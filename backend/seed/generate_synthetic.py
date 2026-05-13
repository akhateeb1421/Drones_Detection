"""Generate synthetic attack rows from the real CSV and insert them into the DB.

Run after `seed/load_history_csv.py`.

Default date range is 2024-11-20 to 2026-05-20 — 1.5 years of synthetic
history so the forecast heuristic has enough seasons to fit a smooth
annual cycle against. 3000 rows spread over ~547 days averages out to
~5-6 attacks/day across all regions combined. Override with --start /
--end / --n (ISO date format).

Run: `python -m seed.generate_synthetic [--n 3000] [--seed 42] [--start ...] [--end ...]`
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import pandas as pd
from sqlalchemy import delete

from app.core.db import SessionLocal
from app.core.logging import configure_logging
from app.models import Attack
from app.services.synthetic import generate, normalize_real_for_db
from seed.load_history_csv import EXTRA_HISTORICAL_ROWS

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "final_processed_history.csv"
SYNTHETIC_OUT = Path(__file__).resolve().parents[2] / "data" / "synthetic" / "synthetic_attacks.csv"

log = logging.getLogger(__name__)


def _build_training_frame() -> pd.DataFrame:
    """Return a SPLIT, jittered version of the real data for the synthetic generator.

    We do this so synthetic rows never inherit combined-attack target_locations
    like "Riyadh + Eastern Region" — every synthetic point should land on a
    single city.
    """
    real_df = pd.read_csv(CSV_PATH)
    if EXTRA_HISTORICAL_ROWS:
        real_df = pd.concat([real_df, pd.DataFrame(EXTRA_HISTORICAL_ROWS)], ignore_index=True)

    norm = normalize_real_for_db(real_df)
    # generate() expects an `attack_date` column; normalize_real_for_db emits `occurred_at`.
    norm = norm.rename(columns={"occurred_at": "attack_date"})
    return norm


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--start", default="2024-11-20",
                        help="ISO start date (inclusive). Default: 2024-11-20 (1.5y pre-May-2026)")
    parser.add_argument("--end", default="2026-05-20",
                        help="ISO end date (inclusive). Default: 2026-05-20")
    args = parser.parse_args()

    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found at {CSV_PATH}")

    train_df = _build_training_frame()
    synth = generate(train_df, n=args.n, seed=args.seed, start_date=args.start, end_date=args.end)

    SYNTHETIC_OUT.parent.mkdir(parents=True, exist_ok=True)
    synth.to_csv(SYNTHETIC_OUT, index=False)
    log.info("Wrote synthetic CSV to %s (%d rows)", SYNTHETIC_OUT, len(synth))

    with SessionLocal() as db:
        deleted = db.execute(delete(Attack).where(Attack.source == "synthetic")).rowcount
        db.commit()
        log.info("Deleted %s old synthetic rows.", deleted)

        for _, row in synth.iterrows():
            db.add(
                Attack(
                    occurred_at=row["occurred_at"],
                    attack_type=row["attack_type"],
                    target_location=row["target_location"],
                    region=row["region"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    source="synthetic",
                )
            )
        db.commit()
        log.info("Inserted %d synthetic rows into attacks.", len(synth))


if __name__ == "__main__":
    main()
