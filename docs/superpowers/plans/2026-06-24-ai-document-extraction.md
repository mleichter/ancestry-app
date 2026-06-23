# AI Document Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered document scanning to the ancestry app — users upload a historical document photo, GPT-4o Vision extracts person fields and crops a portrait, and a review modal lets them selectively apply the results before anything is saved.

**Architecture:** New `app/services/ai_extractor.py` + `app/routers/ai.py` on the backend (no DB changes needed); shared `DocumentScanModal` React component that works in "patch" mode (PersonDetailPage, saves directly) and "prefill" mode (PersonFormPage, populates form fields and queues media for upload after save).

**Tech Stack:** Python `openai>=1.30.0` (AsyncOpenAI), Pillow (already installed), FastAPI multipart, React + TypeScript, Vitest, `@tanstack/react-query`, `react-hook-form`.

## Global Constraints

- All dates must be in `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` format — never any other format
- Only JPEG, PNG, WebP accepted for document uploads (match existing media router)
- No DB migrations — `MediaType.document` already exists in the enum
- UI copy is German throughout (match existing app language)
- Backend: Python 3.12, FastAPI, SQLAlchemy 2 async
- Frontend: React 18, TypeScript strict, Tailwind CSS dark-mode via `prefers-color-scheme`
- Every task ends with a commit

---

## File Map

**Backend — new files:**
- `app/services/ai_extractor.py` — `ExtractionResult`, `FieldResult`, `extract_from_document()`, `_normalize_date()`, `_crop_portrait()`, `_parse_result()`
- `app/routers/ai.py` — `GET /ai/status`, `POST /ai/extract-document`
- `tests/test_ai_extractor.py` — unit tests (pure functions + mocked OpenAI)
- `tests/test_ai_router.py` — endpoint tests (mocked extractor)

**Backend — modified files:**
- `app/config.py` — add `openai_api_key: Optional[str] = None`
- `app/main.py` — register `ai` router
- `app/routers/media.py` — add `POST /persons/{id}/media/document` endpoint; add `title` field to list response
- `pyproject.toml` — add `openai>=1.30.0` to runtime dependencies

**Frontend — new files:**
- `src/components/DocumentScanModal.tsx` — two-step modal (upload → review), exports `initialCheckedFields` for testing
- `src/components/__tests__/documentScanPrecheck.test.ts` — Vitest tests for pre-check logic

**Frontend — modified files:**
- `src/types/index.ts` — add `ExtractionResult`, `FieldResult`, `Confidence`, `PendingMedia`; add `title` to `MediaItem`
- `src/api/client.ts` — add `aiApi`; add `uploadDocument` to `mediaApi`; type `uploadPhoto` return
- `src/hooks/useSettings.ts` — add `ai_enabled: boolean` (default `true`)
- `src/pages/SettingsPage.tsx` — add KI-Analyse section
- `src/pages/PersonDetailPage.tsx` — "Dokument scannen" button; gallery tab split (Fotos/Dokumente)
- `src/pages/PersonFormPage.tsx` — "Aus Dokument füllen" button; `pendingMedia` state; post-save media upload

---

## Task 1: Backend config + openai dependency

**Files:**
- Modify: `app/config.py`
- Modify: `pyproject.toml`

**Interfaces:**
- Produces: `Settings.openai_api_key: str | None` — read by Task 2 and Task 3

- [ ] **Step 1: Add openai_api_key to config**

In `app/config.py`, add `Optional` import and the new field:

```python
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    media_storage_path: str = "/data/media"
    max_upload_size_mb: int = 20
    openai_api_key: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 2: Add openai to runtime dependencies in pyproject.toml**

In `pyproject.toml`, add to the `dependencies` list:

```toml
[project]
name = "ancestry-app"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "sqlalchemy[asyncio]>=2.0.0",
    "asyncpg>=0.29.0",
    "alembic>=1.13.0",
    "pydantic-settings>=2.3.0",
    "python-multipart>=0.0.9",
    "aiofiles>=23.2.0",
    "pillow>=10.0.0",
    "openai>=1.30.0",
]
```

- [ ] **Step 3: Install openai in the dev environment**

```bash
pip install --break-system-packages "openai>=1.30.0"
```

Expected: `Successfully installed openai-...` (no errors)

- [ ] **Step 4: Commit**

```bash
cd /project/src/ancestry-app/backend
git add app/config.py pyproject.toml
git commit -m "feat(ai): add openai_api_key config + openai dependency"
```

---

## Task 2: ai_extractor service + unit tests

**Files:**
- Create: `app/services/ai_extractor.py`
- Create: `tests/test_ai_extractor.py`

**Interfaces:**
- Consumes: `get_settings().openai_api_key` from Task 1
- Produces:
  - `class FieldResult` — `value: Any`, `confidence: str`
  - `class ExtractionResult` — `fields: dict[str, FieldResult]`, `portrait_b64: str | None`, `document_type: str | None`
  - `async def extract_from_document(image_bytes: bytes, mime_type: str) -> ExtractionResult`
  - `def _normalize_date(raw: str) -> str | None` (exported for tests)
  - `def _crop_portrait(image_bytes: bytes, bbox: list) -> str | None` (exported for tests)
  - `def _parse_result(data: dict, image_bytes: bytes) -> ExtractionResult` (exported for tests)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ai_extractor.py`:

