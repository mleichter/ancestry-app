# Portrait Crop Accuracy — Face Detection Design

**Date:** 2026-06-25
**Status:** Approved

## Problem

The AI document extraction pipeline asks GPT-4o to return a `portrait_bbox` as percentage
coordinates `[x1, y1, x2, y2]`. GPT-4o reliably identifies *whether* a portrait exists but
produces inaccurate pixel coordinates — observed on a 1948 German Kennkarte where the crop
included the fingerprint section and cut off part of the face.

## Goal

Produce accurate portrait crops from identity documents that contain embedded photos.
Documents without face photos must not produce spurious crops.

## Approach

Replace GPT-4o coordinate usage with a local MediaPipe BlazeFace detector. GPT-4o's
`portrait_bbox` is retained as a cheap "portrait exists" gate that avoids running face
detection on every document. If GPT-4o signals a portrait but MediaPipe finds no face,
`portrait_b64` is null — no fallback to GPT-4o coordinates.

## Pipeline

```
GPT-4o call (unchanged)
    │
    ├─ portrait_bbox: null ──────────────────────► portrait_b64: null
    │
    └─ portrait_bbox: [x1,y1,x2,y2] (signal only)
            │
            ▼
    MediaPipe face detection on full image
            │
            ├─ no face found ────────────────────► portrait_b64: null
            │
            └─ face found (bbox in px)
                    │
                    ▼
            pad bbox 30% on all sides (head + shoulders)
            clamp to image bounds
            crop → JPEG → base64
                    │
                    ▼
            portrait_b64: "<base64>"
```

## Implementation

All changes are in `backend/app/services/ai_extractor.py`.

### New function: `_detect_face_bbox(image_bytes: bytes) → list[float] | None`

- Uses `mediapipe.solutions.face_detection` with `model_selection=1` (full-range model,
  handles faces at varying distances and angles including 3/4 profile)
- Returns `[x1_pct, y1_pct, x2_pct, y2_pct]` in 0–100 percentage coordinates, or `None`
- Selects the highest-confidence detection if multiple faces are found
- Runs on the full document image (not a pre-cropped region) to avoid compounding GPT-4o's
  coordinate error

### Updated `_crop_portrait`

- Accepts a `padding_pct: float = 0.30` parameter
- Expands the bbox by `padding_pct` of the bbox width/height on each side before cropping
- Clamps to image bounds after expansion

### Updated `_parse_result`

- If `portrait_bbox` is present in GPT-4o response → call `_detect_face_bbox`
- If face detected → call `_crop_portrait` with the face bbox and `padding_pct=0.30`
- If no face detected → `portrait_b64 = None`
- If `portrait_bbox` is absent → `portrait_b64 = None` (unchanged)

## Dependencies

Add to `backend/pyproject.toml`:
```
"mediapipe>=0.10",
```

No Dockerfile changes required (mediapipe ships as a pure Python wheel with bundled
native libs).

## Testing

Two new unit tests in `backend/tests/test_ai_extractor.py`:

1. **Face detection happy path** — pass a synthetic JPEG with a real face; assert
   `_detect_face_bbox` returns a 4-element list with values in [0, 100].

2. **No face → null portrait** — mock GPT-4o to return a `portrait_bbox` on a plain
   white image; assert `result.portrait_b64 is None`.

Existing extractor tests are unchanged.

## Constraints

- `mediapipe` pulls in TensorFlow Lite — acceptable for a backend container
- MediaPipe may miss heavily degraded, very small, or occluded historical portraits; in
  those cases `portrait_b64` is null, which is preferable to a wrong crop
- No UI changes required; the `portrait_b64` field in the API response is unchanged
