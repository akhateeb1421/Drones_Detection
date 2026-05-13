"""One-shot migration — rebalance every attack row's `attack_type` to
hit an exact 80 / 10 / 10 split across drone / ballistic_missile /
cruise_missile.

The existing dataset is overwhelmingly drone (>98%) which makes the
Overview's "Attacks by Type" chart visually useless (one giant slice,
two invisible ones). The user wants a presentable distribution:
    80% drone
    10% ballistic_missile
    10% cruise_missile

Strategy: count total rows → compute exact target per type → shuffle
all row IDs with a seeded RNG → assign the first 80% to drone, next
10% to ballistic_missile, remainder to cruise_missile. Exact counts,
deterministic given the seed.

Run:
    cd backend && python -m seed.rebalance_attack_types            # commits
    python -m seed.rebalance_attack_types --dry-run                # preview
    python -m seed.rebalance_attack_types --seed 11                # different shuffle

Idempotent in the sense that running twice with the same seed produces
the same final distribution. The migration is destructive to the
existing per-row type column, so back up first if you want the old
state preserved.
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter

import numpy as np
from sqlalchemy import select, update

from app.core.db import SessionLocal
from app.core.logging import configure_logging
from app.models import Attack


# Target distribution. Sums to 1.0.
TARGETS: list[tuple[str, float]] = [
    ("drone",             0.80),
    ("ballistic_missile", 0.10),
    ("cruise_missile",    0.10),
]


def main() -> None:
    configure_logging()
    log = logging.getLogger(__name__)
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--dry-run", action="store_true",
                        help="Show the target counts; do not write to the DB.")
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)

    with SessionLocal() as db:
        all_ids = [r[0] for r in db.execute(select(Attack.id)).all()]
        total = len(all_ids)
        if total == 0:
            log.error("No attack rows to rebalance.")
            return

        # Compute exact integer targets. Use floor for all but the last
        # bucket so any rounding remainder lands on cruise_missile.
        counts: list[int] = [int(total * pct) for _, pct in TARGETS]
        counts[-1] = total - sum(counts[:-1])
        plan = dict(zip([t for t, _ in TARGETS], counts))
        log.info("Total rows: %d. Target distribution: %s",
                 total, {k: f"{v} ({v/total:.1%})" for k, v in plan.items()})

        if args.dry_run:
            current = Counter(t for (t,) in db.execute(select(Attack.attack_type)).all())
            log.info("Current distribution: %s",
                     {k: f"{v} ({v/total:.1%})" for k, v in current.items()})
            log.info("Dry run — no rows updated.")
            return

        # Shuffle and assign in chunks.
        shuffled = list(all_ids)
        rng.shuffle(shuffled)
        cursor = 0
        for (atype, _), n in zip(TARGETS, counts):
            slice_ids = shuffled[cursor:cursor + n]
            cursor += n
            # Bulk update — one statement per chunk, parameterised id list.
            # Postgres handles IN (...) up to thousands of parameters fine.
            CHUNK = 500
            for i in range(0, len(slice_ids), CHUNK):
                batch = slice_ids[i:i + CHUNK]
                db.execute(
                    update(Attack)
                    .where(Attack.id.in_(batch))
                    .values(attack_type=atype)
                )
            log.info("Assigned %d rows -> %s", n, atype)

        db.commit()
        log.info("Migration committed — %d rows rebalanced.", total)


if __name__ == "__main__":
    main()
