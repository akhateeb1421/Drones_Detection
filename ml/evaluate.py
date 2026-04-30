"""Evaluate the trained classifier on the *real-only* holdout.

Synthetic rows are excluded from evaluation so the metrics reflect real-world
performance (or lack of it — the real dataset is small).

Run: `python ml/evaluate.py`
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, classification_report, roc_auc_score
from sqlalchemy import select

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "backend"))

from app.core.db import SessionLocal  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.models import Attack  # noqa: E402
from ml.shared.feature_engineering import FEATURE_COLUMNS, daily_grid  # noqa: E402

ARTIFACT = REPO / "ml" / "artifacts" / "risk_clf.joblib"
log = logging.getLogger(__name__)


def main() -> None:
    configure_logging()
    if not ARTIFACT.exists():
        raise SystemExit(f"No classifier artifact at {ARTIFACT}; run train_classifier.py first.")

    with SessionLocal() as db:
        rows = db.execute(
            select(Attack.occurred_at, Attack.region, Attack.attack_type, Attack.source).where(
                Attack.source == "historical"
            )
        ).all()
    real = pd.DataFrame(rows, columns=["occurred_at", "region", "attack_type", "source"])
    if real.empty:
        raise SystemExit("No historical rows found.")

    grid = daily_grid(real, horizon_days=30)
    X = grid[FEATURE_COLUMNS]
    y = grid["y"]

    clf = joblib.load(ARTIFACT)
    proba = clf.predict_proba(X)[:, 1]
    pred = (proba >= 0.5).astype(int)

    log.info("Real-only rows: %d (positives=%d)", len(grid), int(y.sum()))
    log.info("Accuracy:    %.3f", accuracy_score(y, pred))
    if y.nunique() > 1:
        log.info("ROC-AUC:     %.3f", roc_auc_score(y, proba))
    log.info("Brier score: %.3f", brier_score_loss(y, proba))
    log.info("\n%s", classification_report(y, pred, zero_division=0))


if __name__ == "__main__":
    main()
