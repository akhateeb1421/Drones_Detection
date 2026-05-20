"""Chatbot service backed by a local Ollama LLM.

Builds a structured context block from the unified attacks table + a small
window of recent live detections, then sends it to Ollama as the system prompt.
The LLM has read-only context — it has no tools, cannot mutate the database,
and cannot fire alarms.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Attack, Camera, Detection, SensitiveArea
from app.schemas.chat import ChatTurn

log = logging.getLogger(__name__)

# Canonical English region names in the Attack.region column, mapped to
# their Arabic spellings. Injected into every chat context so the LLM
# can translate Arabic place names (الجوف، الرياض، ينبع، …) to the
# English values it must look up in the data block. Without this map
# the "no inventing region aliases" rule turned every Arabic-language
# region question into "لا تتوفر هذه المعلومة" because the model
# refused to translate. Mirrors frontend/src/i18n/ar.json `places`.
REGION_NAME_MAP_EN_AR: dict[str, str] = {
    "Riyadh": "الرياض",
    "Eastern Region": "المنطقة الشرقية",
    "Al-Kharj": "الخرج",
    "Al-Jouf": "الجوف",
    "Hafr Al-Batin": "حفر الباطن",
    "Yanbu": "ينبع",
}


def _region_map_block() -> str:
    """Render the EN<->AR region map as a small table for the prompt."""
    lines = [
        "=== REGION NAME MAP (English DB value <-> Arabic) ===",
        "Use this table to translate Arabic place names in the user's",
        "question into the canonical English region names that appear",
        "in 'Counts by region' and the per-(region,month) table below.",
        "These pairs are TRANSLATIONS, not aliases — they refer to the",
        "same region. The 'no inventing aliases' rule does NOT apply to",
        "translations listed here.",
        "english | arabic",
    ]
    for en, ar in REGION_NAME_MAP_EN_AR.items():
        lines.append(f"- {en} | {ar}")
    return "\n".join(lines)


# Arabic Gregorian month names — every spelling the user is likely to
# type. Maps to numeric month (1..12). Used by `_resolve_attack_query`
# to convert "يونيو 2025" into the (06, 2025) tuple it needs to scan
# the Attack table directly.
ARABIC_MONTHS: dict[str, int] = {
    "يناير": 1, "فبراير": 2, "مارس": 3,
    "أبريل": 4, "ابريل": 4, "ابرل": 4,
    "مايو": 5, "مايس": 5,
    "يونيو": 6, "يونيه": 6,
    "يوليو": 7, "يوليه": 7,
    "أغسطس": 8, "اغسطس": 8, "اوغست": 8,
    "سبتمبر": 9, "أيلول": 9,
    "أكتوبر": 10, "اكتوبر": 10,
    "نوفمبر": 11, "ديسمبر": 12,
}
ENGLISH_MONTHS: dict[str, int] = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5,
    "june": 6, "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

# Specific attack-type names the user might type, in Arabic + English.
# Maps to the canonical Attack.attack_type column value used in the DB.
# Used by `_extract_query_context` to detect questions like
# "كم صاروخ كروز ضرب الرياض" (filter to cruise_missile) vs the more
# generic "كم نوع الهجمات" (return the full type breakdown).
ATTACK_TYPE_ALIASES: dict[str, str] = {
    # drone
    "drone": "drone", "drones": "drone",
    "uav": "drone", "uavs": "drone",
    "مسيرة": "drone", "مسيّرة": "drone", "مسيرات": "drone", "المسيرات": "drone",
    "مسير": "drone", "طائرة بدون طيار": "drone",
    # cruise missile
    "cruise": "cruise_missile", "cruise_missile": "cruise_missile",
    "كروز": "cruise_missile", "صاروخ كروز": "cruise_missile", "صواريخ كروز": "cruise_missile",
    # ballistic missile
    "ballistic": "ballistic_missile", "ballistic_missile": "ballistic_missile",
    "باليستي": "ballistic_missile", "باليستية": "ballistic_missile",
    "صاروخ باليستي": "ballistic_missile", "صواريخ باليستية": "ballistic_missile",
}

# Common non-Saudi place names. When the user asks about any of these
# the system flat-out can't answer (this dashboard is scoped to the
# Kingdom). Used by `_resolve_attack_query` to short-circuit with a
# polite scope-refusal instead of a confusing "no data" answer.
NON_SAUDI_PLACES: set[str] = {
    # Gulf neighbours
    "دبي", "ابوظبي", "أبوظبي", "أبو ظبي", "ابو ظبي", "الشارقة", "العين",
    "الدوحة", "الكويت", "المنامة", "مسقط", "صلالة",
    # Levant + Iraq + Egypt
    "القاهرة", "الإسكندرية", "الاسكندرية", "دمشق", "حلب", "بغداد", "البصرة",
    "بيروت", "صيدا", "عمان", "اربد", "إربد",
    # Yemen / Iran / Levant
    "صنعاء", "عدن", "تعز", "الحديدة", "طهران", "أصفهان", "اصفهان", "شيراز",
    "تبريز", "تل أبيب", "تل ابيب", "القدس", "غزة", "رام الله",
    # Western capitals
    "نيويورك", "لندن", "باريس", "برلين", "موسكو", "واشنطن", "اسطنبول",
    "إسطنبول", "أنقرة", "انقرة",
    # English / Latin
    "dubai", "abu dhabi", "sharjah", "doha", "kuwait city", "manama", "muscat",
    "cairo", "alexandria", "damascus", "aleppo", "baghdad", "basra",
    "beirut", "amman", "sanaa", "sana'a", "aden", "tehran", "isfahan",
    "shiraz", "tel aviv", "jerusalem", "gaza", "ramallah",
    "new york", "london", "paris", "berlin", "moscow", "washington",
    "istanbul", "ankara",
}


# Saudi Arabia's macro-regions. Maps an Arabic / English segment name
# to the list of DB-canonical region values inside it. The Attack.region
# column stores the per-city values (Riyadh, Al-Kharj, etc.); these
# segment names aggregate across them so the user can ask things like
# "كم هجمة على المنطقة الوسطى في 2024؟" without having to know that
# الوسطى spans Riyadh + Al-Kharj.
SAUDI_SEGMENTS: dict[str, list[str]] = {
    # Central — Riyadh + Al-Kharj
    "المنطقة الوسطى": ["Riyadh", "Al-Kharj"],
    "المنطقه الوسطى": ["Riyadh", "Al-Kharj"],
    "الوسطى": ["Riyadh", "Al-Kharj"],
    "central region": ["Riyadh", "Al-Kharj"],
    # Northern — Hafr Al-Batin + Al-Jouf
    "المنطقة الشمالية": ["Hafr Al-Batin", "Al-Jouf"],
    "المنطقه الشمالية": ["Hafr Al-Batin", "Al-Jouf"],
    "الشمالية": ["Hafr Al-Batin", "Al-Jouf"],
    "northern region": ["Hafr Al-Batin", "Al-Jouf"],
    # Western — Yanbu only (for this dataset)
    "المنطقة الغربية": ["Yanbu"],
    "المنطقه الغربية": ["Yanbu"],
    "الغربية": ["Yanbu"],
    "western region": ["Yanbu"],
}


def _detect_non_saudi_place(msg: str) -> str | None:
    """Return the first non-Saudi place we spot in `msg`, or None."""
    lower = msg.lower()
    for place in NON_SAUDI_PLACES:
        # match against both raw and lowercased forms so Arabic + English
        # alike are caught.
        if place in lower:
            return place
        # Arabic words may include the leading "الـ" already in the dict.
        if place in msg:
            return place
    return None


def _detect_saudi_segment(msg: str) -> tuple[str, list[str]] | None:
    """Return (segment_name, [DB region names]) when the user mentioned
    one of the four Saudi macro-regions, else None. "المنطقة الشرقية"
    is intentionally NOT here — it's already a single region in
    REGION_NAME_MAP_EN_AR and gets caught by normal region detection."""
    lower = msg.lower()
    # Try longest names first so "المنطقة الوسطى" wins over "الوسطى".
    for name in sorted(SAUDI_SEGMENTS.keys(), key=len, reverse=True):
        if name in msg or name in lower:
            return name, SAUDI_SEGMENTS[name]
    return None


# Keywords that mean "what model / LLM are you using". The chat service
# answers these with the active backend\'s short description (matching
# the API/Local toggle hints in the dashboard footer).
MODEL_QUESTION_KEYWORDS = (
    "نموذج لغوي", "النموذج اللغوي", "موديل", "النموذج", "أي نموذج",
    "اي نموذج", "ما نموذجك", "ما هو نموذجك",
    "language model", "what model", "which model", "llm",
    "gemini", "qwen", "anthropic", "openai",
)


def _is_model_question(msg: str) -> bool:
    lower = msg.lower()
    return any(k in msg or k in lower for k in MODEL_QUESTION_KEYWORDS)


def _backend_description(chosen: str, language: str) -> str:
    """Short, user-facing description of the active LLM backend.
    Mirrors the hints shown next to the API/Local toggle so the model\'s
    self-description stays consistent with the UI labels."""
    if chosen == "api":
        return (
            "أنا سند. أعمل حالياً على موديل Gemini Flash السحابي — سريع وعالي الجودة، يتطلب إنترنت."
            if language == "ar"
            else "I'm Sanad, currently running on Gemini Flash (cloud) — fast, high-quality, internet required."
        )
    if chosen == "local":
        return (
            "أنا سند. أعمل حالياً على موديل Qwen2.5-3B المحلي مع طبقة LoRA لبيانات الدفاع — يعمل بدون إنترنت."
            if language == "ar"
            else "I'm Sanad, currently running on Qwen2.5-3B locally with a drone-QA LoRA — works offline."
        )
    return (
        "أنا سند. أعمل حالياً على نموذج محلي عبر Ollama."
        if language == "ar"
        else "I'm Sanad, currently running on a local Ollama model."
    )






def _extract_query_context(text: str) -> tuple[str | None, int | None, int | None, bool, str | None, bool]:
    """Pull (region, year, month, type_intent, type_filter, trend_intent) out.

    `type_intent` = user asked about TYPES of attacks (نوع/أنواع/types).
    `type_filter` = specific attack_type the user wants filtered (e.g.
        "drone" / "cruise_missile" / "ballistic_missile"), or None.
    `trend_intent` = user is asking about a trend / peak / ranking,
        which means the resolver should NOT short-circuit with a single
        total — let the LLM use the full per-month/region tables."""
    import re as _re
    msg = text or ""
    msg_lower = msg.lower()

    region = None
    for en, ar in REGION_NAME_MAP_EN_AR.items():
        if ar and ar in msg:
            region = en
            break
    if region is None:
        for en, _ar in REGION_NAME_MAP_EN_AR.items():
            if en.lower() in msg_lower:
                region = en
                break

    year = None
    m = _re.search(r"\b(1[89]\d{2}|20\d{2}|21\d{2})\b", msg)
    if m:
        year = int(m.group(1))

    month = None
    for ar_name, m_num in ARABIC_MONTHS.items():
        if ar_name in msg:
            month = m_num
            break
    if month is None:
        for en_name, m_num in ENGLISH_MONTHS.items():
            if _re.search(rf"\b{en_name}\b", msg_lower):
                month = m_num
                break

    # Relative date phrases resolved against TODAY, so "الشهر الماضي"
    # (last month), "هذا الشهر", "العام الماضي" etc. work without the
    # user typing an explicit month/year. Only fills axes the explicit
    # parsing above didn't already set.
    if month is None and year is None:
        now = datetime.now(timezone.utc)
        if (any(p in msg for p in ("الشهر الماضي", "الشهر الفائت", "الشهر المنصرم"))
                or "last month" in msg_lower):
            prev = now.replace(day=1) - timedelta(days=1)
            month, year = prev.month, prev.year
        elif (any(p in msg for p in ("هذا الشهر", "الشهر الحالي", "الشهر الجاري"))
                or "this month" in msg_lower):
            month, year = now.month, now.year
        elif (any(p in msg for p in ("العام الماضي", "السنة الماضية", "العام الفائت", "السنة الفائتة"))
                or "last year" in msg_lower):
            year = now.year - 1
        elif (any(p in msg for p in ("هذا العام", "هذه السنة", "العام الحالي", "السنة الحالية"))
                or "this year" in msg_lower):
            year = now.year

    type_intent = (
        "نوع" in msg
        or "أنواع" in msg
        or "انواع" in msg
        or _re.search(r"\btypes?\b", msg_lower) is not None
    )
    # Specific attack-type filter (drone / cruise_missile / ballistic_missile).
    type_filter: str | None = None
    for alias, canonical in ATTACK_TYPE_ALIASES.items():
        if alias in msg or alias in msg_lower:
            type_filter = canonical
            break

    # Trend / peak / ranking detection — keywords that mean the user wants
    # an analysis across time or a max/min, not a single grand total.
    # When True the resolver bails out so the LLM can use the full data
    # block. Without this, region-only or region+nothing questions like
    # "ما الشهر الأعلى للرياض؟" got answered with the grand total.
    trend_keywords_ar = ("أعلى", "اعلى", "أقصى", "اقصى", "أقل", "اقل",
                          "الأكثر", "الاكثر", "أكثر", "اكثر", "أقل", "اقل",
                          "تتصاعد", "تتراجع", "اتجاه", "اتجاهات", "تطور",
                          "تغير", "تغيّر", "زيادة", "نقصان", "ذروة", "قمة",
                          "نمو", "تنامي", "تباطؤ")
    trend_keywords_en = ("trend", "trends", "peak", "highest", "lowest",
                          "increase", "decrease", "rise", "rising", "falling",
                          "growth", "compared", "comparison", "over time")
    trend_intent = any(k in msg for k in trend_keywords_ar) or any(
        k in msg_lower for k in trend_keywords_en
    )

    return region, year, month, type_intent, type_filter, trend_intent


def _resolve_attack_query(
    message: str,
    attacks: "pd.DataFrame",
    history: list | None = None,
) -> str | None:
    """Pre-compute the answer for (region [+ month] [+ year]) questions.

    The LLM consistently fails the multi-hop chain
        Arabic question -> English region name -> numeric month
        -> scan the per-(region,month) table -> count
    even when every step's data is in its prompt. So we do that chain
    here in Python and hand the model a single 'GROUNDED FACT' line as
    the source of truth. The model just reformats it as natural Arabic.

    Returns the GROUNDED FACT string when at least a region is found
    in the question, or None when the question is too free-form (the
    LLM then falls back to the unconstrained data block as before).
    """
    if attacks.empty:
        return None

    # Step 0: scope check — if the user mentions a place outside the
    # Kingdom, refuse politely. This dashboard is scoped to Saudi
    # Arabia so a non-Saudi place is always a hard "not applicable"
    # rather than a confusing "no data" miss.
    non_saudi = _detect_non_saudi_place(message)
    if non_saudi:
        return (
            f"GROUNDED FACT (scope check): The user mentioned '{non_saudi}', "
            f"which is OUTSIDE Saudi Arabia. The Sanad dashboard is scoped to "
            f"the Kingdom only. Reply in the user\'s language with the exact "
            f"text: 'هذا النظام مخصص لحماية أراضي المملكة، والمدينة المذكورة "
            f"خارج حدود المملكة.' (or the English equivalent). Do not invent "
            f"a number; do not say 'no record'; do not list any other region."
        )

    # Step 0b: macro-segment check — when the user asked about a Saudi
    # macro-region (Central/Northern/Western), sum across the cities
    # inside that segment. Eastern Region is a single DB region and
    # already handled by the normal flow.
    segment = _detect_saudi_segment(message)

    # Step 1: extract context from the CURRENT message.
    region, year, month, type_intent, type_filter, trend_intent = _extract_query_context(message)

    # Step 2: for any axis the current message didn\'t supply, inherit
    # it from the most recent prior user turn that did. This is what
    # lets follow-ups like "وش نوع الهجمات" (after asking about Yanbu
    # June 2025) carry the implied (region, year, month) forward. We
    # walk newest-first and take the first value we find per axis.
    if history:
        for turn in reversed(history):
            if region is not None and year is not None and month is not None:
                break
            content = getattr(turn, "content", None) if not isinstance(turn, dict) else turn.get("content")
            role = getattr(turn, "role", None) if not isinstance(turn, dict) else turn.get("role")
            if role != "user" or not content:
                continue
            h_region, h_year, h_month, h_type_intent, h_type_filter, _ = _extract_query_context(content)
            if region is None:
                region = h_region
            if year is None:
                year = h_year
            if month is None:
                month = h_month
            # Carry over type intent + specific type so follow-ups like
            # "وماذا عن الرياض؟" after a "ما نوع الهجمات…" question
            # inherit the user\'s desire for a type breakdown.
            if not type_intent and h_type_intent:
                type_intent = True
            if type_filter is None and h_type_filter:
                type_filter = h_type_filter

    # If the user is asking about a trend / peak / ranking, the resolver
    # would only mislead by returning a single total. Bail out so the
    # LLM can use the per-month and per-region tables in the data block
    # to do the actual analysis.
    if trend_intent:
        return None

    # --- Saudi macro-segment branch (Central / Northern / Western).
    # When the user asked about "المنطقة الوسطى" etc., sum the count
    # over its constituent DB regions in the given period (if any).
    if segment:
        seg_name, seg_regions = segment
        seg_sub = attacks[attacks["region"].isin(seg_regions)].copy()
        if type_filter is not None:
            seg_sub = seg_sub[seg_sub["attack_type"] == type_filter]
        seg_sub["_year"] = seg_sub["occurred_at"].dt.year
        seg_sub["_month"] = seg_sub["occurred_at"].dt.month
        if year is not None and month is not None:
            seg_sub = seg_sub[(seg_sub["_year"] == year) & (seg_sub["_month"] == month)]
            scope_label = f"year={year}, month={month:02d}"
        elif year is not None:
            seg_sub = seg_sub[seg_sub["_year"] == year]
            scope_label = f"year={year}"
        elif month is not None:
            seg_sub = seg_sub[seg_sub["_month"] == month]
            scope_label = f"month={month:02d}"
        else:
            scope_label = "across the entire dataset"
        count = int(len(seg_sub))
        type_extra = ""
        if type_intent and count > 0:
            by_type = seg_sub.groupby("attack_type").size().sort_values(ascending=False)
            type_extra = (
                " Breakdown by attack_type: "
                + "; ".join(f"{t}={int(c)}" for t, c in by_type.items())
                + "."
            )
        return (
            f"GROUNDED FACT (Saudi macro-segment): segment={seg_name} "
            f"(cities: {', '.join(seg_regions)}), {scope_label}: {count} "
            f"attack(s) on record." + type_extra +
            " When replying in Arabic, refer to the segment by its Arabic "
            f"name '{seg_name}'. Do not list per-city counts unless asked. "
            f"Report the number directly."
        )

    # --- "Which cities / list regions in <period>" branch.
    # When the user didn\'t name a specific region but did specify a
    # period (year, month, or both), they\'re asking for a per-region
    # breakdown — exactly the kind of multi-row scan Gemini Flash
    # hallucinates on. Pre-compute the full breakdown and force the
    # model to relay it verbatim.
    if region is None:
        if year is None and month is None:
            return None  # truly free-form, let the LLM handle it.
        full = attacks.copy()
        full["_year"] = full["occurred_at"].dt.year
        full["_month"] = full["occurred_at"].dt.month
        if year is not None and month is not None:
            scope = f"year={year}, month={month:02d}"
            full = full[(full["_year"] == year) & (full["_month"] == month)]
        elif year is not None:
            scope = f"year={year}"
            full = full[full["_year"] == year]
        else:
            scope = f"month={month:02d} (all years)"
            full = full[full["_month"] == month]
        if type_filter is not None:
            full = full[full["attack_type"] == type_filter]
            scope = f"{scope}, attack_type={type_filter}"
        by_region = (
            full.groupby("region").size()
            .sort_values(ascending=False)
        )
        if by_region.empty:
            return (
                f"GROUNDED FACT (deterministic lookup): For {scope}: "
                f"0 attacks recorded in any region. Report this directly."
            )
        breakdown = "; ".join(f"{r}={int(c)}" for r, c in by_region.items())
        total = int(by_region.sum())
        return (
            f"GROUNDED FACT (deterministic multi-region breakdown): "
            f"For {scope}, total {total} attack(s), split by region as: "
            f"{breakdown}. "
            f"List EVERY region in this breakdown exactly as written; do "
            f"not omit any; do not invent additional regions; do not "
            f"change any number. Use the Arabic translation from the "
            f"REGION NAME MAP when replying in Arabic."
        )

    # Slice the attacks frame for this region. Apply type_filter so a
    # question like "كم صاروخ كروز ضرب الرياض" counts only cruise_missile
    # rows instead of the grand total.
    sub = attacks[attacks["region"] == region].copy()
    if type_filter is not None:
        sub = sub[sub["attack_type"] == type_filter]
    if sub.empty:
        return (
            f"GROUNDED FACT (deterministic lookup): region={region} has 0 "
            f"attacks on record across the entire dataset."
        )

    sub["_year"] = sub["occurred_at"].dt.year
    sub["_month"] = sub["occurred_at"].dt.month

    if year is not None and month is not None:
        period_mask = (sub["_year"] == year) & (sub["_month"] == month)
        sub_p = sub[period_mask]
        count = int(period_mask.sum())
        type_suffix = ""
        if type_intent and count > 0:
            by_type = sub_p.groupby("attack_type").size().sort_values(ascending=False)
            type_suffix = (
                " Breakdown by attack_type: "
                + "; ".join(f"{t}={int(c)}" for t, c in by_type.items())
                + ". Report EVERY listed attack_type with its number; do not omit or invent any."
            )
        return (
            f"GROUNDED FACT (deterministic lookup): For region={region}, "
            f"year={year}, month={month:02d}: {count} attack(s) on record."
            + type_suffix +
            " Report this number directly; do not re-derive it from any table."
        )
    if year is not None:
        sub_p = sub[sub["_year"] == year]
        count = int(len(sub_p))
        type_suffix = ""
        if type_intent and count > 0:
            by_type = sub_p.groupby("attack_type").size().sort_values(ascending=False)
            type_suffix = (
                " Breakdown by attack_type: "
                + "; ".join(f"{t}={int(c)}" for t, c in by_type.items())
                + ". Report EVERY listed attack_type."
            )
        return (
            f"GROUNDED FACT (deterministic lookup): For region={region}, "
            f"year={year}: {count} attack(s) on record (sum across all months)."
            + type_suffix +
            " Report this number directly; do not re-derive it from any table."
        )
    if month is not None:
        sub_p = sub[sub["_month"] == month]
        by_year = sub_p.groupby("_year").size().sort_index()
        if by_year.empty:
            return (
                f"GROUNDED FACT (deterministic lookup): For region={region}, "
                f"month={month:02d} (across all years): 0 attack(s) on record."
            )
        breakdown = ", ".join(f"{int(y)}={int(c)}" for y, c in by_year.items())
        total = int(by_year.sum())
        type_suffix = ""
        if type_intent and total > 0:
            by_type = sub_p.groupby("attack_type").size().sort_values(ascending=False)
            type_suffix = (
                " Breakdown by attack_type: "
                + "; ".join(f"{t}={int(c)}" for t, c in by_type.items())
                + "."
            )
        return (
            f"GROUNDED FACT (deterministic lookup): For region={region}, "
            f"month={month:02d}: total {total} attack(s) across years "
            f"({breakdown})." + type_suffix
        )
    # Region-only query.
    count = len(sub)
    type_suffix = ""
    if type_intent and count > 0:
        by_type = sub.groupby("attack_type").size().sort_values(ascending=False)
        type_suffix = (
            " Breakdown by attack_type: "
            + "; ".join(f"{t}={int(c)}" for t, c in by_type.items())
            + "."
        )
    return (
        f"GROUNDED FACT (deterministic lookup): region={region} has {count} "
        f"attack(s) on record total (across the entire dataset)."
        + type_suffix +
        " Report this number directly; do not re-derive it from any table."
    )


# Keywords that signal the user wants a FORECAST / outlook for the
# future, not a count of past attacks. Routed to `_resolve_forecast_query`
# which calls the forecaster service for the next 7 days.
FORECAST_KEYWORDS_AR = (
    "توقع", "توقعات", "المتوقع", "نتوقع", "متوقع",
    "الأسبوع القادم", "الاسبوع القادم", "الأسبوع المقبل", "الاسبوع المقبل",
    "الشهر القادم", "الشهر المقبل", "الأيام القادمة", "الايام القادمة",
    "القادمة", "المقبلة", "المستقبل", "مستقبل",
)
FORECAST_KEYWORDS_EN = (
    "forecast", "predict", "prediction", "predicted", "expected", "expect",
    "next week", "next month", "upcoming", "outlook", "coming days", "future",
)


def _resolve_forecast_query(db: Session, message: str) -> str | None:
    """Pre-compute a 7-day forecast grounded fact for outlook questions.

    The chat context only carries PAST attacks, so any "what's expected
    next week" question used to fall through to "not available". Here we
    call the same forecaster the Analysis page uses, sum the expected
    counts over the next 7 days (optionally for a single region/segment
    the user named), and hand the model one authoritative line.
    """
    msg = message or ""
    low = msg.lower()
    if not (any(k in msg for k in FORECAST_KEYWORDS_AR)
            or any(k in low for k in FORECAST_KEYWORDS_EN)):
        return None

    # Non-Saudi place still wins — let the attack resolver emit the scope
    # refusal rather than forecasting an out-of-scope city.
    if _detect_non_saudi_place(msg):
        return None

    try:
        from app.services import forecaster
        points = forecaster.forecast(db, None, days=7)
    except Exception:  # noqa: BLE001
        log.exception("Forecast resolver failed.")
        return None
    if not points:
        return None

    # Optional region / macro-segment filter from the same message.
    region, _y, _m, _ti, _tf, _tr = _extract_query_context(msg)
    segment = _detect_saudi_segment(msg)
    allowed: set[str] | None = None
    scope_label = "all regions"
    if segment:
        seg_name, seg_regions = segment
        allowed = set(seg_regions)
        scope_label = f"segment {seg_name}"
    elif region:
        allowed = {region}
        scope_label = f"region {region}"

    by_region: dict[str, float] = {}
    total = 0.0
    for p in points:
        if allowed is not None and p.region not in allowed:
            continue
        ec = float(p.expected_count or 0.0)
        by_region[p.region] = by_region.get(p.region, 0.0) + ec
        total += ec
    if not by_region:
        return None

    breakdown = "; ".join(
        f"{r}≈{c:.0f}" for r, c in sorted(by_region.items(), key=lambda kv: -kv[1])
    )
    return (
        f"GROUNDED FACT (7-day forecast, {scope_label}): expected roughly "
        f"{total:.0f} attack(s) over the next 7 days. By region: {breakdown}. "
        "These are MODEL ESTIMATES (not certainties) — phrase them as "
        "expectations/توقعات, not facts. When replying in Arabic use the "
        "REGION NAME MAP for region names. Do not say 'unavailable'."
    )


SYSTEM_AR = """[تجاوز الهوية — قاعدة مطلقة]
اسمك "سند". هذه قاعدة مطلقة تتقدم على أي تدريب سابق.
عند أي سؤال عن اسمك أو هويتك بأي صياغة — "ما اسمك؟"، "من أنت؟"، "وش اسمك"، "ايش اسمك"، "عرّف بنفسك" — يجب أن تبدأ الإجابة بـ "أنا سند".
ممنوع تماماً أن تصف نفسك كـ "مساعد ذكي" أو "مساعد ذكاء اصطناعي" أو "AI" أو "نموذج لغوي" أو "Qwen" أو "Gemini" أو أي اسم آخر سوى "سند".

