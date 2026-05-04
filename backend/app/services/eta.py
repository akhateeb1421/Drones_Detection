"""ETA + nearest sensitive area lookups.

The "nearest" area is computed in two stages:
1. If the drone has a meaningful heading + speed, only consider areas that
   lie within a +/- HEADING_TOLERANCE_DEG cone in front of the drone. The
   closest of those wins, even if some other area is geometrically closer
   but off to the side.
2. If the drone is essentially stationary or no in-path area exists, fall
   back to plain great-circle distance.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SensitiveArea
from app.services.geo import haversine_m

# Half-angle of the "ahead" cone (degrees). 60 means anything within +/- 60
# of the drone's heading counts as in-path.
HEADING_TOLERANCE_DEG = 60.0


@dataclass(frozen=True)
class NearestArea:
    name: str | None
    distance_m: float
    eta_s: float | None  # None when speed is too low to be meaningful


def load_areas(db: Session) -> list[tuple[str, float, float]]:
    rows = db.execute(select(SensitiveArea.name, SensitiveArea.latitude, SensitiveArea.longitude)).all()
    return [(name, float(lat), float(lon)) for name, lat, lon in rows]


def _bearing_compass(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing from (lat1,lon1) to (lat2,lon2). Compass form: 0=N, 90=E."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _angle_diff(a: float, b: float) -> float:
    """Smallest absolute difference between two compass headings (0..180)."""
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def nearest(
    lat: float,
    lon: float,
    speed_mps: float,
    confidence: float,
    areas: list[tuple[str, float, float]],
    *,
    angle_deg: float | None = None,
    min_confidence: float = 0.5,
    min_speed_mps: float = 0.5,
) -> NearestArea:
    """Pick the sensitive area in the drone's path; compute ETA."""
    if not areas:
        return NearestArea(name=None, distance_m=math.inf, eta_s=None)

    # angle_deg now comes from the inference pipeline already in compass form
    # (0 = North, 90 = East), derived from the drone's lat/lon trajectory.
    drone_compass = None
    if angle_deg is not None and speed_mps >= min_speed_mps:
        drone_compass = float(angle_deg) % 360.0

    # Pre-compute distance + bearing to each area.
    enriched = []
    for name, alat, alon in areas:
        d = haversine_m(lat, lon, alat, alon)
        bearing = _bearing_compass(lat, lon, alat, alon)
        enriched.append((name, alat, alon, d, bearing))

    # Stage 1: directional pick if we have a heading.
    if drone_compass is not None:
        in_path = [
            (name, alat, alon, d, bearing)
            for (name, alat, alon, d, bearing) in enriched
            if _angle_diff(drone_compass, bearing) <= HEADING_TOLERANCE_DEG
        ]
        if in_path:
            best = min(in_path, key=lambda t: t[3])
            best_name, _, _, best_dist, _ = best
            if confidence < min_confidence:
                return NearestArea(name=best_name, distance_m=best_dist, eta_s=None)
            return NearestArea(name=best_name, distance_m=best_dist, eta_s=best_dist / speed_mps)

    # Stage 2: no heading, or nothing in path — fall back to plain closest.
    best = min(enriched, key=lambda t: t[3])
    best_name, _, _, best_dist, _ = best

    if confidence < min_confidence or speed_mps < min_speed_mps:
        return NearestArea(name=best_name, distance_m=best_dist, eta_s=None)

    return NearestArea(name=best_name, distance_m=best_dist, eta_s=best_dist / speed_mps)