```python
import base64
import io
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from PIL import Image

from app.services.ai_extractor import (
    ExtractionResult,
    FieldResult,
    _normalize_date,
    _crop_portrait,
    _parse_result,
    extract_from_document,
)

# ── helpers ──────────────────────────────────────────────────────────────────

def _make_image(width=200, height=300) -> bytes:
    img = Image.new("RGB", (width, height), color=(128, 64, 32))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()

def _empty_fields() -> dict:
    return {k: {"value": None, "confidence": "none"} for k in [
        "first_name", "last_name", "birth_name", "gender",
        "date_of_birth", "place_of_birth", "date_of_death", "place_of_death",
        "nationality", "origin", "occupations", "biography",
    ]}

# ── _normalize_date ──────────────────────────────────────────────────────────

def test_normalize_date_iso_full():
    assert _normalize_date("1892-03-15") == "1892-03-15"

def test_normalize_date_year_month():
    assert _normalize_date("1892-03") == "1892-03"

def test_normalize_date_year_only():
    assert _normalize_date("1892") == "1892"

def test_normalize_date_dotted():
    assert _normalize_date("15.03.1892") == "1892-03-15"

def test_normalize_date_german_month_name():
    assert _normalize_date("15 März 1892") == "1892-03-15"

def test_normalize_date_english_month_only():
    assert _normalize_date("March 1892") == "1892-03"

def test_normalize_date_invalid_returns_none():
    assert _normalize_date("unlesbar") is None

def test_normalize_date_empty_returns_none():
    assert _normalize_date("") is None

# ── _crop_portrait ──────────────────────────────────────────────────────────

def test_crop_portrait_returns_base64_jpeg():
    result = _crop_portrait(_make_image(200, 300), [10.0, 10.0, 50.0, 50.0])
    assert result is not None
    data = base64.b64decode(result)
    with Image.open(io.BytesIO(data)) as img:
        assert img.format == "JPEG"

def test_crop_portrait_out_of_bounds_clamped():
    result = _crop_portrait(_make_image(200, 300), [80.0, 80.0, 120.0, 120.0])
    assert result is not None

def test_crop_portrait_zero_area_returns_none():
    result = _crop_portrait(_make_image(200, 300), [50.0, 50.0, 50.0, 50.0])
    assert result is None

def test_crop_portrait_invalid_image_returns_none():
    result = _crop_portrait(b"not an image", [10.0, 10.0, 50.0, 50.0])
    assert result is None

# ── _parse_result ─────────────────────────────────────────────────────────────

def test_parse_result_extracts_fields():
    fields = _empty_fields()
    fields["first_name"] = {"value": "Johann", "confidence": "high"}
    fields["date_of_birth"] = {"value": "1892-03-15", "confidence": "medium"}
    data = {"document_type": "passport", "fields": fields, "portrait_bbox": None}
    result = _parse_result(data, _make_image())
    assert result.document_type == "passport"
    assert result.fields["first_name"].value == "Johann"
    assert result.fields["first_name"].confidence == "high"
    assert result.fields["date_of_birth"].value == "1892-03-15"
    assert result.portrait_b64 is None

def test_parse_result_normalizes_dotted_date():
    fields = _empty_fields()
    fields["date_of_birth"] = {"value": "15.03.1892", "confidence": "high"}
    data = {"document_type": None, "fields": fields, "portrait_bbox": None}
    result = _parse_result(data, _make_image())
    assert result.fields["date_of_birth"].value == "1892-03-15"
    assert result.fields["date_of_birth"].confidence == "high"

def test_parse_result_bad_date_downgrades_confidence():
    fields = _empty_fields()
    fields["date_of_birth"] = {"value": "unlesbar", "confidence": "high"}
    data = {"document_type": None, "fields": fields, "portrait_bbox": None}
    result = _parse_result(data, _make_image())
    assert result.fields["date_of_birth"].confidence == "low"

def test_parse_result_crops_portrait():
    data = {"document_type": "passport", "fields": _empty_fields(), "portrait_bbox": [10.0, 10.0, 40.0, 40.0]}
    result = _parse_result(data, _make_image(300, 400))
    assert result.portrait_b64 is not None

def test_parse_result_ignores_invalid_confidence():
    fields = _empty_fields()
    fields["first_name"] = {"value": "Test", "confidence": "nonsense"}
    data = {"document_type": None, "fields": fields, "portrait_bbox": None}
    result = _parse_result(data, _make_image())
    assert result.fields["first_name"].confidence == "none"

# ── extract_from_document ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_from_document_calls_openai(monkeypatch):
    fields = _empty_fields()
    fields["first_name"] = {"value": "Anna", "confidence": "high"}
    fields["last_name"] = {"value": "Schmidt", "confidence": "high"}
    fields["date_of_birth"] = {"value": "1901-07-04", "confidence": "high"}
    mock_content = json.dumps({
        "document_type": "passport",
        "fields": fields,
        "portrait_bbox": None,
    })
    mock_msg = MagicMock(); mock_msg.content = mock_content
    mock_choice = MagicMock(); mock_choice.message = mock_msg
    mock_completion = MagicMock(); mock_completion.choices = [mock_choice]
    mock_create = AsyncMock(return_value=mock_completion)

    with patch("app.services.ai_extractor.AsyncOpenAI") as mock_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create
        mock_cls.return_value = mock_client
        with patch("app.services.ai_extractor.get_settings") as mock_cfg:
            mock_cfg.return_value.openai_api_key = "sk-test"
            result = await extract_from_document(_make_image(), "image/jpeg")

    assert result.document_type == "passport"
    assert result.fields["first_name"].value == "Anna"
    assert mock_create.called
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /project/src/ancestry-app/backend
python3 -m pytest tests/test_ai_extractor.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError: No module named 'app.services.ai_extractor'`

- [ ] **Step 3: Create app/services/ai_extractor.py**

