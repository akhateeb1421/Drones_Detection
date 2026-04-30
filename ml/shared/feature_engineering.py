"""Feature engineering for the risk classifier.

Frames the problem as: given (region, day), did at least one attack occur in
the *next* H days? Features are computed at row-time using only data prior to
that day, so we don't leak future information.
"""

from __future__ import annotations

from datetime import timedelta

import pandas as pd


def daily_grid(attacks: pd.DataFrame, horizon_days: int = 30) -> pd.DataFrame:
    """Expand attacks into one row per (region, day) over the observed range.

    `attacks` must have columns: occurred_at (datetime), region (str), attack_type (str), source (str).
    Returns a DataFrame with engineered features and a binary label `y`.
    """
    df = attacks.copy()
    df["occurred_at"] = pd.to_datetime(df["occurred_at"], utc=True)
    df["date"] = df["occurred_at"].dt.tz_convert(None).dt.normalize()

    if df.empty:
        return pd.DataFrame()

    regions = sorted(df["region"].dropna().unique().tolist())
    start = df["date"].min()
    end = df["date"].max()
    all_days = pd.date_range(start, end, freq="D")

    rows: list[dict] = []
    for region in regions:
        sub = df[df["region"] == region].copy()
        per_day = sub.groupby("date").size().reindex(all_days, fill_value=0)
        types_per_day = (
            sub.assign(one=1)
            .pivot_table(index="date", columns="attack_type", values="one", aggfunc="sum", fill_value=0)
            .reindex(all_days, fill_value=0)
        )

        cum_total = per_day.cumsum()
        last_30 = per_day.rolling(30, min_periods=1).sum()
        last_7 = per_day.rolling(7, min_periods=1).sum()

        # Days since last attack (using a forward-fill trick).
        # Subtracting a Series-of-Timestamps from a DatetimeIndex yields a
        # Series of Timedeltas, so we use .dt.days (not .days).
        last_seen = pd.Series(per_day.index.where(per_day > 0, pd.NaT), index=per_day.index)
        last_seen = last_seen.ffill()
        days_since_last = (per_day.index.to_series() - last_seen).dt.days.fillna(9999)

        for day in all_days:
            label_window_start = day + timedelta(days=1)
            label_window_end = day + timedelta(days=horizon_days)
            mask = (sub["date"] >= label_window_start) & (sub["date"] <= label_window_end)
            y = int(mask.any())

            type_share_total = max(int(cum_total.loc[day]), 1)
            type_counts = types_per_day.loc[:day].sum() if day >= types_per_day.index.min() else types_per_day.iloc[:0].sum()
            share_drone = float(type_counts.get("drone", 0)) / type_share_total
            share_missile = (
                float(type_counts.get("ballistic_missile", 0))
                + float(type_counts.get("cruise_missile", 0))
            ) / type_share_total

            rows.append(
                {
                    "region": region,
                    "date": day,
                    "total": int(cum_total.loc[day]),
                    "last_30d": int(last_30.loc[day]),
                    "last_7d": int(last_7.loc[day]),
                    "days_since_last": int(days_since_last.loc[day]),
                    "share_drone": round(share_drone, 4),
                    "share_missile": round(share_missile, 4),
                    "month": int(day.month),
                    "weekday": int(day.weekday()),
                    "y": y,
                }
            )

    out = pd.DataFrame(rows)
    return out


FEATURE_COLUMNS = [
    "total",
    "last_30d",
    "last_7d",
    "days_since_last",
    "share_drone",
    "share_missile",
    "month",
    "weekday",
]
