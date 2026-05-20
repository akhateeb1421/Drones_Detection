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
import dataclasses
import logging
import time
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

# Set of camera IDs the operator has explicitly paused. The per-camera worker
# loop checks this BEFORE pulling the next frame from its source iterator, so
# for file-based sources (recorded clip) cv2.VideoCapture stays at its current
# byte position — when the operator resumes, the clip continues from where it
# left off instead of having silently advanced through the entire video in the
# background. The flag is set/cleared via the public ``pause_worker`` /
# ``resume_worker`` helpers below, which are called from the cameras API.
_paused_cameras: set[int] = set()

# NOTE on concurrency: an earlier version of this file used a module-level
# ``_executor_lock = asyncio.Lock()`` to serialise every YOLO call across
# every camera. That was necessary back when ``services/inference.py`` held
# a single global model — two cameras hitting ``model.track(persist=True)``
# on the same instance would corrupt each other's ByteTrack state. The lock
# fixed correctness at the cost of starving multi-camera workloads: whichever
# camera re-queued first kept monopolising the mutex.
#
# Each ``TrackingPipeline`` now owns its own YOLO model, so there is no shared
# mutable state to protect. We dispatch inference to the default executor
# without any application-level coordination; PyTorch's internal BLAS/OpenMP
# pool handles fair CPU sharing across concurrent calls.


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


def _enrich_output(
    camera_id: int,
    output,
    infer_frame: np.ndarray,
    areas_local,
) -> tuple[list[dict], list[dict]]:
    """Attach nearest-area / distance / ETA / threat-flag / thumbnail
    bytes onto each raw detection produced by ``pipeline.step``.

    Pure CPU work — no DB access, no awaits — so it can be called inline
    from the live worker, the recorded-clip pre-compute pass, or inside
    an executor without coordination. Returns ``(enriched, threats)``.
    """
    enriched_local: list[dict] = []
    threats_local: list[dict] = []
    for det in output.detections:
        near = nearest(
            det["lat"], det["lon"],
            det["speed_mps"], det["confidence"],
            areas_local,
            angle_deg=det.get("angle_deg"),
        )
        det = dict(det)
        det["nearest_area"] = near.name
        det["dist_m"] = near.distance_m if near.distance_m != float("inf") else None
        det["eta_s"] = near.eta_s

        x1, y1, x2, y2 = det["bbox"]
        pad = 12
        fh, fw = infer_frame.shape[:2]
        cx1, cy1 = max(0, x1 - pad), max(0, y1 - pad)
        cx2, cy2 = min(fw, x2 + pad), min(fh, y2 + pad)
        thumb_bytes: bytes | None = None
        if cx2 > cx1 and cy2 > cy1:
            crop = infer_frame[cy1:cy2, cx1:cx2]
            ok_t, buf_t = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if ok_t:
                thumb_bytes = bytes(buf_t)
        if not thumb_bytes:
            h, w = infer_frame.shape[:2]
            scale = 160.0 / max(h, w) if max(h, w) > 160 else 1.0
            if scale < 1.0:
                small = cv2.resize(
                    infer_frame, (int(w * scale), int(h * scale)),
                    interpolation=cv2.INTER_AREA,
                )
            else:
                small = infer_frame
            ok_f, buf_f = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if ok_f:
                thumb_bytes = bytes(buf_f)
        det["_thumb_bytes"] = thumb_bytes
        enriched_local.append(det)

        threat = alarms_svc.evaluate(
            det["drone_class"], det["confidence"],
            det["eta_s"], det["nearest_area"], det["speed_mps"],
        )
        det["_threat_fired"] = bool(threat.is_threat)
        if threat.is_threat:
            threats_local.append({
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
            })
    return enriched_local, threats_local


