"""Chatbot service backed by a local Ollama LLM.

Builds a dashboard-shaped context block — same analytics the React UI
already shows the user — and sends it to Ollama as the system prompt.
The LLM has read-only context, no tools, and cannot mutate the DB.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import analysis as analysis_api
from app.api.predictions import camera_placements as camera_placements_api
from app.core.config import get_settings
from app.models import Attack, Camera, Detection, SensitiveArea, Track
from app.schemas.chat import ChatTurn
from app.services import classifier, forecaster

log = logging.getLogger(__name__)


COMMON_RULES_AR = """قواعد دائمة:
- أجب بالعربية فقط، باختصار ودقة.
- استخدم الأرقام والقيم كما هي مذكورة في كتلة "لوحة التحكم" أدناه.
- لا تخترع أي رقم ولا تخمّن.
- لا تخترع علاقات أو مرادفات بين أسماء المناطق (كل منطقة قائمة بذاتها).
- لا تذكر أسماء الجداول أو الأعمدة أو معرّفات داخلية أو روابط البث.
- إذا لم تكن المعلومة موجودة في كتلة لوحة التحكم، قل ذلك صراحة بدلاً من التخمين.
"""

COMMON_RULES_EN = """Persistent rules:
- Reply in English only, concisely and precisely.
- Use the numbers and values exactly as written in the DASHBOARD block below.
- Never invent or guess a number.
- Never invent aliases or equivalences between region names (every region is distinct).
- Never mention table names, column names, internal IDs, or stream URLs.
- If a fact is not in the dashboard block, say so plainly instead of guessing.
"""


SYSTEM_AR = """أنت مساعد ذكي للوحة تحكم نظام الدفاع ضد الطائرات المسيّرة.
دورك: الإجابة عن أسئلة المسؤول حول كل ما تظهره لوحة التحكم.

ما تراه في كتلة "لوحة التحكم": أقسام تطابق علامات التبويب التي يراها المسؤول
- نظرة عامة (الإجماليات، التوزيع حسب المنطقة، أنواع الهجمات، الهجمات المركّبة)
- الكشف المباشر (الكاميرات، عدد كشوفات الانتظار)
- خريطة الهجمات (نطاق التواريخ والملخص)
- التحليلات (السلسلة الشهرية، تقييم المخاطر، التوقعات)
- اقتراح مواقع الكاميرات
- الكاميرات المُعدّة والمناطق الحساسة المُعدّة

""" + COMMON_RULES_AR

SYSTEM_EN = """You are an AI assistant for the counter-drone defense dashboard.
Your role: answer the admin's questions about anything the dashboard shows.

The DASHBOARD block below mirrors the admin sidebar tabs:
- Overview (totals, by-region, attack types, combined attacks)
- Live Detection (cameras, pending-approvals count)
- History Map (date range and summary)
- Analysis (monthly timeline, risk scores, forecast)
- Camera Placement suggestions
- Configured Cameras and Sensitive Areas

""" + COMMON_RULES_EN


VIEWER_SYSTEM_AR = """أنت مساعد تحليلي عام للوحة تحكم نظام الدفاع ضد الطائرات المسيّرة.
دورك: الإجابة عن أسئلة المشغّل حول الأقسام العامة التي يراها على الشاشة.

ما تراه في كتلة "لوحة التحكم": أقسام تطابق ما يظهر للمشغّل فقط
- نظرة عامة (الإجماليات، التوزيع حسب المنطقة، أنواع الهجمات، الهجمات المركّبة)
- الكشف المباشر (إجمالي الكاميرات والمناطق الحساسة، عدد كشوفات الانتظار)
- خريطة الهجمات (نطاق التواريخ والملخص)
- التحليلات (السلسلة الشهرية، التوقعات)

ممنوع: مناقشة إعدادات الكاميرات (روابط البث، الإحداثيات الدقيقة)، اقتراحات مواقع الكاميرات الجديدة، أو أي معلومة لا تظهر في كتلة لوحة التحكم. ارفض الأسئلة الإدارية بـ: "هذه المعلومات متاحة للمسؤولين فقط".

""" + COMMON_RULES_AR

VIEWER_SYSTEM_EN = """You are a public-facing analyst for the counter-drone defense dashboard.
Your role: answer the operator's questions about the public sections they see on screen.

The DASHBOARD block below mirrors the operator's tabs only:
- Overview (totals, by-region, attack types, combined attacks)
- Live Detection (total cameras and sensitive areas, pending-approvals count)
- History Map (date range and summary)
- Analysis (monthly timeline, forecast)

Forbidden: discussing camera configuration (stream URLs, exact coordinates), suggested NEW camera placements, or anything that doesn't appear in the dashboard block. Refuse admin questions with: "That information is admin-only."

