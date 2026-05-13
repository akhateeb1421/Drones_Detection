"""Synthetic-data generator + historical CSV normalizer."""

from __future__ import annotations

import logging
from datetime import timedelta, timezone

import numpy as np
import pandas as pd

from app.services import places

log = logging.getLogger(__name__)


CANONICAL_TYPES = {
    "drone": "drone",
    "drones": "drone",
    "ballistic missiles": "ballistic_missile",
    "ballistic missile": "ballistic_missile",
    "cruise missile": "cruise_missile",
    "cruise missiles": "cruise_missile",
}


def normalize_type(raw: str, rng: np.random.Generator | None = None) -> str:
    """Normalize a raw attack_type to a canonical key.

    "mixed" was the historical bucket for rows whose original
    attack_type contained a "+" separator (e.g., "Drones + Cruise
    Missile"). That bucket muddied analytics — operators wanted the
    underlying types instead. We now split "+" rows by picking ONE
    canonical component at normalization time (random pick when an rng
    is provided, deterministic first-match otherwise). The literal
    "mixed" label is no longer emitted anywhere.
    """
    raw_l = (raw or "").strip().lower()
    if "+" in raw_l:
        # Split into components, map each through CANONICAL_TYPES.
        parts = [p.strip() for p in raw_l.split("+") if p.strip()]
        components: list[str] = []
        for p in parts:
            c = CANONICAL_TYPES.get(p)
            if c:
                components.append(c)
        if not components:
            return "drone"  # safe fallback
        if rng is not None:
            return str(rng.choice(components))
        # Deterministic without rng (used in tests / one-off scripts).
        return components[0]
    return CANONICAL_TYPES.get(raw_l, "drone")


