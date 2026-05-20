"""Camera-aware pixel-to-world projection and great-circle utilities.

This is the demo-grade replacement for the "downward camera" math used in the
original Colab notebook. It now respects each camera's mounted heading
(azimuth) and uses a configurable assumed target distance per camera. The
projection is documented as demo-grade in docs/SETUP.md — real geolocation
would require depth from stereo, lidar, or known target size.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class CameraGeo:
    """Frozen snapshot of camera config used for pixel→world math."""

    latitude: float
    longitude: float
    heading_deg: float
    altitude_m: float
    fov_h_deg: float
    fov_v_deg: float
    sensor_w_px: int
    assumed_target_distance_m: float


COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    r = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def offset_meters(lat: float, lon: float, d_north_m: float, d_east_m: float) -> tuple[float, float]:
    """Add a (north, east) meter offset to a (lat, lon) point."""
    new_lat = lat + d_north_m / 111_320.0
    new_lon = lon + d_east_m / (111_320.0 * math.cos(math.radians(lat)))
    return new_lat, new_lon


def pixel_to_world(cx: float, cy: float, frame_w: int, frame_h: int, cam: CameraGeo) -> tuple[float, float]:
    """Project a pixel (cx, cy) onto the world using a per-camera config.

    Tangent-plane "crossing-target" model: the target sits on a vertical
    plane at the assumed distance, perpendicular to the camera's central
    bearing. Its world position is

        camera + D·(look direction) + offset·(perpendicular direction)

    where ``offset`` is proportional to the horizontal pixel offset from
    centre. As the target crosses the frame it therefore traces a STRAIGHT
    line on the map (constant compass heading), with the same
    metres-per-pixel basis the speed uses — so position, heading and speed
    are all consistent.

    This replaces the previous fixed-RADIUS bearing model, which placed the
    target on a CIRCLE around the camera: a drone flying straight then
    appeared to follow an arc, and its heading (the arc tangent) rotated by
    roughly the full horizontal FOV as it crossed the view (the "direction
    rotates east→north" symptom). The straight-line model removes that
    rotation entirely.
    """
    # Linear half-width (metres) covered by half the horizontal FOV at the
    # assumed distance — the same quantity `pixel_speed_to_mps` is built on.
    half_width_m = cam.assumed_target_distance_m * math.tan(math.radians(cam.fov_h_deg / 2.0))
    # Signed perpendicular offset from the camera's central bearing.
    offset_m = ((cx - frame_w / 2.0) / max(frame_w, 1)) * (2.0 * half_width_m)

    look_rad = math.radians(cam.heading_deg)
    perp_rad = math.radians((cam.heading_deg + 90.0) % 360.0)
    d_north = cam.assumed_target_distance_m * math.cos(look_rad) + offset_m * math.cos(perp_rad)
    d_east = cam.assumed_target_distance_m * math.sin(look_rad) + offset_m * math.sin(perp_rad)
    return offset_meters(cam.latitude, cam.longitude, d_north, d_east)


def pixel_speed_to_mps(
    px_delta_per_frame: float, fps: float, frame_w: int, cam: CameraGeo
) -> float:
    """Convert a pixel displacement per frame to meters/second.

    ``frame_w`` is the ACTUAL decoded frame width in pixels — the same
    width ``pixel_to_world`` maps onto the horizontal FOV for its azimuth
    math. The horizontal FOV (``fov_h_deg``) spans exactly ``frame_w``
    pixels, so the linear width covered at the assumed target distance
    (``2 * D * tan(fov_h/2)``) divided by ``frame_w`` is the true
    meters-per-pixel.

    The previous version divided by the CONFIGURED ``cam.sensor_w_px``
    (e.g. 1280) instead of the real frame width. Whenever the decoded
    video resolution differed from that constant, the speed was silently
    mis-scaled (and it was inconsistent with the pixel→world projection,
    which always used the real frame width). Using ``frame_w`` here makes
    the two consistent and the speed correctly scaled.
    """
    meters_per_px = (
        2 * cam.assumed_target_distance_m * math.tan(math.radians(cam.fov_h_deg / 2))
    ) / max(frame_w, 1)
    return px_delta_per_frame * meters_per_px * fps


def angle_to_compass(angle_deg: float) -> str:
    """Map a heading (0=N, 90=E, ...) to one of 8 compass labels."""
    idx = int((angle_deg + 22.5) / 45) % 8
    return COMPASS[idx]


def project_path(
    lat: float,
    lon: float,
    speed_mps: float,
    angle_deg: float,
    seconds_ahead: float = 60.0,
) -> tuple[float, float]:
    """Straight-line projection of a track's future position."""
    distance_m = max(speed_mps, 0.0) * seconds_ahead
    bearing_rad = math.radians(angle_deg % 360.0)
    d_north = distance_m * math.cos(bearing_rad)
    d_east = distance_m * math.sin(bearing_rad)
    return offset_meters(lat, lon, d_north, d_east)