""" + COMMON_RULES_EN


def _section_overview(db: Session) -> str:
    totals = analysis_api.total(db)
    by_region = analysis_api.by_region_pure(db)
    by_type = analysis_api.by_type(db)
    combined = analysis_api.combined(db)

    out: list[str] = []
    out.append("## OVERVIEW (the Overview page)")
    out.append(
        f"- Total attack events: {totals['events']} (rows={totals['rows']}, "
        f"historical={totals['rows_historical']}, synthetic={totals['rows_synthetic']}, "
        f"live={totals['rows_live']})"
    )
    out.append(f"- Regions affected: {len(by_region)}")
    out.append("- Distribution by region (the pie chart):")
    for r in by_region:
        out.append(f"    * {r.region}: {r.count}")
    out.append("- Attacks by type (the bar chart):")
    for tp in by_type:
        out.append(f"    * {tp.attack_type}: {tp.count}")
    if combined:
        out.append("- Combined attacks (rows hit on the same day):")
        for c in combined[:20]:
            out.append(f"    * {c['label']}: {c['count']}")
    else:
        out.append("- Combined attacks: none.")
    return "\n".join(out)


def _section_live(db: Session, *, admin: bool) -> str:
    n_cameras = db.execute(select(func.count(Camera.id))).scalar_one() or 0
    n_areas = db.execute(select(func.count(SensitiveArea.id))).scalar_one() or 0
    n_pending = db.execute(
        select(func.count(Track.id)).where(Track.status == "pending")
    ).scalar_one() or 0
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    n_dets_24h = db.execute(
        select(func.count(Detection.id)).where(Detection.captured_at >= cutoff)
    ).scalar_one() or 0
    n_alarms_24h = db.execute(
        select(func.count(Track.id)).where(
            Track.alarm_fired_at.is_not(None),
            Track.alarm_fired_at >= cutoff,
        )
    ).scalar_one() or 0

    out: list[str] = []
    out.append("## LIVE DETECTION (the Live page)")
    out.append(f"- Total cameras configured: {n_cameras}")
    out.append(f"- Total sensitive areas configured: {n_areas}")
    out.append(f"- Pending approvals (operator review queue): {n_pending}")
    out.append(f"- Detections in the last 24 hours: {n_dets_24h}")
    out.append(f"- Alarms fired in the last 24 hours: {n_alarms_24h}")
    if admin:
        out.append("")
        out.append("Recent pending tracks (latest 10):")
        rows = db.execute(
            select(Track).where(Track.status == "pending")
            .order_by(Track.last_seen_at.desc()).limit(10)
        ).scalars().all()
        if not rows:
            out.append("- (none)")
        for tr in rows:
            eta = f"{tr.min_eta_s:.1f}s" if tr.min_eta_s is not None else "—"
            out.append(
                f"- track #{tr.track_id} | class={tr.voted_class or '?'} | "
                f"nearest={tr.nearest_area or '?'} | min_eta={eta} | "
                f"alarm_fired={'yes' if tr.alarm_fired_at else 'no'}"
            )
    return "\n".join(out)


def _section_history(db: Session) -> str:
    rows = db.execute(
        select(func.min(Attack.occurred_at), func.max(Attack.occurred_at), func.count(Attack.id))
    ).one()
    dmin, dmax, total = rows
    out: list[str] = []
    out.append("## HISTORY MAP (the History page)")
    if not total:
        out.append("- No historical attacks on file.")
        return "\n".join(out)
    out.append(f"- Available date range: {dmin.date()} to {dmax.date()} (inclusive).")
    out.append(f"- Total mappable attack rows: {total}")
    out.append(
        "- Any date BEFORE the start or AFTER the end is out of range — refuse questions about those."
    )
    return "\n".join(out)


def _section_analysis(db: Session, *, admin: bool) -> str:
    out: list[str] = []
    out.append("## ANALYSIS (the Analysis page)")

    timeline = analysis_api.timeline(
        db, granularity="month", region=None, date_from=None, date_to=None
    )
    if timeline:
        out.append("- Monthly attack timeline (the timeline chart):")
        for tp in timeline:
            day = tp.period.split("T")[0] if tp.period else "?"
            out.append(f"    * {day[:7]}: {tp.count}")

    rows = db.execute(
        select(
            func.to_char(Attack.occurred_at, "YYYY-MM").label("month"),
            Attack.region,
            func.count(Attack.id),
        )
        .where(Attack.region.is_not(None))
        .where(~Attack.region.contains("+"))
        .group_by("month", Attack.region)
        .order_by("month", Attack.region)
    ).all()
    if rows:
        out.append("")
        out.append("- Per-region per-month attack counts (only non-zero pairs are listed):")
        out.append("    region | month | attacks")
        for month, region, n in rows:
            out.append(f"    - {region} | {month} | {int(n)}")
        out.append(
            "- Any (region, month) pair NOT listed above (within the date range) "
            "has zero attacks — answer 'no attacks on record', NOT a refusal."
        )

    try:
        fc = forecaster.forecast(db, region=None, days=30)
        if fc:
            out.append("")
            out.append("- 30-day attack forecast per region (the forecast chart):")
            agg: dict[str, float] = {}
            for f in fc:
                agg[f.region] = agg.get(f.region, 0.0) + (f.expected_count or 0.0)
            for region, total in sorted(agg.items(), key=lambda x: -x[1]):
                out.append(f"    * {region}: ~{total:.1f} expected over the next 30 days")
    except Exception as e:  # noqa: BLE001
        log.exception("Forecast unavailable for chatbot context.")
        out.append(f"- Forecast: unavailable ({e}).")

    if admin:
        try:
            risk = classifier.predict_all_regions(db, horizon_days=30)
            if risk:
                out.append("")
                out.append("- 30-day region-level risk scores (risk-assessment view):")
                for r in risk:
                    out.append(f"    * {r.region}: {r.risk_probability:.2f}")
        except Exception as e:  # noqa: BLE001
            log.exception("Risk model unavailable for chatbot context.")
            out.append(f"- Risk model: unavailable ({e}).")

    return "\n".join(out)


def _section_placement(db: Session) -> str:
    try:
        suggestions = camera_placements_api(
            db,
            radius_km=300.0,
            fov_h_deg=82.6,
            assumed_target_distance_m=5000.0,
            n_clusters=4,
            forward_offset=0.30,
            early_warning_km=15.0,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("Camera-placement suggestions unavailable for chatbot.")
        return f"## CAMERA PLACEMENT\n- unavailable ({e})."
    out: list[str] = []
    out.append("## CAMERA PLACEMENT (admin-only suggestions)")
    if not suggestions:
        out.append("- No suggestions yet (need attack history + sensitive areas).")
        return "\n".join(out)
    n_area = sum(1 for s in suggestions if s["kind"] == "area")
    n_fwd = sum(1 for s in suggestions if s["kind"] == "forward")
    out.append(f"- Suggestions: {n_area} per-area + {n_fwd} forward-observation.")
    for s in suggestions[:20]:
        out.append(
            f"    * [{s['kind']}] {s['name']} for {s['for_area']} | "
            f"heading {s['heading_deg']}° {s['heading_label']} | "
            f"covers {s['covers_attacks']} historical attacks"
        )
    return "\n".join(out)


def _section_cameras(db: Session) -> str:
    rows = db.execute(select(Camera).order_by(Camera.id)).scalars().all()
    out: list[str] = []
    out.append("## CONFIGURED CAMERAS (admin)")
    out.append(f"- Total: {len(rows)}")
    for c in rows[:20]:
        out.append(
            f"    * #{c.id} {c.name} | enabled={c.enabled} | "
            f"heading={c.heading_deg}° | fov_h={c.fov_h_deg}°"
        )
    return "\n".join(out)


def _section_areas(db: Session) -> str:
    rows = db.execute(select(SensitiveArea).order_by(SensitiveArea.id)).scalars().all()
    out: list[str] = []
    out.append("## CONFIGURED SENSITIVE AREAS (admin)")
    out.append(f"- Total: {len(rows)}")
    for a in rows[:30]:
        out.append(f"    * #{a.id} {a.name} | priority={a.priority}")
    return "\n".join(out)


def _build_admin_context(db: Session) -> str:
    parts = [
        "=== DASHBOARD (admin view) ===",
        _section_overview(db),
        _section_live(db, admin=True),
        _section_history(db),
        _section_analysis(db, admin=True),
        _section_placement(db),
        _section_cameras(db),
        _section_areas(db),
    ]
    return "\n\n".join(parts)


def _build_viewer_context(db: Session) -> str:
    parts = [
        "=== DASHBOARD (operator view) ===",
        _section_overview(db),
        _section_live(db, admin=False),
        _section_history(db),
        _section_analysis(db, admin=False),
    ]
    return "\n\n".join(parts)


async def ask(
    db: Session,
    *,
    message: str,
    history: list[ChatTurn],
    language: str = "ar",
    role: str = "viewer",
) -> tuple[str, str]:
    settings = get_settings()
    if role == "admin":
        system_prompt = SYSTEM_AR if language == "ar" else SYSTEM_EN
        context = _build_admin_context(db)
    else:
        system_prompt = VIEWER_SYSTEM_AR if language == "ar" else VIEWER_SYSTEM_EN
        context = _build_viewer_context(db)
    system_text = system_prompt + "\n\n" + context

    messages: list[dict[str, str]] = [{"role": "system", "content": system_text}]
    for turn in history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": message})

    url = settings.ollama_url.rstrip("/") + "/api/chat"
    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": False,
        # keep_alive tells Ollama to keep the model resident in RAM/VRAM so
        # subsequent calls don't pay the (slow) load cost.
        "keep_alive": settings.ollama_keep_alive,
        "options": {"temperature": 0.2},
    }

    # connect/write timeouts stay short; only the *read* timeout needs to be
    # generous because that's where the slow token streaming lives.
    timeout = httpx.Timeout(60.0, read=settings.ollama_timeout_s)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
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
