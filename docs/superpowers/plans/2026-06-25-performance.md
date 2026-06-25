# Performance Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce unnecessary network traffic, prevent DB connection exhaustion, stop redundant refetches, and cap unbounded API responses.

**Architecture:** Three independent areas: (1) infrastructure config changes with no API impact (GZip, DB pool, React Query staleTime); (2) a database migration adding name indexes; (3) a paginated media listing endpoint with a matching frontend update. No schema changes beyond indexes. No caching layer introduced (GZip compression covers the bandwidth concern for this homelab scale).

**Tech Stack:** FastAPI `GZipMiddleware`, SQLAlchemy async engine pool params, TanStack React Query, Alembic, PostgreSQL

## Global Constraints

- Python 3.12, FastAPI ≥0.115, SQLAlchemy ≥2.0, Alembic ≥1.13
- Tests run inside the container: `docker compose exec backend pytest -v`
- All existing tests must pass after each task
- `pool_size`, `max_overflow`, `pool_recycle` apply only to the production asyncpg engine; tests override `get_db` with their own in-memory SQLite engine so pool config has no effect on them
- No UI pagination widget needed — frontend passes `limit=500` to preserve existing UX while giving the backend a sensible hard cap
- Audit items already addressed (not in scope): image lazy loading (already `loading="lazy"` throughout), thumbnails (already `?thumb=true` throughout), D3+ReactFlow (both legitimately used for separate tree views)

---

## Task 1: GZip Middleware + DB Connection Pool + React Query staleTime

Three one-liner config changes with no API surface changes. Grouped into one task because they share a commit and test cycle — a reviewer can meaningfully approve or reject all three together.

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/database.py`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: compressed HTTP responses for payloads ≥1000 bytes; asyncpg pool with 10 base connections; React Query stale window of 5 minutes

- [ ] **Step 1: Add GZipMiddleware to main.py**

In `backend/app/main.py`, add the import and middleware registration. The final file should look like:

```python
import logging
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import app.models  # noqa: F401 — registers all mappers with SQLAlchemy
from app.routers import persons, relationships, tree, media, gedcom, ai, auth
from app.auth import require_auth

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

