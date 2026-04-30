"""Prophet forecaster wrapper — daily attack count per region.

Loads pre-trained Prophet artifacts from ml/artifacts/. If none are found, falls
back to an exponential-smoothing-ish heuristic so the API still returns
something sensible on a fresh install.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import joblib
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
    if history.empty:
        return []
    sub = history[history["region"] == region]
    if sub.empty:
        return []
    daily_mean = float(sub["y"].sum()) / max((sub["ds"].max() - sub["ds"].min()).days + 1, 1)
    today = datetime.now(timezone.utc).date()
    points: list[ForecastPoint] = []
    for i in range(1, days + 1):
        d = today + timedelta(days=i)
        points.append(
            ForecastPoint(
                region=region,
                forecast_date=d,
                expected_count=round(daily_mean, 3),
                lower=round(max(0.0, daily_mean - daily_mean * 0.5), 3),
                upper=round(daily_mean + daily_mean * 0.5, 3),
            )
        )
    return points


def forecast(db: Session, region: str | None, days: int = 30) -> list[ForecastPoint]:
    history = _load_history(db, None)  # need all regions to enumerate
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
