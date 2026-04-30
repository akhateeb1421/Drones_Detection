"""Test the synthetic data generator preserves real distributions."""

import pandas as pd

from app.services.synthetic import generate, normalize_real_for_db, normalize_type


SAMPLE = pd.DataFrame(
    [
        {"incident_id": 1, "attack_date": "2026-03-01", "attack_type": "Drones", "target_location": "Riyadh Airport", "region": "Riyadh", "latitude": 24.7136, "longitude": 46.6753},
        {"incident_id": 2, "attack_date": "2026-03-02", "attack_type": "Ballistic Missiles", "target_location": "Prince Sultan", "region": "Al-Kharj", "latitude": 24.1503, "longitude": 47.3346},
        {"incident_id": 3, "attack_date": "2026-03-03", "attack_type": "Drone", "target_location": "Riyadh Airport", "region": "Riyadh", "latitude": 24.7136, "longitude": 46.6753},
    ]
)


def test_normalize_type_canonical():
    assert normalize_type("Drone") == "drone"
    assert normalize_type("Drones") == "drone"
    assert normalize_type("Ballistic Missiles") == "ballistic_missile"
    assert normalize_type("Cruise Missile") == "cruise_missile"
    assert normalize_type("Mixed Stuff + Other") == "mixed"


def test_generate_returns_requested_rows_and_correct_source():
    out = generate(SAMPLE, n=200, seed=1)
    assert len(out) == 200
    assert (out["source"] == "synthetic").all()
    # regions sampled should be a subset of input regions
    assert set(out["region"]).issubset(set(SAMPLE["region"]))


def test_normalize_real_for_db_shape():
    norm = normalize_real_for_db(SAMPLE)
    assert set(norm.columns) == {
        "occurred_at",
        "attack_type",
        "target_location",
        "region",
        "latitude",
        "longitude",
        "source",
    }
    assert (norm["source"] == "historical").all()
    assert set(norm["attack_type"]).issubset({"drone", "ballistic_missile", "cruise_missile", "mixed"})
