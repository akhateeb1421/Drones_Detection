"""Auth schemas."""

from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class LoginOut(BaseModel):
    token: str
    username: str
    role: str  # 'admin' | 'operator'
    expires_in_s: int


class MeOut(BaseModel):
    username: str
    role: str
