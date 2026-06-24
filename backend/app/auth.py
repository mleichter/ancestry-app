from typing import Optional
from fastapi import Header, HTTPException
from jose import JWTError, jwt
from app.config import get_settings


async def require_auth(authorization: Optional[str] = Header(None)) -> None:
    settings = get_settings()

    if not settings.auth_password and not settings.api_key:
        return  # auth disabled

    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    token = authorization.removeprefix("Bearer ").strip()

    if settings.api_key and token == settings.api_key:
        return

    if not settings.auth_secret_key:
        raise HTTPException(status_code=503, detail="AUTH_SECRET_KEY not configured")

    try:
        jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
