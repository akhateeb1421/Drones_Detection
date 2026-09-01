"""Constant-velocity Kalman filter for track smoothing.

Replaces the previous least-squares-slope + EMA scheme in
``services/inference.py``. Two properties matter here:

1. **Real time deltas.** The old code assumed consecutive trajectory
   samples were exactly one video frame apart and multiplied the
   per-sample step by ``fps``. On the live path YOLO only runs every Nth
   frame (and only when the previous pass has finished), so samples were
   several frames apart and displayed speeds were inflated by that
   factor. The filter takes an explicit timestamp with every update, so
   irregular sampling produces correct velocities by construction.

2. **Uncertainty.** The covariance gives honest error bars on speed and
   heading, which the frontend renders as a widening prediction cone
   instead of a false-precision single line.

State: x = [n, e, vn, ve] (metres north/east of a local origin, and
velocity). Measurements are positions only.
"""

from __future__ import annotations

import math

import numpy as np

# Process noise: how much acceleration (m/s^2, 1-sigma) we allow the
# target. Drones manoeuvre; 3 m/s^2 tracks a genuine turn within a couple
# of seconds without letting measurement jitter masquerade as motion.
DEFAULT_ACCEL_SIGMA = 3.0
# Measurement noise: 1-sigma position error of the pixel→world projection
# in metres. The projection is demo-grade (assumed distance), so this is
# deliberately loose.
DEFAULT_MEAS_SIGMA = 8.0


class CVKalman:
    """2-D constant-velocity Kalman filter with per-update time deltas."""

    def __init__(
        self,
        accel_sigma: float = DEFAULT_ACCEL_SIGMA,
        meas_sigma: float = DEFAULT_MEAS_SIGMA,
    ) -> None:
        self._q = float(accel_sigma) ** 2
        self._r = np.eye(2) * float(meas_sigma) ** 2
        self._h = np.array([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]])
        self._x: np.ndarray | None = None  # [n, e, vn, ve]
        self._p: np.ndarray | None = None
        self._t: float | None = None

    @property
    def initialized(self) -> bool:
        return self._x is not None

    def update(self, t_s: float, n_m: float, e_m: float) -> None:
        """Fold in a position measurement taken at time ``t_s`` (seconds,
        any monotonic clock — only deltas matter)."""
        z = np.array([n_m, e_m], dtype=float)
        if self._x is None:
            self._x = np.array([n_m, e_m, 0.0, 0.0])
            # Wide velocity prior: we genuinely don't know it yet.
            self._p = np.diag([self._r[0, 0], self._r[1, 1], 400.0, 400.0])
            self._t = t_s
            return

        dt = max(float(t_s) - float(self._t), 1e-3)
        self._t = t_s

        f = np.array(
            [
                [1.0, 0.0, dt, 0.0],
                [0.0, 1.0, 0.0, dt],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ]
        )
        # Discrete white-noise-acceleration process covariance.
        dt2, dt3, dt4 = dt * dt, dt**3, dt**4
        q = self._q * np.array(
            [
                [dt4 / 4, 0.0, dt3 / 2, 0.0],
                [0.0, dt4 / 4, 0.0, dt3 / 2],
                [dt3 / 2, 0.0, dt2, 0.0],
                [0.0, dt3 / 2, 0.0, dt2],
            ]
        )
        # Predict
        x = f @ self._x
        p = f @ self._p @ f.T + q
        # Update
        y = z - self._h @ x
        s_mat = self._h @ p @ self._h.T + self._r
        k = p @ self._h.T @ np.linalg.inv(s_mat)
        self._x = x + k @ y
        self._p = (np.eye(4) - k @ self._h) @ p

    # -- readouts -----------------------------------------------------------

    def position(self) -> tuple[float, float]:
        assert self._x is not None
        return float(self._x[0]), float(self._x[1])

    def speed_mps(self) -> float:
        if self._x is None:
            return 0.0
        return float(math.hypot(self._x[2], self._x[3]))

    def heading_deg(self) -> float | None:
        """Compass heading of travel (0=N, 90=E), or None while velocity is
        indistinguishable from zero."""
        if self._x is None:
            return None
        vn, ve = float(self._x[2]), float(self._x[3])
        if math.hypot(vn, ve) < 1e-3:
            return None
        return (math.degrees(math.atan2(ve, vn)) + 360.0) % 360.0

    def speed_std_mps(self) -> float:
        """1-sigma uncertainty of the speed magnitude (delta method)."""
        if self._x is None or self._p is None:
            return 0.0
        vn, ve = float(self._x[2]), float(self._x[3])
        v = math.hypot(vn, ve)
        pv = self._p[2:4, 2:4]
        if v < 1e-6:
            return float(math.sqrt(max(pv[0, 0], pv[1, 1], 0.0)))
        j = np.array([vn / v, ve / v])
        return float(math.sqrt(max(j @ pv @ j, 0.0)))

    def heading_std_deg(self) -> float:
        """1-sigma uncertainty of the heading, degrees (capped at 90)."""
        if self._x is None or self._p is None:
            return 90.0
        vn, ve = float(self._x[2]), float(self._x[3])
        v2 = vn * vn + ve * ve
        if v2 < 1e-6:
            return 90.0
        pv = self._p[2:4, 2:4]
        # d(atan2(ve, vn)) = [-ve, vn] / v^2
        j = np.array([-ve / v2, vn / v2])
        var = float(j @ pv @ j)
        return float(min(math.degrees(math.sqrt(max(var, 0.0))), 90.0))
