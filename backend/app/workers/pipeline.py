"""Per-camera ingestion + inference workers.

Pulls JPEG frames from each enabled camera, runs YOLO + tracker, persists
detections + track summaries, and publishes annotated frames + metadata to the
WebSocket `frame_bus`.

We use one async task per camera, but inference itself is offloaded to a thread
(YOLO is CPU-bound and not async-aware). Frame backlog is bounded to 1 — old
frames are dropped, never queued.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import cv2  # type: ignore[import-untyped]
import numpy as np
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import Camera, Detection, Track
from app.services import cross_camera
from app.services import alarms as alarms_svc
from app.services.eta import load_areas, nearest
from app.services.geo import CameraGeo
from app.services.inference import TrackingPipeline, overlay
from app.streaming.frame_bus import frame_bus
from app.streaming.pi_client import read_local_video_as_mjpeg, read_webcam_as_mjpeg, stream_jpegs

log = logging.getLogger(__name__)


_tasks: dict[int, asyncio.Task] = {}
_executor_lock = asyncio.Lock()


def _camera_geo(cam: Camera) -> CameraGeo:
    return CameraGeo(
        latitude=float(cam.latitude),
        longitude=float(cam.longitude),
        heading_deg=float(cam.heading_deg),
        altitude_m=float(cam.altitude_m),
        fov_h_deg=float(cam.fov_h_deg),
        fov_v_deg=float(cam.fov_v_deg),
        sensor_w_px=int(cam.sensor_w_px),
        assumed_target_distance_m=float(cam.assumed_target_distance_m),
    )


def _decode(jpeg: bytes) -> np.ndarray | None:
    arr = np.frombuffer(jpeg, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


async def _run_camera(camera_id: int) -> None:
    settings = get_settings()
    tracker_cfg = str(Path(settings.tracker_cfg).resolve())

    # Snapshot the config; if the admin edits the camera we restart this task.
    with SessionLocal() as db:
        cam = db.get(Camera, camera_id)
        if cam is None or not cam.enabled:
            log.info("Camera %s missing or disabled; skipping.", camera_id)
            return
        geo = _camera_geo(cam)
        stream_url = cam.stream_url
        cam_name = cam.name

    pipeline = TrackingPipeline(geo, fps=25.0)
    log.info("Starting worker for camera %s (%s) @ %s", camera_id, cam_name, stream_url)

    # Decide source based on the stream_url scheme:
    #   http://... or https://...   -> remote MJPEG stream (e.g. Pi)
    #   webcam:N or just N          -> local webcam device index N
    #   anything else               -> local video file (looped for demo)
    if stream_url.startswith(("http://", "https://")):
        source_iter = stream_jpegs(stream_url)
        is_remote = True
    elif stream_url.startswith("webcam:") or stream_url.strip().isdigit():
        device_index = int(stream_url.split(":", 1)[1] if ":" in stream_url else stream_url)
        source_iter = read_webcam_as_mjpeg(device_index)
        is_remote = False
    else:
        source_iter = read_local_video_as_mjpeg(stream_url)
        is_remote = False

    skip = max(settings.inference_frame_skip, 1)
    frame_counter = 0
    loop = asyncio.get_running_loop()

    try:
        async for jpeg in source_iter:
            frame_counter += 1
            if frame_counter % skip != 0:
                continue
            frame = _decode(jpeg)
            if frame is None:
                continue

            # Run YOLO + tracker in a worker thread so the event loop stays free.
            async with _executor_lock:  # serialize CPU access if multiple cams contend
                output = await loop.run_in_executor(None, pipeline.step, frame, tracker_cfg)

            # Enrich with ETA + nearest area.
            with SessionLocal() as db:
                areas = load_areas(db)
                enriched: list[dict] = []
                threats: list[dict] = []
                for det in output.detections:
                    near = nearest(
                        det["lat"],
                        det["lon"],
                        det["speed_mps"],
                        det["confidence"],
                        areas,
                        angle_deg=det.get("angle_deg"),
                    )
                    det = dict(det)
                    det["nearest_area"] = near.name
                    det["dist_m"] = near.distance_m if near.distance_m != float("inf") else None
                    det["eta_s"] = near.eta_s

                    # Crop the bbox out of the current frame for the
                    # pending-approvals thumbnail. JPEG-encode in memory;
                    # _persist decides whether to actually save to disk
                    # (only when this is the best frame for the track).
                    x1, y1, x2, y2 = det["bbox"]
                    pad = 12
                    fh, fw = frame.shape[:2]
                    cx1, cy1 = max(0, x1 - pad), max(0, y1 - pad)
                    cx2, cy2 = min(fw, x2 + pad), min(fh, y2 + pad)
                    if cx2 > cx1 and cy2 > cy1:
                        crop = frame[cy1:cy2, cx1:cx2]
                        ok_t, buf_t = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                        det["_thumb_bytes"] = bytes(buf_t) if ok_t else None
                    enriched.append(det)

                    threat = alarms_svc.evaluate(
                        det["drone_class"],
                        det["confidence"],
                        det["eta_s"],
                        det["nearest_area"],
                        det["speed_mps"],
                    )
                    # Tagged on the detection so _persist can stamp the track
                    # row's alarm_fired_at and the dashboard can reconcile
                    # CRITICAL badges with real alarms.
                    det["_threat_fired"] = bool(threat.is_threat)
                    if threat.is_threat:
                        threats.append(
                            {
                                "camera_id": camera_id,
                                "track_id": det["track_id"],
                                "drone_class": det["drone_class"],
                                "confidence": det["confidence"],
                                "lat": det["lat"],
                                "lon": det["lon"],
                                "nearest_area": det["nearest_area"],
                                "eta_s": det["eta_s"],
                                "score": threat.score,
                                "reasons": threat.reasons,
                                "ts": datetime.now(timezone.utc).isoformat(),
                            }
                        )

                # Persist detections + track summaries.
                _persist(db, camera_id, output.frame_idx, enriched)

            # Build annotated JPEG for the live preview.
            annotated = overlay(frame, enriched)
            ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if not ok:
                continue
            jpeg_out = bytes(buf)

            meta = {
                "type": "frame",
                "camera_id": camera_id,
                "frame_idx": output.frame_idx,
                "ts": datetime.now(timezone.utc).isoformat(),
                "detections": [_serialize_det(d) for d in enriched],
                "remote": is_remote,
            }
            await frame_bus.publish(f"cam:{camera_id}", {"jpeg": jpeg_out, "meta": meta})
            for t in threats:
                await frame_bus.publish("alarms", t)

    except asyncio.CancelledError:
        log.info("Camera %s worker cancelled.", camera_id)
        raise
    except Exception:  # noqa: BLE001
        log.exception("Camera %s worker crashed.", camera_id)


def _serialize_det(d: dict) -> dict:
    out = dict(d)
    if out.get("eta_s") in (float("inf"), float("-inf")):
        out["eta_s"] = None
    if out.get("dist_m") in (float("inf"), float("-inf")):
        out["dist_m"] = None
    # Don't ship raw JPEG bytes over the WebSocket JSON — only metadata.
    out.pop("_thumb_bytes", None)
    return out


def _save_thumbnail(camera_id: int, track_id: int, jpeg_bytes: bytes) -> str | None:
    """Write a track's thumbnail JPEG to disk; return the relative path."""
    try:
        from app.core.config import get_settings
        thumb_dir = Path(get_settings().thumbnail_dir).resolve()
        thumb_dir.mkdir(parents=True, exist_ok=True)
        rel = f"cam_{camera_id}_track_{track_id}.jpg"
        full = thumb_dir / rel
        full.write_bytes(jpeg_bytes)
        return rel
    except Exception:  # noqa: BLE001
        log.exception("Failed to save thumbnail for cam=%s track=%s", camera_id, track_id)
        return None