```python
import base64
import io
import json
import re
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI
from PIL import Image

from app.config import get_settings

PERSON_FIELDS = [
    "first_name", "last_name", "birth_name", "gender",
    "date_of_birth", "place_of_birth", "date_of_death", "place_of_death",
    "nationality", "origin", "occupations", "biography",
]
DATE_FIELDS = {"date_of_birth", "date_of_death"}
VALID_CONFIDENCES = {"high", "medium", "low", "none"}

_MONTH_NAMES = {
    "jan": "01", "january": "01", "januar": "01",
    "feb": "02", "february": "02", "februar": "02",
    "mar": "03", "march": "03", "märz": "03", "maerz": "03",
    "apr": "04", "april": "04",
    "may": "05", "mai": "05",
    "jun": "06", "june": "06", "juni": "06",
    "jul": "07", "july": "07", "juli": "07",
    "aug": "08", "august": "08",
    "sep": "09", "september": "09",
    "oct": "10", "october": "10", "oktober": "10",
    "nov": "11", "november": "11",
    "dec": "12", "december": "12", "dezember": "12",
}

_EXTRACTION_PROMPT = """\
You are an expert at reading historical identity documents in any language \
(German, French, Latin, English, etc.): passports, birth certificates, \
marriage certificates, death certificates.

Analyze the document image and extract all legible information. \
Return ONLY a single valid JSON object — no markdown, no explanation:

{
  "document_type": "passport"|"birth_certificate"|"marriage_certificate"|"death_certificate"|"other"|null,
  "fields": {
    "first_name":     {"value": "string|null", "confidence": "high|medium|low|none"},
    "last_name":      {"value": "string|null", "confidence": "high|medium|low|none"},
    "birth_name":     {"value": "string|null", "confidence": "high|medium|low|none"},
    "gender":         {"value": "male|female|other|unknown|null", "confidence": "high|medium|low|none"},
    "date_of_birth":  {"value": "YYYY|YYYY-MM|YYYY-MM-DD|null", "confidence": "high|medium|low|none"},
    "place_of_birth": {"value": "string|null", "confidence": "high|medium|low|none"},
    "date_of_death":  {"value": "YYYY|YYYY-MM|YYYY-MM-DD|null", "confidence": "high|medium|low|none"},
    "place_of_death": {"value": "string|null", "confidence": "high|medium|low|none"},
    "nationality":    {"value": "string|null", "confidence": "high|medium|low|none"},
    "origin":         {"value": "string|null", "confidence": "high|medium|low|none"},
    "occupations":    {"value": ["string"]|null, "confidence": "high|medium|low|none"},
    "biography":      {"value": "string|null", "confidence": "high|medium|low|none"}
  },
  "portrait_bbox": [x1_pct, y1_pct, x2_pct, y2_pct]|null
}

Rules:
- confidence "high": clearly readable, unambiguous
- confidence "medium": partially obscured or uncertain
- confidence "low": barely legible or inferred
- confidence "none": field not present — value must be null
- Dates must be in YYYY, YYYY-MM, or YYYY-MM-DD format
- portrait_bbox: percentage [left, top, right, bottom] of embedded portrait photo; null if none
- Never omit fields; use null + "none" for absent data
"""


@dataclass
class FieldResult:
    value: Any
    confidence: str


@dataclass
class ExtractionResult:
    fields: dict[str, FieldResult]
    portrait_b64: str | None
    document_type: str | None


def _normalize_date(raw: str) -> str | None:
    if not raw:
        return None
    raw = raw.strip()

    if re.match(r"^\d{4}$", raw):
        return raw
    if re.match(r"^\d{4}-\d{2}$", raw):
        return raw
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw

    # DD.MM.YYYY
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", raw)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"

    # DD/MM/YYYY (European convention)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", raw)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"

    # "15 März 1892" or "15. März 1892"
    m = re.match(r"^(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})$", raw)
    if m:
        d, month_str, y = m.groups()
        mo = _MONTH_NAMES.get(month_str.lower())
        if mo:
            return f"{y}-{mo}-{d.zfill(2)}"

    # "März 1892"
    m = re.match(r"^([A-Za-zäöüÄÖÜ]+)\s+(\d{4})$", raw)
    if m:
        month_str, y = m.groups()
        mo = _MONTH_NAMES.get(month_str.lower())
        if mo:
            return f"{y}-{mo}"

    return None


def _crop_portrait(image_bytes: bytes, bbox: list) -> str | None:
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            w, h = img.size
            x1 = max(0, int(bbox[0] / 100 * w))
            y1 = max(0, int(bbox[1] / 100 * h))
            x2 = min(w, int(bbox[2] / 100 * w))
            y2 = min(h, int(bbox[3] / 100 * h))
            if x2 <= x1 or y2 <= y1:
                return None
            cropped = img.crop((x1, y1, x2, y2)).convert("RGB")
            buf = io.BytesIO()
            cropped.save(buf, "JPEG", quality=85, optimize=True)
            return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def _parse_result(data: dict, image_bytes: bytes) -> ExtractionResult:
    fields_raw = data.get("fields", {})
    fields: dict[str, FieldResult] = {}

    for key in PERSON_FIELDS:
        entry = fields_raw.get(key, {}) or {}
        value = entry.get("value")
        confidence = entry.get("confidence", "none")
        if confidence not in VALID_CONFIDENCES:
            confidence = "none"

        if key in DATE_FIELDS and isinstance(value, str) and value:
            normalized = _normalize_date(value)
            if normalized is None:
                confidence = "low"
            else:
                value = normalized

        fields[key] = FieldResult(value=value, confidence=confidence)

    portrait_b64 = None
    bbox = data.get("portrait_bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        portrait_b64 = _crop_portrait(image_bytes, bbox)

    return ExtractionResult(
        fields=fields,
        portrait_b64=portrait_b64,
        document_type=data.get("document_type"),
    )


async def extract_from_document(image_bytes: bytes, mime_type: str) -> ExtractionResult:
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    b64 = base64.b64encode(image_bytes).decode()

    response = await client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        max_tokens=1500,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime_type};base64,{b64}",
                        "detail": "high",
                    },
                },
                {"type": "text", "text": _EXTRACTION_PROMPT},
            ],
        }],
    )

    raw = response.choices[0].message.content or "{}"
    data = json.loads(raw)
    return _parse_result(data, image_bytes)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /project/src/ancestry-app/backend
python3 -m pytest tests/test_ai_extractor.py -v
```

Expected: all tests pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add app/services/ai_extractor.py tests/test_ai_extractor.py
git commit -m "feat(ai): add ai_extractor service with date normalization and portrait crop"
```

---

## Task 3: AI router + endpoint tests + media document endpoint

**Files:**
- Create: `app/routers/ai.py`
- Create: `tests/test_ai_router.py`
- Modify: `app/routers/media.py` — add document upload endpoint; add `title` to list response
- Modify: `app/main.py` — register ai router

**Interfaces:**
- Consumes: `extract_from_document` from Task 2; `get_settings().openai_api_key` from Task 1
- Produces:
  - `GET /api/v1/ai/status` → `{"available": bool}`
  - `POST /api/v1/ai/extract-document` → `ExtractionResult` JSON (fields, portrait_b64, document_type)
  - `POST /api/v1/persons/{person_id}/media/document` → `{"id": str, "person_id": str}`
  - `MediaItem.title` field in list response

- [ ] **Step 1: Write the failing endpoint tests**

Create `tests/test_ai_router.py`:

```python
import os
import tempfile
import json
from unittest.mock import AsyncMock, MagicMock, patch

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

