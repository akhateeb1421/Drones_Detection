"""Pydantic schemas for camera config (admin)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CameraIn(BaseModel):
    name: str
    name_ar: str | None = None
    stream_url: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    heading_deg: float = Field(0.0, ge=0, lt=360)
    altitude_m: float = 10.0
    fov_h_deg: float = 82.6
    fov_v_deg: float = 52.0
    sensor_w_px: int = 1280
    assumed_target_distance_m: float = 500.0
    enabled: bool = True


class CameraUpdate(BaseModel):
    name: str | None = None
    name_ar: str | None = None
    stream_url: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    heading_deg: float | None = Field(default=None, ge=0, lt=360)
    altitude_m: float | None = None
    fov_h_deg: float | None = None
    fov_v_deg: float | None = None
    sensor_w_px: int | None = None
    assumed_target_distance_m: float | None = None
    enabled: bool | None = None


class CameraOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    name_ar: str | None = None
    stream_url: str
    latitude: float
    longitude: float
    heading_deg: float
    altitude_m: float
    fov_h_deg: float
    fov_v_deg: float
    sensor_w_px: int
    assumed_target_distance_m: float
    enabled: bool
    created_at: datetime
