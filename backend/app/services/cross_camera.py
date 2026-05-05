"""Cross-camera track linking.

When a brand-new track appears on Camera B, look at recently-active tracks
on OTHER cameras. If one of them ended within the last few seconds at a
position whose forward projection (last lat/lon + speed * elapsed * heading)
lands close to where Camera B picked the drone up, treat them as the same
drone and store the link.

Spatial-temporal matching only — no visual re-identification.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Track
from app.services.geo import haversine_m, offset_meters

log = logging.getLogger(__name__)

# How far back (seconds) to look for a candidate from another camera.
MAX_AGE_S = 12.0
# How close the forward-projected position has to be to count as a match (meters).
MAX_GAP_M = 1500.0


def _project(lat: float, lon: float, heading_deg: float, speed_mps: float, dt_s: float) -> tuple[float, float]:
    distance = max(speed_mps, 0.0) * max(dt_s, 0.0)
    bearing = math.radians(heading_deg % 360.0)
    return offset_meters(lat, lon, distance * math.cos(bearing), distance * math.sin(bearing))


def find_link(db: Session, camera_id: int, lat: float, lon: float, now: datetime) -> Track | None:
    """Return a Track from a different camera that probably matches this new sighting.

    Uses each candidate's last known speed + heading + elapsed time to project
    where it would be NOW, then picks the closest projection within MAX_GAP_M.
    Returns None if no good match.
    """
    cutoff = now - timedelta(seconds=MAX_AGE_S)
    candidates = db.execute(
        select(Track)
        .where(Track.camera_id != camera_id)
        .where(Track.last_seen_at >= cutoff)
        .where(Track.status != "rejected")
        .order_by(Track.last_seen_at.desc())
        .limit(50)
    ).scalars().all()

    best: Track | None = None
    best_dist = MAX_GAP_M

    for t in candidates:
        if t.last_lat is None or t.last_lon is None:
            continue
        dt_s = (now - t.last_seen_at).total_seconds()
        heading = float(t.last_heading_deg) if t.last_heading_deg is not None else 0.0
        speed = float(t.max_speed_mps) if t.max_speed_mps is not None else 0.0
        proj_lat, proj_lon = _project(float(t.last_lat), float(t.last_lon), heading, speed, dt_s)
        d = haversine_m(lat, lon, proj_lat, proj_lon)
        if d <= best_dist:
            best_dist = d
            best = t

    if best is not None:
        log.info(
            "Cross-camera link: cam=%s new sighting matched track id=%s (cam=%s) dist=%.1fm",
            camera_id, best.id, best.camera_id, best_dist,
        )
    return best


def root_track_id(db: Session, track: Track) -> int:
    """Walk linked_track_id chain to find the original track id."""
    seen: set[int] = set()
    current = track
    while current.linked_track_id is not None and current.linked_track_id not in seen:
        seen.add(current.id)
        parent = db.get(Track, current.linked_track_id)
        if parent is None:
            break
        current = parent
    return current.id