app = FastAPI(
    title="Ancestry App",
    description="Familien-Stammbaum Verwaltung",
    version="1.0.0",
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_auth_dep = [Depends(require_auth)]

app.include_router(auth.router, prefix="/api/v1")
app.include_router(persons.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(relationships.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(tree.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(media.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(gedcom.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(ai.router, prefix="/api/v1", dependencies=_auth_dep)


@app.get("/health", tags=["system"], summary="Health check")
async def health():
    """Liveness + readiness probe."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
```

Note: `GZipMiddleware` must be registered **before** `CORSMiddleware` — middleware runs in reverse registration order in Starlette; gzip runs outermost so it sees the full response.

- [ ] **Step 2: Configure DB connection pool in database.py**

Replace the full content of `backend/app/database.py`:

```python
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import get_settings

engine = create_async_engine(
    get_settings().database_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,   # recycle connections after 1 hour to avoid stale handles
    pool_pre_ping=True,  # test connection health before checkout
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
```

- [ ] **Step 3: Increase React Query staleTime to 5 minutes**

Replace the full content of `frontend/src/main.tsx`:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 minutes — family tree data changes infrequently
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
```

- [ ] **Step 4: Rebuild backend and run full test suite**

```bash
docker compose build backend && docker compose up -d backend
docker compose exec backend pytest -v 2>&1 | tail -20
```

Expected: all tests pass (the one pre-existing `test_health_db_connected` asyncpg failure is unrelated and acceptable).

- [ ] **Step 5: Verify GZip is active**

```bash
curl -s -I -H "Accept-Encoding: gzip" http://localhost:8000/health
```

Expected: `Content-Encoding: gzip` header present (health endpoint returns JSON ≥1000 bytes when db info included — if not, try `/api/v1/persons` which will be larger with real data).

Actually: test with the tree endpoint which returns a larger payload:

```bash
curl -s -o /dev/null -D - -H "Accept-Encoding: gzip" http://localhost:3000/api/v1/tree | grep -i "content-encoding"
```

Expected: `content-encoding: gzip`

- [ ] **Step 6: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/main.py backend/app/database.py frontend/src/main.tsx
git -C /project/src/ancestry-app commit -m "perf: add GZip middleware, configure DB connection pool, increase React Query staleTime"
```

---

## Task 2: DB Indexes for Person Name Columns

Add indexes on `persons.last_name` and `persons.first_name` via an Alembic migration. These support future ORDER BY or backend search queries. The migration runs inside the container against the live PostgreSQL database.

**Files:**
- Create: `backend/alembic/versions/c3d4e5f6a7b2_add_person_name_indexes.py`

**Interfaces:**
- Produces: `ix_persons_last_name` and `ix_persons_first_name` indexes in PostgreSQL

- [ ] **Step 1: Generate the migration file**

Create `backend/alembic/versions/c3d4e5f6a7b2_add_person_name_indexes.py` with this exact content:

```python
"""add person name indexes

Revision ID: c3d4e5f6a7b2
Revises: b2c3d4e5f6a1
Create Date: 2026-06-25 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'c3d4e5f6a7b2'
down_revision: Union[str, None] = 'b2c3d4e5f6a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_persons_last_name', 'persons', ['last_name'])
    op.create_index('ix_persons_first_name', 'persons', ['first_name'])


def downgrade() -> None:
    op.drop_index('ix_persons_last_name', table_name='persons')
    op.drop_index('ix_persons_first_name', table_name='persons')
```

- [ ] **Step 2: Run the migration**

```bash
docker compose exec backend alembic upgrade head
```

Expected output ends with: `Running upgrade b2c3d4e5f6a1 -> c3d4e5f6a7b2, add person name indexes`

- [ ] **Step 3: Verify indexes exist in PostgreSQL**

```bash
docker compose exec db psql -U postgres -d ancestry -c "\di persons*"
```

Expected: shows `ix_persons_first_name`, `ix_persons_last_name` in the index list.

- [ ] **Step 4: Run test suite**

```bash
docker compose exec backend pytest -v 2>&1 | tail -10
```

Expected: same pass count as before — SQLite in-memory tests are unaffected by PostgreSQL indexes.

- [ ] **Step 5: Commit**

```bash
git -C /project/src/ancestry-app add backend/alembic/versions/c3d4e5f6a7b2_add_person_name_indexes.py
git -C /project/src/ancestry-app commit -m "perf: add DB indexes on persons.first_name and persons.last_name"
```

---

## Task 3: Media Listing Pagination

The `GET /persons/{person_id}/media` endpoint currently returns all media with no limit. Add `skip` and `limit` query parameters. The frontend passes `limit=500` to preserve existing UX (all photos visible) while giving the backend a hard cap that prevents pathological payloads.

**Files:**
- Modify: `backend/app/routers/media.py`
- Create: `backend/tests/test_media.py`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- `GET /persons/{person_id}/media?skip=0&limit=50` — default 50, max 500
- `mediaApi.listPersonMedia(personId: string): Promise<MediaItem[]>` — unchanged call signature, now requests `?limit=500` internally
- PersonDetailPage: no changes needed — still calls `mediaApi.listPersonMedia(personId)` with no args

- [ ] **Step 1: Write failing pagination test**

Create `backend/tests/test_media.py`:

```python
"""Tests for media listing pagination."""
import io
import pytest


PERSON = {"first_name": "Foto", "last_name": "Test"}


@pytest.mark.asyncio
async def test_list_person_media_empty(async_client):
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    r = await async_client.get(f"/api/v1/persons/{person['id']}/media")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_person_media_default_limit(async_client):
    """Endpoint accepts skip and limit query params."""
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    pid = person["id"]

    # Upload 3 photos
    for i in range(3):
        img = io.BytesIO(
            b"\xff\xd8\xff\xe0" + b"\x00" * 10 + b"\xff\xd9"  # minimal JPEG magic bytes
        )
        await async_client.post(
            f"/api/v1/persons/{pid}/media",
            files={"file": (f"photo{i}.jpg", img, "image/jpeg")},
        )

    # Default: returns up to 50
    r = await async_client.get(f"/api/v1/persons/{pid}/media")
    assert r.status_code == 200
    assert len(r.json()) == 3

    # limit=2 returns only 2
    r2 = await async_client.get(f"/api/v1/persons/{pid}/media?limit=2")
    assert r2.status_code == 200
    assert len(r2.json()) == 2

    # skip=2 returns 1 (the third)
    r3 = await async_client.get(f"/api/v1/persons/{pid}/media?skip=2")
    assert r3.status_code == 200
    assert len(r3.json()) == 1


@pytest.mark.asyncio
async def test_list_person_media_limit_cap(async_client):
    """limit > 500 is rejected."""
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    r = await async_client.get(f"/api/v1/persons/{person['id']}/media?limit=9999")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_person_media_negative_skip_rejected(async_client):
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    r = await async_client.get(f"/api/v1/persons/{person['id']}/media?skip=-1")
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec backend pytest tests/test_media.py -v 2>&1 | tail -20
```

Expected: `test_list_person_media_limit_cap` and `test_list_person_media_negative_skip_rejected` FAIL (no validation yet); the upload tests may also fail due to magic-byte validation — the JPEG bytes above are a valid minimal JPEG header so should pass.

- [ ] **Step 3: Update list_person_media in backend/app/routers/media.py**

Find the `list_person_media` function (currently around line 139) and replace it:

```python
@router.get("/persons/{person_id}/media", summary="List person media", tags=["media"])
async def list_person_media(
    person_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Return media records belonging to a person, newest first. Max 500 per page."""
    result = await db.execute(
        select(Media)
        .where(Media.person_id == person_id)
        .order_by(Media.uploaded_at.desc())
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()
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

Also ensure `Query` is imported at the top of `media.py`. It should already be imported since the upload size check uses it — but verify the import line includes `Query`:

```python
from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, File
```

- [ ] **Step 4: Run backend tests**

```bash
docker compose exec backend pytest tests/test_media.py -v 2>&1 | tail -20
```

Expected: all 4 media tests PASS.

- [ ] **Step 5: Update frontend/src/api/client.ts — listPersonMedia**

In `frontend/src/api/client.ts`, replace the `listPersonMedia` entry in `mediaApi`:

```typescript
  listPersonMedia: (personId: string) =>
    api.get<MediaItem[]>(`/persons/${personId}/media`, { params: { limit: 500 } }).then(r => r.data),
```

This passes `?limit=500` on every call, loading up to 500 media items — enough for any realistic family tree while giving the backend a hard cap. PersonDetailPage calls `mediaApi.listPersonMedia(personId)` with no args, so no changes are needed there.

- [ ] **Step 6: Run full test suite**

```bash
docker compose exec backend pytest -v 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/routers/media.py backend/tests/test_media.py frontend/src/api/client.ts
git -C /project/src/ancestry-app commit -m "perf: add skip/limit pagination to media listing endpoint"
```

---

## Self-Review

**Spec coverage:**
- ✅ GZip compression — Task 1
- ✅ DB connection pool config — Task 1
- ✅ React Query staleTime increase (30s → 5min) — Task 1
- ✅ DB indexes on first_name, last_name — Task 2
- ✅ Media listing pagination with cap — Task 3
- ✅ Image lazy loading — already implemented throughout frontend (no task needed)
- ✅ Thumbnails used by default — already implemented throughout frontend (no task needed)
- ✅ D3 vs ReactFlow bundle — D3 used in D3TreeView.tsx, ReactFlow separate; both legitimately used; no redundancy (no task needed)
- ✅ No caching/ETags — GZip covers bandwidth concern at homelab scale; ETags add invalidation complexity not warranted here (deferred, noted)

**Placeholder scan:** None found — all steps have concrete code.

**Type consistency:**
- `mediaApi.listPersonMedia(personId: string)` call signature unchanged — PersonDetailPage needs no update
- `Query` import already present in media.py (search showed it was there)
- `GZipMiddleware` import from `fastapi.middleware.gzip` — correct package path
