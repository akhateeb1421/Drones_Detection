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

# Extra historical rows appended to the CSV so under-represented places
# (notably Yanbu, which appears only once in the original file) have enough
# data points for the analytics charts and the ML model to be meaningful.
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

    # --- Hafr Al-Batin: original CSV has exactly ONE row, on a Saturday,
    # which is what produced the rigid 1↔10 weekly square wave in the
    # /predict/forecast chart. Adding twelve attacks spread across all
    # weekdays + several months so the heuristic has real seasonal
    # variety to learn from, not a single weekday spike to chase. ---
    {"incident_id": 1100, "attack_date": "2025-11-04", "attack_type": "Drone",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4500, "longitude": 45.9700},
    {"incident_id": 1101, "attack_date": "2025-12-14", "attack_type": "Drones",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4521, "longitude": 45.9612},
    {"incident_id": 1102, "attack_date": "2026-01-08", "attack_type": "Ballistic Missiles",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4480, "longitude": 45.9750},
    {"incident_id": 1103, "attack_date": "2026-01-21", "attack_type": "Drone",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4533, "longitude": 45.9690},
    {"incident_id": 1104, "attack_date": "2026-02-05", "attack_type": "Drones",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4515, "longitude": 45.9701},
    {"incident_id": 1105, "attack_date": "2026-02-18", "attack_type": "Drone",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4498, "longitude": 45.9722},
    {"incident_id": 1106, "attack_date": "2026-03-02", "attack_type": "Cruise Missile",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4523, "longitude": 45.9685},
    {"incident_id": 1107, "attack_date": "2026-03-19", "attack_type": "Drones",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4508, "longitude": 45.9697},
    {"incident_id": 1108, "attack_date": "2026-04-06", "attack_type": "Drone",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-Batin",
     "latitude": 28.4544, "longitude": 45.9678},
    {"incident_id": 1109, "attack_date": "2026-04-22", "attack_type": "Drones",
     "target_location": "Hafr Al-Batin", "region": "Hafr Al-B