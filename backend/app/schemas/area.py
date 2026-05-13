"""Pydantic schemas for sensitive areas (admin)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _require_name(v: str | None) -> str | None:
    """Reject empty / whitespace-only names. Used by both AreaIn (where
    name is required) and AreaUpdate (where the field is optional but,
    when supplied, must still be a real value).
    """
    if v is None:
        return None
    stripped = v.strip()
    if not stripped:
        raise ValueError("name must not be empty")
    return stripped


class AreaIn(BaseModel):
    name: str = Field(..., min_length=1)
    name_ar: str | None = None
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    priority: int = 1

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v: str) -> str:
        return _require_name(v) or ""

    @field_validator("name_ar")
    @classmethod
    def _trim_name_ar(cls, v: str | None) -> str | None:
        # Empty form input becomes NULL in the column instead of "".
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


class AreaUpdate(BaseModel):
    name: str | None = None
    name_ar: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    priority: int | None = None

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v: str | None) -> str | None:
        return _require_name(v)

    @field_validator("name_ar")
    @classmethod
    def _trim_name_ar(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    name_ar: str | None = None
    latitude: float
    longitude: float
    priority: int
    created_at: datetime
