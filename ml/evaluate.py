"""Evaluate the trained classifier on real-only, POST-CUTOFF data.

Two hygiene rules, both enforced here:

1. **Real-only** — synthetic rows are excluded so the metrics reflect
   real-world performance.
2. **Post-cutoff** — only (region, day) rows dated at or after the test
   window recorded in ``risk_clf_meta.json`` are scored. The previous
   version scored the whole real dataset, most of which the model was
   trained on, so its "holdout" numbers were not a holdout at all.

Run: `python ml/evaluate.py`
"""

from __future__ import annotations

import json
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
META = REPO / "ml" / "artifacts" / "risk_clf_meta.json"
log = logging.getLogger(__name__)


def main() -> None:
    configure_logging()
    if not ARTIFACT.exists():
        raise SystemExit(f"No classifier artifact at {ARTIFACT}; run train_classifier.py first.")

    horizon_days = 30
    test_start = None
    if META.exists():
        meta = json.loads(META.read_text())
        horizon_days = int(meta.get("horizon_days", 30))
        test_start = pd.Timestamp(meta.get("test_start"))
        log.info("Using training metadata: horizon=%d, test window starts %s", horizon_days, test_start.date())
    else:
        log.warning(
            "No risk_clf_meta.json found — evaluating on ALL real data. These "
            "metrics overlap the training period and are optimistic; re-run "
            "ml/train_classifier.py to produce the metadata."
        )

    with SessionLocal() as db:
        rows = db.execute(
            select(Attack.occurred_at, Attack.region, Attack.attack_type, Attack.source).where(
                Attack.source == "historical"
            )
        ).all()
    real = pd.DataFrame(rows, columns=["occurred_at", "region", "attack_type", "source"])
    if real.empty:
        raise SystemExit("No historical rows found.")

    grid = daily_grid(real, horizon_days=horizon_days)
    if test_start is not None:
        grid = grid[grid["date"] >= test_start]
        if grid.empty:
            raise SystemExit(
                "No real rows fall inside the post-cutoff test window — the "
                "real dataset may end before the training cutoff. Retrain "
                "with a smaller --test-days."
            )

    x = grid[FEATURE_COLUMNS]
    y = grid["y"]

    clf = joblib.load(ARTIFACT)
    proba = clf.predict_proba(x)[:, 1]
    pred = (proba >= 0.5).astype(int)

    scope = "post-cutoff" if test_start is not None else "ALL (optimistic!)"
    log.info("Real-only rows (%s): %d (positives=%d)", scope, len(grid), int(y.sum()))
    log.info("Accuracy:    %.3f", accuracy_score(y, pred))
    if y.nunique() > 1:
        log.info("ROC-AUC:     %.3f", roc_auc_score(y, proba))
    log.info("Brier score: %.3f", brier_score_loss(y, proba))
    log.info("\n%s", classification_report(y, pred, zero_division=0))


if __name__ == "__main__":
    main()