def _persist(db, camera_id: int, frame_idx: int, detections: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    for det in detections:
        db.add(
            Detection(
                camera_id=camera_id,
                track_id=det["track_id"],
                frame_idx=frame_idx,
                drone_class=det["drone_class"],
                confidence=float(det["confidence"]),
                latitude=det["lat"],
                longitude=det["lon"],
                speed_mps=float(det["speed_mps"]),
                direction=det["direction"],
                angle_deg=float(det["angle_deg"]),
                nearest_area=det["nearest_area"],
                dist_m=det["dist_m"],
                eta_s=det["eta_s"],
                bbox_x1=det["bbox"][0],
                bbox_y1=det["bbox"][1],
                bbox_x2=det["bbox"][2],
                bbox_y2=det["bbox"][3],
                captured_at=now,
            )
        )

        track = db.execute(
            select(Track).where(Track.camera_id == camera_id, Track.track_id == det["track_id"])
        ).scalar_one_or_none()
        if track is None:
            # First time we see this track on this camera. Try to link it to a
            # recent track from another camera (cross-camera handoff) so the
            # frontend can keep treating it as the same drone.
            link = cross_camera.find_link(db, camera_id, float(det["lat"]), float(det["lon"]), now)
            link_id = link.id if link is not None else None

            thumb_rel = None
            if det.get("_thumb_bytes"):
                thumb_rel = _save_thumbnail(camera_id, det["track_id"], det["_thumb_bytes"])

            track = Track(
                camera_id=camera_id,
                track_id=det["track_id"],
                first_seen_at=now,
                last_seen_at=now,
                voted_class=det["drone_class"],
                max_confidence=float(det["confidence"]),
                max_speed_mps=float(det["speed_mps"]),
                min_eta_s=det["eta_s"],
                nearest_area=det["nearest_area"],
                last_lat=float(det["lat"]),
                last_lon=float(det["lon"]),
                last_heading_deg=float(det["angle_deg"]),
                linked_track_id=link_id,
                thumbnail_path=thumb_rel,
                status="pending",
                alarm_fired_at=now if det.get("_threat_fired") else None,
            )
            db.add(track)
            # Make the link visible on the WebSocket payload so the frontend
            # can merge tracks across cameras into one drone.
            det["linked_track_id"] = link.track_id if link is not None else None
            det["link_root_camera_id"] = link.camera_id if link is not None else None
        else:
            track.last_seen_at = now
            track.voted_class = det["drone_class"]
            # New high-water confidence -> overwrite the saved thumbnail.
            if track.max_confidence is None or det["confidence"] > track.max_confidence:
                track.max_confidence = float(det["confidence"])
                if det.get("_thumb_bytes"):
                    new_thumb = _save_thumbnail(camera_id, det["track_id"], det["_thumb_bytes"])
                    if new_thumb:
                        track.thumbnail_path = new_thumb
            if track.max_speed_mps is None or det["speed_mps"] > track.max_speed_mps:
                track.max_speed_mps = float(det["speed_mps"])
            if det["eta_s"] is not None and (track.min_eta_s is None or det["eta_s"] < track.min_eta_s):
                track.min_eta_s = float(det["eta_s"])
            track.nearest_area = det["nearest_area"]
            track.last_lat = float(det["lat"])
            track.last_lon = float(det["lon"])
            track.last_heading_deg = float(det["angle_deg"])
            # Stamp the first time an alarm fires for this track. Subsequent
            # alarms keep the original timestamp so the field reads as "alarm
            # has been raised at least once" rather than "most recent alarm".
            if det.get("_threat_fired") and track.alarm_fired_at is None:
                track.alarm_fired_at = now
            # Pass the existing link forward in subsequent frames too, so the
            # frontend always knows the merge key.
            if track.linked_track_id is not None:
                parent = db.get(Track, track.linked_track_id)
                if parent is not None:
                    det["linked_track_id"] = parent.track_id
                    det["link_root_camera_id"] = parent.camera_id
    db.commit()


async def startup_pipeline() -> None:
    """Spawn one worker task per enabled camera at app startup."""
    with SessionLocal() as db:
        cams = list(db.execute(select(Camera).where(Camera.enabled.is_(True))).scalars().all())
    for cam in cams:
        if cam.id in _tasks:
            continue
        _tasks[cam.id] = asyncio.create_task(_run_camera(cam.id), name=f"cam-{cam.id}")
    log.info("Started pipeline workers: %s", list(_tasks.keys()))


async def shutdown_pipeline() -> None:
    for tid, task in list(_tasks.items()):
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        del _tasks[tid]
