import os
import tempfile
from unittest.mock import patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("MEDIA_STORAGE_PATH", tempfile.mkdtemp(prefix="ancestry-test-auth-"))

from tests.conftest import *  # noqa: F401,F403


@pytest.mark.asyncio
async def test_persons_open_when_auth_disabled(async_client):
    """No auth env vars set → /persons returns 200, not 401."""
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 200


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
