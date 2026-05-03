"""Load the real Saudi attack history CSV into the unified attacks table.

Splits combined attacks (target_location with '+') into one row per location,
looking up coordinates from app.services.places. Adds small jitter so points
on the same city don't render as a single overlapping dot.

Not idempotent on coordinates (jitter is random), so this script wipes
existing rows tagged source='historical' before inserting a fresh set.

Run: `python -m seed.load_history_csv`
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.core.logging import configure_logging
from app.models import Attack, SensitiveArea
from app.services.synthetic import normalize_real_for_db

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "final_processed_history.csv"

DEFAULT_AREAS = [
    {"name": "Area-A", "latitude": 24.7136, "longitude": 46.6753, "priority": 1},
    {"name": "Area-B", "latitude": 24.6877, "longitude": 46.7219, "priority": 1},
    {"name": "Area-C", "latitude": 24.7441, "longitude": 46.6180, "priority": 1},
    {"name": "Area-D", "latitude": 24.6600, "longitude": 46.7100, "priority": 1},
    {"name": "Area-E", "latitude": 24.7900, "longitude": 46.6400, "priority": 1},
]

# Extra historical rows appended to the CSV before normalization. Yanbu
# appears only once in the original file, so these augment it.
EXTRA_HISTORICAL_ROWS = [
    {"incident_id": 1001, "attack_date": "2026-03-09", "attack_type": "Drones",
     "target_location": "Yanbu Port", "region": "Yanbu",
     "latitude": 24.0900, "longitude": 38.0500},
    {"incident_id": 1002, "attack_date": "2026-03-12", "attack_type": "Drones",
     "target_location": "Yanbu Refinery", "region": "Yanbu",
     "latitude": 24.0900, "longitude": 38.0700},
    {"incident_id": 1003, "attack_date": "2026-03-15", "attack_type": "Cruise Missile",
     "target_location": "Yanbu Petroleum Facility", "region": "Yanbu",
     "latitude": 24.0900, "longitude": 38.0700},
    {"incident_id": 1004, "attack_date": "2026-03-20", "attack_type": "Drone",
     "target_location": "Yanbu Industrial City", "region": "Yanbu",
     "latitude": 24.0167, "longitude": 38.1833},
    {"incident_id": 1005, "attack_date": "2026-03-25", "attack_type": "Drones + Cruise Missile",
     "target_location": "Yanbu Port + Yanbu Refinery", "region": "Yanbu",
     "latitude": 24.0883, "longitude": 38.0617},
    {"incident_id": 1006, "attack_date": "2026-04-02", "attack_type": "Drone",
     "target_location": "Yanbu", "region": "Yanbu",
     "latitude": 24.0883, "longitude": 38.0617},
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

    if EXTRA_HISTORICAL_ROWS:
        extra_df = pd.DataFrame(EXTRA_HISTORICAL_ROWS)
        df = pd.concat([df, extra_df], ignore_index=True)
        log.info("Appended %d extra hand-curated rows.", len(extra_df))

    norm = normalize_real_for_db(df)
    log.info("After splitting combined attacks: %d location rows", len(norm))

    with SessionLocal() as db:
        seed_areas(db)
        deleted = db.execute(delete(Attack).where(Attack.source == "historical")).rowcount
        db.commit()
        log.info("Deleted %s old historical rows.", deleted)

        for _, row in norm.iterrows():
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
        db.commit()

    log.info("Inserted %d historical rows.", len(norm))


if __name__ == "__main__":
    main()
