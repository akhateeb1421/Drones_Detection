"""Train the XGBoost risk classifier — with a TIME-BASED split.

Reads the unified `attacks` table (historical + synthetic + live), engineers
features per (region, day), and trains a binary classifier predicting whether
*any* attack will occur in the next H days for that region.

Why a time-based split
----------------------
The previous version used a random ``train_test_split`` over the
(region, day) grid. Adjacent days share nearly identical features and
their H-day label windows overlap heavily, so a random split leaks the
test answers into training and the reported metrics were inflated. This
version holds out the LAST ``--test-days`` of the grid as the test set,
and additionally drops the ``horizon`` days immediately before the test
window from training (their label windows would peek into the test
period). The reported metrics therefore reflect genuine forward-looking
performance.

The evaluation cutoff is stored alongside the artifact
(``risk_clf_meta.json``) so ``ml/evaluate.py`` can score strictly
post-cutoff data.

Run: `python ml/train_classifier.py [--horizon-days 30] [--test-days 90]`
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
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
    parser.add_argument(
        "--test-days", type=int, default=90,
        help="Length of the held-out test window at the END of the grid.",
    )
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

    # ── Time-based split ────────────────────────────────────────────────
    grid = grid.sort_values("date")
    max_date = grid["date"].max()
    test_start = max_date - pd.Timedelta(days=args.test_days)
    # Rows whose H-day label window reaches into the test period would
    # leak test outcomes into training — drop them (the "purge gap").
    train_end = test_start - pd.Timedelta(days=args.horizon_days)

    train = grid[grid["date"] < train_end]
    test = grid[grid["date"] >= test_start]
    if train.empty or test.empty:
        raise SystemExit(
            f"Not enough history for a {args.test_days}-day test window plus a "
            f"{args.horizon_days}-day purge gap. Reduce --test-days."
        )
    log.info(
        "Time split: train %s -> %s (%d rows), purge gap %d days, test %s -> %s (%d rows)",
        train["date"].min().date(), train["date"].max().date(), len(train),
        args.horizon_days,
        test["date"].min().date(), test["date"].max().date(), len(test),
    )

    x_train, y_train = train[FEATURE_COLUMNS], train["y"]
    x_test, y_test = test[FEATURE_COLUMNS], test["y"]

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
    clf.fit(x_train, y_train)

    proba = clf.predict_proba(x_test)[:, 1]
    pred = (proba >= 0.5).astype(int)

    log.info("Forward test accuracy:    %.3f", accuracy_score(y_test, pred))
    if y_test.nunique() > 1:
        log.info("Forward test ROC-AUC:     %.3f", roc_auc_score(y_test, proba))
    log.info("Forward test Brier score: %.3f (lower is better)", brier_score_loss(y_test, proba))

    # ── Refit on ALL data for the production artifact ───────────────────
    # The metrics above are honest (trained on the past, scored on the
    # future); the shipped model should still use every available row.
    clf_full = XGBClassifier(
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
    clf_full.fit(grid[FEATURE_COLUMNS], grid["y"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf_full, out_path)

    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "horizon_days": args.horizon_days,
        "test_days": args.test_days,
        "train_end": str(train["date"].max().date()),
        "test_start": str(test["date"].min().date()),
        "feature_columns": FEATURE_COLUMNS,
        "forward_metrics": {
            "accuracy": float(accuracy_score(y_test, pred)),
            "roc_auc": float(roc_auc_score(y_test, proba)) if y_test.nunique() > 1 else None,
            "brier": float(brier_score_loss(y_test, proba)),
        },
    }
    meta_path = out_path.with_name("risk_clf_meta.json")
    meta_path.write_text(json.dumps(meta, indent=2))
    log.info("Saved classifier artifact to %s (+ %s)", out_path, meta_path.name)


if __name__ == "__main__":
    main()
