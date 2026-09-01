"""Sensitive area CRUD (admin only for writes)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import AuthUser, require_admin, require_user
from app.services.audit import audit
from app.models import SensitiveArea
from app.schemas.area import AreaIn, AreaOut, AreaUpdate

router = APIRouter(
    prefix="/areas", tags=["areas"],
    dependencies=[Depends(require_user)],
)


@router.get("", response_model=list[AreaOut])
def list_areas(db: Session = Depends(get_db)) -> list[SensitiveArea]:
    return list(db.execute(select(SensitiveArea).order_by(SensitiveArea.id)).scalars().all())


@router.post("", response_model=AreaOut, status_code=201)
def create_area(
    payload: AreaIn,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_admin),
) -> SensitiveArea:
    area = SensitiveArea(**payload.model_dump())
    db.add(area)
    audit(db, user.username, "area_create", {"name": payload.name})
    db.commit()
    db.refresh(area)
    return area


@router.patch("/{area_id}", response_model=AreaOut)
def update_area(
    area_id: int,
    payload: AreaUpdate,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_admin),
) -> SensitiveArea:
    area = db.get(SensitiveArea, area_id)
    if area is None:
        raise HTTPException(status_code=404, detail="Area not found.")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(area, k, v)
    audit(db, user.username, "area_update", {"id": area_id, "fields": list(payload.model_dump(exclude_none=True).keys())})
    db.commit()
    db.refresh(area)
    return area


@router.delete("/{area_id}", status_code=204)
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_admin),
) -> None:
    area = db.get(SensitiveArea, area_id)
    if area is None:
        raise HTTPException(status_code=404, detail="Area not found.")
    audit(db, user.username, "area_delete", {"id": area_id, "name": area.name})
    db.delete(area)
    db.commit()