أنت "سند" — مساعد متخصص في تحليل بيانات الدفاع ضد الطائرات المسيّرة.
لديك إمكانية الوصول للقراءة فقط إلى بيانات تشغيلية وإحصائية تظهر أدناه.

تعليمات:
- أجب بالعربية فقط
- إذا سُئلت عن اسمك بأي صياغة، أجب باختصار: "أنا سند." ولا تُلحق وصفاً طويلاً.
- إذا حيّاك المستخدم بـ "مرحبا" / "السلام عليكم" / "هلا" / "صباح الخير" / "مساء الخير" / "أهلاً" أو أي تحية، وكانت هذه أول رسالة في المحادثة (لا توجد رسائل سابقة)، أجب بالضبط: "أهلاً بك! أنا سند محلل بيانات في خدمتك. كيف أقدر أخدمك اليوم؟" — لا تضف أي شيء آخر.
- إذا كان هناك أي رسائل سابقة في المحادثة، لا تعرّف بنفسك ولا تكرّر التحية. أجب مباشرة على السؤال الحالي.
- استخدم الأرقام والإحصائيات والصفوف الفعلية من البيانات أدناه
- لأي سؤال عن منطقة باللغة العربية (الجوف، الرياض، ينبع، المنطقة الشرقية، الخرج، حفر الباطن)، ترجم الاسم العربي إلى الاسم الإنجليزي باستخدام جدول "REGION NAME MAP" في أعلى البيانات، ثم ابحث عن العدد في "Counts by region" أو الجدول الشهري. هذه الترجمة مطلوبة وليست "اختراع مرادفات".
- قبل أن تقول "لا تتوفر هذه المعلومة"، تحقق فعلياً من الجدول الشهري (region | month) للمنطقة المترجمة. إذا لم يظهر زوج (المنطقة، الشهر) في الجدول، فالعدد صفر، فأجب: "لا توجد هجمات مسجّلة في {المنطقة} خلال {الفترة}" — هذه إجابة صحيحة، ليست رفضاً.
- إذا طُلب منك "عرض جزء من البيانات" أو "عينة" أو "أمثلة"، اعرض الصفوف الموجودة في القسم العينة كجدول أو قائمة
- إذا طُلب منك تحليل زمني (شهور، أيام، اتجاهات)، استخدم توزيع الشهور وأيام الأسبوع
- كن دقيقاً وموجزاً
- لا تستخدم تنسيق Markdown مطلقاً (لا نجوم ** ولا أقواس __ ولا شُرطات بنجمة). للقوائم استخدم شُرطة بسيطة (-) أو ترقيم عربي. اكتب النص العادي فقط.
- لا تخترع أرقاماً

