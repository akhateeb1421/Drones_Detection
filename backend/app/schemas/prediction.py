"""Schemas for /predict and /analysis endpoints."""

from datetime import date

from pydantic import BaseModel


class RegionRisk(BaseModel):
    region: str
    risk_probability: float
    horizon_days: int
    method: str  # 'xgboost' | 'heuristic'


class ForecastPoint(BaseModel):
    region: str
    forecast_date: date
    expected_count: float
    lower: float
    upper: float


class TimelinePoint(BaseModel):
    period: str
    count: int


class RegionStat(BaseModel):
    region: str
    count: int


class TypeStat(BaseModel):
    attack_type: str
    count: int
