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
    answer, model = await chatbot.ask(
        db,
        message=payload.message,
        history=payload.history,
        language=payload.language,
        role=role,
    )
    return ChatOut(answer=answer, model=model)
