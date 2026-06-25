import logging
from typing import Optional
from fastapi import Cookie, Header, HTTPException, Request
from jose import JWTError, jwt
from app.config import get_settings

logger = logging.getLogger(__name__)

COOKIE_NAME = "access_token"


async def require_auth(
    request: Request,
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> None:
    settings = get_settings()

    if not settings.auth_password and not settings.api_key:
        return  # auth disabled

    # API key via Bearer header (for scripts / API usage)
    if authorization and settings.api_key:
        token = authorization.removeprefix("Bearer ").strip()
        if token == settings.api_key:
            return

    # JWT via httpOnly cookie
    if access_token and settings.auth_secret_key:
        try:
            jwt.decode(access_token, settings.auth_secret_key, algorithms=["HS256"])
            return
        except JWTError:
            logger.warning("Invalid or expired JWT cookie from %s", request.client.host if request.client else "unknown")

    logger.warning("Unauthorized request to %s from %s", request.url.path, request.client.host if request.client else "unknown")
    raise HTTPException(status_code=401, detail="Authentication required")
