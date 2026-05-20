"""Schemas for /predict and /analysis endpoints."""

# Import `date` under an alias because one of the response fields below
# is also named `date` (mirrors the frontend's preferred JSON key). If
# both shared the bare name `date` Python would resolve the annotation
# `date | None` against the half-declared field, not the datetime type,
# and raise TypeError at import time.
from datetime import date as DateType

from pydantic import BaseModel


class RegionRisk(BaseModel):
    region: str
    risk_probability: float
    horizon_days: int
    method: str  # 'xgboost' | 'heuristic'


class ForecastPoint(BaseModel):
    region: str
    forecast_date: DateType
    expected_count: float
    lower: float
    upper: float
    # Aliases for the frontend's newer field-name expectations. Same
    # values, different keys — keeps the contract backwards-compatible
    # for any existing consumer while letting the new Analysis page
    # read `p.date` / `p.predicted_count` directly.
    date: DateType | None = None
    predicted_count: float | None = None


class TimelinePoint(BaseModel):
    period: str
    count: int
    # Alias of `period` — the new Analysis.tsx reads `p.date ?? p.month`.
    # Keeping `period` for backwards compatibility and adding `date`
    # avoids a hard cutover on either side.
    date: str | None = None


class RegionStat(BaseModel):
    region: str
    count: int


class TypeStat(BaseModel):
    attack_type: str
    count: int
