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


# --- Recorded-clip camera bootstrap ----------------------------------
# The "Recorded Clip" page on the dashboard wants a dedicated Camera
# row whose stream_url points at the shahed.mp4 demo file. It also
# needs to be able to copy lat/lon/heading/FOV from any other camera
# so the operator can simulate the same drone footage at different
# geographic locations. These two endpoints power that flow.

RECORDED_CAMERA_NAME = "Recorded Clip"
RECORDED_CAMERA_NAME_AR = "مقطع مسجل"
RECORDED_STREAM_URL = "../data/raw/shahed.mp4"


@router.get("/recorded", response_model=CameraOut)
async def get_or_create_recorded(db: Session = Depends(get_db)) -> Camera:
    """Return the dedicated recorded-clip Camera, creating it on first
    access. Public (no admin token) because the Recorded Clip page is
    available to every operator; this endpoint never returns sensitive
    config, just the standard CameraOut shape.

    Also kicks off a pipeline worker for this camera if one isn\'t
    already running, so the frontend doesn\'t sit on a forever-loading
    video frame waiting for the next uvicorn restart.
    """
    cam = db.execute(
        select(Camera).where(Camera.name == RECORDED_CAMERA_NAME)
    ).scalar_one_or_none()
    if cam is None:
        cam = Camera(
            name=RECORDED_CAMERA_NAME,
            name_ar=RECORDED_CAMERA_NAME_AR,
            stream_url=RECORDED_STREAM_URL,
            # Riyadh defaults — the operator can override via the
            # /cameras/recorded/copy-geo endpoint or the admin UI.
            latitude=24.7136,
            longitude=46.6753,
            heading_deg=0.0,
            altitude_m=10.0,
            fov_h_deg=82.6,
            fov_v_deg=52.0,
            sensor_w_px=1280,
            assumed_target_distance_m=500.0,
            enabled=True,
        )
        db.add(cam)
        db.commit()
        db.refresh(cam)
    # Make sure the pipeline worker is running. Idempotent — if it
    # already is, this is a no-op.
    try:
        from app.workers import pipeline as _pipeline
        await _pipeline.ensure_worker(cam.id)
    except Exception:  # noqa: BLE001
        # Worker spawn failure shouldn\'t break the API response.
        import logging
        logging.getLogger(__name__).exception("Failed to ensure recorded-clip worker.")
    return cam


# --- Pause / resume a camera's worker --------------------------------
# Used by the Recorded Clip page so the operator's "stop" button actually
# stops cv2 from reading new frames — instead of the previous behavior
# where pause was purely cosmetic and the clip kept advancing in the
# background. These are generic per-camera endpoints; nothing about them
# is specific to the recorded clip, so a future "pause this live camera"
# UI would work without code changes.


@router.get("/{camera_id}/state")
async def get_camera_state(
    camera_id: int,
    db: Session = Depends(get_db),
) -> dict:
    """Runtime state for a camera's worker — used by the frontend on
    mount to reconcile its local `paused` UI flag with the actual
    backend state. The pause flag lives in memory on the worker, so a
    page reload (or a switch-back-to-tab that causes a remount) used to
    forget it; the frontend now queries this endpoint on mount and
    restores the toggle to match.
    """
    cam = db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(404, "Camera not found.")
    from app.workers import pipeline as _pipeline
    return {"paused": _pipeline.is_paused(camera_id)}


@router.post("/{camera_id}/pause", response_model=CameraOut)
async def pause_camera(
    camera_id: int,
    db: Session = Depends(get_db),
) -> Camera:
    cam = db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(404, "Camera not found.")
    from app.workers import pipeline as _pipeline
    await _pipeline.pause_worker(camera_id)
    return cam


@router.post("/{camera_id}/resume", response_model=CameraOut)
async def resume_camera(
    camera_id: int,
    db: Session = Depends(get_db),
) -> Camera:
    cam = db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(404, "Camera not found.")
    from app.workers import pipeline as _pipeline
    await _pipeline.resume_worker(camera_id)
    return cam


@router.post("/recorded/copy-geo/{src_camera_id}", response_model=CameraOut)
async def copy_recorded_geo(
    src_camera_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> Camera:
    """Copy lat/lon/heading/FOV from another camera onto the recorded-
    clip camera so the demo footage can be re-played at that camera\'s
    location. Restarts the pipeline worker so the new geo takes
    effect immediately (workers snapshot config at startup)."""
    rec = db.execute(
        select(Camera).where(Camera.name == RECORDED_CAMERA_NAME)
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "Recorded Clip camera not initialised; GET /cameras/recorded first.")
    src = db.get(Camera, src_camera_id)
    if src is None or src.id == rec.id:
        raise HTTPException(404, "Source camera not found.")
    rec.latitude = src.latitude
    rec.longitude = src.longitude
    rec.heading_deg = src.heading_deg
    rec.altitude_m = src.altitude_m
    rec.fov_h_deg = src.fov_h_deg
    rec.fov_v_deg = src.fov_v_deg
    rec.sensor_w_px = src.sensor_w_px
    rec.assumed_target_distance_m = src.assumed_target_distance_m
    db.commit()
    db.refresh(rec)
    try:
        from app.workers import pipeline as _pipeline
        await _pipeline.restart_worker(rec.id)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception("Failed to restart recorded-clip worker after geo update.")
    return rec

