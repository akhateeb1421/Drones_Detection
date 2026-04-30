"""Train the XGBoost risk classifier.

Reads the unified `attacks` table (historical + synthetic + live), engineers
features per (region, day), and trains a binary classifier predicting whether
*any* attack will occur in the next H days for that region.

Eval is reported on the real-only holdout for honest metrics. The artifact is
saved to ml/artifacts/risk_clf.joblib where the FastAPI service picks it up.

Run: `python ml/train_classifier.py [--horizon-days 30] [--out ml/artifacts/risk_clf.joblib]`
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from sqlalchemy import select
from xgboost import XGBClassifier

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))               # so `import ml.shared...` resolves
sys.path.insert(0, str(REPO / "backend"))   # so `import app...` resolves

from app.core.db import SessionLocal  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.models import Attack  # noqa: E402
from ml.shared.feature_engineering import FEATURE_COLUMNS, daily_grid  # noqa: E402


log = logging.getLogger(__name__)


def load_attacks() -> pd.DataFrame:
    with SessionLocal() as db:
        rows = db.execute(
            select(Attack.occurred_at, Attack.region, Attack.attack_type, Attack.source)
        ).all()
    return pd.DataFrame(rows, columns=["occurred_at", "region", "attack_type", "source"])


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon-days", type=int, default=30)
    parser.add_argument("--out", default=str(REPO / "ml" / "artifacts" / "risk_clf.joblib"))
    args = parser.parse_args()

    attacks = load_attacks()
    if attacks.empty:
        raise SystemExit("attacks table is empty — run seeders first.")

    log.info("Engineering features (horizon=%d days)...", args.horizon_days)
    grid = daily_grid(attacks, horizon_days=args.horizon_days)
    if grid.empty:
        raise SystemExit("Feature grid is empty.")

    log.info("Grid rows: %d (positives=%d)", len(grid), int(grid["y"].sum()))

    X = grid[FEATURE_COLUMNS]
    y = grid["y"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)

    clf = XGBClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    proba = clf.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)

    log.info("Test accuracy:    %.3f", accuracy_score(y_test, pred))
    log.info("Test ROC-AUC:     %.3f", roc_auc_score(y_test, proba))
    log.info("Test Brier score: %.3f (lower is better)", brier_score_loss(y_test, proba))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, out_path)
    log.info("Saved classifier artifact to %s", out_path)


if __name__ == "__main__":
    main()
