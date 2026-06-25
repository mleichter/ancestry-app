# Portrait Face Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GPT-4o portrait coordinate estimation with MediaPipe BlazeFace detection to produce accurate portrait crops from identity documents.

**Architecture:** Add `_detect_face_bbox()` to `ai_extractor.py` which runs MediaPipe on the full document image. Update `_parse_result` to call it when GPT-4o signals a portrait exists; use the detected face bbox (with 30% padding) for the crop instead of GPT-4o's coordinates. If no face is detected, return `portrait_b64: null` — no fallback to GPT-4o coordinates. Update `_crop_portrait` to accept a `padding_pct` parameter.

**Tech Stack:** MediaPipe 0.10 (BlazeFace full-range model), Pillow, NumPy (transitive dep of mediapipe)

## Global Constraints

- Python 3.12, python:3.12-slim Docker base image
- All changes confined to `backend/app/services/ai_extractor.py` and its test file
- Tests run inside container: `docker compose exec backend pytest -v`
- All existing tests must pass after each task (no regressions)
- `mediapipe>=0.10.14` — first release with Python 3.12 support
- No UI changes — `portrait_b64` field in the API response schema is unchanged

---

## Task 1: Add MediaPipe dependency + `_detect_face_bbox`

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/services/ai_extractor.py`
- Modify: `backend/tests/test_ai_extractor.py`

**Interfaces:**
- Produces: `_detect_face_bbox(image_bytes: bytes) -> list[float] | None`
  - Returns `[x1_pct, y1_pct, x2_pct, y2_pct]` with values in 0–100, or `None` if no face found
  - Selects the highest-confidence detection when multiple faces are present
  - Catches all exceptions and returns `None` (so a mediapipe failure never crashes extraction)

---

- [ ] **Step 1: Add mediapipe to pyproject.toml**

In `backend/pyproject.toml`, add to the `dependencies` list (after `python-magic`):

```toml
"mediapipe>=0.10.14",
```

- [ ] **Step 2: Write the failing test**

Add to the bottom of `backend/tests/test_ai_extractor.py`:

```python
from app.services.ai_extractor import _detect_face_bbox

# ── _detect_face_bbox ─────────────────────────────────────────────────────────

def test_detect_face_bbox_plain_image_returns_none():
    """A solid-colour image with no face must return None."""
    result = _detect_face_bbox(_make_image(300, 400))
    assert result is None
```

- [ ] **Step 3: Run test to confirm it fails (ImportError — function not defined yet)**

```bash
docker compose exec backend pytest tests/test_ai_extractor.py::test_detect_face_bbox_plain_image_returns_none -v
```

Expected: `ImportError` or `FAILED` — `_detect_face_bbox` not yet defined.

- [ ] **Step 4: Add `_detect_face_bbox` to ai_extractor.py**

In `backend/app/services/ai_extractor.py`, add this function after `_crop_portrait`:

```python
def _detect_face_bbox(image_bytes: bytes) -> list[float] | None:
    """Run MediaPipe BlazeFace on the full image; return [x1%, y1%, x2%, y2%] or None."""
    try:
        import mediapipe as mp
        import numpy as np

        with Image.open(io.BytesIO(image_bytes)) as img:
            np_rgb = np.array(img.convert("RGB"))

        with mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.5
        ) as detector:
            detections = detector.process(np_rgb).detections

        if not detections:
            return None

        best = max(detections, key=lambda d: d.score[0])
        bb = best.location_data.relative_bounding_box
        x1 = max(0.0, bb.xmin) * 100
        y1 = max(0.0, bb.ymin) * 100
        x2 = min(1.0, bb.xmin + bb.width) * 100
        y2 = min(1.0, bb.ymin + bb.height) * 100
        return [x1, y1, x2, y2]
    except Exception:
        return None
