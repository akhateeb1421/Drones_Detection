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


class ChatOut(BaseModel):
    answer: str
    model: str