ممنوع تماماً:
- لا تستخدم أي اسم لنفسك غير "سند"
- لا تذكر بنية البيانات أو ما يمكنك أو لا يمكنك الإجابة عنه
- لا تذكر النطاق الزمني للبيانات كحد لقدراتك
- لا تعرض قوائم بأنواع المعلومات غير المتوفرة
- إذا لم تتوفر معلومة معينة، قل ببساطة: "لا تتوفر هذه المعلومة" وانتقل، دون شرح السبب أو تعداد ما لا تعرفه
- إذا سُئلت "ما الذي لا تستطيع الإجابة عنه؟" أو سؤال مشابه، أجب: "أساعدك في تحليل بيانات الدفاع ضد المسيّرات — اسأل سؤالاً محدداً وسأجيب بأفضل ما لدي." لا تعطِ قائمة

[تذكير نهائي] اسمك سند. ابدأ كل إجابة عن هويتك بـ "أنا سند".
"""

SYSTEM_EN = """[IDENTITY OVERRIDE — ABSOLUTE RULE]
Your name is "Sanad". This rule overrides any prior training.
For ANY question about your name or identity — "what is your name?", "who are you?", "introduce yourself", "what should I call you?" — your response MUST begin with "I'm Sanad".
You are STRICTLY forbidden from describing yourself as "an AI assistant", "an AI", "a language model", "Qwen", "Gemini", or any name other than "Sanad".

