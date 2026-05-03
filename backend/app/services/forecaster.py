"""Prophet forecaster wrapper, with a richer fallback that actually has shape.

Without Prophet installed, we use an STL-ish decomposition: daily mean +
weekly seasonality + monthly seasonality + a small linear trend, all learned
from the per-region history. This gives the chart real curves instead of a
flat line.
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


def _heuristic_forecast(history: pd.DataFrame, region: str, days: int) -> list[ForecastPoint]:
    """Build a forecast from per-weekday + per-month seasonality + a trend."""
    sub = history[history["region"] == region].copy()
    if sub.empty:
        return []

    span_days = max((sub["ds"].max() - sub["ds"].min()).days + 1, 1)
    daily_mean = float(sub["y"].sum()) / span_days

    # Per-weekday multiplier (Mon..Sun) — how that weekday compares to the mean.
    weekly = sub.assign(dow=sub["ds"].dt.dayofweek).groupby("dow")["y"].mean()
    week_mult = {d: float(weekly.get(d, daily_mean)) / max(daily_mean, 1e-6) for d in range(7)}

    # Per-month multiplier.
    monthly = sub.assign(m=sub["ds"].dt.month).groupby("m")["y"].mean()
    month_mult = {m: float(monthly.get(m, daily_mean)) / max(daily_mean, 1e-6) for m in range(1, 13)}

    # Tiny linear trend so the line isn't perfectly periodic. Slope is the
    # change in daily mean per year, derived from a linear fit of cumulative
    # counts vs day index. Bounded so it doesn't blow up.
    if len(sub) >= 5:
        x = (sub["ds"] - sub["ds"].min()).dt.days.to_numpy(dtype=float)
        y = sub["y"].to_numpy(dtype=float)
        if x.max() > 0 and np.std(y) > 0:
            slope, _intercept = np.polyfit(x, y, 1)
        else:
            slope = 0.0
    else:
        slope = 0.0
    slope = float(np.clip(slope, -daily_mean / 365.0, daily_mean / 365.0))

    today = datetime.now(timezone.utc).date()
    points: list[ForecastPoint] = []
    for i in range(1, days + 1):
        d = today + timedelta(days=i)
        wm = week_mult.get(d.weekday(), 1.0)
        mm = month_mult.get(d.month, 1.0)
        trend = slope * i
        # Add a tiny deterministic wobble (~5%) seeded by date so neighboring
        # days aren't identical even when seasonality lines up.
        wobble = 1.0 + 0.05 * math.sin((i + d.toordinal()) * 0.7)
        yhat = max(0.0, daily_mean * wm * mm * wobble + trend)
        # Confidence band: wider when seasonality is far from baseline.
        spread = max(daily_mean * 0.4, abs(yhat - daily_mean) * 0.6)
        points.append(
            ForecastPoint(
                region=region,
                forecast_date=d,
                expected_count=round(float(yhat), 3),
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
                out.append(
                    ForecastPoint(
                        region=r,
                        forecast_date=forecast_date,
                        expected_count=float(max(row.get("yhat", 0.0), 0.0)),
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
