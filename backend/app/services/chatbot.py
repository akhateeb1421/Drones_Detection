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


SYSTEM_AR = """أنت مساعد ذكي متخصص في تحليل بيانات الدفاع ضد الطائرات المسيّرة.
لديك إمكانية الوصول للقراءة فقط إلى البيانات أدناه، والتي تشمل:
- إجمالي الصفوف ومصادرها (تاريخية، مُولّدة، حية)
- النطاق الزمني للبيانات
- توزيعات حسب المنطقة، نوع الهجوم، الموقع المستهدف
- توزيعات حسب الشهر ويوم الأسبوع
- عينة من 20 صفاً تاريخياً + 15 صفاً من أحدث الهجمات
- ملخص الكشوفات المباشرة في آخر 24 ساعة + عينة منها

تعليمات:
- أجب بالعربية فقط
- استخدم الأرقام والإحصائيات والصفوف الفعلية من البيانات أدناه
- إذا طُلب منك "عرض جزء من البيانات" أو "عينة" أو "أمثلة"، اعرض الصفوف الموجودة في القسم العينة كجدول أو قائمة
- إذا طُلب منك تحليل زمني (شهور، أيام، اتجاهات)، استخدم توزيع الشهور وأيام الأسبوع
- كن دقيقاً وموجزاً
- إذا سُئلت عن شيء غير موجود في البيانات أدناه، قل ذلك بوضوح
- لا تخترع أرقاماً
"""

SYSTEM_EN = """You are an AI analyst for a counter-drone defense system.
You have read-only access to the data block below, which includes:
- Total row counts by source (historical, synthetic, live)
- Full date range
- Distributions by region, attack_type, target_location
- Counts by month (last 24) and weekday
- A sample of 20 real historical rows + 15 most-recent rows
- Live-detections summary for the last 24h plus a sample

Rules:
- Reply in English only.
- Use the actual numbers and rows from the context below.
- If the user asks for a 'sample', 'examples', or 'part of the data', display the listed rows as a table or list.
- For temporal questions (months, weekdays, trends), use the per-month and per-weekday counts.
- Be concise and precise.
- If something is not in the data block below, say so plainly.
- Never fabricate numbers.
"""

# Restricted prompts for the non-admin "viewer" role: the assistant only
# answers high-level analytical questions. It must NOT reveal table or
# column names, primary keys, internal IDs, stream URLs, file paths, raw
# detection rows, or any other operational/structural information.
VIEWER_SYSTEM_AR = """أنت مساعد تحليلي للجمهور العام لمنظومة الدفاع ضد الطائرات المسيّرة.
يمكنك مشاركة الإحصائيات الإجمالية (الأرقام، الاتجاهات، التوزيعات الجغرافية والزمنية، عدد الكاميرات والمناطق الحساسة).

كيف تجيب:
1. اقرأ السؤال بعناية ثم ابحث عن الإجابة في كتلة البيانات أدناه.
2. إذا وُجدت الإجابة (سواء صفر أم رقم آخر)، أعطها بشكل صريح ومختصر.
3. إذا كانت الإجابة "صفر" بشكل واضح من الجدول (مثلاً منطقة وشهر غير مذكورين معاً)، قل ذلك صراحة: "لا توجد هجمات مسجّلة" — لا ترفض الإجابة.
4. ارفض الإجابة فقط في الحالات التالية، باستخدام: "لا توجد بيانات متوفرة للإجابة على هذا السؤال في النطاق المتاح":
   - السؤال عن تاريخ خارج النطاق الزمني المذكور
   - السؤال عن معلومة لا تظهر إطلاقاً في كتلة البيانات
5. ارفض الأسئلة الخاصة بالإدارة (روابط البث، رموز إدارية، اقتراحات مواقع الكاميرات الجديدة، شفرة برمجية، أسماء جداول/أعمدة) برسالة: "هذه المعلومات متاحة للمسؤولين فقط".

ممنوع:
- اختراع أو تخمين أي رقم
- اختراع علاقات أو مرادفات بين أسماء المناطق (لا تقل "ينبع اسم آخر للرياض" مثلاً — كل منطقة قائمة بذاتها)
- ذكر أسماء جداول أو أعمدة أو معرّفات داخلية أو روابط بث

تعليمات:
- أجب بالعربية فقط
- كن مختصراً ودقيقاً
- استخدم الأرقام الموجودة في كتلة البيانات أدناه كما هي
"""

VIEWER_SYSTEM_EN = """You are a public-facing analyst for the counter-drone defense system.
You may share aggregate statistics — totals, trends, geographic/temporal distributions, total camera count, total sensitive-area count.

How to answer:
1. Read the question carefully, then look for the answer inside the data block below.
2. If the answer is present (zero or any other number), state it plainly and concisely.
3. If the answer is clearly zero from the table (e.g. a (region, month) pair not listed in the cross-tab), say "No attacks on record" — do NOT refuse.
4. ONLY refuse, with the exact phrase "No data is available for that query in the covered range.", when:
   - The question targets a date outside the stated date range, OR
   - The information genuinely does not appear anywhere in the data block.
5. Refuse admin questions (stream URLs, admin tokens, suggested new camera placements, code, table/column names) with: "That information is admin-only."

Forbidden:
- Inventing or guessing any number.
- Inventing aliases or equivalences between regions (NEVER say "Yanbu is an alias of Riyadh" — every region is distinct).
- Mentioning table names, column names, internal IDs, or stream URLs.

Rules:
- Reply in English only.
- Be concise and precise.
- Use the numbers in the data block exactly as written.
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
    lines.append("=== SYSTEM TOTALS ===")
    lines.append(f"Total cameras configured: {len(n_cameras)}")
    lines.append(f"Total sensitive areas configured: {len(n_areas)}")
    lines.append("")
    lines.append("=== AGGREGATE STATISTICS ===")
    if attacks.empty:
        lines.append("No attack records on file.")
        lines.append("Available date range: NONE — refuse any temporal question.")
    else:
        dmin = attacks["occurred_at"].min().date()
        dmax = attacks["occurred_at"].max().date()
        lines.append(f"Total attack records: {len(attacks)}")
        lines.append(f"Available date range: {dmin} to {dmax} (inclusive).")
        lines.append(
            "Any date BEFORE the start or AFTER the end of that range is out of bounds; "
            "for those, refuse. Dates INSIDE that range (or partial overlaps like 'in 2026') "
            "ARE answerable from the per-(region, month) table further below."
        )
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
        # Keep it compact: only non-zero cells, sorted by month then region.
        region_month = (
            a2.groupby(["region", "month"]).size().reset_index(name="count")
            .sort_values(["month", "region"])
        )
        if not region_month.empty:
            lines.append("")
            lines.append("Per-region per-month attack counts (only non-zero):")
            lines.append("region | month | attacks")
            for _, r in region_month.iterrows():
                lines.append(f"- {r['region']} | {r['month']} | {int(r['count'])}")
            lines.append(
                "Any (region, month) pair NOT listed above (within the date range) "
                "has zero attacks — answer 'no attacks on record', NOT a refusal."
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
    system_text = system_prompt + "\n\n" + context

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