_FAKE_JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # minimal JPEG header bytes


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
        files={"file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /project/src/ancestry-app/backend
python3 -m pytest tests/test_ai_router.py -v 2>&1 | head -20
```

Expected: `ImportError` or `404` errors — router not yet created.

- [ ] **Step 3: Create app/routers/ai.py**

```python
from fastapi import APIRouter, HTTPException, UploadFile, File
from app.config import get_settings
from app.services.ai_extractor import extract_from_document

router = APIRouter(prefix="/ai", tags=["ai"])

_ACCEPTED_MIME = {"image/jpeg", "image/png", "image/webp"}


@router.get("/status", summary="AI availability check")
async def ai_status():
    """Returns whether an OpenAI API key is configured on the server."""
    return {"available": bool(get_settings().openai_api_key)}


@router.post("/extract-document", summary="Extract person data from a document image")
async def extract_document_endpoint(file: UploadFile = File(...)):
    """
    Upload a historical document image. Returns extracted person fields with
    confidence scores and a base64-encoded cropped portrait (if found).
    Does not write to the database.
    """
    if not get_settings().openai_api_key:
        raise HTTPException(status_code=503, detail="AI not configured")
    if (file.content_type or "") not in _ACCEPTED_MIME:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP allowed")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    result = await extract_from_document(image_bytes, file.content_type)

    return {
        "fields": {
            k: {"value": v.value, "confidence": v.confidence}
            for k, v in result.fields.items()
        },
        "portrait_b64": result.portrait_b64,
        "document_type": result.document_type,
    }
```

- [ ] **Step 4: Register ai router in app/main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import app.models  # noqa: F401
from app.routers import persons, relationships, tree, media, gedcom, ai

app = FastAPI(
    title="Ancestry App",
    description="Familien-Stammbaum Verwaltung",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(persons.router, prefix="/api/v1")
app.include_router(relationships.router, prefix="/api/v1")
app.include_router(tree.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(gedcom.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")


@app.get("/health", tags=["system"], summary="Health check")
async def health():
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
```

- [ ] **Step 5: Add document upload endpoint to app/routers/media.py**

Add this import at the top of the existing imports in `media.py`:

```python
from fastapi import Form
```

Then add this endpoint after `upload_photo` (around line 120 of the current file):

```python
@router.post("/persons/{person_id}/media/document", status_code=201, summary="Upload a document scan", tags=["media"])
async def upload_document(
    person_id: UUID,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document scan (passport, birth certificate, etc.) to a person's media gallery."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    settings = get_settings()
    ext = EXT_BY_MIME.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF allowed")

    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB")

    media_id = uuid.uuid4()
    rel_path = f"{person_id}/{media_id}.{ext}"
    abs_path = _safe_media_path(settings.media_storage_path, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    with open(abs_path, "wb") as fh:
        fh.write(content)

    media = Media(
        id=media_id,
        person_id=person_id,
        file_name=f"{media_id}.{ext}",
        file_path=rel_path,
        media_type=MediaType.document,
        mime_type=file.content_type,
        title=title,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    return {"id": str(media.id), "person_id": str(person_id)}
```

- [ ] **Step 6: Add title to list_person_media response in media.py**

Find the `list_person_media` endpoint and update its return to include `title`:

```python
return [
    {
        "id": str(m.id),
        "person_id": str(m.person_id),
        "file_name": m.file_name,
        "media_type": m.media_type.value,
        "mime_type": m.mime_type,
        "title": m.title,
        "uploaded_at": m.uploaded_at.isoformat() if m.uploaded_at else None,
    }
    for m in items
]
```

- [ ] **Step 7: Run all backend tests**

```bash
cd /project/src/ancestry-app/backend
python3 -m pytest tests/ -v
```

Expected: all tests pass (34 existing + new ai tests).

- [ ] **Step 8: Commit**

```bash
git add app/routers/ai.py app/routers/media.py app/main.py tests/test_ai_router.py
git commit -m "feat(ai): add AI router, document upload endpoint, title in media list"
```

---

## Task 4: Frontend types + API client

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/client.ts`

**Interfaces:**
- Produces:
  - `type Confidence = 'high' | 'medium' | 'low' | 'none'`
  - `interface FieldResult { value: string | string[] | null; confidence: Confidence }`
  - `interface ExtractionResult { fields: Record<string, FieldResult>; portrait_b64: string | null; document_type: string | null }`
  - `interface PendingMedia { file: File; mediaType: 'photo' | 'document'; title?: string; setAsAvatar?: boolean }`
  - `aiApi.status()` → `{ available: boolean }`
  - `aiApi.extractDocument(file)` → `ExtractionResult`
  - `mediaApi.uploadDocument(personId, file, title?)` → `{ id: string; person_id: string }`
  - `mediaApi.uploadPhoto` typed return → `{ id: string; person_id: string }`

- [ ] **Step 1: Update src/types/index.ts**

Add these types after the existing `MediaItem` interface, and update `MediaItem` to include `title`:

```typescript
export interface MediaItem {
  id: string
  person_id: string
  file_name: string
  media_type: 'photo' | 'document'
  mime_type: string
  title?: string
  uploaded_at: string
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface FieldResult {
  value: string | string[] | null
  confidence: Confidence
}

export interface ExtractionResult {
  fields: Record<string, FieldResult>
  portrait_b64: string | null
  document_type: string | null
}

export interface PendingMedia {
  file: File
  mediaType: 'photo' | 'document'
  title?: string
  setAsAvatar?: boolean
}
```

- [ ] **Step 2: Update src/api/client.ts**

Replace the `mediaApi` object with a typed version and add `aiApi`:

```typescript
export const mediaApi = {
  uploadAvatar: (personId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ id: string; person_id: string }>(`/persons/${personId}/media/avatar`, form).then(r => r.data)
  },
  uploadPhoto: (personId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ id: string; person_id: string }>(`/persons/${personId}/media`, form).then(r => r.data)
  },
  uploadDocument: (personId: string, file: File, title?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (title) form.append('title', title)
    return api.post<{ id: string; person_id: string }>(`/persons/${personId}/media/document`, form).then(r => r.data)
  },
  listPersonMedia: (personId: string) =>
    api.get<MediaItem[]>(`/persons/${personId}/media`).then(r => r.data),
  deleteMedia: (mediaId: string) => api.delete(`/media/${mediaId}`),
  setAvatar: (personId: string, mediaId: string) =>
    api.patch(`/persons/${personId}/avatar/${mediaId}`).then(r => r.data),
  fileUrl: (mediaId: string, opts?: { thumb?: boolean }) =>
    `/api/v1/media/${mediaId}/file${opts?.thumb ? '?thumb=true' : ''}`,
}

export const aiApi = {
  status: () => api.get<{ available: boolean }>('/ai/status').then(r => r.data),
  extractDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ExtractionResult>('/ai/extract-document', form).then(r => r.data)
  },
}
```

Also add the import at the top of `client.ts`:

```typescript
import type { Person, PersonCreate, Relationship, RelationshipCreate, TreeData, MediaItem, GedcomImportResult, ExtractionResult } from '../types'
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /project/src/ancestry-app/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /project/src/ancestry-app
git add frontend/src/types/index.ts frontend/src/api/client.ts
git commit -m "feat(ai): add ExtractionResult types and aiApi/mediaApi.uploadDocument to client"
```

---

## Task 5: useSettings + SettingsPage

**Files:**
- Modify: `src/hooks/useSettings.ts`
- Modify: `src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `aiApi.status()` from Task 4
- Produces: `settings.ai_enabled: boolean` — read by `DocumentScanModal` in Task 6

- [ ] **Step 1: Update useSettings.ts**

Replace the entire file contents:

```typescript
import { useState, useCallback } from 'react'

export interface AppSettings {
  anonymize_living: boolean
  ai_enabled: boolean
}

const KEY = 'ancestry_settings'
const DEFAULTS: AppSettings = { anonymize_living: false, ai_enabled: true }

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load)

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { settings, update }
}
```

- [ ] **Step 2: Add KI-Analyse section to SettingsPage.tsx**

