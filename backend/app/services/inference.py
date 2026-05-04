"""YOLO + ByteTrack wrapper.

Lazily loads the model so that endpoints not using inference (e.g. /attacks,
/predict) don't pay the startup cost. The model + tracker config paths come
from settings; the tracker config file is committed to scripts/.
"""

from __future__ import annotations

import logging
import math
import threading
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

from app.core.config import get_settings
from app.services.geo import (
    CameraGeo,
    angle_to_compass,
    pixel_speed_to_mps,
    pixel_to_world,
)

log = logging.getLogger(__name__)

_model_lock = threading.Lock()
_model = None
_class_names: dict[int, str] = {}


def _ensure_model():
    global _model, _class_names
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from ultralytics import YOLO  # heavy import, deferred

            settings = get_settings()
            weights = Path(settings.yolo_weights).resolve()
            if not weights.exists():
                raise FileNotFoundError(f"YOLO weights not found at {weights}")
            log.info("Loading YOLO weights from %s", weights)
            _model = YOLO(str(weights))
            _class_names = dict(_model.names)
            log.info("Model classes: %s", _class_names)
    return _model


@dataclass
class FrameOutput:
    """Result of running detection + tracking on one frame."""

    frame_idx: int
    detections: list[dict]


class TrackingPipeline:
    """Per-camera state: keeps track history for speed/direction/voting."""

    HISTORY_LEN = 30
    SMOOTHING_LEN = 5
    CLASS_VOTE_LEN = 10

    def __init__(self, cam: CameraGeo, fps: float = 25.0) -> None:
        self.cam = cam
        self.fps = fps
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

    def _clean_id(self, raw_id: int) -> int:
        if raw_id not in self._id_remap:
            self._id_remap[raw_id] = self._next_id
            self._next_id += 1
        return self._id_remap[raw_id]

    def step(self, frame_bgr: np.ndarray, tracker_cfg_path: str) -> FrameOutput:
        model = _ensure_model()
        settings = get_settings()
        results = model.track(
            source=frame_bgr,
            tracker=tracker_cfg_path,
            conf=settings.yolo_conf,
            iou=settings.yolo_iou,
            imgsz=settings.yolo_imgsz,
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

        frame_h, frame_w = frame_bgr.shape[:2]
        for box, raw_tid, conf, cls_id in zip(boxes, ids, confs, classes):
            x1, y1, x2, y2 = map(int, box)
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

            self._class_votes[raw_tid].append(int(cls_id))
            voted_cls = max(set(self._class_votes[raw_tid]), key=self._class_votes[raw_tid].count)
            drone_class = _class_names.get(voted_cls, f"cls_{voted_cls}")

            history = self._history[raw_tid]
            history.append((cx, cy))

            if len(history) >= 2:
                recent = list(history)[-min(self.SMOOTHING_LEN, len(history)) :]
                dx = recent[-1][0] - recent[0][0]
                dy = recent[-1][1] - recent[0][1]
                frames_span = max(len(recent) - 1, 1)
                speed_px = math.hypot(dx, dy) / frames_span
                speed_mps = pixel_speed_to_mps(speed_px, self.fps, self.cam)
            else:
                speed_mps = 0.0

            # World-frame position + heading.
            lat, lon = pixel_to_world(cx, cy, frame_w, frame_h, self.cam)
            world_hist = self._world_history[raw_tid]
            world_hist.append((lat, lon))

            # Compass heading derived from the actual lat/lon trajectory:
            # 0 = North, 90 = East, etc. Independent of camera orientation.
            if len(world_hist) >= 2:
                w_recent = list(world_hist)[-min(self.SMOOTHING_LEN, len(world_hist)) :]
                lat0, lon0 = w_recent[0]
                lat1, lon1 = w_recent[-1]
                # equirectangular approximation is fine over the few-meter span
                # we observe between frames.
                dN = (lat1 - lat0) * 111_320.0
                dE = (lon1 - lon0) * 111_320.0 * math.cos(math.radians(lat0))
                if abs(dN) < 1e-6 and abs(dE) < 1e-6:
                    angle_deg = 0.0  # not enough movement to infer direction
                else:
                    angle_deg = (math.degrees(math.atan2(dE, dN)) + 360.0) % 360.0
            else:
                angle_deg = 0.0

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
    _ensure_model()
    return dict(_class_names)


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
