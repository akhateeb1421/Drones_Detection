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
    """Project a pixel (cx, cy) onto the world using a per-camera config."""
    # angular offsets in the camera frame (deg)
    az_offset_deg = ((cx - frame_w / 2) / max(frame_w, 1)) * cam.fov_h_deg
    # el_offset_deg = ((cy - frame_h / 2) / max(frame_h, 1)) * cam.fov_v_deg  # unused for ground-plane demo

    # bearing this pixel points to in world frame (0=N, clockwise)
    target_bearing_deg = (cam.heading_deg + az_offset_deg) % 360.0
    bearing_rad = math.radians(target_bearing_deg)

    # demo-grade: assume target at a fixed configured distance
    horizontal_dist_m = cam.assumed_target_distance_m

    d_north = horizontal_dist_m * math.cos(bearing_rad)
    d_east = horizontal_dist_m * math.sin(bearing_rad)
    return offset_meters(cam.latitude, cam.longitude, d_north, d_east)


def pixel_speed_to_mps(px_delta_per_frame: float, fps: float, cam: CameraGeo) -> float:
    """Convert a pixel displacement per frame to meters/second.

    Uses the same simple horizontal-FOV model as the original notebook but reads
    the FOV from the camera config rather than hardcoding it.
    """
    meters_per_px = (
        2 * cam.assumed_target_distance_m * math.tan(math.radians(cam.fov_h_deg / 2))
    ) / max(cam.sensor_w_px, 1)
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
