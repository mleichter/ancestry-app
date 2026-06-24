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
