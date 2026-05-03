"""Camera CRUD (admin only for writes)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import require_admin
from app.models import Camera, Detection, Track
from app.schemas.camera import CameraIn, CameraOut, CameraUpdate

router = APIRouter(prefix="/cameras", tags=["cameras"])


@router.get("", response_model=list[CameraOut])
def list_cameras(db: Session = Depends(get_db)) -> list[Camera]:
    return list(db.execute(select(Camera).order_by(Camera.id)).scalars().all())


@router.post("", response_model=CameraOut, status_code=201)
def create_camera(
    payload: CameraIn,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> Camera:
    cam = Camera(**payload.model_dump())
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@router.patch("/{camera_id}", response_model=CameraOut)
def update_camera(
    camera_id: int,
    payload: CameraUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> Camera:
    cam = db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found.")
    data = payload.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(cam, k, v)
    db.commit()
    db.refresh(cam)
    return cam


@router.delete("/{camera_id}", status_code=204)
def delete_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> None:
    cam = db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found.")
    # Cascade-delete dependent rows so the FK constraints don't reject the delete.
    db.execute(delete(Detection).where(Detection.camera_id == camera_id))
    db.execute(delete(Track).where(Track.camera_id == camera_id))
    db.delete(cam)
    db.commit()