```

- [ ] **Step 5: Rebuild backend container with mediapipe**

```bash
docker compose build backend && docker compose up -d backend
```

Expected: build completes, container starts healthy.

- [ ] **Step 6: Run the new test**

```bash
docker compose exec backend pytest tests/test_ai_extractor.py::test_detect_face_bbox_plain_image_returns_none -v
```

Expected: `PASSED` — MediaPipe installed and returns None for a blank image.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

```bash
docker compose exec backend pytest -v 2>&1 | tail -15
```

Expected: same pass count as before + 1 new pass. The pre-existing `test_health_db_connected` asyncpg teardown failure is unrelated — acceptable.

- [ ] **Step 8: Commit**

```bash
git -C /project/src/ancestry-app add backend/pyproject.toml backend/app/services/ai_extractor.py backend/tests/test_ai_extractor.py
git -C /project/src/ancestry-app commit -m "feat(ai): add MediaPipe face detection helper _detect_face_bbox"
```

---

## Task 2: Wire face detection into `_parse_result`, add padding to `_crop_portrait`

**Files:**
- Modify: `backend/app/services/ai_extractor.py`
- Modify: `backend/tests/test_ai_extractor.py`

**Interfaces:**
- Consumes: `_detect_face_bbox(image_bytes: bytes) -> list[float] | None` (Task 1)
- Modifies: `_crop_portrait(image_bytes, bbox, padding_pct=0.0)` — adds `padding_pct` keyword arg; default `0.0` keeps existing test behaviour unchanged
- Modifies: `_parse_result(data, image_bytes)` — calls `_detect_face_bbox` when `portrait_bbox` present; uses face bbox + `padding_pct=0.30`; returns `portrait_b64=None` when no face found

---

- [ ] **Step 1: Write failing tests**

Replace the existing `test_parse_result_crops_portrait` and add three new tests in `backend/tests/test_ai_extractor.py`. Find the line:

```python
def test_parse_result_crops_portrait():
    data = {"document_type": "passport", "fields": _empty_fields(), "portrait_bbox": [10.0, 10.0, 40.0, 40.0]}
    result = _parse_result(data, _make_image(300, 400))
    assert result.portrait_b64 is not None
```

Replace it with:

```python
from unittest.mock import patch, call, ANY

def test_parse_result_crops_portrait():
    """portrait_bbox present + face detected → portrait_b64 is set."""
    data = {"document_type": "passport", "fields": _empty_fields(), "portrait_bbox": [10.0, 10.0, 40.0, 40.0]}
    face_bbox = [12.0, 8.0, 38.0, 42.0]
    with patch("app.services.ai_extractor._detect_face_bbox", return_value=face_bbox):
        result = _parse_result(data, _make_image(300, 400))
    assert result.portrait_b64 is not None


def test_parse_result_no_face_detected_returns_null_portrait():
    """portrait_bbox present but no face detected → portrait_b64 must be None (no fallback)."""
    data = {"document_type": "passport", "fields": _empty_fields(), "portrait_bbox": [10.0, 10.0, 40.0, 40.0]}
    with patch("app.services.ai_extractor._detect_face_bbox", return_value=None):
        result = _parse_result(data, _make_image(300, 400))
    assert result.portrait_b64 is None


def test_parse_result_uses_face_bbox_not_gpt_bbox():
    """Crop must use the face-detected bbox, not GPT-4o's bbox, and pass padding_pct=0.30."""
    gpt_bbox = [5.0, 5.0, 45.0, 45.0]
    face_bbox = [20.0, 10.0, 60.0, 55.0]
    data = {"document_type": "passport", "fields": _empty_fields(), "portrait_bbox": gpt_bbox}
    image = _make_image(300, 400)
    with patch("app.services.ai_extractor._detect_face_bbox", return_value=face_bbox):
        with patch("app.services.ai_extractor._crop_portrait", return_value="b64data") as mock_crop:
            result = _parse_result(data, image)
    mock_crop.assert_called_once_with(image, face_bbox, padding_pct=0.30)
    assert result.portrait_b64 == "b64data"
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
docker compose exec backend pytest tests/test_ai_extractor.py::test_parse_result_crops_portrait tests/test_ai_extractor.py::test_parse_result_no_face_detected_returns_null_portrait tests/test_ai_extractor.py::test_parse_result_uses_face_bbox_not_gpt_bbox -v
```

Expected: all three FAILED — `_parse_result` still uses the old code path.

- [ ] **Step 3: Update `_crop_portrait` to accept `padding_pct`**

In `backend/app/services/ai_extractor.py`, replace the `_crop_portrait` function:

```python
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
        return None
