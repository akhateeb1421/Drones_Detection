"""YOLO + ByteTrack wrapper.

Each `TrackingPipeline` owns its own YOLO model instance. This is a deliberate
departure from the original module-level singleton design: ultralytics keeps
ByteTrack state inside the model object (via the predictor when ``persist=True``
is passed), so two cameras sharing a single model would corrupt each other's
tracker state. The original codebase worked around that by serialising every
call through a global ``asyncio.Lock`` in ``workers/pipeline.py`` — which fixed
correctness at the cost of starving multi-camera setups, since whichever camera
happened to re-queue first would monopolise the lock and effectively block
every other camera from running inference at all.

Moving the model into ``TrackingPipeline`` makes each camera fully independent:

* Tracker state is isolated per camera (no cross-camera ID collisions on the
  bytetrack side; we still keep our own per-pipeline ``_id_remap`` on top).
* No application-level lock is needed — PyTorch's internal BLAS/OpenMP thread
  pool fairly shares CPU between concurrent inference calls.
* A missing weights file fails one worker cleanly instead of cascading.

The cost is ~30-50 MB of resident memory per camera, which is fine for the
2-5 camera setups this system targets.
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

log = logging.getLogger(__name__)


@dataclass
class FrameOutput:
    """Result of running detection + tracking on one frame."""

    frame_idx: int
    detections: list[dict]


def _lsq_slope(values: list[float]) -> float:
    """Least-squares slope of ``values`` against their integer index
    (0, 1, 2, …). Returns the change-per-index of the best-fit line.

    This is the robust replacement for a first-to-last difference. A
    distant drone's bounding-box center jitters several pixels per frame;
    a first-to-last difference is fully exposed to noise in those two
    endpoints, which is what made the displayed speed swing 125↔235 m/s
    and the heading flip N↔NE frame to frame. A least-squares fit over a
    window averages the jitter out (noise reduces ~√N) while still
    tracking the true drift, so the velocity and heading are stable.

    Returns 0.0 for fewer than 2 points.
    """
    n = len(values)
    if n < 2:
        return 0.0
    mean_i = (n - 1) / 2.0
    mean_v = sum(values) / n
    num = 0.0
    den = 0.0
    for i, v in enumerate(values):
        di = i - mean_i
        num += di * (v - mean_v)
        den += di * di
    return (num / den) if den > 0 else 0.0


class TrackingPipeline:
    """Per-camera state: keeps a YOLO model + tracker + smoothing history.

    Each instance is fully self-contained. Two pipelines can run inference
    concurrently without coordinating because they share no mutable state.
    """

    HISTORY_LEN = 40
    SMOOTHING_LEN = 5
    CLASS_VOTE_LEN = 10
    # Number of recent frames the least-squares velocity / heading fit uses.
    # ~1 s at 25-30 fps — long enough to average out bounding-box jitter on
    # a tiny distant drone, short enough to follow a genuine turn.
    VELOCITY_WINDOW = 25
    # Display-smoothing factor on the fitted speed. The LSQ fit is already
    # smooth; this extra exponential moving average removes residual wobble
    # so the readout holds steady for a constant-speed target. Lower = smoother.
    SPEED_EMA_ALPHA = 0.25

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
        # Test-time augmentation (TTA). When True, YOLO runs each frame at
        # multiple scales/flips and merges the results, which materially
        # raises recall on hard views (e.g. a side-profile drone against
        # bright sky, where the single-pass model emits ~0 confidence) at
        # roughly 3x inference cost. Only enabled for the recorded clip,
        # which pre-computes once and caches — so the cost is paid a single
        # time and never affects live latency.
        self._augment = augment
        self._history: dict[int, deque[tuple[int, int]]] = defaultdict(lambda: deque(maxlen=self.HISTORY_LEN))
        # World-frame lat/lon trajectory per track. Used to compute the
        # actual compass heading of the drone (independent of camera orientation).
        self._world_history: dict[int, deque[tuple[float, float]]] = defaultdict(
            lambda: deque(maxlen=self.HISTORY_LEN)
        )
        self._class_votes: dict[int, deque[int]] = defaultdict(lambda: deque(maxlen=self.CLASS_VOTE_LEN))
        self._id_remap: dict[int, int] = {}
        self._next_id = 1
        self._frame_idx = 0
        # Per-track smoothed-speed state (EMA) and last stable heading. The
        # heading is held across sub-pixel-drift frames instead of snapping
        # back to 0° (North), which previously made the predicted line jump.
        self._speed_ema: dict[int, float] = {}
        self._last_angle: dict[int, float] = {}
        # Resolve imgsz: explicit arg wins; 0/None falls back to the legacy
        # global default. Stored on the instance so `step()` doesn't have to
        # re-read settings on every frame.
        settings = get_settings()
        self._imgsz = imgsz if (imgsz is not None and imgsz > 0) else settings.yolo_imgsz
        # Per-pipeline YOLO model — see module docstring for why this is
        # owned per camera instead of being a global singleton. ``weights_path``
        # lets the caller (workers/pipeline.py) pick a model that matches the
        # camera's capture mode (live vs pre-recorded). If omitted, falls
        # back to the legacy ``settings.yolo_weights``.
        self._model, self._class_names = self._load_model(weights_path)

    @staticmethod
    def _load_model(weights_path: str | None = None) -> tuple[object, dict[int, str]]:
        """Load YOLO weights and return (model, class_names).

        If ``weights_path`` is provided AND points at an existing file we use
        it directly. If the requested file is missing we fall back to the
        legacy ``settings.yolo_weights`` so a misconfigured per-source path
        (e.g. operator added best_live.pt but not best_video.pt) doesn't take
        the worker down — it just runs on the generic model with a warning.

        Raised exceptions propagate to the worker's outer ``except`` and are
        logged as ``worker crashed``. The worker stops; other cameras keep
        running. This is intentional — a per-camera failure should never
        take down the whole pipeline.
        """
        from ultralytics import YOLO  # heavy import, deferred

        settings = get_settings()
        requested = Path(weights_path).resolve() if weights_path else None
        if requested is not None and not requested.exists():
            fallback = Path(settings.yolo_weights).resolve()
            log.warning(
                "Requested YOLO weights %s not found; falling back to %s. "
                "Add the file or update YOLO_WEIGHTS_LIVE / YOLO_WEIGHTS_VIDEO in .env "
                "to silence this warning.",
                requested, fallback,
            )
            requested = fallback
        if requested is None:
            requested = Path(settings.yolo_weights).resolve()
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

    def step(self, frame_bgr: np.ndarray, tracker_cfg_path: str) -> FrameOutput:
        model = self._model
        settings = get_settings()
        # Lower the floor we hand to YOLO to the *hostile* threshold so
        # marginal DJI/Shahed/Orlan detections survive past NMS and reach
        # the tracker. Non-hostile classes that come through at this low
        # bar are dropped further down in the per-detection loop, so
        # bird/airplane/helicopter noise stays at the regular yolo_conf
        # floor. min(...) is defensive in case an operator inverts the
        # two values via env vars. ``self._conf_hostile`` lets the recorded
        # clip use a more sensitive floor than the live camera (None ->
        # the global default).
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
        # set to avoid the circular import inference <-> alarms. If you
        # add a new hostile class to alarms.HOSTILE_CLASSES, add it here
        # too so its low-conf detections aren't filtered out.
        _HOSTILE = {
            "shahed", "shahed_136", "shahed-136", "shahed136",
            "orlan", "orlan-10", "orlan10", "orlan_10",
            "dji", "drone",
        }

        frame_h, frame_w = frame_bgr.shape[:2]
        for box, raw_tid, conf, cls_id in zip(boxes, ids, confs, classes):
            x1, y1, x2, y2 = map(int, box)
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

            self._class_votes[raw_tid].append(int(cls_id))
            voted_cls = max(set(self._class_votes[raw_tid]), key=self._class_votes[raw_tid].count)
            drone_class = self._class_names.get(voted_cls, f"cls_{voted_cls}")

            # Per-class confidence gate: non-hostile classes still have
            # to clear the regular yolo_conf bar (default 0.50). Hostile
            # classes ride the looser yolo_conf_hostile floor we passed
            # to YOLO above, so a marginal DJI sighting still gets
            # tracked and ends up in the pending-approvals queue.
            if drone_class.lower().strip() not in _HOSTILE and float(conf) < settings.yolo_conf:
                continue

            # World-frame position (tangent-plane crossing model — a target
            # crossing the frame traces a STRAIGHT line on the map).
            lat, lon = pixel_to_world(cx, cy, frame_w, frame_h, self.cam)
            world_hist = self._world_history[raw_tid]
            world_hist.append((lat, lon))

            # Speed AND heading from ONE least-squares fit of the world-frame
            # trajectory over the recent window. Deriving both from the same
            # straight world track keeps them consistent and stable:
            #   • the LSQ fit averages out per-frame box jitter (the cause of
            #     the 125↔235 m/s speed swing and the N↔NE heading flicker);
            #   • the tangent-plane projection means a crossing target's track
            #     is straight, so the heading no longer rotates with the FOV.
            # An EMA holds the speed readout steady for a constant-speed
            # target; the heading is HELD across near-static frames instead of
            # snapping to North (which made the predicted line jump).
            wwin = list(world_hist)[-self.VELOCITY_WINDOW :]
            if len(wwin) >= 2:
                dlat = _lsq_slope([p[0] for p in wwin])  # deg per frame
                dlon = _lsq_slope([p[1] for p in wwin])
                dN = dlat * 111_320.0
                dE = dlon * 111_320.0 * math.cos(math.radians(lat))
                step_m = math.hypot(dN, dE)  # metres travelled per frame
                raw_speed = step_m * self.fps
                prev = self._speed_ema.get(raw_tid)
                speed_mps = (
                    raw_speed
                    if prev is None
                    else self.SPEED_EMA_ALPHA * raw_speed + (1.0 - self.SPEED_EMA_ALPHA) * prev
                )
                self._speed_ema[raw_tid] = speed_mps
                if step_m < 1e-3:
                    angle_deg = self._last_angle.get(raw_tid, 0.0)
                else:
                    angle_deg = (math.degrees(math.atan2(dE, dN)) + 360.0) % 360.0
                    self._last_angle[raw_tid] = angle_deg
            else:
                speed_mps = 0.0
                angle_deg = self._last_angle.get(raw_tid, 0.0)

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
                }
            )

        return FrameOutput(self._frame_idx, out)


def class_names() -> dict[int, str]:
    """Return the class names of the configured YOLO model.

    Kept as a public helper for any callers that just want the class list
    without spinning up a full pipeline. Loads weights on demand, so an
    endpoint that never touches inference doesn't pay the startup cost.
    """
    from ultralytics import YOLO

    settings = get_settings()
    weights = Path(settings.yolo_weights).resolve()
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
