"""Live detections + admin approve/reject endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import require_admin
from app.models import Attack, Detection, Track
from app.schemas.detection import ApprovalOut, DetectionOut, TrackOut
from app.services.synthetic import _region_for  # canonicalize "Area-A" -> "Riyadh"

router = APIRouter(prefix="/detections", tags=["detections"])


@router.get("", response_model=list[DetectionOut])
def list_detections(
    db: Session = Depends(get_db),
    camera_id: int | None = Query(default=None),
    track_id: int | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=10000),
) -> list[Detection]:
    stmt = select(Detection)
    if camera_id is not None:
        stmt = stmt.where(Detection.camera_id == camera_id)
    if track_id is not None:
        stmt = stmt.where(Detection.track_id == track_id)
    stmt = stmt.order_by(Detection.captured_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


@router.get("/tracks", response_model=list[TrackOut])
def list_tracks(
    db: Session = Depends(get_db),
    status: str | None = Query(default=None, description="pending | approved | rejected"),
    limit: int = Query(default=200, ge=1, le=2000),
) -> list[Track]:
    stmt = select(Track)
    if status:
        stmt = stmt.where(Track.status == status)
    stmt = stmt.order_by(Track.last_seen_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


def _find_track(db: Session, camera_id: int, track_id: int) -> Track:
    track = db.execute(
        select(Track).where(Track.camera_id == camera_id, Track.track_id == track_id)
    ).scalar_one_or_none()
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found.")
    return track


@router.post("/{camera_id}/{track_id}/approve", response_model=ApprovalOut)
def approve_track(
    camera_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> ApprovalOut:
    track = _find_track(db, camera_id, track_id)
    if track.status == "approved":
        raise HTTPException(status_code=409, detail="Already approved.")

    # Snapshot the most recent detection for this track to write the attack row.
    latest = db.execute(
        select(Detection)
        .where(Detection.camera_id == camera_id, Detection.track_id == track_id)
        .order_by(Detection.captured_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if latest is None:
        raise HTTPException(status_code=400, detail="No detections to snapshot.")

    # Canonicalize the region so "Area-A" / "Area-B" etc. roll up into the
    # parent city (Riyadh) instead of becoming their own pie-chart slice.
    canonical_region = _region_for(latest.nearest_area or "", latest.nearest_area)
    attack = Attack(
        occurred_at=latest.captured_at,
        attack_type="drone",
        target_location=latest.nearest_area,
        region=canonical_region,
        latitude=latest.latitude if latest.latitude is not None else 0,
        longitude=latest.longitude if latest.longitude is not None else 0,
        source="live",
        drone_class=latest.drone_class,
        confidence=latest.confidence,
        speed_mps=latest.speed_mps,
        direction=latest.direction,
        nearest_area=latest.nearest_area,
        eta_s=latest.eta_s,
        approved_by="admin",
    )
    db.add(attack)
    track.status = "approved"
    track.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(attack)
    return ApprovalOut(track_id=track_id, status="approved", attack_id=attack.id)


@router.post("/{camera_id}/{track_id}/reject", response_model=ApprovalOut)
def reject_track(
    camera_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> ApprovalOut:
    track = _find_track(db, camera_id, track_id)
    track.status = "rejected"
    track.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    return ApprovalOut(track_id=track_id, status="rejected")
