"""Load the 75-row real Saudi attack history CSV into the unified attacks table.

Idempotent: skips rows whose (occurred_at, latitude, longitude, attack_type)
already exist as source='historical'.

Run: `python -m seed.load_history_csv`
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.logging import configure_logging
from app.models import Attack, SensitiveArea
from app.services.synthetic import normalize_real_for_db

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "final_processed_history.csv"

# The 5 sensitive areas you currently hardcode in the notebook.
DEFAULT_AREAS = [
    {"name": "Area-A", "latitude": 24.7136, "longitude": 46.6753, "priority": 1},
    {"name": "Area-B", "latitude": 24.6877, "longitude": 46.7219, "priority": 1},
    {"name": "Area-C", "latitude": 24.7441, "longitude": 46.6180, "priority": 1},
    {"name": "Area-D", "latitude": 24.6600, "longitude": 46.7100, "priority": 1},
    {"name": "Area-E", "latitude": 24.7900, "longitude": 46.6400, "priority": 1},
]


log = logging.getLogger(__name__)


def seed_areas(db) -> None:
    existing = {a.name for a in db.execute(select(SensitiveArea)).scalars().all()}
    for entry in DEFAULT_AREAS:
        if entry["name"] in existing:
            continue
        db.add(SensitiveArea(**entry))
    db.commit()


def main() -> None:
    configure_logging()
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found at {CSV_PATH}")

    df = pd.read_csv(CSV_PATH)
    log.info("Loaded %d rows from %s", len(df), CSV_PATH)

    norm = normalize_real_for_db(df)

    inserted = 0
    skipped = 0
    with SessionLocal() as db:
        seed_areas(db)
        for _, row in norm.iterrows():
            exists = db.execute(
                select(Attack.id).where(
                    Attack.occurred_at == row["occurred_at"],
                    Attack.latitude == row["latitude"],
                    Attack.longitude == row["longitude"],
                    Attack.attack_type == row["attack_type"],
                    Attack.source == "historical",
                )
            ).first()
            if exists:
                skipped += 1
                continue
            db.add(
                Attack(
                    occurred_at=row["occurred_at"].to_pydatetime() if hasattr(row["occurred_at"], "to_pydatetime") else row["occurred_at"],
                    attack_type=row["attack_type"],
                    target_location=row["target_location"],
                    region=row["region"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    source=row["source"],
                )
            )
            inserted += 1
        db.commit()

    log.info("Inserted %d historical rows; skipped %d duplicates.", inserted, skipped)


if __name__ == "__main__":
    main()