Add this import at the top of `SettingsPage.tsx`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '../api/client'
```

Then add the KI-Analyse section inside `SettingsPage`, between the Datenschutz card and the Über die Anwendung card:

```tsx
{/* KI-Analyse */}
<div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm mb-6">
  <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">KI-Analyse</h2>
  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
    Automatisches Auslesen von Personendaten aus historischen Dokumenten per OpenAI GPT-4o Vision.
  </p>
  <Toggle
    label="KI-Dokumentenanalyse aktivieren"
    description={
      aiStatus?.available === false
        ? 'Kein API-Schlüssel konfiguriert — bitte OPENAI_API_KEY in der Backend-Umgebung setzen.'
        : 'Felder beim Dokumenten-Upload automatisch auslesen.'
    }
    checked={settings.ai_enabled && (aiStatus?.available ?? true)}
    onChange={v => update({ ai_enabled: v })}
  />
</div>
```

Add the query for `aiStatus` inside the `SettingsPage` function, before the return:

```typescript
const { data: aiStatus } = useQuery({
  queryKey: ['ai-status'],
  queryFn: aiApi.status,
  staleTime: 60_000,
})
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /project/src/ancestry-app/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /project/src/ancestry-app
git add frontend/src/hooks/useSettings.ts frontend/src/pages/SettingsPage.tsx
git commit -m "feat(ai): add ai_enabled setting and KI-Analyse toggle to settings page"
```

---

## Task 6: DocumentScanModal component + pre-check tests

**Files:**
- Create: `src/components/DocumentScanModal.tsx`
- Create: `src/components/__tests__/documentScanPrecheck.test.ts`

**Interfaces:**
- Consumes: `aiApi`, `mediaApi`, `personsApi` (Task 4); `useSettings` (Task 5); `ExtractionResult`, `PendingMedia` (Task 4)
- Produces:
  - `export function initialCheckedFields(result: ExtractionResult, currentPerson: Partial<Person>): Set<string>`
  - `export function DocumentScanModal(props: DocumentScanModalProps): JSX.Element`
  - `DocumentScanModalProps`: `{ personId: string; currentPerson?: Partial<Person>; mode: 'patch' | 'prefill'; onClose: () => void; onPrefill?: (fields: Partial<PersonCreate>, pendingMedia: PendingMedia[]) => void }`

- [ ] **Step 1: Write the failing pre-check tests**

Create `src/components/__tests__/documentScanPrecheck.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { initialCheckedFields } from '../DocumentScanModal'
import type { ExtractionResult } from '../../types'

function makeResult(overrides: Record<string, { value: unknown; confidence: string }>): ExtractionResult {
  const base: ExtractionResult['fields'] = {}
  for (const [k, v] of Object.entries(overrides)) {
    base[k] = { value: v.value as string | string[] | null, confidence: v.confidence as any }
  }
  return { fields: base, portrait_b64: null, document_type: null }
}

