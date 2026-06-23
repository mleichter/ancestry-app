# AI Document Extraction — Design Spec

**Date:** 2026-06-24
**Status:** Approved

## Overview

Add an AI-powered document scanning feature to the ancestry app. Users can upload photos of historical documents (passports, birth certificates, marriage certificates) and have the app automatically extract structured person data and a portrait photo using the OpenAI GPT-4o Vision API. Extracted fields are reviewed before being saved.

## Goals

- Extract all person fields from a scanned document image
- Crop and save the embedded portrait photo (e.g. passport photo)
- Let users review and selectively apply extracted fields before any data is written
- Toggle AI analysis globally (settings) with per-upload override
- Phase A: trigger from PersonDetailPage (enrich existing record)
- Phase B: trigger from PersonFormPage (prefill new/edited record)

## Architecture

### Data Flow

```
Upload (image)
     │
     ▼
POST /api/v1/ai/extract-document
     │
     ├─► OpenAI GPT-4o Vision (one call)
     │        └─ Returns: structured JSON with fields + confidence + portrait bbox
     │
     ├─► Pillow crops portrait if bbox returned
     │
     └─► ExtractionResult JSON response (no DB writes at this stage)

User reviews result in modal
     │
     ├─► PATCH /api/v1/persons/:id          (checked fields)
     ├─► POST  /api/v1/persons/:id/media    (document scan, type=document)
     ├─► POST  /api/v1/persons/:id/media    (portrait, type=photo, if selected)
     └─► PATCH /api/v1/persons/:id/avatar/:media_id  (if "set as avatar" checked)
```

### Approach

New dedicated `/ai/` router + service — isolated from media and person routers, independently testable, reusable for both phases.

## Backend

### Config (`app/config.py`)

Add one optional field:

```python
openai_api_key: Optional[str] = None
```

If not set, `/ai/extract-document` returns `503 Service Unavailable` with `{"detail": "AI not configured"}`. The feature degrades gracefully — all other functionality is unaffected.

### New files

**`app/services/ai_extractor.py`**

Single public function:

```python
async def extract_from_document(image_bytes: bytes, mime_type: str) -> ExtractionResult
```

Steps:
1. Base64-encode the image
2. Send one GPT-4o Vision call with a structured prompt requesting:
   - All person fields as JSON, each with `value` and `confidence` (`high` / `medium` / `low` / `none`)
   - Portrait bounding box as `[x1%, y1%, x2%, y2%]` or `null`
   - `document_type` string (e.g. `"passport"`, `"birth_certificate"`)
3. Parse and validate the JSON response
4. Normalise dates to `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` (same format used throughout the app)
5. If portrait bbox returned: use Pillow to crop and encode as JPEG base64
6. Return `ExtractionResult` dataclass

`ExtractionResult` shape:
```python
@dataclass
class FieldResult:
    value: Any          # str, list, or None
    confidence: str     # "high" | "medium" | "low" | "none"

@dataclass
class ExtractionResult:
    fields: dict[str, FieldResult]   # keyed by person field name
    portrait_b64: str | None         # JPEG base64 or None
    document_type: str | None        # e.g. "passport"
```

Extracted fields covered: `first_name`, `last_name`, `birth_name`, `gender`, `date_of_birth`, `place_of_birth`, `date_of_death`, `place_of_death`, `nationality`, `origin`, `occupations`, `biography`.

**`app/routers/ai.py`**

```
GET  /api/v1/ai/status
  Response: {"available": true | false}
  Used by frontend on load to decide whether to show AI toggle.

POST /api/v1/ai/extract-document
  Body: multipart, field "file" (image/jpeg, image/png, image/webp)
  Guards: openai_api_key must be set → else 503
  Calls: ai_extractor.extract_from_document()
  Response: ExtractionResult as JSON
  Does NOT write to DB.
```

### No DB migration required

Document scans are stored as `MediaType.document` (already exists in the enum). Portraits are stored as `MediaType.photo`. Both use the existing media table and file storage path `{media_storage_path}/{person_id}/{media_id}.ext`.

