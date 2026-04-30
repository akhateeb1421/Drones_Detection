"""Train one Prophet model per region on the unified attacks table.

Saves each artifact to ml/artifacts/prophet_<region_slug>.pkl where the API
service reads them lazily on demand.

Run: `python ml/train_forecaster.py`
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import joblib
import pandas as pd
from sqlalchemy import select

try:
    from prophet import Prophet
except ImportError as _e:  # noqa: F841
    print("prophet is not installed. Install with: pip install -e .[forecast]")
    print("Skipping forecaster training. The API will use the heuristic fallback.")
    raise SystemExit(0)

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "backend"))

from app.core.db import SessionLocal  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.models import Attack  # noqa: E402

ARTIFACTS = REPO / "ml" / "artifacts"
log = logging.getLogger(__name__)


def slug(s: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in s).strip("_").lower()


def load_per_region() -> dict[str, pd.DataFrame]:
    with SessionLocal() as db:
        rows = db.execute(select(Attack.occurred_at, Attack.region)).all()
    df = pd.DataFrame(rows, columns=["occurred_at", "region"])
    if df.empty:
        return {}
    df["ds"] = pd.to_datetime(df["occurred_at"], utc=True).dt.tz_convert(None).dt.normalize()
    grouped = df.groupby(["region", "ds"]).size().reset_index(name="y")
    out: dict[str, pd.DataFrame] = {}
    for region, sub in grouped.groupby("region"):
        if region is None or pd.isna(region):
            continue
        out[str(region)] = sub[["ds", "y"]].sort_values("ds").reset_index(drop=True)
    return out


def main() -> None:
    configure_logging()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)

    series_per_region = load_per_region()
    if not series_per_region:
        raise SystemExit("No attack history found.")

    for region, ts in series_per_region.items():
        if len(ts) < 10:
            log.warning("Skipping %s — only %d data points (Prophet wants more).", region, len(ts))
            continue

        m = Prophet(weekly_seasonality=True, yearly_seasonality=False, daily_seasonality=False)
        try:
            m.fit(ts)
        except Exception:  # noqa: BLE001
            log.exception("Prophet fit failed for %s", region)
            continue

        path = ARTIFACTS / f"prophet_{slug(region)}.pkl"
        joblib.dump(m, path)
        log.info("Saved Prophet model for %s -> %s (%d points)", region, path, len(ts))


if __name__ == "__main__":
    main()
