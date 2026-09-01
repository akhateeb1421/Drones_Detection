"""Two-camera bearing triangulation.

When the same drone is visible from two cameras (a cross-camera link),
each camera contributes a bearing ray from its own position toward the
target. Intersecting the two rays yields a *measured* position — unlike
the single-camera pixel→world projection, which has to assume a target
distance. Planar (equirectangular) math is used; fine at the few-km
scales two overlapping cameras cover.
"""

from __future__ import annotations

import math

M_PER_DEG_LAT = 111_320.0


def bearing_intersection(
    lat1: float,
    lon1: float,
    bearing1_deg: float,
    lat2: float,
    lon2: float,
    bearing2_deg: float,
    max_range_m: float = 20_000.0,
) -> tuple[float, float] | None:
    """Intersect two bearing rays. Returns (lat, lon) or None when the
    rays are near-parallel, intersect behind either camera, or land
    farther than ``max_range_m`` from either camera."""
    # Local ENU frame anchored at camera 1.
    cos_lat = math.cos(math.radians(lat1))
    n2 = (lat2 - lat1) * M_PER_DEG_LAT
    e2 = (lon2 - lon1) * M_PER_DEG_LAT * cos_lat

    b1 = math.radians(bearing1_deg % 360.0)
    b2 = math.radians(bearing2_deg % 360.0)
    d1 = (math.cos(b1), math.sin(b1))  # (north, east)
    d2 = (math.cos(b2), math.sin(b2))

    # Solve p1 + t1*d1 == p2 + t2*d2 for t1, t2 (2x2 linear system).
    det = d1[0] * (-d2[1]) - d1[1] * (-d2[0])
    if abs(det) < 1e-6:  # near-parallel rays — no reliable fix
        return None
    rhs_n, rhs_e = n2, e2
    t1 = (rhs_n * (-d2[1]) - rhs_e * (-d2[0])) / det
    t2 = (d1[0] * rhs_e - d1[1] * rhs_n) / det

    # Both intersections must lie IN FRONT of their cameras and within range.
    if t1 <= 0.0 or t2 <= 0.0 or t1 > max_range_m or t2 > max_range_m:
        return None

    n = t1 * d1[0]
    e = t1 * d1[1]
    return lat1 + n / M_PER_DEG_LAT, lon1 + e / (M_PER_DEG_LAT * cos_lat)
