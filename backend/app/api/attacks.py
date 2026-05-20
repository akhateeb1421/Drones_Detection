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


# --- Admin cleanup endpoints ----------------------------------------
# Both require the X-Admin-Token header. Use these when a test
# sensitive area was deleted from the admin UI but its attack rows
# are still showing up on the dashboard map (Attack.target_location
# is a free-text column with no FK on sensitive_areas.name, so the
# delete in admin/areas doesn\'t cascade).

from fastapi import HTTPException
from sqlalchemy import delete as sql_delete
from app.core.security import require_admin
from app.models import SensitiveArea


@router.delete("/admin/by-target")
def delete_attacks_by_target(
    name: str = Query(..., description="Attack.target_location to delete (exact match)."),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> dict:
    """Delete every attack row whose target_location equals `name`.

    Use this when you know the exact label of the orphaned sensitive
    area (e.g. "test"). Returns the count of rows removed.
    """
    if not name.strip():
        raise HTTPException(status_code=422, detail="name required")
    res = db.execute(
        sql_delete(Attack).where(Attack.target_location == name)
    )
    db.commit()
    return {"deleted": int(res.rowcount or 0), "target_location": name}


# NOTE: a `cleanup-orphans` endpoint used to live here. It was
# removed because target_location is a free-text column that holds
# regional descriptions (e.g. "Riyadh Region") in addition to
# sensitive-area names — so "delete anything not in sensitive_areas"
# wiped almost the entire historical dataset. If you need to clean
# up a specific orphan, use DELETE /attacks/admin/by-target?name=...
# with the exact label.

