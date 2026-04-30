"""XGBoost risk classifier wrapper.

Predicts the probability that *at least one* attack occurs in a given region
in the next H days, using engineered features from the unified attacks table.
Falls back to a heuristic (recency × frequency) if the trained artifact is
missing, so the API never 500s on a fresh install.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Attack
from app.schemas.prediction import RegionRisk

log = logging.getLogger(__name__)

ARTIFACT_PATH = Path(__file__).resolve().parents[3] / "ml" / "artifacts" / "risk_clf.joblib"


def _load_attacks_df(db: Session) -> pd.DataFrame:
    rows = db.execute(
        select(Attack.occurred_at, Attack.region, Attack.attack_type, Attack.source)
    ).all()
    if not rows:
        return pd.DataFrame(columns=["occurred_at", "region", "attack_type", "source"])
    df = pd.DataFrame(rows, columns=["occurred_at", "region", "attack_type", "source"])
    df["occurred_at"] = pd.to_datetime(df["occurred_at"], utc=True)
    return df


def _features_for_region(df: pd.DataFrame, region: str, asof: datetime) -> dict[str, float]:
    sub = df[df["region"] == region]
    if sub.empty:
        return {
            "total": 0.0,
            "last_30d": 0.0,
            "last_7d": 0.0,
            "days_since_last": 9999.0,
            "share_drone": 0.0,
            "share_missile": 0.0,
        }
    last_30 = sub[sub["occurred_at"] >= asof - timedelta(days=30)].shape[0]
    last_7 = sub[sub["occurred_at"] >= asof - timedelta(days=7)].shape[0]
    last_seen = sub["occurred_at"].max()
    days_since_last = max((asof - last_seen).days, 0)
    types = sub["attack_type"].value_counts(normalize=True).to_dict()
    return {
        "total": float(len(sub)),
        "last_30d": float(last_30),
        "last_7d": float(last_7),
        "days_since_last": float(days_since_last),
        "share_drone": float(types.get("drone", 0.0)),
        "share_missile": float(types.get("ballistic_missile", 0.0) + types.get("cruise_missile", 0.0)),
    }


def _heuristic(features: dict[str, float], horizon_days: int) -> float:
    # Simple, explainable fallback: recency × frequency × horizon scale
    recency = max(0.0, 1.0 - features["days_since_last"] / 365.0)
    frequency = min(features["last_30d"] / 30.0 * horizon_days, 1.0)
    return float(min(0.95, max(0.05, 0.4 * recency + 0.6 * frequency)))


def predict_all_regions(db: Session, horizon_days: int = 30) -> list[RegionRisk]:
    df = _load_attacks_df(db)
    if df.empty:
        return []
    asof = datetime.now(timezone.utc)
    regions = sorted(df["region"].dropna().unique().tolist())

    model = None
    if ARTIFACT_PATH.exists():
        try:
            model = joblib.load(ARTIFACT_PATH)
        except Exception:  # noqa: BLE001
            log.exception("Failed to load classifier artifact; using heuristic.")
            model = None

    out: list[RegionRisk] = []
    for region in regions:
        feats = _features_for_region(df, region, asof)
        if model is None:
            prob = _heuristic(feats, horizon_days)
            method = "heuristic"
        else:
            try:
                feature_order = list(model.feature_names_in_)
                x = np.array([[feats.get(c, 0.0) for c in feature_order]], dtype=float)
                prob = float(model.predict_proba(x)[0, 1])
                method = "xgboost"
            except Exception:  # noqa: BLE001
                log.exception("Classifier inference failed for region=%s; using heuristic.", region)
                prob = _heuristic(feats, horizon_days)
                method = "heuristic"
        out.append(
            RegionRisk(region=region, risk_probability=prob, horizon_days=horizon_days, method=method)
        )
    out.sort(key=lambda r: r.risk_probability, reverse=True)
    return out
