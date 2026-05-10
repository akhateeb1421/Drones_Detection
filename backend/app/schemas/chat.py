"""Chatbot schemas."""

from pydantic import BaseModel


class ChatTurn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class ChatIn(BaseModel):
    message: str
    history: list[ChatTurn] = []
    language: str = "ar"  # 'ar' | 'en'
    role: str = "viewer"  # 'admin' | 'viewer'
    # Optional per-request backend override. None = use server default
    # (settings.llm_backend). The UI sends 'api' or 'local'.
    backend: str | None = None


class ChatOut(BaseModel):
    answer: str
    model: str
