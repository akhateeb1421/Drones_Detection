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
from app.models import Attack, Detection
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


async def ask(
    db: Session,
    *,
    message: str,
    history: list[ChatTurn],
    language: str = "ar",
) -> tuple[str, str]:
    settings = get_settings()
    system_text = (SYSTEM_AR if language == "ar" else SYSTEM_EN) + "\n\n" + _build_context(db, language)

    messages: list[dict[str, str]] = [{"role": "system", "content": system_text}]
    for turn in history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": message})

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
