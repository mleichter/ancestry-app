import base64
import io
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

import fitz  # pymupdf
from openai import AsyncOpenAI
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)

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


def pdf_to_image_bytes(pdf_bytes: bytes, dpi: int = 200) -> bytes:
    """Render the first page of a PDF to JPEG bytes at the given DPI."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return pix.tobytes("jpeg")


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


def _crop_portrait(image_bytes: bytes, bbox: list, padding_pct: float = 0.0) -> str | None:
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            w, h = img.size
            bw = (bbox[2] - bbox[0]) / 100 * w
            bh = (bbox[3] - bbox[1]) / 100 * h
            pad_x = bw * padding_pct
            pad_y = bh * padding_pct
            x1 = max(0, int(bbox[0] / 100 * w - pad_x))
            y1 = max(0, int(bbox[1] / 100 * h - pad_y))
            x2 = min(w, int(bbox[2] / 100 * w + pad_x))
            y2 = min(h, int(bbox[3] / 100 * h + pad_y))
            if x2 <= x1 or y2 <= y1:
                return None
            cropped = img.crop((x1, y1, x2, y2)).convert("RGB")
            buf = io.BytesIO()
            cropped.save(buf, "JPEG", quality=85, optimize=True)
            return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        logger.warning("_crop_portrait failed", exc_info=True)
        return None


_FACE_DETECTOR_MODEL = "/opt/face_detector.tflite"


def _detect_face_bbox(image_bytes: bytes) -> list[float] | None:
    """Run MediaPipe Tasks FaceDetector; return [x1%, y1%, x2%, y2%] or None."""
    try:
        import mediapipe as mp
        from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions
        from mediapipe.tasks.python.core.base_options import BaseOptions
        import numpy as np

        model_path = _FACE_DETECTOR_MODEL

        with Image.open(io.BytesIO(image_bytes)) as img:
            w, h = img.size
            np_rgb = np.array(img.convert("RGB"))

        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np_rgb)
        options = FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            min_detection_confidence=0.5,
        )
        with FaceDetector.create_from_options(options) as detector:
            result = detector.detect(mp_image)

        if not result.detections:
            return None

        best = max(result.detections, key=lambda d: d.categories[0].score)
        bb = best.bounding_box
        x1 = max(0.0, bb.origin_x / w) * 100
        y1 = max(0.0, bb.origin_y / h) * 100
        x2 = min(1.0, (bb.origin_x + bb.width) / w) * 100
        y2 = min(1.0, (bb.origin_y + bb.height) / h) * 100
        return [x1, y1, x2, y2]
    except Exception:
        logger.warning("_detect_face_bbox failed", exc_info=True)
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
        face_bbox = _detect_face_bbox(image_bytes)
        if face_bbox is not None:
            portrait_b64 = _crop_portrait(image_bytes, face_bbox, padding_pct=0.30)

    return ExtractionResult(
        fields=fields,
        portrait_b64=portrait_b64,
        document_type=data.get("document_type"),
    )


async def extract_from_document(image_bytes: bytes, mime_type: str) -> ExtractionResult:
    settings = get_settings()
    client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or None,
    )
    b64 = base64.b64encode(image_bytes).decode()

    response = await client.chat.completions.create(
        model=settings.openai_model,
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
