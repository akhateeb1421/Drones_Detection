"""Generate synthetic attack rows from the real CSV and insert them into the DB.

Run after `seed/load_history_csv.py`.

By default produces ~3000 synthetic rows tagged source='synthetic'. You can
override the row count with --n. Idempotent: re-running deletes the previous
synthetic rows before inserting fresh ones (so re-runs don't accumulate
duplicates).

Run: `python -m seed.generate_synthetic [--n 3000] [--seed 42]`
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
from app.services.synthetic import generate

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "final_processed_history.csv"
SYNTHETIC_OUT = Path(__file__).resolve().parents[2] / "data" / "synthetic" / "synthetic_attacks.csv"

log = logging.getLogger(__name__)


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found at {CSV_PATH}")

    real_df = pd.read_csv(CSV_PATH)
    synth = generate(real_df, n=args.n, seed=args.seed)

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
