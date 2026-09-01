"""Unit tests for two-camera bearing triangulation."""

import math

import pytest

from app.services.geo import haversine_m
from app.services.triangulate import bearing_intersection

M_PER_DEG_LAT = 111_320.0


def _bearing_to(lat1, lon1, lat2, lon2):
    """Planar compass bearing from point 1 to point 2 (matches the ENU
    frame the intersection uses)."""
    n = (lat2 - lat1) * M_PER_DEG_LAT
    e = (lon2 - lon1) * M_PER_DEG_LAT * math.cos(math.radians(lat1))
    return (math.degrees(math.atan2(e, n)) + 360.0) % 360.0


def test_recovers_known_target():
    cam1 = (24.7000, 46.6000)
    cam2 = (24.7000, 46.7000)   # ~10 km east of cam1
    target = (24.7500, 46.6500)  # north, between them
    fix = bearing_intersection(
        *cam1, _bearing_to(*cam1, *target),
        *cam2, _bearing_to(*cam2, *target),
    )
    assert fix is not None
    assert haversine_m(fix[0], fix[1], *target) < 50  # within 50 m


def test_parallel_rays_return_none():
    assert bearing_intersection(24.7, 46.6, 0.0, 24.7, 46.7, 0.0) is None


def test_intersection_behind_camera_rejected():
    cam1 = (24.7000, 46.6000)
    cam2 = (24.7000, 46.7000)
    target = (24.7500, 46.6500)
    # Camera 2 looks AWAY from the target — the rays only "cross" behind it.
    away = (_bearing_to(*cam2, *target) + 180.0) % 360.0
    fix = bearing_intersection(*cam1, _bearing_to(*cam1, *target), *cam2, away)
    assert fix is None


def test_out_of_range_rejected():
    cam1 = (24.7000, 46.6000)
    cam2 = (24.7000, 46.7000)
    far_target = (26.5000, 46.6500)  # ~200 km north
    fix = bearing_intersection(
        *cam1, _bearing_to(*cam1, *far_target),
        *cam2, _bearing_to(*cam2, *far_target),
        max_range_m=20_000.0,
    )
    assert fix is None


def test_geometry_sanity_various_quadrants():
    cam1 = (24.70, 46.60)
    cam2 = (24.66, 46.66)
    for target in [(24.75, 46.55), (24.75, 46.70), (24.62, 46.58)]:
        fix = bearing_intersection(
            *cam1, _bearing_to(*cam1, *target),
            *cam2, _bearing_to(*cam2, *target),
        )
        assert fix is not None, target
        assert haversine_m(fix[0], fix[1], *target) < 100
