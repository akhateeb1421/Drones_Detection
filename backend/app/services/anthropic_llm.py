"""Deprecated — Anthropic Claude path was replaced by gemini_llm.py.

Kept as an empty stub so any stale imports fail loudly with a clear
message instead of silently breaking. The chatbot now uses
`gemini_llm.generate(...)` for the cloud "API" path.
"""

raise ImportError(
    "anthropic_llm has been removed. Use app.services.gemini_llm instead."
)
