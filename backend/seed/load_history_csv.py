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
    # Legacy generic areas (kept for backward-compat with old approvals).
    {"name": "Area-A", "name_ar": "المنطقة أ", "latitude": 24.7136, "longitude": 46.6753, "priority": 1},
    {"name": "Area-B", "name_ar": "المنطقة ب", "latitude": 24.6877, "longitude": 46.7219, "priority": 1},
    {"name": "Area-C", "name_ar": "المنطقة ج", "latitude": 24.7441, "longitude": 46.6180, "priority": 1},
    {"name": "Area-D", "name_ar": "المنطقة د", "latitude": 24.6600, "longitude": 46.7100, "priority": 1},
    {"name": "Area-E", "name_ar": "المنطقة هـ", "latitude": 24.7900, "longitude": 46.6400, "priority": 1},

    # 2 named sensitive locations in each attacked city.
    # --- Riyadh ---
    {"name": "King Khalid International Airport", "name_ar": "مطار الملك خالد الدولي", "latitude": 24.9576, "longitude": 46.6989, "priority": 1},
    {"name": "Diplomatic Quarter (Riyadh)",       "name_ar": "الحي الدبلوماسي (الرياض)", "latitude": 24.6877, "longitude": 46.6219, "priority": 1},
    # --- Eastern Region ---
    {"name": "Ras Tanura Oil Refinery",           "name_ar": "مصفاة رأس تنورة", "latitude": 26.6388, "longitude": 50.1583, "priority": 1},
    {"name": "Abqaiq Processing Plant",           "name_ar": "معامل بقيق", "latitude": 25.9357, "longitude": 49.6708, "priority": 1},
    # --- Al-Kharj ---
    {"name": "Prince Sultan Air Base",            "name_ar": "قاعدة الأمير سلطان الجوية", "latitude": 24.0617, "longitude": 47.5805, "priority": 1},
    {"name": "Al-Kharj Power Station",            "name_ar": "محطة كهرباء الخرج", "latitude": 24.1503, "longitude": 47.3346, "priority": 2},
    # --- Al-Jouf ---
    {"name": "Sakaka Solar Plant",                "name_ar": "محطة سكاكا للطاقة الشمسية", "latitude": 29.9697, "longitude": 40.2064, "priority": 2},
    {"name": "Al-Jouf Regional Airport",          "name_ar": "مطار الجوف الإقليمي", "latitude": 29.7853, "longitude": 40.0998, "priority": 2},
    # --- Hafr Al-Batin ---
    {"name": "King Khalid Military City",         "name_ar": "مدينة الملك خالد العسكرية", "latitude": 28.4328, "longitude": 45.9708, "priority": 1},
    {"name": "Hafr Al-Batin Airport",             "name_ar": "مطار حفر الباطن", "latitude": 28.3344, "longitude": 46.1247, "priority": 2},
    # --- Yanbu ---
    {"name": "Yanbu Oil Refinery",                "name_ar": "مصفاة ينبع", "latitude": 24.0900, "longitude": 38.0700, "priority": 1},
    {"name": "Yanbu Industrial Port",             "name_ar": "ميناء ينبع الصناعي", "latitude": 24.0883, "longitude": 38.0617, "priority": 1},
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
    existing = {a.name: a for a in db.execute(select(SensitiveArea)).scalars().all()}
    for entry in DEFAULT_AREAS:
        if entry["name"] in existing:
            # Backfill name_ar on rows that pre-date the bilingual column.
            row = existing[entry["name"]]
            if not row.name_ar and entry.get("name_ar"):
                row.name_ar = entry["name_ar"]
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
