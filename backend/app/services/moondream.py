"""Local VLM service — describes pending-track thumbnails in one sentence.

Despite the historical filename `moondream.py`, this module now wraps
**BLIP** (Salesforce/blip-image-captioning-base) instead of Moondream2.
We made the swap after Moondream's HuggingFace runtime kept breaking on
Windows due to:
  • a hard `pyvips` import (requires libvips system DLLs)
  • per-revision incompatibilities with newer `transformers` versions
  • dynamic `trust_remote_code` loading that can't be pinned reliably

BLIP solves all three: it's a first-class `transformers` model (no
remote code download, no system libs), the wheels we already have
(transformers + torch + pillow) are sufficient, and the public API
of this module is unchanged so `detections.py` keeps working.

Public API (stable):
  • describe_thumbnail(track_id, thumbnail_path, jpeg_bytes) -> str | None
  • cache_stats() -> dict   # diagnostic

Threading model:
  • Single ThreadPoolExecutor worker so a flood of new tracks can't
    spawn N PyTorch jobs concurrently.
  • Module-level `_load_lock` so the first concurrent calls don't all
    try to download weights simultaneously.
  • `_pending_lock` so we never enqueue the same (track, thumb) twice.

Failure modes (all silent, never crash the caller):
  • BLIP weights can't download → `_load_failed = True` sticky; calls
    return None and the row keeps showing the loading placeholder.
  • Individual inference raises → logged + cached as a fixed string so
    we don't retry the same image forever.
"""

from __future__ import annotations

import concurrent.futures
import io
import logging
import threading
import time
from typing import Optional

log = logging.getLogger(__name__)

# Module-level singletons. The lock prevents the first burst of
# concurrent requests from each kicking off their own model download.
_load_lock = threading.Lock()
_model = None
_processor = None
_load_failed = False  # sticky: once we've established the model can't load, stop retrying.

# (track_id, thumbnail_path) -> caption string. Same path for the same
# track gives the same caption, so we generate once and cache forever.
_cache: dict[tuple[int, str], str] = {}
_pending: set[tuple[int, str]] = set()
_pending_lock = threading.Lock()

# Single-worker pool: caption inference is CPU-bound and slow. We
# serialise so a backlog of new tracks can't peg every CPU core.
_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="vlm"
)


def _try_load() -> bool:
    """Lazily import + load BLIP. Returns True on success.

    Sticky failure: if anything goes wrong we set `_load_failed=True`
    so subsequent calls return immediately instead of re-trying the
    failed import on every poll.
    """
    global _model, _processor, _load_failed
    if _model is not None:
        return True
    if _load_failed:
        return False
    with _load_lock:
        if _model is not None:
            return True
        if _load_failed:
            return False
        try:
            # Heavy imports inside the function so uvicorn boots fast.
            from transformers import (  # noqa: E402
                BlipForConditionalGeneration,
                BlipProcessor,
            )

            model_id = "Salesforce/blip-image-captioning-base"
            log.info(
                "Loading BLIP captioning model (%s) — first run downloads ~990 MB.",
                model_id,
            )
            t0 = time.time()
            _processor = BlipProcessor.from_pretrained(model_id)
            _model = BlipForConditionalGeneration.from_pretrained(model_id)
            try:
                _model.eval()
            except Exception:  # noqa: BLE001
                pass
            log.info("BLIP ready in %.1f s.", time.time() - t0)
            return True
        except Exception:  # noqa: BLE001
            log.exception(
                "BLIP failed to load — pending-approvals descriptions "
                "will stay empty. Check network access to "
                "huggingface.co and disk space in the HF cache."
            )
            _load_failed = True
            return False


def _describe_bytes(jpeg_bytes: bytes) -> Optional[str]:
    """Run a single inference. Synchronous; expects to be on a worker
    thread (PyTorch is blocking). Returns None on any failure."""
    if not _try_load():
        return None
    try:
        # Imports kept inside the function so a missing optional dep
        # surfaces as a logged exception rather than a uvicorn boot fail.
        import torch  # noqa: E402
        from PIL import Image  # noqa: E402

        image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        inputs = _processor(image, return_tensors="pt")
        # no_grad keeps inference memory + latency down. Beam search of
        # 3 gives noticeably better captions than greedy for a tiny
        # cost; max_new_tokens=40 caps long-tail rambling.
        with torch.no_grad():
            ids = _model.generate(
                **inputs,
                max_new_tokens=40,
                num_beams=3,
                no_repeat_ngram_size=2,
            )
        text = _processor.decode(ids[0], skip_special_tokens=True).strip()
        if len(text) > 220:
            text = text[:217].rstrip() + "..."
        return text or None
    except Exception:  # noqa: BLE001
        log.exception("BLIP inference failed for one image.")
        return None


def _bg_generate(key: tuple[int, str], jpeg_bytes: bytes) -> None:
    """Worker entry: produce the caption and stash it in the cache."""
    try:
        desc = _describe_bytes(jpeg_bytes)
        if desc:
            _cache[key] = desc
        elif _load_failed:
            # Sticky load failure — surface the most useful single hint.
            _cache[key] = "(VLM model failed to load — see server log)"
        else:
            # Model loaded but this particular inference returned nothing.
            _cache[key] = "(no description — inference returned empty)"
    finally:
        with _pending_lock:
            _pending.discard(key)


def describe_thumbnail(track_id: int, thumbnail_path: str, jpeg_bytes: bytes) -> Optional[str]:
    """Public API used by `/detections/tracks`.

    Returns:
      • the cached caption when we've already generated one,
      • None on the first call (kicks off background generation;
        the next poll will see a value),
      • a "(...)" sentinel string if generation failed.

    Never raises — designed to be called inline in a hot endpoint.
    """
    if not jpeg_bytes or not thumbnail_path:
        return None
    key = (track_id, thumbnail_path)
    cached = _cache.get(key)
    if cached is not None:
        return cached
    with _pending_lock:
        if key in _pending:
            return None
        _pending.add(key)
    try:
        _executor.submit(_bg_generate, key, jpeg_bytes)
    except Exception:  # noqa: BLE001
        with _pending_lock:
            _pending.discard(key)
        log.exception("Failed to submit VLM caption task.")
        return None
    return None


def cache_stats() -> dict:
    """Diagnostic — call from /detections/debug if you want it."""
    with _pending_lock:
        pending = len(_pending)
    return {
        "loaded": _model is not None,
        "load_failed": _load_failed,
        "cached_descriptions": len(_cache),
        "pending_jobs": pending,
    }