def generate(
    real_df: pd.DataFrame,
    n: int = 3000,
    seed: int = 42,
    extend_days_forward: int = 365,
    burst_prob: float = 0.05,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    """Return a synthetic DataFrame matching the schema of attacks rows."""
    rng = np.random.default_rng(seed)

    df = real_df.copy()
    df["attack_date"] = pd.to_datetime(df["attack_date"])
    df["attack_type_canonical"] = df["attack_type"].astype(str).map(normalize_type)

    region_counts = df["region"].fillna("Unknown").value_counts()
    regions = region_counts.index.tolist()
    empirical = (region_counts / region_counts.sum()).values

    # Smooth region distribution with a uniform prior. The raw empirical
    # distribution skews so heavily toward Eastern Region / Riyadh that
    # thin regions (Hafr Al-Batin, Yanbu) get ~1% of samples — far too
    # few to support a meaningful per-region forecast (see the forecast
    # heuristic's per-DOW sample floor). Mixing 60% empirical + 40%
    # uniform gives every region a floor of ~7%/n_regions while still
    # preserving the heavy-tailed shape of the real distribution.
    n_regions = len(regions)
    uniform = np.full(n_regions, 1.0 / max(n_regions, 1))
    region_probs = 0.6 * empirical + 0.4 * uniform
    region_probs = region_probs / region_probs.sum()  # re-normalize for safety

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

    if start_date and end_date:
        real_min = pd.Timestamp(start_date)
        horizon_end = pd.Timestamp(end_date)
    else:
        real_min = df["attack_date"].min()
        real_max = df["attack_date"].max()
        horizon_end = real_max + timedelta(days=extend_days_forward)
    span_days = max((horizon_end - real_min).days, 1)

    monthly = df["attack_date"].dt.month.value_counts(normalize=True).to_dict()
    mean_monthly = 1 / 12.0
    month_weight = {m: monthly.get(m, mean_monthly) / mean_monthly for m in range(1, 13)}

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


# -----------------------------------------------------------------------------
# Historical normalizer with location splitting + jitter
# -----------------------------------------------------------------------------

_JITTER_DEG = 0.02  # ~2 km Gaussian jitter so points dont stack

_REGION_OF_PLACE = {
    "riyadh": "Riyadh",
    "embassy district": "Riyadh",
    "embassy district – riyadh": "Riyadh",
    "embassy district - riyadh": "Riyadh",
    "riyadh airport": "Riyadh",
    "king khalid international airport": "Riyadh",
    "riyadh region": "Riyadh",
    "prince sultan air base": "Al-Kharj",
    "kharj": "Al-Kharj",
    "al-kharj": "Al-Kharj",
    "al kharj": "Al-Kharj",
    "east of kharj city": "Al-Kharj",
    "east of kharj governorate": "Al-Kharj",
    "eastern region": "Eastern Region",
    "dammam": "Eastern Region",
    "khobar": "Eastern Region",
    "ras tanura oil refinery": "Eastern Region",
    "ras tanura": "Eastern Region",
    "shaybah field": "Eastern Region",
    "shaybah": "Eastern Region",
    "empty quarter": "Eastern Region",
    "abqaiq": "Eastern Region",
    "jubail": "Eastern Region",
    "qatif": "Eastern Region",
    "hofuf": "Eastern Region",
    "al-jouf": "Al-Jouf",
    "al jouf": "Al-Jouf",
    "jouf": "Al-Jouf",
    "east of al-jouf region": "Al-Jouf",
    "hafr al-batin": "Hafr Al-Batin",
    "hafr al batin": "Hafr Al-Batin",
    "yanbu": "Yanbu",
    "yanbu port": "Yanbu",
    "yanbu industrial city": "Yanbu",
    "yanbu refinery": "Yanbu",
    "yanbu petroleum facility": "Yanbu",
    "area-a": "Riyadh",
    "area-b": "Riyadh",
    "area-c": "Riyadh",
    "area-d": "Riyadh",
    "area-e": "Riyadh",
    "jeddah": "Makkah",
    "mecca": "Makkah",
    "makkah": "Makkah",
    "medina": "Madinah",
    "madinah": "Madinah",
    "tabuk": "Tabuk",
    "abha": "Asir",
    "khamis mushait": "Asir",
    "buraidah": "Qassim",
    "qassim": "Qassim",
    "hail": "Hail",
    "najran": "Najran",
}


def _region_for(place: str, fallback: str | None) -> str | None:
    n = places._normalize(place)
    if n in _REGION_OF_PLACE:
        return _REGION_OF_PLACE[n]
    # Also try to canonicalize the fallback itself — handles rows where
    # `region` literally says "Area-A" / "Area-B" etc. but target_location
    # is something we don't recognize.
    if fallback:
        fn = places._normalize(fallback)
        if fn in _REGION_OF_PLACE:
            return _REGION_OF_PLACE[fn]
    return fallback


def _jitter(rng: np.random.Generator) -> tuple[float, float]:
    return float(rng.normal(0.0, _JITTER_DEG)), float(rng.normal(0.0, _JITTER_DEG))


def normalize_real_for_db(real_df: pd.DataFrame, seed: int = 1234) -> pd.DataFrame:
    """Normalize the real CSV into one row per (incident, location).

    A CSV row is split when EITHER target_location OR region contains '+'.
    Some rows put the split in `region` while target_location is a generic
    "Multiple Locations" or "Oil / Gas / Petrochemical Facilities (multiple)".
    """
    rng = np.random.default_rng(seed)
    df = real_df.copy()
    df["attack_date"] = pd.to_datetime(df["attack_date"], utc=True)

    out_rows: list[dict] = []
    split_count = 0
    for _, row in df.iterrows():
        # Pass the rng so "+" rows are split into one of their
        # canonical components rather than collapsed to "mixed".
        attack_type = normalize_type(str(row.get("attack_type", "")), rng=rng)
        target_location = str(row.get("target_location", "") or "")
        region_raw = row.get("region")
        region_str = str(region_raw) if region_raw is not None and pd.notna(region_raw) else ""
        base_lat = float(row["latitude"]) if pd.notna(row.get("latitude")) else 24.7136
        base_lon = float(row["longitude"]) if pd.notna(row.get("longitude")) else 46.6753

        target_parts = places.split_locations(target_location)
        region_parts = places.split_locations(region_str)

        if len(target_parts) > 1:
            parts = target_parts
        elif len(region_parts) > 1:
            parts = region_parts
        elif target_parts:
            parts = target_parts
        elif region_parts:
            parts = region_parts
        else:
            parts = [target_location or region_str or "Unknown"]

        if len(parts) > 1:
            split_count += 1

        for place in parts:
            coords = places.lookup(place)
            if coords is None:
                lat, lon = base_lat, base_lon
            else:
                lat, lon = coords
            d_lat, d_lon = _jitter(rng)
            out_rows.append(
                {
                    "occurred_at": row["attack_date"],
                    "attack_type": attack_type,
                    "target_location": place.strip(),
                    "region": _region_for(place, region_str or None),
                    "latitude": round(lat + d_lat, 6),
                    "longitude": round(lon + d_lon, 6),
                    "source": "historical",
                }
            )

    out = pd.DataFrame(out_rows)
    log.info(
        "Normalized %d CSV rows (of which %d were combined) into %d location rows (jitter=%.3f deg).",
        len(df), split_count, len(out), _JITTER_DEG,
    )
    return out