# In-memory cache of pre-computed recorded-clip detections, keyed by
# (video, geometry, model, imgsz). A recorded clip is a FIXED file, so its
# per-frame detections never change for a given camera geometry — we run
# YOLO over every frame ONCE and replay the cached results at full native
# fps. This is what makes the recorded clip detect the drone on (almost)
# every frame instead of the ~1-in-12 the live decoupled path manages on
# CPU. Keying on geometry means switching the clip's location re-analyses
# the first time, but switching BACK to a previously-seen location is
# instant. Lost on uvicorn restart (re-computed on next access).
# Cached recorded-clip analysis, keyed by geometry. Value holds the clip's
# native fps plus a list of (annotated_jpeg_bytes, serialized_dets) — one per
# frame. The JPEG is pre-encoded ONCE here so the replay loop does zero
# decode/encode work and the playback-speed sleep alone governs the frame
# rate (otherwise per-frame decode+encode dominates and the speed knob is a
# no-op).
_clip_cache: dict[tuple, dict] = {}


async def _publish_clip_progress(camera_id: int, done: int, total: int) -> None:
    """Push a placeholder 'Analyzing clip… N%' frame to the WebSocket so
    the operator sees progress instead of a frozen 'loading' spinner while
    the one-time pre-compute pass runs."""
    img = np.full((360, 640, 3), (34, 26, 20), dtype=np.uint8)  # dark teal-navy (BGR)
    pct = int(done / total * 100) if total else 0
    msg = f"Analyzing clip... {pct}%" if total else f"Analyzing clip... {done}"
    # Brand cyan #01F2CF -> BGR (207, 242, 1).
    cv2.putText(img, msg, (110, 195), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (207, 242, 1), 2)
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        return
    meta = {
        "type": "frame", "camera_id": camera_id, "frame_idx": 0,
        "ts": datetime.now(timezone.utc).isoformat(),
        "detections": [], "remote": False,
    }
    await frame_bus.publish(f"cam:{camera_id}", {"jpeg": bytes(buf), "meta": meta})


