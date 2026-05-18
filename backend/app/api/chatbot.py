"""Chatbot endpoint backed by a local Ollama LLM."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.chat import ChatIn, ChatOut
from app.services import chatbot

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatOut)
async def chat(payload: ChatIn, db: Session = Depends(get_db)) -> ChatOut:
    # Only "admin" and "viewer" are accepted; anything else collapses to viewer.
    role = payload.role if payload.role in {"admin", "viewer"} else "viewer"
    # Restrict backend to known values; anything else falls back to default.
    backend = payload.backend if payload.backend in {"api", "local", "ollama"} else None
    answer, model = await chatbot.ask(
        db,
        message=payload.message,
        history=payload.history,
        language=payload.language,
        role=role,
        backend=backend,
    )
    return ChatOut(answer=answer, model=model)


@router.get("/debug-context")
def debug_context(
    role: str = "viewer",
    language: str = "ar",
    db: Session = Depends(get_db),
) -> dict:
    """Return the exact text block the chat service would send to the LLM.

    Hit `/chat/debug-context?role=viewer&language=ar` to see what data
    is actually in front of the model. If Al-Jouf June 2025 doesn\'t
    appear in the per-(region,month) table here, the chatbot is right
    to say "no record" — the rows aren\'t reaching the prompt. The
    fix would then be in `_build_viewer_context` / the DB, not the
    chatbot.
    """
    role = role if role in {"admin", "viewer"} else "viewer"
    if role == "admin":
        text = chatbot._build_context(db, language)
    else:
        text = chatbot._build_viewer_context(db)
    return {
        "role": role,
        "language": language,
        "chars": len(text),
        "context": text,
    }

