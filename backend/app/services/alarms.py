"""Threat evaluation logic. Decides whether a detection should fire an alarm."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings


@dataclass(frozen=True)
class ThreatEval:
    is_threat: bool
    score: int  # 0..100
    reasons: list[str]


HOSTILE_CLASSES = {"shahed", "orlan-10", "orlan10", "orlan_10"}


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

    if drone_class.lower() in HOSTILE_CLASSES:
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
