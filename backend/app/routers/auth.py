from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from jose import jwt
from pydantic import BaseModel
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.get("/status", summary="Auth availability check")
async def auth_status():
    """Returns whether authentication is enabled on this server."""
    settings = get_settings()
    return {"auth_enabled": bool(settings.auth_password)}


@router.post("/login", response_model=TokenResponse, summary="Obtain a JWT")
async def login(body: LoginRequest):
    """Exchange the admin password for a 30-day JWT."""
    settings = get_settings()
    if not settings.auth_password or body.password != settings.auth_password:
        raise HTTPException(status_code=401, detail="Invalid password")
    if not settings.auth_secret_key:
        raise HTTPException(status_code=503, detail="AUTH_SECRET_KEY not configured")
    exp = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode(
        {"sub": "owner", "exp": exp},
        settings.auth_secret_key,
        algorithm="HS256",
    )
    return TokenResponse(access_token=token)
