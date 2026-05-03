"""Synthetic-data generator.

Bootstraps from real Saudi attack records to emit ~N synthetic incidents that
preserve the joint distribution of region x attack_type x target_location and
a Poisson-with-seasonality temporal pattern. Every synthetic row is tagged
source='synthetic' so ML evaluation can hold out real data.
"""

from __future__ import annotations

import logging
from datetime import timedelta, timezone

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


CANONICAL_TYPES = {
    "drone": "drone",
    "drones": "drone",
    "ballistic missiles": "ballistic_missile",
    "ballistic missile": "ballistic_missile",
    "cruise missile": "cruise_missile",
    "cruise missiles": "cruise_missile",
}


def normalize_type(raw: str) -> str:
    raw_l = (raw or "").strip().lower()
    if "+" in raw_l:
        return "mixed"
    return CANONICAL_TYPES.get(raw_l, "mixed")


def generate(
    real_df: pd.DataFrame,
    n: int = 3000,
    seed: int = 42,
    extend_days_forward: int = 365,
    burst_prob: float = 0.05,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    """Return a synthetic DataFrame matching the schema of attacks rows.

    Expected columns in `real_df`: attack_date, attack_type, target_location,
    region, latitude, longitude.

    If `start_date` and `end_date` (ISO strings, e.g. '2025-05-20') are
    provided, sampled timestamps are constrained to that explicit range.
    Otherwise the range defaults to [real_min, real_max + extend_days_forward].
    """
    rng = np.random.default_rng(seed)

    df = real_df.copy()
    df["attack_date"] = pd.to_datetime(df["attack_date"])
    df["attack_type_canonical"] = df["attack_type"].astype(str).map(normalize_type)

    # ----- Learn distributions -----
    region_counts = df["region"].fillna("Unknown").value_counts()
    regions = region_counts.index.tolist()
    region_probs = (region_counts / region_counts.sum()).values

    type_by_region: dict[str, tuple[list[str], np.ndarray]] = {}
    loc_by_region: dict[str, tuple[list[str], np.ndarray, dict[str, tuple[float, float]]]] = {}
    for region in regions:
        sub = df[df["region"].fillna("Unknown") == region]
        tc = sub["attack_type_canonical"].value_counts()
        type_by_region[region] = (tc.index.tolist(), (tc / tc.sum()).values)
        lc = sub["target_location"].fillna("Unknown").value_counts()
        coords = (
            sub.dropna(subset=["latitude", "longitude"])
            .groupby("target_location")
            .first()[["latitude", "longitude"]]
        )
        coord_map = {idx: (float(r["latitude"]), float(r["longitude"])) for idx, r in coords.iterrows()}
        loc_by_region[region] = (lc.index.tolist(), (lc / lc.sum()).values, coord_map)

    # ----- Temporal pattern: explicit range OR extend real range forward -----
    if start_date and end_date:
        real_min = pd.Timestamp(start_date)
        horizon_end = pd.Timestamp(end_date)
    else:
        real_min = df["attack_date"].min()
        real_max = df["attack_date"].max()
        horizon_end = real_max + timedelta(days=extend_days_forward)
    span_days = max((horizon_end - real_min).days, 1)

    # Per-month seasonality
    monthly = df["attack_date"].dt.month.value_counts(normalize=True).to_dict()
    mean_monthly = 1 / 12.0
    month_weight = {m: monthly.get(m, mean_monthly) / mean_monthly for m in range(1, 13)}

    # Per-weekday seasonality
    weekly = df["attack_date"].dt.dayofweek.value_counts(normalize=True).to_dict()
    mean_weekly = 1 / 7.0
    week_weight = {d: weekly.get(d, mean_weekly) / mean_weekly for d in range(7)}

    rows: list[dict] = []
    while len(rows) < n:
        day_offset = int(rng.integers(0, span_days + 1))
        day = real_min + timedelta(days=day_offset)
        m_w = month_weight.get(day.month, 1.0)
        w_w = week_weight.get(day.weekday(), 1.0)
        keep_prob = min((m_w * w_w) / 4.0, 1.0)
        if rng.random() > keep_prob:
            continue

        if rng.random() < burst_prob:
            n_burst = int(rng.integers(2, 6))
        else:
            n_burst = 1

        for _ in range(n_burst):
            if len(rows) >= n:
                break
            region = rng.choice(regions, p=region_probs)
            t_idx, t_p = type_by_region[region]
            attack_type = rng.choice(t_idx, p=t_p)
            l_idx, l_p, coord_map = loc_by_region[region]
            location = rng.choice(l_idx, p=l_p)
            base_lat, base_lon = coord_map.get(location, (24.7136, 46.6753))
            lat = float(base_lat + rng.normal(0.0, 0.05))
            lon = float(base_lon + rng.normal(0.0, 0.05))

            seconds = int(rng.integers(0, 24 * 3600))
            occurred_at = (
                day.to_pydatetime().replace(hour=0, minute=0, second=0, tzinfo=timezone.utc)
                + timedelta(seconds=seconds)
            )

            rows.append(
                {
                    "occurred_at": occurred_at,
                    "attack_type": attack_type,
                    "target_location": location,
                    "region": region,
                    "latitude": round(lat, 6),
                    "longitude": round(lon, 6),
                    "source": "synthetic",
                }
            )

    out = pd.DataFrame(rows[:n])
    log.info(
        "Generated %d synthetic rows from %s to %s (%d days span).",
        len(out), real_min.date(), horizon_end.date(), span_days,
    )
    return out


def normalize_real_for_db(real_df: pd.DataFrame) -> pd.DataFrame:
    """Normalize the real CSV into the unified attacks-table shape."""
    df = real_df.copy()
    df["attack_date"] = pd.to_datetime(df["attack_date"], utc=True)
    df["attack_type_canonical"] = df["attack_type"].astype(str).map(normalize_type)

    return pd.DataFrame(
        {
            "occurred_at": df["attack_date"],
            "attack_type": df["attack_type_canonical"],
            "target_location": df["target_location"],
            "region": df["region"],
            "latitude": df["latitude"].astype(float).round(7),
            "longitude": df["longitude"].astype(float).round(7),
            "source": "historical",
        }
    )
