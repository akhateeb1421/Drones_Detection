"""Tiny in-process pub/sub.

Publishers are inference workers; subscribers are WebSocket handlers. Topics are
strings ("cam:1", "alarms"). Each subscriber owns its own queue; if a queue is
full we drop the oldest item rather than blocking the producer (drop-tail) so
the live pipeline never stalls.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

log = logging.getLogger(__name__)


class FrameBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue]] = defaultdict(list)

    def subscribe(self, topic: str, queue: asyncio.Queue) -> None:
        self._subs[topic].append(queue)
        log.debug("subscribed to %s (n=%d)", topic, len(self._subs[topic]))

    def unsubscribe(self, topic: str, queue: asyncio.Queue) -> None:
        try:
            self._subs[topic].remove(queue)
        except ValueError:
            pass

    async def publish(self, topic: str, payload: object) -> None:
        for q in list(self._subs.get(topic, [])):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # drop-tail: discard oldest, keep newest
                try:
                    _ = q.get_nowait()
                    q.put_nowait(payload)
                except Exception:  # noqa: BLE001
                    pass


frame_bus = FrameBus()