async def _run_recorded_clip(
    camera_id: int,
    video_path: str,
    pipeline: TrackingPipeline,
    tracker_cfg: str,
    geo_key: tuple,
) -> None:
    """Pre-compute detections for a recorded clip ONCE (every frame), then
    loop the video at native fps overlaying the cached detections.

    Why not the live decoupled path? On CPU, YOLO at imgsz=640 runs ~2
    inferences/sec while the clip plays at ~25 fps, so the live path only
    samples ~8% of frames — the drone is detected in a handful of frames
    per loop, sometimes none. A recorded clip is a fixed file, so we can
    afford to analyse every frame once and then replay smoothly with a
    detection on every frame the model can see the drone.
    """
    loop = asyncio.get_running_loop()
    settings = get_settings()

    cached = _clip_cache.get(geo_key)

    # ── Phase 1: pre-compute (only on cache miss) ──────────────────────
    if cached is None:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            cap.release()
            raise RuntimeError(f"Could not open recorded clip '{video_path}' for pre-compute.")
        total_hint = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        # Use the clip's REAL frame rate for the per-frame→per-second speed
        # conversion. The pipeline was constructed with a 25 fps default;
        # pre-compute walks every frame in order so the history points are
        # exactly one clip-frame apart, and the true fps is what makes the
        # m/s figure correct. Clamp to a sane range so a corrupt header
        # can't blow up the speed.
        clip_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        pipeline.fps = max(1.0, min(clip_fps or 25.0, 120.0))
        log.info("Recorded clip cam=%s: clip fps=%.2f (used for speed).", camera_id, pipeline.fps)
        with SessionLocal() as db:
            areas_local = load_areas(db)
        log.info(
            "Recorded clip cam=%s: pre-computing detections over ~%d frames "
            "(one-time; cached per location).", camera_id, total_hint,
        )
        # Each entry: (annotated_jpeg_bytes, serialized_dets). Encoding the
        # overlay HERE — where we already decode every frame for YOLO — means
        # the replay loop never touches the video file or the JPEG encoder,
        # so the playback-speed sleep alone controls the frame rate.
        # Each frame: (annotated_jpeg_bytes, serialized_dets, threats). The
        # threats are kept so Phase 2 can RAISE THE ALARM during replay — the
        # live loop publishes them to the "alarms" channel, but the recorded
        # clip used to discard them, so the recorded clip never alarmed.
        computed: list[tuple[bytes, list[dict], list[dict]]] = []
        # Enriched detections per detected frame, kept so we can (re)persist
        # the pending-approval rows on EVERY worker start — see the persist
        # pass below. Holds the thumbnail bytes too (~tens of KB per detected
        # frame, a handful of frames per clip — negligible memory).
        persist_pass: list[tuple[int, list[dict]]] = []
        detect_frames = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                output = await loop.run_in_executor(None, pipeline.step, frame, tracker_cfg)
                enriched, threats = _enrich_output(camera_id, output, frame, areas_local)
                if enriched:
                    detect_frames += 1
                    persist_pass.append((output.frame_idx, enriched))
                sdets = [_serialize_det(d) for d in enriched]
                annotated = overlay(frame, sdets)
                ok2, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                jpeg_bytes = bytes(buf) if ok2 else b""
                computed.append((jpeg_bytes, sdets, threats))
                if len(computed) % 15 == 0:
                    await _publish_clip_progress(camera_id, len(computed), total_hint)
        finally:
            cap.release()
        cached = {"fps": pipeline.fps, "frames": computed, "persist": persist_pass}
        _clip_cache[geo_key] = cached
        log.info(
            "Recorded clip cam=%s: pre-compute done — %d frames, %d with detections.",
            camera_id, len(computed), detect_frames,
        )
    else:
        log.info(
            "Recorded clip cam=%s: using cached frames (%d).",
            camera_id, len(cached["frames"]),
        )

    frames = cached["frames"]
    clip_fps = cached["fps"]
    total = len(frames)
    if total == 0:
        log.error("Recorded clip cam=%s: no frames decoded; nothing to replay.", camera_id)
        return

    # ── Persist pass: runs on EVERY worker start (cache miss OR hit) ────
    # _persist used to run only inside Phase 1, so re-opening a cached clip
    # left the pending-approvals queue empty even though the boxes replayed
    # fine. Persisting from the cached enriched detections here guarantees
    # the queue is populated whenever the clip is opened. _persist upserts,
    # so re-runs are idempotent (an already-approved/rejected track is only
    # flipped back to pending after a >60s gap — see the REUSED branch).
    persist_list = cached.get("persist", [])
    if persist_list:
        with SessionLocal() as db:
            for fidx, enriched in persist_list:
                if enriched:
                    _persist(db, camera_id, fidx, enriched)
        log.info(
            "Recorded clip cam=%s: persisted %d detected frame(s) to pending queue.",
            camera_id, len(persist_list),
        )

    # ── Phase 2: smooth replay from cached frames ──────────────────────
    # No VideoCapture, no per-frame decode/encode here — we only ship the
    # pre-encoded JPEG bytes and sleep. That makes the playback-speed knob
    # actually control the rate (decode+encode previously dominated the loop
    # and swamped the sleep, so 0.5x and 2.0x looked identical).
    fps_play = max(5.0, min(clip_fps or 30.0, 60.0))
    playback_speed = max(0.1, settings.recorded_clip_playback_speed)
    frame_dt = 1.0 / (fps_play * playback_speed)
    log.info(
        "Recorded clip cam=%s: replaying at %.2fx (%.1f fps native -> %.1f display fps).",
        camera_id, playback_speed, fps_play, fps_play * playback_speed,
    )
    idx = 0
    # Per-track alarm throttle so replaying the drone over many consecutive
    # frames doesn't spam the "alarms" channel — fire at most once every
    # ALARM_THROTTLE_S per track (matches how rarely the live loop emits,
    # which runs inference every N frames). The frontend dedups by track too.
    ALARM_THROTTLE_S = 3.0
    last_alarm: dict[int, float] = {}
    while True:
        # Pause gate (operator stop button) — keeps the clip frozen at the
        # current frame instead of advancing in the background.
        while camera_id in _paused_cameras:
            await asyncio.sleep(0.2)
        if idx >= total:
            idx = 0
        jpeg_bytes, dets, threats = frames[idx]
        idx += 1
        if not jpeg_bytes:
            await asyncio.sleep(frame_dt)
            continue
        meta = {
            "type": "frame",
            "camera_id": camera_id,
            "frame_idx": idx,
            "ts": datetime.now(timezone.utc).isoformat(),
            "detections": dets,
            "remote": False,
        }
        await frame_bus.publish(f"cam:{camera_id}", {"jpeg": jpeg_bytes, "meta": meta})
        # Raise the alarm during playback, when the drone actually appears on
        # screen — re-stamped to "now" and throttled per track. This is the
        # recorded-clip equivalent of the live loop's threat publish.
        if threats:
            now_mono = time.monotonic()
            now_iso = datetime.now(timezone.utc).isoformat()
            for thr in threats:
                tid = thr.get("track_id")
                if now_mono - last_alarm.get(tid, 0.0) >= ALARM_THROTTLE_S:
                    last_alarm[tid] = now_mono
                    await frame_bus.publish("alarms", {**thr, "ts": now_iso})
        await asyncio.sleep(frame_dt)


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

    # Decide source AND model weights AND inference resolution based on
    # the stream_url scheme:
    #   http://... or https://...   -> remote MJPEG stream (e.g. Pi)   [live]
    #   webcam:N or just N          -> local webcam device index N     [live]
    #   anything else               -> local video file (looped demo)  [video]
    #
    # Live cameras typically show a large, close drone (phone screen,
    # indoor demo), so we run YOLO at imgsz=416 to roughly halve the
    # per-frame latency — that drops detection lag from ~1-2 s to
    # ~0.5 s on CPU. The recorded clip shows small, distant drones
    # (~20-40 px), so we keep it at 640 to preserve recall.
    # The weights loader falls back to `settings.yolo_weights` if the
    # per-source file is missing.
    is_file_source = False
    if stream_url.startswith(("http://", "https://")):
        source_iter = stream_jpegs(stream_url)
        is_remote = True
        weights_for_camera = settings.yolo_weights_live
        imgsz_for_camera = settings.yolo_imgsz_live
    elif stream_url.startswith("webcam:") or stream_url.strip().isdigit():
        device_index = int(stream_url.split(":", 1)[1] if ":" in stream_url else stream_url)
        source_iter = read_webcam_as_mjpeg(device_index)
        is_remote = False
        weights_for_camera = settings.yolo_weights_live
        imgsz_for_camera = settings.yolo_imgsz_live
    else:
        source_iter = read_local_video_as_mjpeg(stream_url)
        is_remote = False
        weights_for_camera = settings.yolo_weights_video
        imgsz_for_camera = settings.yolo_imgsz_video
        is_file_source = True
        # The bundled demo drone enters as a tiny distant speck whose
        # confidence sits below the live tracker's 0.35 new-track gate, so
        # ByteTrack never opens a track for it (no track id -> no box, no
        # persisted row, empty pending-approvals). The recorded clip plays
        # clean sky footage where false positives are unlikely, so it gets
        # its own much more sensitive tracker config that lets faint
        # detections start tracks. Live cameras keep the strict default.
        tracker_cfg = str(Path(settings.tracker_cfg_video).resolve())
        # The recorded clip copies its geometry from a long-range
        # surveillance camera, whose multi-kilometre assumed distance
        # makes the demo footage's drone read at hundreds of km/h. Speed
        # scales linearly with the assumed distance, so override it with
        # the dedicated, tunable recorded-clip distance for a realistic
        # readout (CameraGeo is frozen, hence dataclasses.replace).
        geo = dataclasses.replace(
            geo, assumed_target_distance_m=settings.recorded_clip_distance_m
        )

    pipeline = TrackingPipeline(
        geo,
        fps=25.0,
        weights_path=weights_for_camera,
        imgsz=imgsz_for_camera,
        # Recorded clip gets the more sensitive hostile floor (clean sky,
        # tiny distant drone); live cameras keep the global 0.15 default.
        conf_hostile=settings.yolo_conf_video if is_file_source else None,
        # Test-time augmentation only for the recorded clip — it pre-computes
        # once and caches, so the ~3x inference cost is paid a single time and
        # never touches live latency. Raises recall on the side-profile-vs-sky
        # frames the single-pass model misses.
        augment=is_file_source,
    )
    log.info(
        "Starting worker for camera %s (%s) @ %s [weights=%s imgsz=%s]",
        camera_id, cam_name, stream_url, weights_for_camera, imgsz_for_camera,
    )

    # File sources (recorded clip): pre-compute every frame once, then
    # replay smoothly. This is its own self-contained path — it does NOT
    # use the decoupled live loop below. Keyed on geometry so changing
    # the clip's location re-analyses the first time but is instant on
    # return. See _run_recorded_clip for the full rationale.
    if is_file_source:
        # Include the clip file's size + mtime so REPLACING the file at the
        # same path (e.g. swapping in a new shahed.mp4) invalidates the cache
        # and forces a fresh re-analysis. Without this the cache is keyed on
        # the path alone, so a new clip at the old path silently replays the
        # previous analysis — stale boxes AND no new pending-approval rows
        # (Phase 1, the only place we persist, never re-runs).
        try:
            _st = Path(stream_url).stat()
            file_sig = (int(_st.st_size), int(_st.st_mtime))
        except OSError:
            file_sig = (0, 0)
        geo_key = (
            stream_url, file_sig,
            round(geo.latitude, 6), round(geo.longitude, 6),
            round(geo.heading_deg, 2), round(geo.altitude_m, 2),
            round(geo.fov_h_deg, 2), round(geo.fov_v_deg, 2),
            int(geo.sensor_w_px), round(geo.assumed_target_distance_m, 2),
            weights_for_camera, imgsz_for_camera, tracker_cfg,
        )
        try:
            await _run_recorded_clip(camera_id, stream_url, pipeline, tracker_cfg, geo_key)
        except asyncio.CancelledError:
            log.info("Camera %s (recorded clip) worker cancelled.", camera_id)
            raise
        except Exception:  # noqa: BLE001
            log.exception("Camera %s (recorded clip) worker crashed.", camera_id)
        return
    # All source types share the same downstream flow: decoupled overlay,
    # background YOLO task, and the HOLD_FRAMES sticky-box behaviour below.
    # Multi-camera setups are now correctness-safe at the model level — each
    # ``TrackingPipeline`` constructed below owns its own YOLO instance — so
    # this loop intentionally does NOT serialise inference across cameras.
    # See the module-level NOTE near ``_tasks`` for the rationale.

    skip = max(settings.inference_frame_skip, 1)
    every_n = max(settings.inference_every_n_frames, 1)
    frame_counter = 0
    # Truly-decoupled overlay state. `last_enriched` is updated by a
    # background coroutine (`_inference_pass`) so the main display
    # loop NEVER awaits YOLO. Without this, the await on the executor
    # used to drop display fps to inference fps every Nth frame; with
    # the background pattern, display fps == source fps regardless of
    # how slow YOLO is on CPU.
    last_enriched: list[dict] = []
    last_frame_idx = 0
    # Sticky-overlay hold-over: when a YOLO pass returns detections we
    # latch them into `last_enriched` and stamp `last_detection_frame`.
    # Subsequent passes that return ZERO detections do NOT immediately
    # clear `last_enriched` — they only clear it once the hold window
    # has expired. Without this, sporadic per-frame YOLO misses (very
    # common with the stock 416/640 weights on a 1080p clip where the
    # drone occupies <30 px) make the boxes flicker on for one frame
    # and then disappear for many, which the operator perceives as
    # "no detection boxes at all" even though the DB rows + thumbnails
    # prove inference is landing.
    #
    # 25 frames ≈ 1 s of playback at 25 fps — enough to bridge the
    # gap between two non-adjacent successful detections without
    # leaving the box on screen so long that it visibly lags the
    # drone's actual position.
    HOLD_FRAMES = 25
    last_detection_frame = -10_000
    inference_task: asyncio.Task | None = None
    loop = asyncio.get_running_loop()

    async def _inference_pass(infer_frame, fc):
        """Background YOLO + enrich + persist for a single frame.
        Returns (enriched, threats, frame_idx) so the main loop can
        harvest the result without ever awaiting inline.

        No application-level lock here: each ``pipeline`` is the only
        thing that ever touches its own YOLO model + tracker state, so
        concurrent calls from other cameras' inference passes don't need
        coordination. CPU contention is handled by PyTorch internally.
        """
        output = await loop.run_in_executor(
            None, pipeline.step, infer_frame, tracker_cfg
        )
        with SessionLocal() as db:
            areas_local = load_areas(db)
            enriched_local, threats_local = _enrich_output(
                camera_id, output, infer_frame, areas_local
            )
            _persist(db, camera_id, output.frame_idx, enriched_local)
        return enriched_local, threats_local, output.frame_idx

    # Convert the source iterator to an explicit async-iter so we can
    # gate `__anext__()` on the pause flag. With a plain ``async for`` we
    # could only pause AFTER pulling a frame — which would still advance
    # cv2.VideoCapture and drain the file. By checking the flag BEFORE
    # pulling, the underlying capture stays at its current position and
    # the clip resumes from exactly where the operator paused it.
    source_aiter = source_iter.__aiter__()
    try:
        while True:
            # Pause gate. Idle-loop with a short sleep so resuming is
            # snappy (~200 ms latency) without busy-spinning the CPU.
            while camera_id in _paused_cameras:
                await asyncio.sleep(0.2)
            try:
                jpeg = await source_aiter.__anext__()
            except StopAsyncIteration:
                break
            frame_counter += 1
            if frame_counter % skip != 0:
                continue
            frame = _decode(jpeg)
            if frame is None:
                continue

            # Harvest a completed inference (non-blocking). The display
            # loop never waits for YOLO — when the background task
            # finishes, we pick up its result on whichever frame is
            # being processed next.
            if inference_task is not None and inference_task.done():
                try:
                    enriched_r, threats_r, fidx_r = inference_task.result()
                    last_frame_idx = fidx_r
                    if enriched_r:
                        # Fresh detections — latch them and stamp the
                        # hold-over watermark so they stay on screen
                        # even if the next few YOLO passes miss.
                        last_enriched = enriched_r
                        last_detection_frame = frame_counter
                        log.info(
                            "YOLO pass: cam=%s frame=%s -> %d detection(s) %s",
                            camera_id, fidx_r, len(enriched_r),
                            [f"{d['drone_class']}:{d['confidence']:.2f}" for d in enriched_r],
                        )
                    else:
                        # YOLO returned nothing. Only blank the overlay
                        # if the hold window has expired; otherwise
                        # keep drawing the previous boxes.
                        if frame_counter - last_detection_frame > HOLD_FRAMES:
                            last_enriched = []
                    for t in threats_r:
                        await frame_bus.publish("alarms", t)
                except Exception:  # noqa: BLE001
                    log.exception("Background YOLO task failed.")
                inference_task = None

            # Launch a new inference task only when (a) the cadence
            # says so AND (b) no inference is already in flight. The
            # second condition naturally throttles YOLO to whatever
            # rate CPU can sustain — if YOLO is slow, frames just
            # skip inference and reuse last_enriched, but display fps
            # stays at source fps.
            do_inference = (frame_counter % every_n == 0) and inference_task is None
            if do_inference:
                # Copy the frame so the inference task has its own
                # buffer (the main loop will overwrite `frame` on the
                # next iteration of source_iter).
                inference_task = asyncio.create_task(
                    _inference_pass(frame.copy(), frame_counter)
                )


            # Build annotated JPEG for the live preview, reusing
            # `last_enriched` whether or not we just ran YOLO. On the
            # very first frame (before any inference has happened),
            # this overlays nothing, which is the correct behavior.
            annotated = overlay(frame, last_enriched)
            ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if not ok:
                continue
            jpeg_out = bytes(buf)

            meta = {
                "type": "frame",
                "camera_id": camera_id,
                "frame_idx": last_frame_idx,
                "ts": datetime.now(timezone.utc).isoformat(),
                "detections": [_serialize_det(d) for d in last_enriched],
                "remote": is_remote,
            }
            await frame_bus.publish(f"cam:{camera_id}", {"jpeg": jpeg_out, "meta": meta})

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
    """Write a track's thumbnail JPEG to disk ATOMICALLY; return the relative path.

    The previous implementation used Path.write_bytes() which opens the
    destination, writes in chunks, then closes. The dashboard polls
    /detections/tracks every 2 s and the browser fetches each thumbnail
    in a separate HTTP request — if the pipeline happened to be mid-
    rewrite (every higher-confidence frame re-saves the same file),
    the browser could receive a half-written JPEG, trigger the <img>
    onError handler, and the row's image would disappear.

    The fix: write to a hidden temp file in the same directory, then
    `os.replace()` to swap it into place. os.replace is atomic on
    POSIX and on Windows (Windows >= XP) — a concurrent reader either
    sees the OLD complete file or the NEW complete file, never a
    partial one.
    """
    try:
        import os
        from app.core.config import get_settings
        thumb_dir = Path(get_settings().thumbnail_dir).resolve()
        thumb_dir.mkdir(parents=True, exist_ok=True)
        rel = f"cam_{camera_id}_track_{track_id}.jpg"
        full = thumb_dir / rel
        log.info(
            "THUMB save start: cam=%s track=%s bytes=%d -> %s",
            camera_id, track_id, len(jpeg_bytes), full,
        )
        tmp = full.with_name(f".{full.name}.tmp")
        tmp.write_bytes(jpeg_bytes)
        log.info(
            "THUMB tmp written: exists=%s path=%s",
            tmp.exists(), tmp,
        )
        os.replace(tmp, full)
        log.info(
            "THUMB after os.replace: full.exists()=%s",
            full.exists(),
        )
        # Belt-and-braces: confirm the file actually landed. On Windows
        # with OneDrive Files-On-Demand + Storage Sense, brand-new
        # files in synced folders can be evicted from local disk
        # moments after creation, even though os.replace() returned
        # success. If we don\'t verify here, the DB row gets a
        # thumbnail_path pointing at a file that won\'t be on disk
        # the next time the API reads it. Returning None keeps the
        # column NULL so the frontend renders the placeholder dash
        # rather than a broken-image row.
        if not full.exists():
            log.error(
                "Thumbnail %s vanished immediately after rename. This is "
                "almost always OneDrive / Storage Sense de-localizing the "
                "file. Set THUMBNAIL_DIR in backend/.env to a non-synced "
                "path (e.g. %%LOCALAPPDATA%%/capstone-thumbnails).",
                full,
            )
            return None
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
            # Loud INFO so the operator can verify in uvicorn output that
            # hostile tracks are actually being persisted with
            # status="pending". If you see "non-hostile" classes here
            # (bird/airplane/helicopter) they will be created BUT the
            # frontend now filters them out — that's expected.
            log.info(
                "NEW TRACK cam=%s track=%s class=%s conf=%.2f -> status=pending",
                camera_id, det["track_id"], det["drone_class"], float(det["confidence"]),
            )

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
            # ByteTrack restarts its ID counter from 1 every time the
            # worker (re)starts, so after a uvicorn restart a brand-new
            # drone can collide with a previously reviewed track_id. If
            # the row was approved or rejected AND the new sighting
            # arrives after a meaningful gap, treat it as a fresh
            # sighting: flip status back to "pending", clear the prior
            # verdict, and re-stamp first_seen_at. Without this, old
            # rejected decisions silently hide every future DJI track
            # on the same ID.
            gap_s = (now - track.last_seen_at).total_seconds()
            if track.status != "pending" and gap_s > 60:
                log.info(
                    "TRACK REUSED cam=%s track=%s was %s -> resetting to pending (gap=%.1fs)",
                    camera_id, det["track_id"], track.status, gap_s,
                )
                track.status = "pending"
                track.reviewed_at = None
                track.outcome = None
                track.alarm_fired_at = None
                track.first_seen_at = now
                # CRITICAL: also reset thumbnail_path and max_confidence
                # so the next frame's _save_thumbnail call actually
                # fires. Without this, an ID reused from a previous
                # uvicorn session keeps pointing at the OLD (possibly
                # missing) thumbnail file, and the "if
                # track.thumbnail_path is None" backfill check below
                # never triggers — so the row sits in pending forever
                # with a broken-image placeholder.
                track.thumbnail_path = None
                track.max_confidence = None
            track.last_seen_at = now
            track.voted_class = det["drone_class"]
            # Save a fresh thumbnail when the DB path is either None OR
            # points at a file that no longer exists on disk (left over
            # from a previous run after OneDrive deleted it, a cleared
            # cache, a moved thumbnail_dir, etc.). The on-disk check
            # protects against the exact bug we just chased: TRACK
            # REUSED would reset status to pending but leave a stale
            # thumbnail_path, so this branch never fired and the row
            # rendered the dash placeholder forever.
            needs_thumb = track.thumbnail_path is None
            if not needs_thumb and track.thumbnail_path:
                try:
                    from app.core.config import get_settings as _gs
                    _td = Path(_gs().thumbnail_dir).resolve()
                    if not (_td / track.thumbnail_path).exists():
                        needs_thumb = True
                except Exception:  # noqa: BLE001
                    pass
            if needs_thumb and det.get("_thumb_bytes"):
                first_thumb = _save_thumbnail(
                    camera_id, det["track_id"], det["_thumb_bytes"]
                )
                if first_thumb:
                    track.thumbnail_path = first_thumb
            # New high-water confidence -> overwrite the saved thumbnail
            # with the better frame.
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