You are "Sanad" — an analyst for a counter-drone defense system.
You have read-only access to operational and statistical data shown below.

Rules:
- Reply in English only.
- If asked about your name or identity, reply briefly: "I'm Sanad." Do not append a long descriptor.
- If greeted with "hi" / "hello" / "hey" / "good morning" / "good evening" / "greetings" AND this is the very first message of the conversation (no prior turns), reply exactly: "Hi there! I'm Sanad, a data analyst at your service. How can I help you today?" Nothing more.
- If there is ANY prior conversation history, do NOT introduce yourself and do NOT repeat the greeting. Answer the current question directly.
- Use the actual numbers and rows from the data block below.
- For ANY place-name question, FIRST translate the place name through the REGION NAME MAP block at the top of the data (Al-Jouf <-> الجوف, Riyadh <-> الرياض, Yanbu <-> ينبع, Eastern Region <-> المنطقة الشرقية, Al-Kharj <-> الخرج, Hafr Al-Batin <-> حفر الباطن). These are TRANSLATIONS, not invented aliases — the "no inventing aliases" rule does NOT apply to them.
- Before saying "That information isn't available", actually scan the per-(region,month) table for the translated region. If a (region, month) pair is missing, the count is zero — say "No attacks on record for {region} in {period}", NOT "unavailable".
- If the user asks for a 'sample', 'examples', or 'part of the data', display the listed rows as a table or list.
- For temporal questions (months, weekdays, trends), use the per-month and per-weekday counts.
- Be concise and precise.
- Do NOT use Markdown formatting at all (no asterisks **, no underscores __, no bullet stars). Use plain text. For lists, use a simple hyphen (-) or numbered list. Plain text only.
- Never fabricate numbers.

