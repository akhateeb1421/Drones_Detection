"""Aggregated analytics endpoints (powers the Analysis tab + Overview totals)."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Attack
from app.schemas.prediction import RegionStat, TimelinePoint, TypeStat

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/total")
def total(db: Session = Depends(get_db)) -> dict[str, int]:
    """Number of distinct attack events."""
    rows = db.execute(
        select(Attack.source, Attack.occurred_at).distinct()
    ).all()
    distinct_events = len(rows)
    total_rows = db.execute(select(func.count(Attack.id))).scalar_one()
    by_source = dict(
        db.execute(
            select(Attack.source, func.count(Attack.id)).group_by(Attack.source)
        ).all()
    )
    return {
        "events": int(distinct_events),
        "rows": int(total_rows or 0),
        "rows_historical": int(by_source.get("historical", 0)),
        "rows_synthetic": int(by_source.get("synthetic", 0)),
        "rows_live": int(by_source.get("live", 0)),
    }


@router.get("/by-region", response_model=list[RegionStat])
def by_region(db: Session = Depends(get_db)) -> list[RegionStat]:
    """All regions with their row count."""
    rows = db.execute(
        select(Attack.region, func.count(Attack.id))
        .where(Attack.region.is_not(None))
        .group_by(Attack.region)
        .order_by(func.count(Attack.id).desc())
    ).all()
    return [RegionStat(region=r or "Unknown", count=int(c)) for r, c in rows]


@router.get("/by-region-pure", response_model=list[RegionStat])
def by_region_pure(db: Session = Depends(get_db)) -> list[RegionStat]:
    """Same as /by-region but filters out any region label that contains '+'.

    After we split combined attacks at seed time the `region` column should
    never contain '+', so this is just a defensive filter — and it makes the
    Overview pie chart immune to bad data.
    """
    rows = db.execute(
        select(Attack.region, func.count(Attack.id))
        .where(Attack.region.is_not(None))
        .where(~Attack.region.contains("+"))
        .group_by(Attack.region)
        .order_by(func.count(Attack.id).desc())
    ).all()
    return [RegionStat(region=r or "Unknown", count=int(c)) for r, c in rows]


@router.get("/combined")
def combined(db: Session = Depends(get_db)) -> list[dict]:
    """List unique multi-location attack patterns and how many incidents had them.

    A "combined attack" is one whose original incident produced more than one
    row in the attacks table (rows sharing the same source + occurred_at).
    The label is the deduplicated, sorted, '+'-joined list of regions that
    were hit in that incident.
    """
    grouped = db.execute(
        select(
            Attack.source,
            Attack.occurred_at,
            func.array_agg(func.distinct(Attack.region)).label("regions"),
            func.count(Attack.id).label("n"),
        )
        .where(Attack.region.is_not(None))
        .group_by(Attack.source, Attack.occurred_at)
        .having(func.count(func.distinct(Attack.region)) > 1)
    ).all()

    pattern_counts: dict[str, int] = {}
    for _src, _ts, regions, _n in grouped:
        clean = sorted({r for r in regions if r})
        if len(clean) < 2:
            continue
        label = " + ".join(clean)
        pattern_counts[label] = pattern_counts.get(label, 0) + 1

    items = [{"label": k, "count": v} for k, v in pattern_counts.items()]
    items.sort(key=lambda x: x["count"], reverse=True)
    return items


@router.get("/by-type", response_model=list[TypeStat])
def by_type(db: Session = Depends(get_db)) -> list[TypeStat]:
    rows = db.execute(
        select(Attack.attack_type, func.count(Attack.id))
        .group_by(Attack.attack_type)
        .order_by(func.count(Attack.id).desc())
    ).all()
    return [TypeStat(attack_type=t, count=int(c)) for t, c in rows]


@router.get("/by-weekday")
def by_weekday(db: Session = Depends(get_db)) -> list[dict]:
    """Attacks grouped by weekday (Sun..Sat) × region.

    Returns one row per weekday, with each region's count as a key.
    Shape: [{ day: "Sun", day_index: 0, "Riyadh": 47, "Yanbu": 12, ... },
            { day: "Mon", day_index: 1, ... }, ...]

    Postgres `EXTRACT(dow FROM ts)` returns 0=Sunday … 6=Saturday.
    The frontend translates the day strings via i18n for display.
    """
    rows = db.execute(
        select(
            func.extract("dow", Attack.occurred_at).label("dow"),
            Attack.region,
            func.count(Attack.id).label("n"),
        )
        .where(Attack.region.is_not(None))
        .group_by(func.extract("dow", Attack.occurred_at), Attack.region)
    ).all()

    DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    week: list[dict] = [{"day": DAY_NAMES[i], "day_index": i} for i in range(7)]
    for dow, region, n in rows:
        if region is None:
            continue
        week[int(dow)][region] = int(n)
    return week


@router.get("/timeline", response_model=list[TimelinePoint])
def timeline(
    db: Session = Depends(get_db),
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    region: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
) -> list[TimelinePoint]:
    bucket = func.date_trunc(granularity, Attack.occurred_at)
    stmt = select(bucket, func.count(Attack.id)).group_by(bucket).order_by(bucket)
    if region:
        stmt = stmt.where(Attack.region == region)
    if date_from is not None:
        stmt = stmt.where(Attack.occurred_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Attack.occurred_at <= date_to)
    rows = db.execute(stmt).all()
    # `period` stays for backwards compatibility; `date` is the alias the
    # new Analysis.tsx prefers. Same string in both fields.
    return [
        TimelinePoint(
            period=p.isoformat() if p else "",
            date=p.isoformat() if p else "",
            count=int(c),
        )
        for p, c in rows
    ]
