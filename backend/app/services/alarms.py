"""Threat evaluation logic. Decides whether a detection should fire an alarm."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings


@dataclass(frozen=True)
class ThreatEval:
    is_threat: bool
    score: int  # 0..100
    reasons: list[str]


# Hostile drone classes. The set MUST include every spelling the YOLO
# model can emit — the current model exports shahed_136 / orlan / dji,
# so older spellings (shahed, orlan-10) are kept for backward compat
# but the canonical entries are the underscore variants.
#
# Bird / airplane / helicopter are explicitly non-hostile and the
# evaluate() function short-circuits on them — see the hard-gate below.
HOSTILE_CLASSES = {
    "shahed",
    "shahed_136",
    "shahed-136",
    "shahed136",
    "orlan",
    "orlan-10",
    "orlan10",
    "orlan_10",
    "dji",
    "drone",
}

# Demo-priority classes auto-clear the score threshold on their own — used
# for any sighting we want to react to instantly without piling up enough
# secondary signals (speed / ETA / nearest_area). The frontend's threatTier
# treats *any* hostile class within 30 s ETA as CRITICAL with no other
# conditions, so we keep the backend alarm rule equally permissive — every
# hostile drone class is demo-priority. Without this, a moderate-confidence
# Shahed without a known nearest_area would score 40 (no alarm) while the
# frontend still painted Threat=CRITICAL — the badge and the audible alarm
# would disagree.
DEMO_PRIORITY_CLASSES = {
    "dji",
    "shahed",
    "shahed_136",
    "shahed-136",
    "shahed136",
    "orlan",
    "orlan-10",
    "orlan10",
    "orlan_10",
    "drone",
}


def _is_hostile(cls_l: str) -> bool:
    """Case-insensitive, whitespace-trimmed membership check.
    Centralised so the gate, the scorer, and any future caller agree."""
    return cls_l.strip() in HOSTILE_CLASSES


def evaluate(
    drone_class: str | None,
    confidence: float,
    eta_s: float | None,
    nearest_area: str | None,
    speed_mps: float | None,
) -> ThreatEval:
    """Return a threat score + flag based on configurable thresholds.

    HARD GATE: a detection that isn't a hostile drone class never fires
    an alarm, regardless of how fast / close / confident it is. Birds,
    airplanes, and helicopters can clear the geometric thresholds
    (e.g. an airliner flying near a sensitive area at high speed), but
    they're not threats — only drones are.
    """
    s = get_settings()

    # Defensive boundary coerce — a new YOLO model can emit None or an
    # unexpected label. Treat anything we can't read as non-hostile.
    cls_l = str(drone_class or "").lower().strip()

    if not _is_hostile(cls_l):
        # Non-hostile classes (bird/airplane/helicopter/unknown) never
        # alarm. Return early so the rest of the scorer can't accidentally
        # push them over the threshold via high-confidence + fast-moving
        # + imminent-arrival.
        return ThreatEval(is_threat=False, score=0, reasons=["non_hostile_class"])

    score = 0
    reasons: list[str] = []

    if cls_l in DEMO_PRIORITY_CLASSES:
        # Auto-clears the 60 threshold by itself; any DJI sighting alarms.
        score += 70
        reasons.append("demo_priority")
    else:
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