describe('initialCheckedFields', () => {
  it('pre-checks high confidence field when current is empty', () => {
    const result = makeResult({ first_name: { value: 'Johann', confidence: 'high' } })
    const checked = initialCheckedFields(result, {})
    expect(checked.has('first_name')).toBe(true)
  })

  it('pre-checks medium confidence field', () => {
    const result = makeResult({ date_of_birth: { value: '1892-03', confidence: 'medium' } })
    expect(initialCheckedFields(result, {}).has('date_of_birth')).toBe(true)
  })

  it('does not pre-check low confidence field', () => {
    const result = makeResult({ biography: { value: 'some text', confidence: 'low' } })
    expect(initialCheckedFields(result, {}).has('biography')).toBe(false)
  })

  it('does not pre-check field with confidence none', () => {
    const result = makeResult({ birth_name: { value: null, confidence: 'none' } })
    expect(initialCheckedFields(result, {}).has('birth_name')).toBe(false)
  })

  it('does not pre-check field matching current string value', () => {
    const result = makeResult({ first_name: { value: 'Johann', confidence: 'high' } })
    const checked = initialCheckedFields(result, { first_name: 'Johann' })
    expect(checked.has('first_name')).toBe(false)
  })

  it('pre-checks field when extracted differs from current', () => {
    const result = makeResult({ last_name: { value: 'Müller', confidence: 'high' } })
    const checked = initialCheckedFields(result, { last_name: 'Mueller' })
    expect(checked.has('last_name')).toBe(true)
  })

  it('does not pre-check null value field', () => {
    const result = makeResult({ place_of_death: { value: null, confidence: 'high' } })
    expect(initialCheckedFields(result, {}).has('place_of_death')).toBe(false)
  })

  it('compares array values as JSON strings', () => {
    const result = makeResult({ occupations: { value: ['Bäcker'], confidence: 'high' } })
    const checked = initialCheckedFields(result, { occupations: ['Bäcker'] })
    expect(checked.has('occupations')).toBe(false)
  })

  it('handles multiple fields correctly', () => {
    const result = makeResult({
      first_name: { value: 'Anna', confidence: 'high' },
      biography: { value: 'text', confidence: 'low' },
      nationality: { value: 'Deutsch', confidence: 'medium' },
    })
    const checked = initialCheckedFields(result, {})
    expect(checked.has('first_name')).toBe(true)
    expect(checked.has('biography')).toBe(false)
    expect(checked.has('nationality')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /project/src/ancestry-app/frontend
npm test 2>&1 | tail -20
```

Expected: `Cannot find module '../DocumentScanModal'`

- [ ] **Step 3: Create src/components/DocumentScanModal.tsx**

```tsx
import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../hooks/useToast'
import { aiApi, mediaApi, personsApi } from '../api/client'
import type { ExtractionResult, Person, PersonCreate, PendingMedia } from '../types'

// ── helpers ────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  first_name: 'Vorname', last_name: 'Nachname', birth_name: 'Geburtsname',
  gender: 'Geschlecht', date_of_birth: 'Geburtsdatum', place_of_birth: 'Geburtsort',
  date_of_death: 'Sterbedatum', place_of_death: 'Sterbeort',
  nationality: 'Nationalität', origin: 'Herkunft', occupations: 'Berufe', biography: 'Biografie',
}

const GENDER_LABELS: Record<string, string> = {
  male: 'Männlich', female: 'Weiblich', other: 'Divers', unknown: 'Unbekannt',
}

function displayValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  if (key === 'gender' && typeof value === 'string') return GENDER_LABELS[value] ?? value
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function ConfidenceIndicator({ confidence }: { confidence: string }) {
  const filled = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1
  const colors: Record<string, string> = {
    high: 'text-green-500', medium: 'text-yellow-500', low: 'text-orange-400',
  }
  return (
    <span className={`text-xs font-mono ${colors[confidence] ?? ''}`}>
      {'●'.repeat(filled)}{'○'.repeat(3 - filled)}
    </span>
  )
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mimeType })
}

// ── exported pure function (tested in Vitest) ──────────────────────────────

export function initialCheckedFields(
  result: ExtractionResult,
  currentPerson: Partial<Person>,
): Set<string> {
  const checked = new Set<string>()
  for (const [key, field] of Object.entries(result.fields)) {
    if (!field || field.confidence === 'none' || field.value === null) continue
    if (field.confidence === 'low') continue
    const currentVal = (currentPerson as Record<string, unknown>)[key]
    const toStr = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : String(v ?? ''))
    if (toStr(field.value) === toStr(currentVal)) continue
    checked.add(key)
  }
  return checked
}

// ── component ──────────────────────────────────────────────────────────────

interface DocumentScanModalProps {
  personId: string
  currentPerson?: Partial<Person>
  mode: 'patch' | 'prefill'
  onClose: () => void
  onPrefill?: (fields: Partial<PersonCreate>, pendingMedia: PendingMedia[]) => void
}

type Step = 'upload' | 'review'
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export function DocumentScanModal({
  personId,
  currentPerson = {},
  mode,
  onClose,
  onPrefill,
}: DocumentScanModalProps) {
  const { settings } = useSettings()
  const { addToast } = useToast()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [useAi, setUseAi] = useState(settings.ai_enabled)
  const [file, setFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set())
  const [savePortrait, setSavePortrait] = useState(true)
  const [setAsAvatar, setSetAsAvatar] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = (f: File) => {
    if (!ACCEPTED.includes(f.type)) { setError('Nur JPEG, PNG oder WebP erlaubt.'); return }
    setFile(f)
    setFilePreviewUrl(URL.createObjectURL(f))
    setError(null)
  }

  const handleAnalyze = async () => {
    if (!file) return
    if (!useAi) { await handleConfirmNoAi(); return }
    setIsAnalyzing(true); setError(null)
    try {
      const extracted = await aiApi.extractDocument(file)
      setResult(extracted)
      setCheckedFields(initialCheckedFields(extracted, currentPerson))
      setSavePortrait(Boolean(extracted.portrait_b64))
      setStep('review')
    } catch {
      setError('Analyse fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleConfirmNoAi = async () => {
    if (!file) return
    setIsApplying(true)
    try {
      if (mode === 'patch') {
        await mediaApi.uploadDocument(personId, file)
        qc.invalidateQueries({ queryKey: ['media', personId] })
        addToast('Dokument gespeichert.', 'success')
      } else {
        onPrefill?.({}, [{ file, mediaType: 'document' }])
      }
      onClose()
    } catch { setError('Dokument konnte nicht gespeichert werden.')
    } finally { setIsApplying(false) }
  }

  const handleConfirm = async () => {
    if (!result || !file) return
    setIsApplying(true); setError(null)
    try {
      if (mode === 'patch') {
        const patch: Record<string, unknown> = {}
        for (const key of checkedFields) {
          const f = result.fields[key]; if (f) patch[key] = f.value
        }
        if (Object.keys(patch).length > 0)
          await personsApi.update(personId, patch as Partial<PersonCreate>)
        await mediaApi.uploadDocument(personId, file, result.document_type ?? undefined)
        if (savePortrait && result.portrait_b64) {
          const blob = base64ToBlob(result.portrait_b64, 'image/jpeg')
          const pf = new File([blob], 'portrait.jpg', { type: 'image/jpeg' })
          const uploaded = await mediaApi.uploadPhoto(personId, pf)
          if (setAsAvatar) await mediaApi.setAvatar(personId, uploaded.id)
        }
        qc.invalidateQueries({ queryKey: ['persons', personId] })
        qc.invalidateQueries({ queryKey: ['media', personId] })
        qc.invalidateQueries({ queryKey: ['tree'] })
        const parts: string[] = []
        if (checkedFields.size > 0) parts.push(`${checkedFields.size} Felder übernommen`)
        if (savePortrait && result.portrait_b64) parts.push('Foto gespeichert')
        addToast(parts.join(' · ') || 'Dokument gespeichert.', 'success')
      } else {
        const fields: Partial<PersonCreate> = {}
        for (const key of checkedFields) {
          const f = result.fields[key]
          if (f) (fields as Record<string, unknown>)[key] = f.value
        }
        const pending: PendingMedia[] = [
          { file, mediaType: 'document', title: result.document_type ?? undefined },
        ]
        if (savePortrait && result.portrait_b64) {
          const blob = base64ToBlob(result.portrait_b64, 'image/jpeg')
          const pf = new File([blob], 'portrait.jpg', { type: 'image/jpeg' })
          pending.push({ file: pf, mediaType: 'photo', setAsAvatar })
        }
        onPrefill?.(fields, pending)
      }
      onClose()
    } catch { setError('Fehler beim Speichern. Bitte erneut versuchen.')
    } finally { setIsApplying(false) }
  }

  const toggleField = (key: string) =>
    setCheckedFields(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {step === 'upload' ? 'Dokument scannen' : 'Ergebnisse prüfen'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
        </div>

        <div className="p-5">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400'
                }`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div className="space-y-2">
                    {filePreviewUrl && <img src={filePreviewUrl} alt="Vorschau" className="mx-auto max-h-40 object-contain rounded" />}
                    <p className="text-sm text-gray-600 dark:text-gray-300">{file.name}</p>
                    <p className="text-xs text-gray-400">Klicken zum Ändern</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-4xl text-gray-300 dark:text-gray-600">📄</div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Datei hierher ziehen oder klicken</p>
                    <p className="text-xs text-gray-400">JPEG, PNG, WebP</p>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

              {/* AI toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative shrink-0">
                  <input type="checkbox" className="sr-only" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
                  <div className={`w-10 h-6 rounded-full transition-colors ${useAi ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${useAi ? 'translate-x-4' : ''}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">KI-Analyse verwenden</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Felder automatisch auslesen</p>
                </div>
              </label>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 2: Review */}
          {step === 'review' && result && (
            <div className="space-y-4">
              <div className="flex gap-4 flex-wrap">
                {filePreviewUrl && (
                  <img src={filePreviewUrl} alt="Dokument"
                    className="w-32 h-40 object-cover rounded border border-gray-200 dark:border-gray-700 shrink-0" />
                )}
                {result.portrait_b64 && (
                  <div className="space-y-1.5">
                    <img src={`data:image/jpeg;base64,${result.portrait_b64}`} alt="Porträt"
                      className="w-24 h-28 object-cover rounded border border-gray-200 dark:border-gray-700" />
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={savePortrait} onChange={e => setSavePortrait(e.target.checked)} className="w-3.5 h-3.5" />
                      Foto speichern
                    </label>
                    {savePortrait && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={setAsAvatar} onChange={e => setSetAsAvatar(e.target.checked)} className="w-3.5 h-3.5" />
                        Als Avatar setzen
                      </label>
                    )}
                  </div>
                )}
                {result.document_type && (
                  <p className="text-xs text-gray-400 self-end">Typ: {result.document_type}</p>
                )}
              </div>

              {Object.entries(result.fields).filter(([, f]) => f?.confidence !== 'none').length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Keine Felder erkannt.</p>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-3 py-2 w-8"></th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Feld</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Aktuell</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Erkannt</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.fields)
                        .filter(([, f]) => f?.confidence !== 'none')
                        .map(([key, field]) => (
                          <tr key={key} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={checkedFields.has(key)}
                                onChange={() => toggleField(key)} className="w-3.5 h-3.5" />
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 text-xs">
                              {FIELD_LABELS[key] ?? key}
                            </td>
                            <td className="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs max-w-[100px] truncate">
                              {displayValue(key, (currentPerson as Record<string, unknown>)[key])}
                            </td>
                            <td className="px-3 py-2 text-gray-800 dark:text-gray-100 text-xs max-w-[100px] truncate">
                              {displayValue(key, field?.value)}
                            </td>
                            <td className="px-3 py-2">
                              {field && <ConfidenceIndicator confidence={field.confidence} />}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
            Abbrechen
          </button>
          {step === 'upload' ? (
            <button onClick={handleAnalyze} disabled={!file || isAnalyzing}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
              {isAnalyzing
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analysiere…</>
                : useAi ? 'Analysieren →' : 'Speichern'}
            </button>
          ) : (
            <button onClick={handleConfirm} disabled={isApplying}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
              {isApplying ? 'Übernehme…' : 'Übernehmen →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run all frontend tests**

```bash
cd /project/src/ancestry-app/frontend
npm test 2>&1
```

Expected: all tests pass (28 existing + 9 new pre-check tests).

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /project/src/ancestry-app
git add frontend/src/components/DocumentScanModal.tsx frontend/src/components/__tests__/documentScanPrecheck.test.ts
git commit -m "feat(ai): add DocumentScanModal component with pre-check logic"
```

---

## Task 7: Phase A — PersonDetailPage (button + gallery tab split)

**Files:**
- Modify: `src/pages/PersonDetailPage.tsx`

**Interfaces:**
- Consumes: `DocumentScanModal` from Task 6; existing `mediaApi`, `personsApi`, `useQuery`

- [ ] **Step 1: Add imports and modal state to PersonDetailPage**

At the top of `PersonDetailPage.tsx`, add:

```typescript
import { DocumentScanModal } from '../components/DocumentScanModal'
```

Inside the `PhotoGallery` component, add this state before the return:

```typescript
const [showScanModal, setShowScanModal] = useState<boolean>(false)
```

- [ ] **Step 2: Split gallery into Fotos/Dokumente tabs**

Add tab state inside `PhotoGallery`:

```typescript
const [tab, setTab] = useState<'photos' | 'documents'>('photos')
const photos = media.filter(m => m.media_type === 'photo' || !m.media_type)
const documents = media.filter(m => m.media_type === 'document')
```

Replace the existing gallery header `<div className="flex justify-between...">` block entirely with:

```tsx
<div className="flex justify-between items-center mb-4">
  <div className="flex gap-1">
    <button
      onClick={() => setTab('photos')}
      className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
        tab === 'photos'
          ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      Fotos ({photos.length})
    </button>
    <button
      onClick={() => setTab('documents')}
      className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
        tab === 'documents'
          ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      Dokumente ({documents.length})
    </button>
  </div>
  <div className="flex items-center gap-3">
    <button
      onClick={() => setShowScanModal(true)}
      className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
    >
      Dokument scannen
    </button>
    {tab === 'photos' && (
      <button
        onClick={() => photoRef.current?.click()}
        disabled={uploadMutation.isPending}
        className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
      >
        {uploadMutation.isPending ? 'Hochladen…' : '+ Foto hinzufügen'}
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 3: Update gallery body to show correct tab content**

Replace the section after the header (currently shows `media.length === 0 ? ...`) with:

```tsx
{tab === 'photos' && (
  <>
    {photos.length === 0 ? (
      <p className="text-sm text-gray-400 dark:text-gray-500">Noch keine Fotos vorhanden.</p>
    ) : (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map(m => (
          <div key={m.id} className="relative group aspect-square cursor-pointer"
            onClick={() => setLightbox(m)}>
            <img src={mediaApi.fileUrl(m.id, { thumb: true })} alt={m.file_name} loading="lazy"
              className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
            {person?.avatar_media_id === m.id && (
              <span className="absolute top-1 left-1 bg-indigo-600 text-white text-[9px] px-1 py-0.5 rounded font-medium">Avatar</span>
            )}
          </div>
        ))}
      </div>
    )}
  </>
)}

{tab === 'documents' && (
  <>
    {documents.length === 0 ? (
      <p className="text-sm text-gray-400 dark:text-gray-500">Noch keine Dokumente vorhanden.</p>
    ) : (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {documents.map(m => (
          <div key={m.id} className="relative group aspect-square cursor-pointer"
            onClick={() => setLightbox(m)}>
            <img src={mediaApi.fileUrl(m.id, { thumb: true })} alt={m.title ?? m.file_name} loading="lazy"
              className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
            {m.title && (
              <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] px-1 py-0.5 rounded-b-lg truncate">
                {m.title}
              </span>
            )}
          </div>
        ))}
      </div>
    )}
  </>
)}
```

- [ ] **Step 4: Render DocumentScanModal at the end of the PhotoGallery return**

Add just before the closing `</div>` of the `PhotoGallery` return (after the lightbox block):

```tsx
{showScanModal && (
  <DocumentScanModal
    personId={personId}
    currentPerson={person ?? {}}
    mode="patch"
    onClose={() => setShowScanModal(false)}
  />
)}
```

Also add the hidden file input `<input ref={photoRef} ...>` back if it was removed during refactor — it's still needed for photo tab uploads.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /project/src/ancestry-app/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Run all frontend tests**

```bash
npm test 2>&1
```

Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /project/src/ancestry-app
git add frontend/src/pages/PersonDetailPage.tsx
git commit -m "feat(ai): Phase A — Dokument scannen button and gallery tab split on PersonDetailPage"
```

---

## Task 8: Phase B — PersonFormPage (prefill button + queued media upload)

**Files:**
- Modify: `src/pages/PersonFormPage.tsx`

**Interfaces:**
- Consumes: `DocumentScanModal` from Task 6; `mediaApi.uploadDocument`, `mediaApi.uploadPhoto`, `mediaApi.setAvatar` (Task 4); `PendingMedia` (Task 4)

- [ ] **Step 1: Add imports and state to PersonFormPage**

Add to the import block at the top:

```typescript
import { DocumentScanModal } from '../components/DocumentScanModal'
import { mediaApi } from '../api/client'
import type { PendingMedia } from '../types'
```

Add `setValue` to the `useForm` destructure:

```typescript
const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(schema),
  defaultValues: { is_living: true },
})
```

Add new state variables inside `PersonFormPage` (alongside the existing `dupWarning` state):

```typescript
const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
const [showScanModal, setShowScanModal] = useState(false)
```

- [ ] **Step 2: Add onPrefill handler**

Add this function inside `PersonFormPage`, before the return:

```typescript
const handlePrefill = (fields: Partial<PersonCreate>, pending: PendingMedia[]) => {
  if (fields.first_name) setValue('first_name', fields.first_name as string)
  if (fields.last_name) setValue('last_name', fields.last_name as string)
  if (fields.birth_name) setValue('birth_name', fields.birth_name as string)
  if (fields.gender) setValue('gender', fields.gender as 'male' | 'female' | 'other' | 'unknown')
  if (fields.date_of_birth) setValue('date_of_birth', fields.date_of_birth as string)
  if (fields.place_of_birth) setValue('place_of_birth', fields.place_of_birth as string)
  if (fields.date_of_death) setValue('date_of_death', fields.date_of_death as string)
  if (fields.place_of_death) setValue('place_of_death', fields.place_of_death as string)
  if (fields.nationality) setValue('nationality', fields.nationality as string)
  if (fields.origin) setValue('origin', fields.origin as string)
  if (fields.biography) setValue('biography', fields.biography as string)
  if (fields.occupations && Array.isArray(fields.occupations))
    setOccupations(fields.occupations as string[])
  setPendingMedia(pending)
}
```

- [ ] **Step 3: Upload pending media after person save**

Replace `createMutation` and `updateMutation` with versions that upload pending media in `onSuccess`:

```typescript
const createMutation = useMutation({
  mutationFn: (data: PersonCreate) => personsApi.create(data),
  onSuccess: async (p) => {
    for (const pm of pendingMedia) {
      if (pm.mediaType === 'document') {
        await mediaApi.uploadDocument(p.id, pm.file, pm.title)
      } else {
        const uploaded = await mediaApi.uploadPhoto(p.id, pm.file)
        if (pm.setAsAvatar) await mediaApi.setAvatar(p.id, uploaded.id)
      }
    }
    qc.invalidateQueries({ queryKey: ['persons'] })
    navigate(`/persons/${p.id}`)
  },
  onError: (err) => addToast(apiErrMsg(err, 'Person konnte nicht angelegt werden.'), 'error'),
})

const updateMutation = useMutation({
  mutationFn: (data: Partial<PersonCreate>) => personsApi.update(id!, data),
  onSuccess: async () => {
    for (const pm of pendingMedia) {
      if (pm.mediaType === 'document') {
        await mediaApi.uploadDocument(id!, pm.file, pm.title)
      } else {
        const uploaded = await mediaApi.uploadPhoto(id!, pm.file)
        if (pm.setAsAvatar) await mediaApi.setAvatar(id!, uploaded.id)
      }
    }
    qc.invalidateQueries({ queryKey: ['persons'] })
    navigate(`/persons/${id}`)
  },
  onError: (err) => addToast(apiErrMsg(err, 'Änderungen konnten nicht gespeichert werden.'), 'error'),
})
```

- [ ] **Step 4: Add the "Aus Dokument füllen" button and modal to the JSX**

Add the button immediately before the `<form>` tag inside the return:

```tsx
<div className="flex justify-end mb-2">
  <button
    type="button"
    onClick={() => setShowScanModal(true)}
    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
  >
    Aus Dokument füllen
  </button>
</div>
```

Add the modal at the very end of the return, just before the closing `</div>` of the page wrapper:

```tsx
{showScanModal && (
  <DocumentScanModal
    personId={id ?? ''}
    currentPerson={existing ?? {}}
    mode="prefill"
    onClose={() => setShowScanModal(false)}
    onPrefill={handlePrefill}
  />
)}
```

Note: `personId` is passed as empty string for new persons — the modal in prefill mode does not use it for API calls, so this is safe.

- [ ] **Step 5: Show pending media indicator**

Add this just below the "Aus Dokument füllen" button (shows count of queued media so user knows scan results are queued):

```tsx
{pendingMedia.length > 0 && (
  <p className="text-xs text-indigo-500 dark:text-indigo-400 text-right">
    {pendingMedia.length} Datei{pendingMedia.length > 1 ? 'en' : ''} werden nach dem Speichern hochgeladen.
  </p>
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /project/src/ancestry-app/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Run all tests (backend + frontend)**

```bash
cd /project/src/ancestry-app/backend && python3 -m pytest tests/ -v
cd /project/src/ancestry-app/frontend && npm test
```

Expected: all backend tests pass, all frontend tests pass.

- [ ] **Step 8: Commit**

```bash
cd /project/src/ancestry-app
git add frontend/src/pages/PersonFormPage.tsx
git commit -m "feat(ai): Phase B — Aus Dokument füllen button and queued media upload on PersonFormPage"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Extract all person fields from document — Task 2 (`ai_extractor.py` with all 12 fields)
- ✅ Crop and save portrait — Task 2 (`_crop_portrait`), Task 6 (modal handles base64 → File → upload)
- ✅ Review before saving — Task 6 (Step 2 review with checkboxes)
- ✅ Global AI toggle with per-upload override — Task 5 (`useSettings`), Task 6 (toggle in Step 1)
- ✅ Phase A PersonDetailPage — Task 7
- ✅ Phase B PersonFormPage — Task 8
- ✅ Gallery tab split Fotos/Dokumente — Task 7 Step 2-3
- ✅ `GET /ai/status` for frontend availability check — Task 3
- ✅ `MediaType.document` used (no migration needed) — Task 3 Step 5
- ✅ Error handling: 503 no key, 400 bad mime, inline modal errors — Task 3 + Task 6
- ✅ Backend unit tests mocking OpenAI — Task 2
- ✅ Frontend Vitest tests for pre-check logic — Task 6
- ✅ Date normalisation with confidence downgrade — Task 2

**Type consistency:**
- `ExtractionResult` / `FieldResult` / `PendingMedia` defined in Task 4, consumed in Tasks 5, 6, 7, 8 ✅
- `mediaApi.uploadDocument` defined in Task 4, used in Tasks 6, 8 ✅
- `initialCheckedFields` exported from `DocumentScanModal.tsx`, imported in test file ✅
- `settings.ai_enabled` defined in Task 5, read in Task 6 ✅