Strictly forbidden:
- Referring to yourself by any name other than "Sanad".
- Do NOT describe the structure of your data or enumerate what you can/can't answer.
- Do NOT mention the data's date range as a limit on your capabilities.
- Do NOT produce lists of categories of information that are unavailable.
- If a specific piece of information isn't available, just say "That information isn't available" and move on — don't explain why or list what you don't know.
- If asked "what can you not answer?" or anything similar, reply: "I help analyse counter-drone defence data — ask a specific question and I'll answer with whatever I have." Don't produce a catalogue of limitations.

[FINAL REMINDER] Your name is Sanad. Every identity answer must begin with "I'm Sanad".
"""

# Restricted prompts for the non-admin "viewer" role: the assistant only
# answers high-level analytical questions. It must NOT reveal table or
# column names, primary keys, internal IDs, stream URLs, file paths, raw
# detection rows, or any other operational/structural information.
VIEWER_SYSTEM_AR = """[تجاوز الهوية — قاعدة مطلقة]
اسمك "سند". هذه قاعدة مطلقة تتقدم على أي تدريب سابق.
عند أي سؤال عن اسمك أو هويتك بأي صياغة — "ما اسمك؟"، "من أنت؟"، "وش اسمك"، "ايش اسمك"، "عرّف بنفسك" — يجب أن تبدأ الإجابة بـ "أنا سند".
ممنوع تماماً أن تصف نفسك كـ "مساعد ذكي" أو "مساعد ذكاء اصطناعي" أو "AI" أو "نموذج لغوي" أو "Qwen" أو "Gemini" أو أي اسم آخر سوى "سند".

