import os
import tempfile
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("MEDIA_STORAGE_PATH", tempfile.mkdtemp(prefix="ancestry-test-ai-"))

from tests.conftest import *  # noqa: F401,F403 — import async_client fixture

from app.services.ai_extractor import ExtractionResult, FieldResult

_ALL_NONE_FIELDS = {k: FieldResult(value=None, confidence="none") for k in [
    "first_name", "last_name", "birth_name", "gender",
    "date_of_birth", "place_of_birth", "date_of_death", "place_of_death",
    "nationality", "origin", "occupations", "biography",
]}

_FAKE_JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 100


@pytest.mark.asyncio
async def test_status_not_available(async_client):
    r = await async_client.get("/api/v1/ai/status")
    assert r.status_code == 200
    assert r.json()["available"] is False


@pytest.mark.asyncio
async def test_status_available(async_client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/ai/status")
    assert r.json()["available"] is True
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_extract_document_no_api_key(async_client):
    r = await async_client.post(
        "/api/v1/ai/extract-document",
        files={"file": ("test.jpg", _FAKE_JPG, "image/jpeg")},
    )
    assert r.status_code == 503
    assert r.json()["detail"] == "AI not configured"


@pytest.mark.asyncio
async def test_extract_document_bad_mime(async_client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post(
        "/api/v1/ai/extract-document",
        files={"file": ("test.docx", b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert r.status_code == 400
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_extract_document_happy_path(async_client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
    from app.config import get_settings
    get_settings.cache_clear()

    mock_result = ExtractionResult(
        fields={**_ALL_NONE_FIELDS, "first_name": FieldResult(value="Johann", confidence="high")},
        portrait_b64=None,
        document_type="passport",
    )

    with patch("app.routers.ai.extract_from_document", new=AsyncMock(return_value=mock_result)):
        r = await async_client.post(
            "/api/v1/ai/extract-document",
            files={"file": ("test.jpg", _FAKE_JPG, "image/jpeg")},
        )

    assert r.status_code == 200
    body = r.json()
    assert body["document_type"] == "passport"
    assert body["fields"]["first_name"]["value"] == "Johann"
    assert body["fields"]["first_name"]["confidence"] == "high"
    assert body["portrait_b64"] is None
    get_settings.cache_clear()
