"""WebSocket endpoint that streams a pre-loaded video file through
the YOLO + ByteTrack pipeline and publishes annotated frames + metadata.
Mirrors the live-camera pipeline but reads from a local video file on loop.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.services.eta import load_areas, nearest
from app.services.geo import CameraGeo
from app.services.inference import TrackingPipeline, overlay

log = logging.getLogger(__name__)
router = APIRouter()

# Default camera geo — Riyadh center, same as live demo defaults
_DEFAULT_GEO = CameraGeo(
    latitude=24.7136,
    longitude=46.6753,
    heading_deg=0.0,
    altitude_m=50.0,
    fov_h_deg=90.0,
    fov_v_deg=60.0,
    sensor_w_px=640,
    assumed_target_distance_m=300.0,
)


@router.websocket("/ws/video")
async def video_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    settings = get_settings()
    tracker_cfg = str(Path(settings.tracker_cfg).resolve())

    video_path = Path(settings.fallback_video).resolve()
    if not video_path.exists():
        await websocket.send_json({"type": "error", "message": "Video file not found"})
        await websocket.close()
        return

    pipeline = TrackingPipeline(_DEFAULT_GEO, fps=25.0)
    from app.services.inference import _ensure_model
    _ensure_model()  # pre-load model before entering thread
    loop = asyncio.get_running_loop()
    skip = max(settings.inference_frame_skip, 1)
    frame_counter = 0

    try:
        while True:
            cap = cv2.VideoCapture(str(video_path))
            if not cap.isOpened():
                await websocket.send_json({"type": "error", "message": "Cannot open video"})
                break

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                frame_counter += 1
                if frame_counter % skip != 0:
                    await asyncio.sleep(0.01)
                    continue

                # Run inference in thread
                output = await loop.run_in_executor(None, pipeline.step, frame, tracker_cfg)

                # Enrich with ETA + nearest area
                with SessionLocal() as db:
                    areas = load_areas(db)
                    enriched: list[dict] = []
                    for det in output.detections:
                        near = nearest(
                            det["lat"], det["lon"], det["speed_mps"],
                            det["confidence"], areas, angle_deg=det.get("angle_deg"),
                        )
                        det = dict(det)
                        det["nearest_area"] = near.name
                        det["dist_m"] = near.distance_m if near.distance_m != float("inf") else None
                        det["eta_s"] = near.eta_s
                        enriched.append(det)

                # Annotate frame
                annotated = overlay(frame, enriched)
                ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                if not ok:
                    continue

                def _fix(d: dict) -> dict:
                    out = dict(d)
                    if out.get("eta_s") in (float("inf"), float("-inf")):
                        out["eta_s"] = None
                    if out.get("dist_m") in (float("inf"), float("-inf")):
                        out["dist_m"] = None
                    out.pop("_thumb_bytes", None)
                    return out

                meta = {
                    "type": "frame",
                    "frame_idx": output.frame_idx,
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "detections": [_fix(d) for d in enriched],
                }

                try:
                    await websocket.send_bytes(bytes(buf))
                    await asyncio.sleep(0.01)
                    await websocket.send_json(meta)
                except Exception:
                    log.info("Client disconnected during send")
                    return

            cap.release()

    # try:
    #     while True:
    #         cap = cv2.VideoCapture(str(video_path))
    #         if not cap.isOpened():
    #             await websocket.send_json({"type": "error", "message": "Cannot open video"})
    #             break

    #         while True:
    #             ret, frame = cap.read()
    #             if not ret:
    #                 break  # end of video → loop

    #             frame_counter += 1
    #             if frame_counter % skip != 0:
    #                 await asyncio.sleep(0.01)
    #                 continue

    #             # Run inference in thread
    #             output = await loop.run_in_executor(None, pipeline.step, frame, tracker_cfg)

    #             # Enrich with ETA + nearest area
    #             with SessionLocal() as db:
    #                 areas = load_areas(db)
    #                 enriched: list[dict] = []
    #                 for det in output.detections:
    #                     near = nearest(
    #                         det["lat"], det["lon"], det["speed_mps"],
    #                         det["confidence"], areas, angle_deg=det.get("angle_deg"),
    #                     )
    #                     det = dict(det)
    #                     det["nearest_area"] = near.name
    #                     det["dist_m"] = near.distance_m if near.distance_m != float("inf") else None
    #                     det["eta_s"] = near.eta_s
    #                     enriched.append(det)

    #             # Annotate frame
    #             annotated = overlay(frame, enriched)
    #             ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    #             if not ok:
    #                 continue

    #             # Serialize
    #             def _fix(d: dict) -> dict:
    #                 out = dict(d)
    #                 if out.get("eta_s") in (float("inf"), float("-inf")):
    #                     out["eta_s"] = None
    #                 if out.get("dist_m") in (float("inf"), float("-inf")):
    #                     out["dist_m"] = None
    #                 out.pop("_thumb_bytes", None)
    #                 return out

    #             meta = {
    #                 "type": "frame",
    #                 "frame_idx": output.frame_idx,
    #                 "ts": datetime.now(timezone.utc).isoformat(),
    #                 "detections": [_fix(d) for d in enriched],
    #             }

    #             # Send JPEG bytes then metadata
    #             await websocket.send_bytes(bytes(buf))
    #             await websocket.send_json(meta)
    #             await asyncio.sleep(0.04)  # ~25 fps cap

    #         cap.release()

    except WebSocketDisconnect:
        log.info("Video WS client disconnected")
    except Exception:
        log.exception("Video WS error")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass