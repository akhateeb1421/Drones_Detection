"""GET /attacks — historical map data with filters."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Attack
from app.schemas.attack import AttackOut

router = APIRouter(prefix="/attacks", tags=["attacks"])


@router.get("", response_model=list[AttackOut])
def list_attacks(
    db: Session = Depends(get_db),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    region: str | None = Query(default=None),
    attack_type: str | None = Query(default=None),
    source: str | None = Query(default=None, description="historical | synthetic | live"),
    limit: int = Query(default=10000, ge=1, le=50000),
) -> list[Attack]:
    stmt = select(Attack)
    if date_from is not None:
        stmt = stmt.where(Attack.occurred_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Attack.occurred_at <= date_to)
    if region:
        stmt = stmt.where(Attack.region == region)
    if attack_type:
        stmt = stmt.where(Attack.attack_type == attack_type)
    if source:
        stmt = stmt.where(Attack.source == source)
    stmt = stmt.order_by(Attack.occurred_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())
