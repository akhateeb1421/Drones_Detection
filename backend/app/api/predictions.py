"""ML prediction endpoints — XGBoost classifier + Prophet forecaster, with heuristic fallback."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.prediction import ForecastPoint, RegionRisk
from app.services import classifier, forecaster

router = APIRouter(prefix="/predict", tags=["predictions"])


@router.get("/risk", response_model=list[RegionRisk])
def predict_risk(
    db: Session = Depends(get_db),
    horizon_days: int = Query(default=30, ge=1, le=365),
) -> list[RegionRisk]:
    return classifier.predict_all_regions(db, horizon_days=horizon_days)


@router.get("/forecast", response_model=list[ForecastPoint])
def predict_forecast(
    db: Session = Depends(get_db),
    region: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
) -> list[ForecastPoint]:
    return forecaster.forecast(db, region=region, days=days)