## Frontend

### Settings

**`useSettings` hook** — adds `ai_enabled: boolean` (default `true`) to the persisted settings object.

**`SettingsPage`** — new "KI-Analyse" section:
- Toggle: "KI-Dokumentenanalyse aktivieren"
- If `GET /ai/status` returns `available: false`, toggle is shown disabled with note: "Kein API-Schlüssel konfiguriert"

### `DocumentScanModal` (new shared component)

Two-step modal, shared between Phase A and Phase B via a `mode` prop (`"patch"` | `"prefill"`).

**Step 1 — Upload**
- Drag/drop or file picker (JPEG, PNG, WebP)
- AI toggle defaulting to global `ai_enabled` setting, overridable per-upload
- "Analysieren" button triggers `POST /ai/extract-document`; loading spinner while waiting

**Step 2 — Review**
- Left column: document thumbnail + portrait preview (if extracted)
  - Checkbox: "Als Avatar setzen"
  - Checkbox: "Foto zur Galerie hinzufügen"
- Right/bottom: field comparison table
  - Columns: Field | Current value | Extracted value | Confidence indicator | Checkbox
  - Fields with `confidence: none` are hidden
  - Fields with `confidence: low` shown but pre-unchecked
  - Fields with `confidence: high` or `medium` pre-checked
  - Fields where extracted value equals current value pre-unchecked (no change needed)
- "Abbrechen" / "Übernehmen" buttons

**On confirm (mode = "patch"):**
1. `PATCH /api/v1/persons/:id` — checked fields only
2. `POST /api/v1/persons/:id/media` — document scan (`media_type: document`, title = detected document_type)
3. `POST /api/v1/persons/:id/media` — portrait (`media_type: photo`) if portrait checkbox checked
4. `PATCH /api/v1/persons/:id/avatar/:media_id` — if "Als Avatar setzen" checked
5. Invalidate person + media React Query caches
6. Toast: e.g. "5 Felder übernommen · Foto gespeichert"

**On confirm (mode = "prefill"):**
- Populate `react-hook-form` fields directly (no API calls at this point)
- Portrait and document scan are queued as pending uploads; PersonFormPage uploads them immediately after the person is created/saved (using the newly returned `person_id`)
- This applies to both create and edit flows — queuing ensures a `person_id` always exists before media is stored

### Phase A — PersonDetailPage

"Dokument scannen" button in the media section header. Opens `DocumentScanModal` in `"patch"` mode with the current `personId`.

### Phase B — PersonFormPage

"Aus Dokument füllen" button near the top of the form. Opens `DocumentScanModal` in `"prefill"` mode. Extracted fields populate the form; user can edit before saving.

### Media Gallery — tab split

PersonDetailPage gallery gains two tabs: **Fotos** and **Dokumente**. Filtered client-side by `media_type`. Prevents document scans from cluttering the photo gallery.

## Error Handling

| Scenario | Behaviour |
|---|---|
| `openai_api_key` not set | `GET /ai/status` → `available: false`; upload button hidden/disabled |
| OpenAI API error / timeout | Modal shows inline error: "Analyse fehlgeschlagen. Bitte erneut versuchen." |
| No fields extracted (blank doc) | Step 2 shows empty table with note: "Keine Felder erkannt" |
| Portrait bbox out of bounds | Portrait crop silently skipped; `portrait_b64: null` |
| Date normalisation fails | Field kept but confidence downgraded to `low` |

## Testing

- **`tests/test_ai_extractor.py`**: unit tests for date normalisation, portrait crop, JSON parsing — OpenAI call mocked
- **`tests/test_ai_router.py`**: endpoint tests — `ai_extractor.extract_from_document` mocked; tests for missing API key (503), bad MIME type (400), happy path
- **Frontend**: Vitest unit tests for the pre-check logic (which fields get pre-checked based on confidence + current value)

## Out of Scope

- Multi-page document support (only single-image upload)
- Batch processing of multiple documents
- AI-generated biography text
- On-device OCR fallback
