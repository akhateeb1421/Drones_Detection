"""Regression tests for the Kalman velocity estimator.

The key property: speed must be correct REGARDLESS of the sampling
cadence. The pre-Kalman implementation assumed samples were one video
frame apart and multiplied by fps, so live-path speeds (sampled every
Nth frame, gated on inference latency) were inflated by the gap. These
tests feed the same constant-velocity target at both regular and
irregular timestamps and require the same answer.
"""

import math

import pytest

from app.services.kalman import CVKalman


def _run_constant_velocity(times, vn=20.0, ve=10.0, n0=0.0, e0=0.0):
    kf = CVKalman()
    for t in times:
        kf.update(t, n0 + vn * t, e0 + ve * t)
    return kf


def test_speed_converges_regular_sampling():
    times = [i * 0.04 for i in range(100)]  # 25 fps, 4 s
    kf = _run_constant_velocity(times)
    expected = math.hypot(20.0, 10.0)
    assert kf.speed_mps() == pytest.approx(expected, rel=0.05)


def test_speed_identical_under_irregular_sampling():
    """The exact live-path failure mode: sparse, irregular samples must
    NOT inflate the speed."""
    regular = [i * 0.04 for i in range(100)]         # every frame
    sparse = [i * 0.5 for i in range(9)]             # one sample per 12.5 frames
    irregular = [0.0, 0.3, 0.9, 1.0, 1.8, 2.2, 3.1, 3.3, 4.0]
    expected = math.hypot(20.0, 10.0)
    for times in (regular, sparse, irregular):
        kf = _run_constant_velocity(times)
        assert kf.speed_mps() == pytest.approx(expected, rel=0.10), times


def test_heading_correct():
    # Due-east motion: vn=0, ve=15 -> heading 90.
    kf = _run_constant_velocity([i * 0.1 for i in range(60)], vn=0.0, ve=15.0)
    assert kf.heading_deg() == pytest.approx(90.0, abs=3.0)


def test_stationary_target_reports_near_zero_speed_and_no_heading():
    kf = CVKalman()
    for i in range(50):
        kf.update(i * 0.1, 100.0, -50.0)
    assert kf.speed_mps() < 0.5
    assert kf.heading_deg() is None


def test_uncertainty_shrinks_with_evidence():
    kf = CVKalman()
    kf.update(0.0, 0.0, 0.0)
    kf.update(0.1, 2.0, 0.0)
    early = kf.speed_std_mps()
    for i in range(2, 80):
        kf.update(i * 0.1, 20.0 * i * 0.1, 0.0)
    late = kf.speed_std_mps()
    assert late < early
    assert kf.heading_std_deg() < 45.0