```

- [ ] **Step 4: Update `_parse_result` to use face detection**

In `backend/app/services/ai_extractor.py`, replace this block inside `_parse_result`:

```python
    portrait_b64 = None
    bbox = data.get("portrait_bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        portrait_b64 = _crop_portrait(image_bytes, bbox)
```

with:

```python
    portrait_b64 = None
    bbox = data.get("portrait_bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        face_bbox = _detect_face_bbox(image_bytes)
        if face_bbox is not None:
            portrait_b64 = _crop_portrait(image_bytes, face_bbox, padding_pct=0.30)
```

- [ ] **Step 5: Run the new tests**

```bash
docker compose exec backend pytest tests/test_ai_extractor.py::test_parse_result_crops_portrait tests/test_ai_extractor.py::test_parse_result_no_face_detected_returns_null_portrait tests/test_ai_extractor.py::test_parse_result_uses_face_bbox_not_gpt_bbox -v
```

Expected: all three PASS.

- [ ] **Step 6: Run full test suite**

```bash
docker compose exec backend pytest -v 2>&1 | tail -15
```

Expected: all tests pass (same count + 3 new passes). Confirm `test_crop_portrait_*` tests still pass — `padding_pct` defaults to `0.0` so existing crop behaviour is unchanged.

- [ ] **Step 7: Smoke-test with Pauline's document**

```bash
curl -s -X POST http://localhost:8000/api/v1/ai/extract-document \
  -F "file=@/tmp/pauline_doc.png" \
  | python3 -c "
import json, sys, base64, io
from PIL import Image
d = json.load(sys.stdin)
b64 = d.get('portrait_b64')
if b64:
    img = Image.open(io.BytesIO(base64.b64decode(b64)))
    img.save('/tmp/pauline_portrait_new.jpg')
    print('Portrait saved:', img.size)
else:
    print('No portrait detected')
"
```

Then view `/tmp/pauline_portrait_new.jpg` to confirm the crop contains Pauline's face with head and shoulders, without the fingerprint section.

- [ ] **Step 8: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/services/ai_extractor.py backend/tests/test_ai_extractor.py
git -C /project/src/ancestry-app commit -m "feat(ai): use MediaPipe face detection for accurate portrait crops"
```

---

## Self-Review

**Spec coverage:**
- ✅ MediaPipe BlazeFace model_selection=1 — Task 1 Step 4
- ✅ Highest-confidence detection selected — Task 1 Step 4 (`max(..., key=lambda d: d.score[0])`)
- ✅ Runs on full image, not pre-cropped region — Task 1 Step 4 (processes full `image_bytes`)
- ✅ 30% padding on all sides — Task 2 Step 4 (`padding_pct=0.30`)
- ✅ No fallback to GPT-4o coordinates — Task 2 Step 4 (only crops when `face_bbox is not None`)
- ✅ `portrait_bbox: null` → `portrait_b64: null` unchanged — Task 2 Step 4 (guard `isinstance(bbox, list)`)
- ✅ Exception safety — Task 1 Step 4 (`except Exception: return None`)
- ✅ Unit test: plain image → None — Task 1 Step 2
- ✅ Unit test: no face → null portrait — Task 2 Step 1
- ✅ Unit test: face detected → uses face bbox + padding — Task 2 Step 1
- ✅ Existing tests unbroken — `padding_pct` defaults to `0.0`; `test_parse_result_crops_portrait` updated to use mock

**Placeholder scan:** None — all steps have complete code.

**Type consistency:**
- `_detect_face_bbox` returns `list[float] | None` — matches usage in `_parse_result` (`if face_bbox is not None`)
- `_crop_portrait` called as `_crop_portrait(image_bytes, face_bbox, padding_pct=0.30)` — matches updated signature `_crop_portrait(image_bytes: bytes, bbox: list, padding_pct: float = 0.0)`
- Mock in `test_parse_result_uses_face_bbox_not_gpt_bbox` asserts `call(image, face_bbox, padding_pct=0.30)` — matches keyword arg name
