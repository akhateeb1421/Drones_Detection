"""Prophet forecaster wrapper, with a richer fallback that actually has shape.

Without Prophet installed, the fallback fits a 1st-harmonic Fourier
seasonality (annual + weekly) plus a bounded linear trend plus
per-region Gaussian noise. That gives a smooth, region-specific curve
without the hard step changes a discrete per-month bucketing would
produce.
"""

from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Attack
from app.schemas.prediction import ForecastPoint

log = logging.getLogger(__name__)

ARTIFACTS_DIR = Path(__file__).resolve().parents[3] / "ml" / "artifacts"


def _load_history(db: Session, region: str | None) -> pd.DataFrame:
    stmt = select(Attack.occurred_at, Attack.region)
    if region:
        stmt = stmt.where(Attack.region == region)
    rows = db.execute(stmt).all()
    if not rows:
        return pd.DataFrame(columns=["ds", "y"])
    df = pd.DataFrame(rows, columns=["occurred_at", "region"])
    df["ds"] = pd.to_datetime(df["occurred_at"], utc=True).dt.tz_convert(None).dt.normalize()
    g = df.groupby(["ds", "region"]).size().reset_index(name="y")
    return g


def _fit_seasonal(values: np.ndarray, t: np.ndarray, period: float, max_amp: float) -> tuple[float, float]:
    """Fit `y = a*cos(2πt/period) + b*sin(2πt/period)` by least squares.

    Returns (a, b) coefficients, scaled so the cycle amplitude
    `sqrt(a²+b²)` never exceeds `max_amp`. This is the 1st harmonic of a
    Fourier series — enough to model a single peak/trough per period
    (annual summer/winter or weekend/weekday rhythm) without overfitting
    sparse data the way per-bucket means do.
    """
    if values.size < 8 or np.std(values) < 1e-9:
        return 0.0, 0.0
    centred = values - values.mean()
    c = np.cos(2 * np.pi * t / period)
    s = np.sin(2 * np.pi * t / period)
    try:
        coeffs, *_ = np.linalg.lstsq(np.stack([c, s], axis=1), centred, rcond=None)
        a, b = float(coeffs[0]), float(coeffs[1])
    except Exception:  # noqa: BLE001
        return 0.0, 0.0
    amp = math.hypot(a, b)
    if amp > max_amp and amp > 0:
        scale = max_amp / amp
        a *= scale; b *= scale
    return a, b


