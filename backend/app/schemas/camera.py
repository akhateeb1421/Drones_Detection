"""Pydantic schemas for camera config (admin)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _require_name(v: str | None) -> str | None:
    """Reject empty or whitespace-only names. Used by both CameraIn
    (where name is required) and CameraUpdate (where the field is
    optional but, when supplied, must still be a real value).
    """
    if v is None:
        return None
    stripped = v.strip()
    if not stripped:
        raise ValueError("name must not be empty")
    return stripped


class CameraIn(BaseModel):
    # min_length=1 catches the trivial case; the validator below also
    # strips whitespace so "   " no longer counts as a valid name.
    name: str = Field(..., min_length=1)
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

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v: str) -> str:
        return _require_name(v) or ""

    @field_validator("name_ar")
    @classmethod
    def _trim_name_ar(cls, v: str | None) -> str | None:
        # Empty string from the form is normalized to None so the column
        # stays NULL instead of holding a blank value.
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


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

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v: str | None) -> str | None:
        # When name is supplied for an update it must still be a real,
        # non-blank value — we never want PATCH to wipe the name with "".
        return _require_name(v)

    @field_validator("name_ar")
    @classmethod
    def _trim_name_ar(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


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
