"""ML prediction endpoints — XGBoost classifier + Prophet forecaster + camera placement suggestions."""

import math
from collections import Counter

import numpy as np
from fastapi import APIRouter, Depends, Query
from sklearn.cluster import KMeans
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Attack, SensitiveArea
from app.schemas.prediction import ForecastPoint, RegionRisk
from app.services import classifier, forecaster
from app.services.geo import haversine_m

router = APIRouter(prefix="/predict", tags=["predictions"])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _bearing_compass(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _circular_mean(angles_deg: list[float]) -> float:
    if not angles_deg:
        return 0.0
    sx = sum(math.sin(math.radians(a)) for a in angles_deg) / len(angles_deg)
    sy = sum(math.cos(math.radians(a)) for a in angles_deg) / len(angles_deg)
    return (math.degrees(math.atan2(sx, sy)) + 360.0) % 360.0


def _label(deg: float) -> str:
    labels = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return labels[int((deg + 22.5) / 45) % 8]


def _interpolate(lat1: float, lon1: float, lat2: float, lon2: float, t: float) -> tuple[float, float]:
    """Linear interpolation in lat/lon space (good enough at city scales)."""
    return (lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1))


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------


@router.get("/risk", response_model=list[RegionRisk])
def predict_risk(
    db: Session = Depends(get_db),
    horizon_days: int = Query(default=30, ge=1, le=365),
) -> list[RegionRisk]:
    return classifier.predict_all_regions(db, horizon_days=horizon_days)


@router.get("/forecast", response_model=list[ForecastPoint])
def predict_forecast(
    db: Session = Depends(get_db),
    region: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
) -> list[ForecastPoint]:
    return forecaster.forecast(db, region=region, days=days)


