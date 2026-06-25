import os
import tempfile
from unittest.mock import patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("MEDIA_STORAGE_PATH", tempfile.mkdtemp(prefix="ancestry-test-auth-"))

from tests.conftest import *  # noqa: F401,F403


@pytest.mark.asyncio
async def test_persons_open_when_auth_disabled(async_client, monkeypatch):
    """No auth env vars set → /persons returns 200, not 401."""
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("AUTH_SECRET_KEY", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 200
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_persons_blocked_without_token(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_persons_accessible_with_api_key(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    monkeypatch.setenv("API_KEY", "sk-test-static")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get(
        "/api/v1/persons",
        headers={"Authorization": "Bearer sk-test-static"},
    )
    assert r.status_code == 200
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_persons_blocked_with_wrong_api_key(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    monkeypatch.setenv("API_KEY", "sk-test-static")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get(
        "/api/v1/persons",
        headers={"Authorization": "Bearer sk-wrong"},
    )
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_disabled(async_client, monkeypatch):
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/auth/status")
    assert r.status_code == 200
    assert r.json()["auth_enabled"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_enabled(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/auth/status")
    assert r.json()["auth_enabled"] is True
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_wrong_password(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "correct")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "wrong"})
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_correct_password(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "correct")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_returns_usable_jwt(async_client, monkeypatch):
    """Token from /login should grant access to a protected endpoint."""
    monkeypatch.setenv("AUTH_PASSWORD", "correct")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()

    login_r = await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    token = login_r.json()["access_token"]

    persons_r = await async_client.get(
        "/api/v1/persons",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert persons_r.status_code == 200
    get_settings.cache_clear()
