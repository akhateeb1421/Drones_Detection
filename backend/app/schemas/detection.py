"""Pydantic schemas for live detections."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DetectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    camera_id: int
    track_id: int
    frame_idx: int
    drone_class: str
    confidence: float
    latitude: float | None
    longitude: float | None
    speed_mps: float | None
    direction: str | None
    nearest_area: str | None
    dist_m: float | None
    eta_s: float | None
    captured_at: datetime


class TrackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    camera_id: int
    track_id: int
    first_seen_at: datetime
    last_seen_at: datetime
    voted_class: str | None
    max_confidence: float | None
    max_speed_mps: float | None
    min_eta_s: float | None
    nearest_area: str | None
    last_lat: float | None
    last_lon: float | None
    status: str
    reviewed_at: datetime | None


class ApprovalOut(BaseModel):
    track_id: int
    status: str
    attack_id: int | None = None
