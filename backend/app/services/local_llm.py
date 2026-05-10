"""In-process LLM backend — Qwen2.5-3B + PEFT LoRA adapter.

Loaded lazily on first request and cached. The base model is downloaded
from HuggingFace the first time the service is touched; subsequent runs
hit the local HF cache. The LoRA adapter lives on disk at the path set
by `llm_lora_path` in settings.

Why this exists alongside the Ollama path:
- The drone-QA LoRA is a HuggingFace PEFT adapter (safetensors).
  Ollama only loads GGUF, so wiring the adapter to Ollama would mean a
  one-shot merge + GGUF conversion — extra tooling for the demo.
- transformers + peft loads the adapter directly. Slower at inference
  time on CPU than llama.cpp/Ollama, but no conversion pipeline and
  the chatbot output is identical.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Iterable

from app.core.config import get_settings

log = logging.getLogger(__name__)

_lock = threading.Lock()
_model = None
_tokenizer = None


def _resolve_lora_path() -> Path:
    """Resolve the LoRA adapter path. If relative, anchor at backend/."""
    settings = get_settings()
    p = Path(settings.llm_lora_path)
    if not p.is_absolute():
        p = (Path(__file__).resolve().parents[2] / p).resolve()
    return p


def _load() -> tuple[object, object]:
    """Load (base + adapter) once and cache. Subsequent calls return the cached pair."""
    global _model, _tokenizer
    if _model is not None and _tokenizer is not None:
        return _model, _tokenizer

    with _lock:
        if _model is not None and _tokenizer is not None:
            return _model, _tokenizer

        # Heavy imports kept inside the function so the worker can boot
        # without paying the transformers import cost when running with
        # llm_backend=ollama.
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModelForCausalLM

        settings = get_settings()
        adapter_dir = _resolve_lora_path()
        if not adapter_dir.is_dir():
            raise FileNotFoundError(
                f"LoRA adapter folder not found at {adapter_dir}. "
                f"Set LLM_LORA_PATH or LLM_BACKEND=ollama in your .env."
            )

        log.info("Loading tokenizer from %s", adapter_dir)
        tok = AutoTokenizer.from_pretrained(str(adapter_dir), trust_remote_code=True)
        ct_file = adapter_dir / "chat_template.jinja"
        if ct_file.is_file():
            tok.chat_template = ct_file.read_text(encoding="utf-8")
            log.info("Using saved chat_template.jinja from adapter folder")

        # Pick dtype + device explicitly. Letting accelerate decide via
        # device_map="auto" was offloading half the Qwen weights to the
        # meta device — PEFT then writes the LoRA into meta slots and the
        # whole thing silently turns into a no-op.
        if torch.cuda.is_available():
            dtype = torch.float16
            target_device = "cuda"
            log.info("CUDA detected: loading base + LoRA in FP16 on CUDA")
        else:
            # FP16 weights halve the RAM hit (~6 GB instead of ~12 GB)
            # which keeps everything in real CPU memory and avoids the
            # meta-device spill. Compute on CPU is still done in FP32 by
            # PyTorch's autocast so quality is unaffected.
            dtype = torch.float16
            target_device = "cpu"
            log.info("No CUDA: loading base + LoRA in FP16 on CPU")

        # Two-step explicit load — avoids the AutoPeftModel auto path that
        # hits a `base_model.model.model.model.embed_tokens` lookup against
        # a meta-device base. The fix is two-fold:
        #
        #   1. Load the base with `low_cpu_mem_usage=False` so all weights
        #      materialize on a real device before PEFT wraps. Meta-device
        #      tensors break PEFT's tied-weights walk.
        #   2. Untie word embeddings BEFORE wrapping. Qwen2.5-3B ships with
        #      `tie_word_embeddings=True`, and the tie-aware walk through
        #      the wrapped chain is what produces the 4-level `.model.`
        #      KeyError. Untying first sidesteps the walk entirely. The
        #      output quality is unaffected — the LM head was tied to
        #      embed_tokens at training time too.
        log.info(
            "Loading base %s (cold load: ~1-3 min on CPU, cached after)",
            settings.llm_base_model,
        )
        base = AutoModelForCausalLM.from_pretrained(
            settings.llm_base_model,
            torch_dtype=dtype,
            device_map={"": target_device},
            low_cpu_mem_usage=False,
            trust_remote_code=True,
        )
        if getattr(base.config, "tie_word_embeddings", False):
            log.info("Untying word embeddings before applying LoRA")
            base.config.tie_word_embeddings = False

        log.info("Applying LoRA adapter from %s", adapter_dir)
        m = PeftModelForCausalLM.from_pretrained(
            base,
            str(adapter_dir),
            is_trainable=False,
            torch_dtype=dtype,
        )
        m.eval()

        _model, _tokenizer = m, tok
        log.info("Local LLM ready.")
    return _model, _tokenizer


def warm_up() -> None:
    """Optional: trigger model load on app startup so the first user
    request doesn't pay the cold-load tax."""
    try:
        _load()
    except Exception as e:  # noqa: BLE001
        log.warning("Local LLM warm-up failed: %s", e)


def generate(messages: Iterable[dict], *, max_new_tokens: int | None = None,
             temperature: float | None = None, top_p: float | None = None) -> str:
    """Generate a reply for an OpenAI-style messages list.

    `messages` is a list of {"role": "system"|"user"|"assistant", "content": str}.
    Uses the tokenizer's `apply_chat_template` so the saved chat template
    decides exactly how Qwen sees the conversation.
    """
    import torch
    settings = get_settings()
    m, tok = _load()

    msgs = list(messages)
    # transformers >=4.45 defaults `apply_chat_template` to returning a
    # BatchEncoding dict instead of a bare tensor. Force the dict form so
    # we can pass attention_mask through to .generate() and avoid the
    # "BatchEncoding has no attribute 'shape'" path inside generation.
    enc = tok.apply_chat_template(
        msgs,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=True,
    )
    enc = {k: v.to(m.device) for k, v in enc.items()}
    input_ids = enc["input_ids"]
    prompt_len = input_ids.shape[-1]

    gen_kwargs = dict(
        max_new_tokens=max_new_tokens or settings.llm_max_new_tokens,
        temperature=temperature if temperature is not None else settings.llm_temperature,
        top_p=top_p if top_p is not None else settings.llm_top_p,
        do_sample=(temperature or settings.llm_temperature) > 0,
        pad_token_id=tok.eos_token_id,
    )

    with torch.no_grad():
        out = m.generate(**enc, **gen_kwargs)

    # Strip the prompt back out — `prompt_len` is the prompt token count.
    new_tokens = out[0][prompt_len:]
    return tok.decode(new_tokens, skip_special_tokens=True).strip()
