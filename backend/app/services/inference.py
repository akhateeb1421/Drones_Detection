"""YOLO + ByteTrack wrapper.

Each `TrackingPipeline` owns its own YOLO model instance. This is a deliberate
departure from the original module-level singleton design: ultralytics keeps
ByteTrack state inside the model object (via the predictor when ``persist=True``
is passed), so two cameras sharing a single model would corrupt each other's
tracker state. The original codebase worked around that by serialising every
call through a global ``asyncio.Lock`` in ``workers/pipeline.py`` — which fixed
correctness at the cost of starving multi-camera setups.

Moving the model into ``TrackingPipeline`` makes each camera fully independent:

* Tracker state is isolated per camera (no cross-camera ID collisions on the
  bytetrack side; we still keep our own per-pipeline ``_id_remap`` on top).
* No application-level lock is needed — PyTorch's internal BLAS/OpenMP thread
  pool fairly shares CPU between concurrent inference calls.
* A missing weights file fails one worker cleanly instead of cascading.

Velocity estimation
-------------------
Speed and heading come from a per-track constant-velocity Kalman filter
(``services/kalman.py``) fed with REAL timestamps. The previous
least-squares + EMA scheme assumed consecutive samples were exactly one
video frame apart and multiplied by ``fps``; on the live path YOLO only
runs every Nth frame (and only when the previous pass finished), so live
speeds were inflated by the sampling gap. ``step()`` now takes an
explicit ``t_s``: the worker passes a monotonic wall clock for live
sources, and the recorded-clip pre-compute (which walks every frame in
order) falls back to ``frame_idx / fps`` — both produce correct m/s.
The filter also yields honest 1-sigma uncertainties on speed and heading,
which ship with each detection so the UI can draw a prediction cone.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

from app.core.config import get_settings
from app.services.geo import (
    CameraGeo,
    angle_to_compass,
    pixel_to_world,
)
from app.services.kalman import CVKalman

log = logging.getLogger(__name__)

M_PER_DEG_LAT = 111_320.0


@dataclass
class FrameOutput:
    """Result of running detection + tracking on one frame."""

    frame_idx: int
    detections: list[dict]


class TrackingPipeline:
    """Per-camera state: keeps a YOLO model + tracker + Kalman smoothing.

    Each instance is fully self-contained. Two pipelines can run inference
    concurrently without coordinating because they share no mutable state.
    """

    CLASS_VOTE_LEN = 15
    # Drop per-track state (Kalman filter, class votes, id remap) for raw
    # tracker ids not seen for this long. Without pruning these dicts grow
    # one entry per ByteTrack id forever — a slow leak on a live camera
    # that runs for weeks.
    STATE_TTL_S = 120.0
    PRUNE_EVERY_STEPS = 300

    def __init__(
        self,
        cam: CameraGeo,
        fps: float = 25.0,
        weights_path: str | None = None,
        imgsz: int | None = None,
        conf_hostile: float | None = None,
        augment: bool = False,
    ) -> None:
        self.cam = cam
        self.fps = fps
        # Per-pipeline hostile-class confidence floor. Lets the recorded
        # clip run a more sensitive floor than the live camera. None ->
        # fall back to the global ``settings.yolo_conf_hostile``.
        self._conf_hostile = conf_hostile
        # Test-time augmentation (TTA). Only enabled for the recorded clip,
        # which pre-computes once and caches — so the ~3x inference cost is
        # paid a single time and never affects live latency.
        self._augment = augment
        # Class votes are (class_id, confidence) pairs; the voted class is
        # the one with the highest SUMMED confidence over the window. A
        # count-based majority let a run of low-confidence "dji" frames
        # outvote fewer but confident "shahed_136" frames while a target
        # was still small/distant.
        self._class_votes: dict[int, deque[tuple[int, float]]] = defaultdict(
            lambda: deque(maxlen=self.CLASS_VOTE_LEN)
        )
        self._id_remap: dict[int, int] = {}
        self._next_id = 1
        self._frame_idx = 0
        # Per-track Kalman filter (world ENU frame anchored at the camera)
        # and the last time each raw tracker id produced a detection —
        # used both to hold a stable heading across near-static frames and
        # to prune stale per-track state.
        self._kf: dict[int, CVKalman] = {}
        self._last_seen_t: dict[int, float] = {}
        self._last_angle: dict[int, float] = {}
        # Resolve imgsz: explicit arg wins; 0/None falls back to the legacy
        # global default.
        settings = get_settings()
        self._imgsz = imgsz if (imgsz is not None and imgsz > 0) else settings.yolo_imgsz
        # Per-pipeline YOLO model — see module docstring.
        self._model, self._class_names = self._load_model(weights_path)

    @staticmethod
    def _load_model(weights_path: str | None = None) -> tuple[object, dict[int, str]]:
        """Load YOLO weights and return (model, class_names).

        If ``weights_path`` is provided AND points at an existing file we use
        it directly. If the requested file is missing we fall back to the
        legacy ``settings.yolo_weights`` so a misconfigured per-source path
        doesn't take the worker down — it just runs on the generic model
        with a warning.
        """
        from ultralytics import YOLO  # heavy import, deferred

        settings = get_settings()
        # resolve_path anchors relative .env paths to backend/ so the
        # launch directory doesn't matter.
        requested = settings.resolve_path(weights_path) if weights_path else None
        if requested is not None and not requested.exists():
            fallback = settings.resolve_path(settings.yolo_weights)
            log.warning(
                "Requested YOLO weights %s not found; falling back to %s. "
                "Add the file or update YOLO_WEIGHTS_LIVE / YOLO_WEIGHTS_VIDEO in .env "
                "to silence this warning.",
                requested, fallback,
            )
            requested = fallback
        if requested is None:
            requested = settings.resolve_path(settings.yolo_weights)
        if not requested.exists():
            raise FileNotFoundError(f"YOLO weights not found at {requested}")
        log.info("Loading YOLO weights from %s", requested)
        model = YOLO(str(requested))
        names = dict(model.names)
        log.info("Model classes (%s): %s", requested.name, names)
        return model, names

    def _clean_id(self, raw_id: int) -> int:
        if raw_id not in self._id_remap:
            self._id_remap[raw_id] = self._next_id
            self._next_id += 1
        return self._id_remap[raw_id]

    def _prune_stale_state(self, now_t: float) -> None:
        """Drop per-track dict entries for ids unseen for STATE_TTL_S."""
        stale = [
            rid for rid, seen in self._last_seen_t.items()
            if now_t - seen > self.STATE_TTL_S
        ]
        for rid in stale:
            self._last_seen_t.pop(rid, None)
            self._kf.pop(rid, None)
            self._last_angle.pop(rid, None)
            self._class_votes.pop(rid, None)
            # NOTE: _id_remap entries are kept intentionally — they're tiny
            # (two ints) and dropping them could reassign a clean id that
            # the DB still references. They only reset with the pipeline.
        if stale:
            log.debug("Pruned %d stale track states.", len(stale))

    def step(
        self,
        frame_bgr: np.ndarray,
        tracker_cfg_path: str,
        t_s: float | None = None,
    ) -> FrameOutput:
        """Run detection + tracking on one frame.

        ``t_s`` is the frame's timestamp in seconds on any monotonic clock
        (only deltas matter). Live workers MUST pass a real clock so the
        Kalman velocity uses true time deltas. When None (recorded-clip
        pre-compute, which steps every frame in order), falls back to
        ``frame_idx / fps``.
        """
        model = self._model
        settings = get_settings()
        # Lower the floor we hand to YOLO to the *hostile* threshold so
        # marginal DJI/Shahed/Orlan detections survive past NMS and reach
        # the tracker. Non-hostile classes that come through at this low
        # bar are dropped further down in the per-detection loop.
        hostile_floor = (
            self._conf_hostile if self._conf_hostile is not None else settings.yolo_conf_hostile
        )
        conf_floor = min(settings.yolo_conf, hostile_floor)
        results = model.track(
            source=frame_bgr,
            tracker=tracker_cfg_path,
            conf=conf_floor,
            iou=settings.yolo_iou,
            imgsz=self._imgsz,
            augment=self._augment,
            persist=True,
            verbose=False,
            stream=False,
        )
        self._frame_idx += 1
        now_t = float(t_s) if t_s is not None else self._frame_idx / max(self.fps, 1e-6)
        if self._frame_idx % self.PRUNE_EVERY_STEPS == 0:
            self._prune_stale_state(now_t)

        out: list[dict] = []
        if not results:
            return FrameOutput(self._frame_idx, out)

        result = results[0]
        if result.boxes is None or result.boxes.id is None:
            return FrameOutput(self._frame_idx, out)

        boxes = result.boxes.xyxy.cpu().numpy()
        ids = result.boxes.id.cpu().numpy().astype(int)
        confs = result.boxes.conf.cpu().numpy()
        classes = result.boxes.cls.cpu().numpy().astype(int)

        # Mirror of alarms.HOSTILE_CLASSES, duplicated here as a local
        # set to avoid the circular import inference <-> alarms.
        _HOSTILE = {
            "shahed", "shahed_136", "shahed-136", "shahed136",
            "orlan", "orlan-10", "orlan10", "orlan_10",
            "dji", "drone",
        }

        frame_h, frame_w = frame_bgr.shape[:2]
        cos_cam_lat = math.cos(math.radians(self.cam.latitude))
        for box, raw_tid, conf, cls_id in zip(boxes, ids, confs, classes):
            x1, y1, x2, y2 = map(int, box)
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

            self._class_votes[raw_tid].append((int(cls_id), float(conf)))
            weights: dict[int, float] = {}
            for cid, w in self._class_votes[raw_tid]:
                weights[cid] = weights.get(cid, 0.0) + w
            voted_cls = max(weights, key=lambda c: weights[c])
            drone_class = self._class_names.get(voted_cls, f"cls_{voted_cls}")

            # Per-class confidence gate: non-hostile classes still have
            # to clear the regular yolo_conf bar (default 0.50).
            if drone_class.lower().strip() not in _HOSTILE and float(conf) < settings.yolo_conf:
                continue

            # World-frame position (tangent-plane crossing model — a target
            # crossing the frame traces a STRAIGHT line on the map).
            lat, lon = pixel_to_world(cx, cy, frame_w, frame_h, self.cam)

            # Local ENU metres relative to the camera — the Kalman filter's
            # working frame, and the basis for the camera→target bearing
            # used by cross-camera triangulation.
            n_m = (lat - self.cam.latitude) * M_PER_DEG_LAT
            e_m = (lon - self.cam.longitude) * M_PER_DEG_LAT * cos_cam_lat
            bearing_from_cam = (math.degrees(math.atan2(e_m, n_m)) + 360.0) % 360.0

            kf = self._kf.get(raw_tid)
            if kf is None:
                kf = CVKalman()
                self._kf[raw_tid] = kf
            kf.update(now_t, n_m, e_m)
            self._last_seen_t[raw_tid] = now_t

            speed_mps = kf.speed_mps()
            heading = kf.heading_deg()
            if heading is None:
                # Hold the last stable heading across near-static frames
                # instead of snapping to 0° (North).
                angle_deg = self._last_angle.get(raw_tid, 0.0)
            else:
                angle_deg = heading
                self._last_angle[raw_tid] = angle_deg

            direction = angle_to_compass(angle_deg)
            clean_tid = self._clean_id(int(raw_tid))

            out.append(
                {
                    "track_id": clean_tid,
                    "drone_class": drone_class,
                    "confidence": float(conf),
                    "bbox": [x1, y1, x2, y2],
                    "lat": lat,
                    "lon": lon,
                    "speed_mps": float(speed_mps),
                    "angle_deg": float(angle_deg),
                    "direction": direction,
                    # Kalman 1-sigma uncertainties — the UI renders these
                    # as a widening prediction cone instead of a single
                    # false-precision line.
                    "speed_std_mps": float(kf.speed_std_mps()),
                    "heading_std_deg": float(kf.heading_std_deg()),
                    # Bearing from the detecting camera to the target;
                    # persisted so a second camera's bearing to the same
                    # (linked) drone allows triangulating a real position.
                    "bearing_from_cam_deg": float(bearing_from_cam),
                }
            )

        return FrameOutput(self._frame_idx, out)


def class_names() -> dict[int, str]:
    """Return the class names of the configured YOLO model."""
    from ultralytics import YOLO

    settings = get_settings()
    weights = settings.resolve_path(settings.yolo_weights)
    if not weights.exists():
        return {}
    model = YOLO(str(weights))
    return dict(model.names)


def overlay(frame_bgr: np.ndarray, detections: Iterable[dict]) -> np.ndarray:
    """Draw boxes + labels on a frame for the live preview JPEG."""
    import cv2  # type: ignore[import-untyped]

    frame = frame_bgr.copy()
    color_for = {
        "shahed": (0, 0, 255),
        "orlan-10": (0, 140, 255),
        "dji": (0, 200, 255),
        "airplane": (255, 180, 0),
        "bird": (0, 255, 100),
        "helicopter": (255, 0, 200),
    }
    for d in detections:
        x1, y1, x2, y2 = d["bbox"]
        color = color_for.get(d["drone_class"].lower(), (0, 200, 255))
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        label = f"#{d['track_id']} {d['drone_class']} {d['confidence']:.0%}"
        cv2.putText(frame, label, (x1, max(y1 - 6, 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, label, (x1, max(y1 - 6, 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    return frame
