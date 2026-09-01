"""Chatbot endpoint. The caller's role is derived SERVER-SIDE from their
authentication — the request body's legacy `role` field is ignored, so an
operator can no longer claim admin and receive the admin data context."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import AuthUser, require_admin, require_user
from app.schemas.chat import ChatIn, ChatOut
from app.services import chatbot

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatOut)
async def chat(
    payload: ChatIn,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_user),
) -> ChatOut:
    # SECURITY: role comes from the authenticated identity, never from the
    # request body. payload.role is kept in the schema only for backwards
    # compatibility with older clients and is deliberately unused.
    role = "admin" if user.role == "admin" else "viewer"
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
    _: AuthUser = Depends(require_admin),
) -> dict:
    """Return the exact text block the chat service would send to the LLM.

    Admin-only: the admin context includes operational data that the
    viewer role must not see, so this diagnostic requires the admin role.
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