@router.get("/camera-placements")
def camera_placements(
    db: Session = Depends(get_db),
    radius_km: float = Query(default=300.0, ge=50.0, le=2000.0),
    fov_h_deg: float = Query(default=82.6, ge=10.0, le=120.0),
    assumed_target_distance_m: float = Query(default=5000.0, ge=100.0, le=50000.0),
    n_clusters: int = Query(default=4, ge=1, le=10, description="Number of attack hotspots to detect"),
    forward_offset: float = Query(default=0.30, ge=0.0, le=0.9, description="0..1 — how far from the area toward the hotspot to place the forward camera"),
    early_warning_km: float = Query(default=15.0, ge=0.0, le=200.0, description="Distance to push the per-area camera FORWARD along the threat axis. 0 = at the area itself."),
) -> list[dict]:
    """Suggest camera placements per sensitive area + cluster-based forward cameras.

    - `area` cameras: one per sensitive area, looking along the mean threat axis
      computed from attacks within `radius_km`.
    - `forward` cameras: KMeans-cluster the attacks into `n_clusters` hotspots,
      and for each hotspot place a forward observation camera between the
      closest sensitive area and the hotspot, looking outward at the hotspot.
    """
    sensitive = list(db.execute(select(SensitiveArea)).scalars().all())
    attacks = list(
        db.execute(
            select(Attack.latitude, Attack.longitude, Attack.region, Attack.attack_type)
        ).all()
    )
    if not sensitive or not attacks:
        return []

    attack_pts = [(float(la), float(lo), reg or "Unknown", typ or "") for la, lo, reg, typ in attacks]

    suggestions: list[dict] = []

    # ---- per-area cameras (mean threat axis of nearby attacks) ----
    for area in sensitive:
        a_lat = float(area.latitude)
        a_lon = float(area.longitude)

        nearby = []
        for la, lo, reg, typ in attack_pts:
            d_m = haversine_m(a_lat, a_lon, la, lo)
            if d_m <= radius_km * 1000.0:
                nearby.append((la, lo, reg, typ, d_m))

        if not nearby:
            nearby = [(la, lo, reg, typ, haversine_m(a_lat, a_lon, la, lo)) for la, lo, reg, typ in attack_pts]
            scope = "global"
        else:
            scope = f"{int(radius_km)}km"

        bearings = [_bearing_compass(a_lat, a_lon, la, lo) for la, lo, *_ in nearby]
        threat_bearing = _circular_mean(bearings)

        deviations = []
        for b in bearings:
            d = abs(b - threat_bearing) % 360.0
            deviations.append(min(d, 360.0 - d))
        spread_deg = sum(deviations) / max(len(deviations), 1)

        top_region, top_count = Counter([n[2] for n in nearby]).most_common(1)[0]
        compass_label = _label(threat_bearing)

        # Push the camera FORWARD along the threat axis so it can detect a
        # drone before it reaches the sensitive area. Distance is the user
        # control `early_warning_km` (0 = stay at the area).
        bearing_rad = math.radians(threat_bearing)
        d_m = early_warning_km * 1000.0
        d_north = d_m * math.cos(bearing_rad)
        d_east = d_m * math.sin(bearing_rad)
        cam_lat = a_lat + d_north / 111_320.0
        cam_lon = a_lon + d_east / (111_320.0 * math.cos(math.radians(a_lat)))

        # Reaction-time hint: how long does it take a typical drone to
        # cover early_warning_km? Use 30 m/s as a rough Shahed cruise.
        warn_seconds = (d_m / 30.0) if d_m > 0 else 0

        suggestions.append({
            "kind": "area",
            "name": f"CAM-{area.name}",
            "for_area": area.name,
            "lat": round(cam_lat, 6),
            "lon": round(cam_lon, 6),
            "heading_deg": round(threat_bearing, 1),
            "heading_label": compass_label,
            "fov_h_deg": round(fov_h_deg, 1),
            "assumed_target_distance_m": round(assumed_target_distance_m, 0),
            "covers_attacks": len(nearby),
            "spread_deg": round(spread_deg, 1),
            "top_threat_region": top_region,
            "top_threat_region_count": int(top_count),
            "scope": scope,
            "rationale": (
                f"Early-warning camera ahead of {area.name}, pushed "
                f"{early_warning_km:.0f} km along the threat axis ({threat_bearing:.0f}° {compass_label}). "
                f"Buys ~{warn_seconds:.0f}s reaction time at 30 m/s. "
                f"{len(nearby)} historical attacks within {scope}; "
                f"top contributor: {top_region} ({top_count}). Spread: {spread_deg:.0f}°."
            ),
        })

    # ---- forward cameras (KMeans-clustered attack hotspots) ----
    if len(attack_pts) >= max(2, n_clusters):
        coords = np.array([[la, lo] for la, lo, *_ in attack_pts], dtype=float)
        k = min(n_clusters, len(coords))
        try:
            kmeans = KMeans(n_clusters=k, n_init=10, random_state=42).fit(coords)
            centers = kmeans.cluster_centers_
            labels = kmeans.labels_
        except Exception:
            centers, labels = [], []

        for cid, (c_lat, c_lon) in enumerate(centers):
            members_idx = [i for i, lab in enumerate(labels) if lab == cid]
            if not members_idx:
                continue

            # Closest sensitive area to this hotspot.
            best_area = min(
                sensitive,
                key=lambda a: haversine_m(float(a.latitude), float(a.longitude), c_lat, c_lon),
            )
            ba_lat = float(best_area.latitude)
            ba_lon = float(best_area.longitude)

            d_to_hotspot_m = haversine_m(ba_lat, ba_lon, c_lat, c_lon)
            if d_to_hotspot_m < 1000:
                # Hotspot is essentially on top of the area — the per-area camera already covers it.
                continue

            cam_lat, cam_lon = _interpolate(ba_lat, ba_lon, c_lat, c_lon, forward_offset)
            heading = _bearing_compass(cam_lat, cam_lon, c_lat, c_lon)
            label = _label(heading)

            members_regions = [attack_pts[i][2] for i in members_idx]
            top_region, top_count = Counter(members_regions).most_common(1)[0]

            forward_distance_m = haversine_m(ba_lat, ba_lon, cam_lat, cam_lon)
            cluster_size_km = (
                np.mean(
                    [
                        haversine_m(c_lat, c_lon, attack_pts[i][0], attack_pts[i][1])
                        for i in members_idx
                    ]
                )
                / 1000.0
            )

            suggestions.append({
                "kind": "forward",
                "name": f"FWD-{best_area.name}-{cid + 1}",
                "for_area": best_area.name,
                "lat": round(float(cam_lat), 6),
                "lon": round(float(cam_lon), 6),
                "heading_deg": round(heading, 1),
                "heading_label": label,
                "fov_h_deg": round(fov_h_deg, 1),
                "assumed_target_distance_m": round(assumed_target_distance_m, 0),
                "covers_attacks": len(members_idx),
                "spread_deg": round(cluster_size_km, 1),  # repurpose as cluster radius (km)
                "top_threat_region": top_region,
                "top_threat_region_count": int(top_count),
                "scope": "cluster",
                "rationale": (
                    f"Forward observation camera ahead of {best_area.name}. "
                    f"Placed {forward_distance_m / 1000:.0f} km toward an attack hotspot "
                    f"at ({c_lat:.3f}, {c_lon:.3f}) with {len(members_idx)} attacks "
                    f"(mostly {top_region}, {top_count}). "
                    f"Heading {heading:.0f}° ({label}); cluster radius ~{cluster_size_km:.0f} km."
                ),
            })

    return suggestions
