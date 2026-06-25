import os
import tempfile
from unittest.mock import patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("MEDIA_STORAGE_PATH", tempfile.mkdtemp(prefix="ancestry-test-auth-"))

from tests.conftest import *  # noqa: F401,F403


AUTH_ENV = {
    "AUTH_PASSWORD": "correct",
    "AUTH_SECRET_KEY": "deadbeef" * 8,
}


@pytest.mark.asyncio
async def test_persons_open_when_auth_disabled(async_client, monkeypatch):
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
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_persons_accessible_with_api_key(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
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
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
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
    data = r.json()
    assert data["auth_enabled"] is False
    assert data["authenticated"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_enabled_not_authenticated(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/auth/status")
    data = r.json()
    assert data["auth_enabled"] is True
    assert data["authenticated"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_wrong_password(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "wrong"})
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_sets_cookie(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    assert r.status_code == 200
    assert "access_token" in r.cookies
    body = r.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_cookie_grants_access(async_client, monkeypatch):
    """Cookie from /login should grant access to a protected endpoint."""
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()

    await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    # httpx test client automatically sends cookies from previous responses
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 200
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_logout_clears_cookie(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()

    await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    r = await async_client.post("/api/v1/auth/logout")
    assert r.status_code == 200
    # after logout, persons should be blocked again
    r2 = await async_client.get("/api/v1/persons")
    assert r2.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_authenticated_after_login(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()

    await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    r = await async_client.get("/api/v1/auth/status")
    data = r.json()
    assert data["auth_enabled"] is True
    assert data["authenticated"] is True
    get_settings.cache_clear()