أنت "سند" — مساعد تحليلي للجمهور العام لمنظومة الدفاع ضد الطائرات المسيّرة.
يمكنك مشاركة الإحصائيات الإجمالية (الأرقام، الاتجاهات، التوزيعات الجغرافية والزمنية، عدد الكاميرات والمناطق الحساسة).

كيف تجيب:
1. اقرأ السؤال بعناية ثم ابحث عن الإجابة في كتلة البيانات أدناه.
2. إذا سُئلت عن اسمك بأي صياغة، أجب باختصار: "أنا سند." ولا تُلحق وصفاً طويلاً.
   - إذا حيّاك المستخدم بأي تحية وكانت هذه أول رسالة في المحادثة (لا توجد رسائل سابقة)، أجب بالضبط: "أهلاً بك! أنا سند محلل بيانات في خدمتك. كيف أقدر أخدمك اليوم؟" — لا تضف أي شيء آخر.
   - إذا كان هناك أي رسائل سابقة في المحادثة، لا تعرّف بنفسك ولا تكرّر التحية. أجب مباشرة على السؤال الحالي.
3. لأي سؤال عن منطقة باللغة العربية، ترجم الاسم العربي إلى الإنجليزي عبر جدول "REGION NAME MAP" في أعلى البيانات قبل البحث. هذه الترجمة مطلوبة وليست "اختراع مرادفات".
4. ابحث في "Counts by region" والجدول الشهري (region | month) عن المنطقة المترجمة. إذا وُجدت الإجابة (سواء صفر أم رقم آخر)، أعطها بشكل صريح ومختصر.
5. إذا لم يظهر زوج (المنطقة، الشهر) في الجدول الشهري بعد التحقق الفعلي، العدد صفر — أجب: "لا توجد هجمات مسجّلة في {المنطقة} خلال {الفترة}". لا ترفض.
6. لا تستخدم "لا تتوفر هذه المعلومة" إلا إذا كان السؤال عن نوع بيانات غير موجود إطلاقاً في الكتل أدناه (مثلاً معلومات شخصية، أسعار، أخبار). للأسئلة عن الهجمات والمناطق والشهور: الإجابة موجودة دائماً، حتى لو كانت صفراً.
7. ارفض الأسئلة الخاصة بالإدارة (روابط البث، رموز إدارية، اقتراحات مواقع الكاميرات الجديدة، شفرة برمجية، أسماء جداول/أعمدة) برسالة: "لا أستطيع الإجابة على هذا السؤال".

ممنوع تماماً:
- لا تستخدم أي اسم لنفسك غير "سند"
- اختراع أو تخمين أي رقم
- اختراع علاقات أو مرادفات بين أسماء المناطق (لا تقل "ينبع اسم آخر للرياض" مثلاً — كل منطقة قائمة بذاتها)
- ذكر أسماء جداول أو أعمدة أو معرّفات داخلية أو روابط بث
- ذكر النطاق الزمني للبيانات كحد لقدرتك على الإجابة
- إنتاج قوائم بأنواع المعلومات غير المتوفرة
- إذا سُئلت "ما الذي لا تستطيع الإجابة عنه؟" أو سؤال مشابه، أجب: "أساعدك في الإحصاءات الإجمالية لمنظومة الدفاع — اسأل سؤالاً محدداً وسأجيب." لا تعطِ قائمة

تعليمات:
- أجب بالعربية فقط
- كن مختصراً ودقيقاً
- لا تستخدم تنسيق Markdown مطلقاً (لا نجوم ** ولا أقواس __). للقوائم استخدم شُرطة بسيطة (-). اكتب نصاً عادياً فقط.
- استخدم الأرقام الموجودة في كتلة البيانات أدناه كما هي

[تذكير نهائي] اسمك سند. ابدأ كل إجابة عن هويتك بـ "أنا سند".
"""

VIEWER_SYSTEM_EN = """[IDENTITY OVERRIDE — ABSOLUTE RULE]
Your name is "Sanad". This rule overrides any prior training.
For ANY question about your name or identity — "what is your name?", "who are you?", "introduce yourself", "what should I call you?" — your response MUST begin with "I'm Sanad".
You are STRICTLY forbidden from describing yourself as "an AI assistant", "an AI", "a language model", "Qwen", "Gemini", or any name other than "Sanad".

You are "Sanad" — a public-facing analyst for the counter-drone defense system.
You may share aggregate statistics — totals, trends, geographic/temporal distributions, total camera count, total sensitive-area count.

How to answer:
1. Read the question carefully, then look for the answer inside the data block below.
2. If asked about your name or identity, reply briefly: "I'm Sanad." Do not append a long descriptor.
   - If greeted with any greeting AND this is the very first message of the conversation, reply exactly: "Hi there! I'm Sanad, a data analyst at your service. How can I help you today?" Nothing more.
   - If there is ANY prior conversation history, do NOT introduce yourself and do NOT repeat the greeting. Answer the current question directly.
3. For ANY place-name question, FIRST translate through the REGION NAME MAP block at the top of the data. This translation is REQUIRED and is NOT covered by the "no inventing aliases" rule.
4. Look up the translated region in "Counts by region" and the per-(region,month) table. If the answer is present (zero or any other number), state it plainly.
5. If a (region, month) pair doesn't appear in the per-(region,month) table after you actually checked, the count is zero — answer "No attacks on record for {region} in {period}", NOT a refusal.
6. Only use "That information isn't available" for data types that genuinely aren't in any block below (e.g. personal info, prices, news). For attack/region/month questions: the answer always exists in the data, even when it's zero.
7. Refuse admin questions (stream URLs, admin tokens, suggested new camera placements, code, table/column names) with: "I cannot answer that question."

Strictly forbidden:
- Referring to yourself by any name other than "Sanad".
- Inventing or guessing any number.
- Inventing aliases or equivalences between regions (NEVER say "Yanbu is an alias of Riyadh" — every region is distinct).
- Mentioning table names, column names, internal IDs, or stream URLs.
- Citing the data's date range as a limit on your capabilities.
- Producing lists of categories of information that are unavailable.
- If asked "what can you not answer?" or anything similar, reply: "I help with aggregate statistics for the defence system — ask a specific question and I'll answer." Don't produce a catalogue.

Rules:
- Reply in English only.
- Be concise and precise.
- Do NOT use Markdown formatting (no asterisks, no bold, no bullet stars). Plain text only — use hyphens for lists.
- Use the numbers in the data block exactly as written.

