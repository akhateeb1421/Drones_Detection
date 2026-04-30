"""Aggregated analytics endpoints (powers the Analysis tab)."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Attack
from app.schemas.prediction import RegionStat, TimelinePoint, TypeStat

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/by-region", response_model=list[RegionStat])
def by_region(db: Session = Depends(get_db)) -> list[RegionStat]:
    rows = db.execute(
        select(Attack.region, func.count(Attack.id))
        .where(Attack.region.is_not(None))
        .group_by(Attack.region)
        .order_by(func.count(Attack.id).desc())
    ).all()
    return [RegionStat(region=r or "Unknown", count=int(c)) for r, c in rows]


@router.get("/by-type", response_model=list[TypeStat])
def by_type(db: Session = Depends(get_db)) -> list[TypeStat]:
    rows = db.execute(
        select(Attack.attack_type, func.count(Attack.id))
        .group_by(Attack.attack_type)
        .order_by(func.count(Attack.id).desc())
    ).all()
    return [TypeStat(attack_type=t, count=int(c)) for t, c in rows]


@router.get("/timeline", response_model=list[TimelinePoint])
def timeline(
    db: Session = Depends(get_db),
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    region: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
) -> list[TimelinePoint]:
    bucket = func.date_trunc(granularity, Attack.occurred_at)
    stmt = select(bucket, func.count(Attack.id)).group_by(bucket).order_by(bucket)
    if region:
        stmt = stmt.where(Attack.region == region)
    if date_from is not None:
        stmt = stmt.where(Attack.occurred_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Attack.occurred_at <= date_to)
    rows = db.execute(stmt).all()
    return [TimelinePoint(period=p.isoformat() if p else "", count=int(c)) for p, c in rows]
