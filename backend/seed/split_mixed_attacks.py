"""One-shot migration — split every attack_type='mixed' (or 'combined')
row into a canonical type (drone / ballistic_missile / cruise_missile).

The original "mixed" bucket came from raw CSV values like
"Drones + Cruise Missile" that the historical loader collapsed to a
single label. That bucket muddied analytics; operators wanted the
underlying types. We now split each mixed row by sampling one
canonical type using the per-region distribution of the existing
non-mixed rows — so e.g. Riyadh (drone-heavy) keeps its drone bias and
Yanbu (mixed cruise/drone) keeps its mix.

Run:
    cd backend && python -m seed.split_mixed_attacks            # commits
    python -m seed.split_mixed_attacks --dry-run                # preview
    python -m seed.split_mixed_attacks --seed 7                 # different RNG

Idempotent — running twice is fine; second run finds zero mixed rows
to update.

Going forward, `normalize_type` in `app/services/synthetic.py` splits
"+" rows at load time, so re-seeding from the CSV won't reintroduce
"mixed". The synthetic generator also picks from canonical types only.
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict

import numpy as np
from sqlalchemy import select, update, or_

from app.core.db import SessionLocal
from app.core.logging import configure_logging
from app.models import Attack


CANONICAL = ("drone", "ballistic_missile", "cruise_missile")
# Tolerate every casing the dataset might hold.
MIXED_LITERALS = ("mixed", "Mixed", "MIXED", "combined", "Combined", "COMBINED")


def main() -> None:
    configure_logging()
    log = logging.getLogger(__name__)

    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42,
                        help="RNG seed for the random pick. Default 42 — change "
                             "to reshuffle without re-seeding the whole DB.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show how many rows would be updated; do not write.")
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)

    with SessionLocal() as db:
        # ── Pass 1: learn the per-region distribution of canonical types
        #            from the existing non-mixed rows. Falls back to a
        #            global distribution when a region has no canonical
        #            rows at all (rare; only thin/synthetic regions).
        rows = db.execute(select(Attack.region, Attack.attack_type)).all()
        by_region: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        global_counts: dict[str, int] = defaultdict(int)
        for region, atype in rows:
            atype_l = (atype or "").strip().lower()
            if atype_l in {m.lower() for m in MIXED_LITERALS}:
                continue
            if atype_l in CANONICAL:
                key = region or "Unknown"
                by_region[key][atype_l] += 1
                global_counts[atype_l] += 1

        if not global_counts:
            log.error("No canonical-type rows found to learn distribution from — "
                      "cannot split mixed rows without a reference. Aborting.")
            return

        global_total = sum(global_counts.values())
        global_dist = [global_counts.get(k, 0) / global_total for k in CANONICAL]
        log.info("Reference distribution (global): %s",
                 {k: f"{p:.2%}" for k, p in zip(CANONICAL, global_dist)})

        # ── Pass 2: find every mixed row, reassign it.
        mixed_rows = db.execute(
            select(Attack.id, Attack.region).where(
                or_(*[Attack.attack_type == m for m in MIXED_LITERALS])
            )
        ).all()
        log.info("Found %d mixed rows to split.", len(mixed_rows))

        per_type_assigned: dict[str, int] = defaultdict(int)
        for aid, region in mixed_rows:
            region_dist = by_region.get(region or "Unknown")
            if region_dist and sum(region_dist.values()) > 0:
                total = sum(region_dist.values())
                probs = [region_dist.get(k, 0) / total for k in CANONICAL]
            else:
                probs = global_dist
            new_type = str(rng.choice(CANONICAL, p=probs))
            per_type_assigned[new_type] += 1
            if not args.dry_run:
                db.execute(
                    update(Attack)
                    .where(Attack.id == aid)
                    .values(attack_type=new_type)
                )

        if not args.dry_run:
            db.commit()

        log.info("Split breakdown: %s", dict(per_type_assigned))
        log.info("Migration %s — %d rows %s.",
                 "dry-run" if args.dry_run else "committed",
                 len(mixed_rows),
                 "would change" if args.dry_run else "updated")


if __name__ == "__main__":
    main()
