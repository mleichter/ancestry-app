import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Response
from jose import JWTError, jwt
from pydantic import BaseModel
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days


class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.get("/status", summary="Auth availability check")
async def auth_status(request: Request):
    """Returns whether authentication is enabled and whether the current session is authenticated."""
    settings = get_settings()
    auth_enabled = bool(settings.auth_password)
    authenticated = False

    if auth_enabled and settings.auth_secret_key:
        token = request.cookies.get(COOKIE_NAME)
        if token:
            try:
                jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
                authenticated = True
            except JWTError:
                pass

        if not authenticated and settings.api_key:
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer ") and auth_header[7:] == settings.api_key:
                authenticated = True

    return {"auth_enabled": auth_enabled, "authenticated": authenticated}


@router.post("/login", response_model=TokenResponse, summary="Obtain a JWT")
async def login(body: LoginRequest, response: Response):
    """Exchange the admin password for a JWT stored in an httpOnly cookie."""
    settings = get_settings()
    if not settings.auth_password or body.password != settings.auth_password:
        logger.warning("Failed login attempt with wrong password")
        raise HTTPException(status_code=401, detail="Invalid password")
    if not settings.auth_secret_key:
        raise HTTPException(status_code=503, detail="AUTH_SECRET_KEY not configured")
    exp = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode(
        {"sub": "owner", "exp": exp},
        settings.auth_secret_key,
        algorithm="HS256",
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        secure=False,  # set to True when serving over HTTPS
        max_age=COOKIE_MAX_AGE,
    )
    return TokenResponse(access_token=token)


@router.post("/logout", summary="Invalidate session cookie")
async def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME, samesite="strict")
    return {"detail": "logged out"}
