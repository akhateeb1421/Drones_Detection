"""Pydantic schemas for the attacks endpoint."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AttackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    occurred_at: datetime
    attack_type: str
    target_location: str | None
    region: str | None
    latitude: float
    longitude: float
    source: str
    drone_class: str | None = None
    confidence: float | None = None
    speed_mps: float | None = None
    direction: str | None = None
    nearest_area: str | None = None
    eta_s: float | None = None


class AttackFilter(BaseModel):
    date_from: datetime | None = None
    date_to: datetime | None = None
    region: str | None = None
    attack_type: str | None = None
    source: str | None = Field(default=None, description="historical | synthetic | live")