[FINAL REMINDER] Your name is Sanad. Every identity answer must begin with "I'm Sanad".
"""


def _attacks_df(db: Session) -> pd.DataFrame:
    rows = db.execute(
        select(Attack.occurred_at, Attack.region, Attack.attack_type, Attack.target_location, Attack.source)
    ).all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["occurred_at", "region", "attack_type", "target_location", "source"])
    df["occurred_at"] = pd.to_datetime(df["occurred_at"], utc=True)
    return df


def _live_df(db: Session, hours: int = 24) -> pd.DataFrame:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.execute(
        select(
            Detection.captured_at,
            Detection.drone_class,
            Detection.confidence,
            Detection.speed_mps,
            Detection.direction,
            Detection.nearest_area,
            Detection.eta_s,
        ).where(Detection.captured_at >= cutoff)
    ).all()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(
        rows,
        columns=["captured_at", "drone_class", "confidence", "speed_mps", "direction", "nearest_area", "eta_s"],
    )


def _build_context(db: Session, language: str) -> str:
    attacks = _attacks_df(db)
    live = _live_df(db)

    lines: list[str] = []
    lines.append(_region_map_block())
    lines.append("")
    lines.append("=== HISTORICAL + SYNTHETIC ATTACKS ===")
    if attacks.empty:
        lines.append("No attack records.")
    else:
        # Headline counts
        lines.append(f"Total rows: {len(attacks)}")
        lines.append(f"Sources: {attacks['source'].value_counts().to_dict()}")
        lines.append(f"Date range: {attacks['occurred_at'].min().date()} to {attacks['occurred_at'].max().date()}")

        # Region / type / target breakdown
        lines.append(f"Counts by region: {attacks['region'].value_counts().to_dict()}")
        lines.append(f"Counts by attack_type: {attacks['attack_type'].value_counts().to_dict()}")
        lines.append(f"Top 10 target locations: {attacks['target_location'].value_counts().head(10).to_dict()}")

        # Temporal breakdowns so the chatbot can answer date questions
        attacks_local = attacks.copy()
        attacks_local["month"] = attacks_local["occurred_at"].dt.to_period("M").astype(str)
        attacks_local["weekday"] = attacks_local["occurred_at"].dt.day_name()
        lines.append(f"Counts by month (last 24): {dict(list(attacks_local['month'].value_counts().sort_index().items())[-24:])}")
        lines.append(f"Counts by weekday: {attacks_local['weekday'].value_counts().to_dict()}")

        # Sample real rows so the chatbot can show "parts of the data"
        sample_real = attacks[attacks["source"] == "historical"].sort_values("occurred_at").head(20)
        if not sample_real.empty:
            lines.append("\nSample of 20 real historical rows (oldest first):")
            for _, r in sample_real.iterrows():
                lines.append(
                    f"- {r['occurred_at'].date()} | {r['attack_type']:<18} | "
                    f"{(r['region'] or '?'):<22} | {r['target_location'] or '?'}"
                )

        # Most recent rows across all sources (synthetic + historical + live)
        recent = attacks.sort_values("occurred_at", ascending=False).head(15)
        if not recent.empty:
            lines.append("\nMost recent 15 rows across all sources:")
            for _, r in recent.iterrows():
                lines.append(
                    f"- {r['occurred_at'].date()} | {r['attack_type']:<18} | "
                    f"{(r['region'] or '?'):<22} | {r['source']}"
                )

    lines.append("")
    lines.append("=== LIVE DETECTIONS (last 24h) ===")
    if live.empty:
        lines.append("No recent live detections.")
    else:
        lines.append(f"Records: {len(live)}")
        lines.append(f"Drone classes: {live['drone_class'].value_counts().to_dict()}")
        if live["speed_mps"].notna().any():
            lines.append(
                f"Speed (m/s): mean={live['speed_mps'].mean():.2f} max={live['speed_mps'].max():.2f}"
            )
        lines.append(f"Directions: {live['direction'].value_counts().to_dict()}")
        lines.append(f"Nearest areas: {live['nearest_area'].value_counts().to_dict()}")

        # Sample of recent live detections
        recent_live = live.sort_values("captured_at", ascending=False).head(10)
        if not recent_live.empty:
            lines.append("\nSample of 10 most recent live detections:")
            for _, r in recent_live.iterrows():
                eta = f"{r['eta_s']:.1f}s" if pd.notna(r["eta_s"]) else "—"
                lines.append(
                    f"- {r['captured_at']:%Y-%m-%d %H:%M} | {r['drone_class']:<10} | "
                    f"conf={r['confidence']:.2f} | speed={r['speed_mps']:.1f}m/s | "
                    f"dir={r['direction']} | near={r['nearest_area'] or '?'} | eta={eta}"
                )

    return "\n".join(lines)


def _build_viewer_context(db: Session) -> str:
    """Aggregate-only context for non-admin users.

    Strips per-row samples and operational data, but DOES include per-region
    per-month counts so questions like "Yanbu in June 2026" can be grounded
    or refused with confidence — never guessed.
    """
    attacks = _attacks_df(db)
    live = _live_df(db)
    n_cameras = db.execute(select(Camera)).scalars().unique().all()
    n_areas = db.execute(select(SensitiveArea)).scalars().unique().all()

    lines: list[str] = []
    lines.append(_region_map_block())
    lines.append("")
    lines.append("=== SYSTEM TOTALS ===")
    lines.append(f"Total cameras configured: {len(n_cameras)}")
    lines.append(f"Total sensitive areas configured: {len(n_areas)}")
    lines.append("")
    lines.append("=== AGGREGATE STATISTICS ===")
    if attacks.empty:
        lines.append("No attack records on file.")
    else:
        dmin = attacks["occurred_at"].min().date()
        dmax = attacks["occurred_at"].max().date()
        lines.append(f"Total attack records: {len(attacks)}")
        # Date range is included for the model's own grounding but
        # MUST NOT be cited to the user as a limitation — see the
        # "Strictly forbidden" rules in the system prompt. Internal use only.
        lines.append(f"[INTERNAL] Available date range: {dmin} to {dmax}")
        lines.append(f"Counts by region: {attacks['region'].value_counts().to_dict()}")
        lines.append(f"Counts by attack type: {attacks['attack_type'].value_counts().to_dict()}")

        a2 = attacks.copy()
        a2["month"] = a2["occurred_at"].dt.to_period("M").astype(str)
        a2["weekday"] = a2["occurred_at"].dt.day_name()
        lines.append(
            "Counts by month (full range): "
            f"{a2['month'].value_counts().sort_index().to_dict()}"
        )
        lines.append(f"Counts by weekday: {a2['weekday'].value_counts().to_dict()}")

        # Per-(region, month) cross-tab so granular questions are grounded.
        # ALL non-zero cells across the entire date range — without
        # this the model can't answer questions about older months.
        # Size is bounded by (regions × months) which is small enough
        # for Gemini even over multi-year datasets.
        region_month = (
            a2.groupby(["region", "month"]).size().reset_index(name="count")
            .sort_values(["month", "region"])
        )
        # Per-(region, year) rollup so year-level questions like "كم
        # هجمة على الجوف في 2025" don't require the model to sum 12
        # monthly cells itself — answer is one lookup away.
        a2["year"] = a2["occurred_at"].dt.year.astype(str)
        region_year = (
            a2.groupby(["region", "year"]).size().reset_index(name="count")
            .sort_values(["year", "region"])
        )
        if not region_year.empty:
            lines.append("")
            lines.append("Per-region per-year attack counts (only non-zero):")
            lines.append("region | year | attacks")
            for _, r in region_year.iterrows():
                lines.append(f"- {r['region']} | {r['year']} | {int(r['count'])}")
        if not region_month.empty:
            lines.append("")
            lines.append("Per-region per-month attack counts (only non-zero):")
            lines.append("region | month | attacks")
            for _, r in region_month.iterrows():
                lines.append(f"- {r['region']} | {r['month']} | {int(r['count'])}")
            lines.append(
                "Any (region, month) pair NOT listed above has zero attacks — "
                "answer 'no attacks on record', NOT a refusal."
            )

    lines.append("")
    lines.append("=== LIVE ACTIVITY (last 24h) ===")
    if live.empty:
        lines.append("No live drone activity in the last 24 hours.")
    else:
        lines.append(f"Detections in the last 24h: {len(live)}")
        lines.append(f"Drone class breakdown: {live['drone_class'].value_counts().to_dict()}")
        if live["speed_mps"].notna().any():
            lines.append(
                f"Average speed (m/s): {live['speed_mps'].mean():.2f}; "
                f"max: {live['speed_mps'].max():.2f}"
            )

    return "\n".join(lines)


async def ask(
    db: Session,
    *,
    message: str,
    history: list[ChatTurn],
    language: str = "ar",
    role: str = "viewer",
    backend: str | None = None,
) -> tuple[str, str]:
    """Generate a chatbot reply.

    `backend` overrides the global `settings.llm_backend`. Valid values:
        - "api"    -> Anthropic Claude Haiku 4.5 (fast, network-bound)
        - "local"  -> Qwen2.5-3B + drone_qa LoRA (offline, slower)
        - "ollama" -> the original Ollama HTTP path (legacy fallback)
    Pass None to fall back to the env-configured default.
    """
    settings = get_settings()
    chosen = (backend or settings.llm_backend or "local").lower()
    if role == "admin":
        system_prompt = SYSTEM_AR if language == "ar" else SYSTEM_EN
        context = _build_context(db, language)
    else:
        system_prompt = VIEWER_SYSTEM_AR if language == "ar" else VIEWER_SYSTEM_EN
        context = _build_viewer_context(db)

    # Pre-compute a grounded fact for any (region + month/year) question.
    # If the resolver returns a string, we hand it to the LLM as the
    # authoritative answer for this turn — the model just reformats it
    # into natural Arabic/English. This bypasses Gemini Flash\'s
    # multi-hop lookup failure where it can\'t reliably chain
    # Arabic question -> English region -> numeric month -> table row.
    # Model-identity question? Short-circuit with a backend-aware answer
    # before falling through to the attack-data resolver.
    if _is_model_question(message):
        grounded = (
            "GROUNDED FACT (model identity): The user asked which LLM "
            "powers Sanad. Reply with this exact text (do NOT add other "
            f"text): {_backend_description(chosen, language)}"
        )
    elif (forecast_fact := _resolve_forecast_query(db, message)) is not None:
        grounded = forecast_fact
    else:
        grounded = _resolve_attack_query(message, _attacks_df(db), history)
    fact_block = ""
    if grounded:
        log.info("Resolver grounded fact: %s", grounded)
        fact_block = (
            "\n\n=== AUTHORITATIVE PRE-COMPUTED ANSWER ===\n"
            + grounded
            + "\n\nWhen a GROUNDED FACT line is present above, that is the\n"
            + "definitive answer for this turn. State the number in natural\n"
            + "language in the user\'s language. Do NOT scan any table; do\n"
            + "NOT say \"no record\" or \"unavailable\" if the GROUNDED FACT\n"
            + "gives a number (including zero — say \"no attacks on record\"\n"
            + "for zero, not a refusal)."
        )
    system_text = system_prompt + fact_block + "\n\n" + context

    messages: list[dict[str, str]] = [{"role": "system", "content": system_text}]
    for turn in history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": message})

    # Branch on backend selection. The `local` path runs Qwen2.5-3B + LoRA
    # in-process via transformers + peft (slower but self-contained); the
    # `api` path calls Anthropic Claude Haiku (fast, requires API key);
    # the `ollama` path keeps the original HTTP-to-Ollama wiring.
    if chosen == "api":
        import asyncio
        from app.services import gemini_llm
        try:
            answer = await asyncio.get_event_loop().run_in_executor(
                None, lambda: gemini_llm.generate(messages)
            )
            answer = answer.strip() or "(empty response)"
            return answer, f"gemini:{settings.gemini_model}"
        except gemini_llm.GeminiNotConfigured as e:
            msg = (
                "مفتاح Google API غير مضبوط. احصل على مفتاح مجاني من "
                "https://aistudio.google.com/app/apikey وأضفه في ملف .env."
                if language == "ar"
                else "Google API key is not configured. Get a free key at "
                "https://aistudio.google.com/app/apikey and add it to .env."
            )
            return f"{msg} ({e})", "gemini"
        except Exception as e:  # noqa: BLE001
            log.exception("Gemini API call failed.")
            msg = (
                "تعذّر الاتصال بـ Gemini API. تحقق من المفتاح وحالة الشبكة."
                if language == "ar"
                else "Gemini API call failed. Check the key and network."
            )
            return f"{msg} ({e})", "gemini"

    if chosen == "local":
        import asyncio
        from app.services import local_llm
        try:
            # model.generate is blocking — push to a thread so the FastAPI
            # event loop stays responsive.
            answer = await asyncio.get_event_loop().run_in_executor(
                None, lambda: local_llm.generate(messages)
            )
            answer = answer.strip() or "(empty response)"
            return answer, f"{settings.llm_base_model}+lora"
        except Exception as e:  # noqa: BLE001
            log.exception("Local LLM call failed.")
            msg = (
                "تعذّر تحميل النموذج المحلي. تحقق من مسار LoRA أو بدّل LLM_BACKEND إلى ollama."
                if language == "ar"
                else "Local LLM failed to load. Check the LoRA path or switch LLM_BACKEND to ollama."
            )
            return f"{msg} ({e})", "local"

    url = settings.ollama_url.rstrip("/") + "/api/chat"
    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.3},
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=120.0)) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
            answer = (data.get("message") or {}).get("content", "").strip() or "(empty response)"
            return answer, settings.ollama_model
    except httpx.HTTPError as e:
        log.exception("Ollama call failed.")
        msg = (
            "تعذّر الاتصال بنموذج Ollama المحلي. تأكد من تشغيل `ollama serve` وأن النموذج محمّل."
            if language == "ar"
            else "Could not reach the local Ollama server. Make sure `ollama serve` is running and the model is pulled."
        )
        return f"{msg} ({e})", settings.ollama_model