def _heuristic_forecast(history: pd.DataFrame, region: str, days: int) -> list[ForecastPoint]:
    """Smooth annual + weekly seasonality, linear trend, Gaussian noise.

    The previous version used discrete per-month and per-weekday buckets
    and multiplied them together. That produces hard *step* changes at
    month boundaries and rigid weekly square waves, which look
    artificial over long horizons.

    This version fits the 1st Fourier harmonic for each cycle
    (annual ~365 d, weekly 7 d) plus a bounded linear trend, and adds
    small Gaussian noise seeded per region. The result is a smooth,
    region-specific curve with realistic day-to-day jitter.
    """
    sub = history[history["region"] == region].copy()
    if sub.empty:
        return []

    span_days = max((sub["ds"].max() - sub["ds"].min()).days + 1, 1)
    daily_mean = float(sub["y"].sum()) / span_days
    if daily_mean <= 1e-6:
        # Region exists but has effectively zero history — emit a flat
        # near-zero forecast rather than dividing-by-zero downstream.
        today = datetime.now(timezone.utc).date()
        return [
            ForecastPoint(
                region=region,
                forecast_date=today + timedelta(days=i),
                expected_count=0.0,
                date=today + timedelta(days=i),
                predicted_count=0.0,
                lower=0.0,
                upper=0.0,
            )
            for i in range(1, days + 1)
        ]

    # --- Annual seasonality (smooth sinusoid over day-of-year) ---
    doy = sub["ds"].dt.dayofyear.to_numpy(dtype=float)
    yvals = sub["y"].to_numpy(dtype=float)
    # Cap annual swing at ±30% of the regional baseline. Real attack
    # data is noisy; bigger swings here are almost always overfit.
    a_year, b_year = _fit_seasonal(yvals, doy, 365.0, max_amp=0.30 * daily_mean)

    # --- Weekly cycle (smooth sinusoid over day-of-week) ---
    dow = sub["ds"].dt.dayofweek.to_numpy(dtype=float)
    # Weekly swing capped tighter — most regions have only a mild
    # weekday/weekend rhythm in the historical data.
    a_week, b_week = _fit_seasonal(yvals, dow, 7.0, max_amp=0.15 * daily_mean)

    # --- Long-term linear trend ---
    if len(sub) >= 5:
        x = (sub["ds"] - sub["ds"].min()).dt.days.to_numpy(dtype=float)
        if x.max() > 0 and np.std(yvals) > 0:
            slope, _intercept = np.polyfit(x, yvals, 1)
        else:
            slope = 0.0
    else:
        slope = 0.0
    # Bound the slope so a noisy fit can't predict the model into the
    # stratosphere over 365 days. Max swing over a year ≤ daily_mean.
    slope = float(np.clip(slope, -daily_mean / 365.0, daily_mean / 365.0))

    today = datetime.now(timezone.utc).date()

    # Per-region RNG so the noise is deterministic but uncorrelated
    # across regions — they don't all jitter the same direction on the
    # same day, which is what made every line move together before.
    region_seed = sum(ord(c) for c in region) % 100003
    rng = np.random.default_rng(region_seed)

    # Noise sigma — 8% of the regional baseline, with a small floor so
    # high-traffic regions don't end up looking unrealistically smooth.
    sigma = max(daily_mean * 0.08, 0.15)

    points: list[ForecastPoint] = []
    for i in range(1, days + 1):
        d = today + timedelta(days=i)
        di_doy = float(d.timetuple().tm_yday)
        di_dow = float(d.weekday())

        annual = a_year * math.cos(2 * math.pi * di_doy / 365.0) \
               + b_year * math.sin(2 * math.pi * di_doy / 365.0)
        weekly = a_week * math.cos(2 * math.pi * di_dow / 7.0) \
               + b_week * math.sin(2 * math.pi * di_dow / 7.0)
        trend  = slope * i
        noise  = float(rng.normal(0.0, sigma))

        yhat = max(0.0, daily_mean + annual + weekly + trend + noise)

        # Confidence band scales with both the deterministic seasonality
        # and the noise floor — wider when seasonality is far from
        # baseline, never collapses to a flat line.
        spread = max(daily_mean * 0.30, abs(annual + weekly) * 0.6, 2 * sigma)

        ec = round(float(yhat), 3)
        points.append(
            ForecastPoint(
                region=region,
                forecast_date=d,
                expected_count=ec,
                # Aliases for the new Analysis.tsx, which reads p.date /
                # p.predicted_count first and falls back to the old names.
                date=d,
                predicted_count=ec,
                lower=round(float(max(0.0, yhat - spread)), 3),
                upper=round(float(yhat + spread), 3),
            )
        )
    return points


def forecast(db: Session, region: str | None, days: int = 30) -> list[ForecastPoint]:
    history = _load_history(db, None)
    if history.empty:
        return []
    regions = [region] if region else sorted(history["region"].dropna().unique().tolist())

    out: list[ForecastPoint] = []
    for r in regions:
        artifact = ARTIFACTS_DIR / f"prophet_{_slug(r)}.pkl"
        model = None
        if artifact.exists():
            try:
                model = joblib.load(artifact)
            except Exception:  # noqa: BLE001
                log.exception("Failed to load Prophet artifact for region=%s", r)
                model = None

        if model is None:
            out.extend(_heuristic_forecast(history, r, days))
            continue

        try:
            future = model.make_future_dataframe(periods=days, freq="D", include_history=False)
            preds = model.predict(future)
            for _, row in preds.iterrows():
                ds: datetime = row["ds"].to_pydatetime() if hasattr(row["ds"], "to_pydatetime") else row["ds"]
                forecast_date: date = ds.date() if hasattr(ds, "date") else ds
                ec = float(max(row.get("yhat", 0.0), 0.0))
                out.append(
                    ForecastPoint(
                        region=r,
                        forecast_date=forecast_date,
                        expected_count=ec,
                        # Aliases so the new frontend reads `date` / `predicted_count`.
                        date=forecast_date,
                        predicted_count=ec,
                        lower=float(max(row.get("yhat_lower", 0.0), 0.0)),
                        upper=float(max(row.get("yhat_upper", 0.0), 0.0)),
                    )
                )
        except Exception:  # noqa: BLE001
            log.exception("Prophet inference failed for region=%s; using heuristic.", r)
            out.extend(_heuristic_forecast(history, r, days))

    return out


def _slug(s: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in s).strip("_").lower()
