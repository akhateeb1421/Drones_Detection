"""Threat evaluation logic. Decides whether a detection should fire an alarm."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings


@dataclass(frozen=True)
class ThreatEval:
    is_threat: bool
    score: int  # 0..100
    reasons: list[str]


# Any drone-shaped object should be treated as hostile by default.
# (Bird / airplane / helicopter remain non-hostile.)
HOSTILE_CLASSES = {"shahed", "orlan-10", "orlan10", "orlan_10", "dji", "drone"}

# Demo-priority classes get the maximum hostile boost so they fire the alarm
# even at low confidence and without ETA/speed signals — useful for a live
# demo where DJI is the target we want to react to instantly.
DEMO_PRIORITY_CLASSES = {"dji"}


def evaluate(
    drone_class: str,
    confidence: float,
    eta_s: float | None,
    nearest_area: str | None,
    speed_mps: float | None,
) -> ThreatEval:
    """Return a threat score + flag based on configurable thresholds."""
    s = get_settings()
    score = 0
    reasons: list[str] = []

    cls_l = drone_class.lower()
    if cls_l in DEMO_PRIORITY_CLASSES:
        # Auto-clears the 60 threshold by itself; any DJI sighting alarms.
        score += 70
        reasons.append("demo_priority")
    elif cls_l in HOSTILE_CLASSES:
        score += 40
        reasons.append("hostile_class")
    if confidence >= s.threat_conf_threshold:
        score += 25
        reasons.append("high_confidence")
    if speed_mps and speed_mps > 5.0:
        score += 10
        reasons.append("fast_moving")
    if eta_s is not None and eta_s < s.threat_eta_seconds and nearest_area:
        score += 25
        reasons.append("imminent_arrival")

    return ThreatEval(is_threat=score >= 60, score=min(score, 100), reasons=reasons)
