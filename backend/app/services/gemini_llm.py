"""Google Gemini API backend — gemini-2.0-flash.

Used by the chatbot when the request specifies backend="api". Google AI
Studio offers a generous free tier (no credit card required), so this is
the default cloud path for the project.

Gemini's API differs from OpenAI/Anthropic in two ways we have to handle:
  1. The system prompt is passed as `system_instruction` in the config,
     NOT as a message with role="system".
  2. Chat history uses role="user" / role="model" — "assistant" must be
     mapped to "model" before posting.
"""
from __future__ import annotations

import logging
from typing import Iterable

from app.core.config import get_settings

log = logging.getLogger(__name__)


class GeminiNotConfigured(RuntimeError):
    """Raised when GOOGLE_API_KEY is missing — surfaced to the chat UI."""


def generate(messages: Iterable[dict]) -> str:
    """Generate a reply for an OpenAI-style messages list via Gemini."""
    settings = get_settings()
    if not settings.google_api_key:
        raise GeminiNotConfigured(
            "GOOGLE_API_KEY is not set in .env — grab a free key at "
            "https://aistudio.google.com/app/apikey and restart uvicorn."
        )

    # Heavy import kept inside the call so the worker boots without
    # paying the SDK import cost when the user never selects API mode.
    from google import genai
    from google.genai import types

    msgs = list(messages)
    system_chunks: list[str] = []
    chat_msgs: list[dict] = []
    for m in msgs:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            system_chunks.append(content)
        elif role == "user":
            chat_msgs.append({"role": "user", "parts": [{"text": content}]})
        elif role == "assistant":
            # Gemini calls the assistant role "model".
            chat_msgs.append({"role": "model", "parts": [{"text": content}]})

    if not chat_msgs or chat_msgs[-1]["role"] != "user":
        raise ValueError("gemini_llm.generate: expected the last message to be user-role.")

    # Explicit short timeout. The SDK default lets a hung request sit
    # past the frontend's 90 s axios timeout, leaving the operator with
    # an opaque error. 45 s is generous for Gemini Flash on a healthy
    # connection; if it times out, that's a real network/quota problem
    # the operator should see, not buffered silently.
    client = genai.Client(
        api_key=settings.google_api_key,
        http_options=types.HttpOptions(timeout=45_000),  # ms
    )
    sys_chars = sum(len(s) for s in system_chunks)
    log.info(
        "Calling Gemini %s (system=%d chars, msgs=%d)",
        settings.gemini_model, sys_chars, len(chat_msgs),
    )

    # Disable Gemini 2.5's internal "thinking" pass. Without this, every
    # call burns several seconds of reasoning tokens before any output
    # token appears — on a system prompt this large that pushes total
    # latency past 45 s and the request hits the SDK timeout. For 2.0
    # and 1.5 models thinking_config is silently ignored, so this is
    # safe across the board.
    config = types.GenerateContentConfig(
        system_instruction="\n\n".join(system_chunks) if system_chunks else None,
        max_output_tokens=settings.gemini_max_tokens,
        temperature=0.3,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    import time
    t0 = time.time()
    resp = client.models.generate_content(
        model=settings.gemini_model,
        contents=chat_msgs,
        config=config,
    )
    dt = time.time() - t0
    out = (resp.text or "").strip()
    log.info("Gemini call took %.2fs, %d output chars", dt, len(out))

    # `.text` concatenates all text parts of the first candidate.
    return out
