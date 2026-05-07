"""Pydantic schemas for sensitive areas (admin)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AreaIn(BaseModel):
    name: str
    name_ar: str | None = None
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    priority: int = 1


class AreaUpdate(BaseModel):
    name: str | None = None
    name_ar: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    priority: int | None = None


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    name_ar: str | None = None
    latitude: float
    longitude: float
    priority: int
    created_at: datetime