async def ensure_worker(camera_id: int) -> None:
    """Spawn a worker for `camera_id` if one isn\'t already running.

    Used by the cameras API (create / update / recorded-clip bootstrap)
    so newly-added cameras start producing frames immediately instead
    of waiting for the next uvicorn restart. Idempotent.
    """
    existing = _tasks.get(camera_id)
    if existing is not None and not existing.done():
        return  # already running
    log.info("Spawning pipeline worker for camera %s (ensure_worker).", camera_id)
    _tasks[camera_id] = asyncio.create_task(
        _run_camera(camera_id), name=f"cam-{camera_id}"
    )


async def pause_worker(camera_id: int) -> None:
    """Stop the worker for ``camera_id`` from pulling new frames.

    The worker keeps its source iterator open (cv2.VideoCapture stays at
    its current position for file-based sources, so a resume picks up
    where the operator paused), but stops consuming and stops publishing
    to the WebSocket. Idempotent.
    """
    if camera_id in _paused_cameras:
        return
    _paused_cameras.add(camera_id)
    log.info("Paused worker for camera %s.", camera_id)


async def resume_worker(camera_id: int) -> None:
    """Resume a previously-paused worker. Idempotent."""
    if camera_id not in _paused_cameras:
        return
    _paused_cameras.discard(camera_id)
    log.info("Resumed worker for camera %s.", camera_id)


def is_paused(camera_id: int) -> bool:
    """Whether the worker for ``camera_id`` is currently paused."""
    return camera_id in _paused_cameras


async def restart_worker(camera_id: int) -> None:
    """Cancel + respawn the worker for `camera_id`. Used when the
    camera\'s geo or stream_url changes — the worker snapshots config
    at startup, so a restart is the cheapest way to pick up the new
    settings (geo, stream_url, weights, imgsz, clip fps)."""
    existing = _tasks.pop(camera_id, None)
    if existing is not None:
        existing.cancel()
        try:
            await existing
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    log.info("Restarting pipeline worker for camera %s.", camera_id)
    _tasks[camera_id] = asyncio.create_task(
        _run_camera(camera_id), name=f"cam-{camera_id}"
    )

