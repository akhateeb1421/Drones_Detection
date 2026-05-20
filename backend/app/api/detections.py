"""Live detections + admin approve/reject endpoints."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import require_admin
from app.models import Attack, Camera, Detection, Track
from app.schemas.detection import ApprovalOut, ApproveIn, DetectionOut, TrackOut
from app.services.synthetic import _region_for  # canonicalize "Area-A" -> "Riyadh"

router = APIRouter(prefix="/detections", tags=["detections"])


@router.get("/tracks/{track_id}/thumb")
def track_thumbnail(track_id: int, db: Session = Depends(get_db)):
    """Serve the JPEG thumbnail for a track."""
    track = db.get(Track, track_id)
    if track is None or not track.thumbnail_path:
        raise HTTPException(status_code=404, detail="No thumbnail.")
    base = Path(get_settings().thumbnail_dir).resolve()
    full = base / track.thumbnail_path
    if not full.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file missing.")
    return FileResponse(str(full), media_type="image/jpeg")


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
) -> list[TrackOut]:
    stmt = select(Track)
    if status:
        stmt = stmt.where(Track.status == status)
    stmt = stmt.order_by(Track.last_seen_at.desc()).limit(limit)
    rows = list(db.execute(stmt).scalars().all())

    # Enrich each row with a Moondream-generated description for its
    # thumbnail. The moondream service caches by (track_id, thumb_path),
    # so this is a fast dict lookup once the model is warm; the first
    # call for a given track returns None and kicks off background
    # inference. Wrapped in try/except so an offline VLM never blocks
    # the pending-approvals queue.
    try:
        from app.services.moondream import describe_thumbnail
        thumb_dir = Path(get_settings().thumbnail_dir).resolve()
    except Exception:  # noqa: BLE001
        describe_thumbnail = None  # type: ignore[assignment]
        thumb_dir = None  # type: ignore[assignment]

    out: list[TrackOut] = []
    for t in rows:
        obj = TrackOut.model_validate(t)
        if t.thumbnail_path:
            # Always verify the file is actually on disk. If the DB has
            # a path but the file is gone (e.g. cleared cache, manual
            # delete, pipeline mid-restart), null out thumbnail_path on
            # the response so the frontend renders the placeholder dash
            # instead of a broken <img> that gets hidden by onError.
            if thumb_dir is not None:
                full = thumb_dir / t.thumbnail_path
                if not full.exists():
                    obj.thumbnail_path = None
                elif describe_thumbnail is not None:
                    try:
                        jpeg = full.read_bytes()
                        obj.description = describe_thumbnail(t.id, t.thumbnail_path, jpeg)
                    except Exception:  # noqa: BLE001
                        # Any I/O or VLM hiccup -> leave description None
                        # so the row still renders without the caption.
                        pass
        out.append(obj)
    return out


def _find_track(db: Session, camera_id: int, track_id: int) -> Track:
    track = db.execute(
        select(Track).where(Track.camera_id == camera_id, Track.track_id == track_id)
    ).scalar_one_or_none()
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found.")
    return track


_ALLOWED_OUTCOMES = {"countered", "hit"}


@router.post("/{camera_id}/{track_id}/approve", response_model=ApprovalOut)
def approve_track(
    camera_id: int,
    track_id: int,
    body: ApproveIn,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> ApprovalOut:
    if body.outcome not in _ALLOWED_OUTCOMES:
        raise HTTPException(
            status_code=422,
            detail=f"outcome must be one of {sorted(_ALLOWED_OUTCOMES)}.",
        )

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
    track.outcome = body.outcome
    db.commit()
    db.refresh(attack)
    return ApprovalOut(
        track_id=track_id,
        status="approved",
        outcome=body.outcome,
        attack_id=attack.id,
    )


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
    track.outcome = None
    db.commit()
    return ApprovalOut(track_id=track_id, status="rejected")


@router.get("/debug")
def debug_state(db: Session = Depends(get_db)) -> dict:
    """Diagnostic snapshot of the live-detection pipeline state.

    Hit this from a browser or `curl http://localhost:8000/detections/debug`
    when the Pending Approvals queue looks empty. Tells you in one
    response whether: (a) any cameras are enabled, (b) any tracks exist
    in the DB and what their statuses/classes are, (c) the YOLO pipeline
    is producing detection rows, and (d) the most recent detection
    timestamp. If everything looks zero, the worker isn't running or
    YOLO isn't seeing anything in the stream.
    """
    cameras_total = db.execute(select(func.count(Camera.id))).scalar_one() or 0
    cameras_enabled = db.execute(
        select(func.count(Camera.id)).where(Camera.enabled.is_(True))
    ).scalar_one() or 0

    # Track counts grouped by (status, voted_class) so we can spot the
    # exact reason the frontend filter shows "no_data" (wrong class,
    # wrong status, or just zero rows).
    by_status_class = db.execute(
        select(Track.status, Track.voted_class, func.count(Track.id))
        .group_by(Track.status, Track.voted_class)
    ).all()
    tracks_breakdown = [
        {"status": s or "(null)", "voted_class": c or "(null)", "count": int(n)}
        for s, c, n in by_status_class
    ]
    tracks_total = sum(row["count"] for row in tracks_breakdown)

    # Detection rows in the last 5 minutes — a non-zero count proves
    # YOLO is finding objects, even if no Track has been created yet.
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    detections_recent = db.execute(
        select(func.count(Detection.id)).where(Detection.captured_at >= cutoff)
    ).scalar_one() or 0
    detections_total = db.execute(select(func.count(Detection.id))).scalar_one() or 0
    last_detection_at = db.execute(
        select(func.max(Detection.captured_at))
    ).scalar_one()

    # Recent detection class histogram — if YOLO is firing at all this
    # tells you which classes it's actually outputting.
    classes_recent = db.execute(
        select(Detection.drone_class, func.count(Detection.id))
        .where(Detection.captured_at >= cutoff)
        .group_by(Detection.drone_class)
    ).all()

    return {
        "cameras": {"total": int(cameras_total), "enabled": int(cameras_enabled)},
        "tracks": {
            "total": int(tracks_total),
            "by_status_and_class": tracks_breakdown,
        },
        "detections": {
            "total": int(detections_total),
            "last_5_min": int(detections_recent),
            "last_5_min_by_class": {c or "(null)": int(n) for c, n in classes_recent},
            "last_seen_at": last_detection_at.isoformat() if last_detection_at else None,
        },
    }


@router.post("/admin/reset-rejected")
def reset_rejected_tracks(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> dict:
    """Flip every Track currently marked `rejected` back to `pending`.

    Surfaces stale ByteTrack-ID-reuse victims that the operator can no
    longer see in the pending queue. Useful as a one-shot cleanup after
    a uvicorn restart populated the DB with rejected rows that future
    DJI sightings keep updating instead of creating fresh entries. The
    permanent fix lives in pipeline.py (stale-reuse detector); this
    endpoint just unblocks tracks that were already reviewed before
    that fix shipped.
    """
    rows = (
        db.execute(select(Track).where(Track.status == "rejected"))
        .scalars()
        .all()
    )
    count = 0
    for track in rows:
        track.status = "pending"
        track.reviewed_at = None
        track.outcome = None
        count += 1
    db.commit()
    return {"reset": count}

