"""Smoke tests for the camera-aware geo math + ETA + path projection."""

import math

from app.services.eta import nearest
from app.services.geo import (
    CameraGeo,
    angle_to_compass,
    haversine_m,
    pixel_to_world,
    project_path,
)


def _cam(heading: float = 0.0) -> CameraGeo:
    return CameraGeo(
        latitude=24.7136,
        longitude=46.6753,
        heading_deg=heading,
        altitude_m=10.0,
        fov_h_deg=82.6,
        fov_v_deg=52.0,
        sensor_w_px=1280,
        assumed_target_distance_m=500.0,
    )


def test_haversine_zero_distance():
    assert haversine_m(24.7, 46.6, 24.7, 46.6) == 0.0


def test_pixel_center_returns_camera_position_offset_only_by_distance():
    cam = _cam(heading=0.0)  # north
    lat, lon = pixel_to_world(640, 360, 1280, 720, cam)
    # heading 0 => target is due north of the camera, ~500m away
    distance = haversine_m(cam.latitude, cam.longitude, lat, lon)
    assert abs(distance - cam.assumed_target_distance_m) < 5
    # latitude should increase, longitude unchanged-ish
    assert lat > cam.latitude
    assert abs(lon - cam.longitude) < 1e-4


def test_pixel_offset_respects_heading():
    cam_north = _cam(heading=0.0)
    cam_east = _cam(heading=90.0)
    lat_n, _ = pixel_to_world(640, 360, 1280, 720, cam_north)
    lat_e, lon_e = pixel_to_world(640, 360, 1280, 720, cam_east)
    assert lat_n > cam_north.latitude  # north
    assert abs(lat_e - cam_east.latitude) < 1e-4  # east => ~no lat change
    assert lon_e > cam_east.longitude


def test_angle_to_compass():
    assert angle_to_compass(0) == "N"
    assert angle_to_compass(90) == "E"
    assert angle_to_compass(180) == "S"
    assert angle_to_compass(270) == "W"


def test_project_path_zero_speed_returns_origin():
    lat, lon = project_path(24.7136, 46.6753, 0.0, 0.0, 60)
    assert math.isclose(lat, 24.7136, abs_tol=1e-6)
    assert math.isclose(lon, 46.6753, abs_tol=1e-6)


def test_nearest_returns_inf_when_no_areas():
    n = nearest(24.7136, 46.6753, 10.0, 0.9, [])
    assert n.eta_s is None
    assert n.distance_m == float("inf")


def test_nearest_low_confidence_no_eta():
    areas = [("Area-A", 24.7140, 46.6755)]
    n = nearest(24.7136, 46.6753, 10.0, 0.4, areas)
    assert n.name == "Area-A"
    assert n.eta_s is None
