"""ETA + nearest sensitive area lookups."""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SensitiveArea
from app.services.geo import haversine_m


@dataclass(frozen=True)
class NearestArea:
    name: str | None
    distance_m: float
    eta_s: float | None  # None when speed is too low to be meaningful


def load_areas(db: Session) -> list[tuple[str, float, float]]:
    rows = db.execute(select(SensitiveArea.name, SensitiveArea.latitude, SensitiveArea.longitude)).all()
    return [(name, float(lat), float(lon)) for name, lat, lon in rows]


def nearest(
    lat: float,
    lon: float,
    speed_mps: float,
    confidence: float,
    areas: list[tuple[str, float, float]],
    *,
    min_confidence: float = 0.5,
    min_speed_mps: float = 0.5,
) -> NearestArea:
    """Find the nearest sensitive area and compute ETA at the current speed."""
    if not areas:
        return NearestArea(name=None, distance_m=math.inf, eta_s=None)

    best_name = None
    best_dist = math.inf
    for name, alat, alon in areas:
        d = haversine_m(lat, lon, alat, alon)
        if d < best_dist:
            best_dist = d
            best_name = name

    if confidence < min_confidence:
        # match the notebook semantics: low-confidence detections don't get ETAs
        return NearestArea(name=best_name, distance_m=best_dist, eta_s=None)

    if speed_mps < min_speed_mps:
        return NearestArea(name=best_name, distance_m=best_dist, eta_s=None)

    return NearestArea(name=best_name, distance_m=best_dist, eta_s=best_dist / speed_mps)
