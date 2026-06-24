# Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-user JWT authentication to the ancestry-app web UI and API, with a separate static API key for future MCP access.

**Architecture:** Backend adds a `require_auth` FastAPI dependency that accepts either a JWT or a static API key; it is a no-op when neither `AUTH_PASSWORD` nor `API_KEY` is configured. The frontend checks `/auth/status` on load, shows a `LoginPage` when auth is enabled and no token is stored, and attaches `Authorization: Bearer` on every API call via an axios interceptor.

**Tech Stack:** FastAPI, python-jose[cryptography], React 18 + TypeScript, axios, localStorage

## Global Constraints

- Working directory: `/project/src/ancestry-app`
- Run backend tests from `backend/` with: `docker compose exec backend pytest tests/ -v`
- Run frontend tests from `frontend/` with: `docker compose exec frontend npm test`
- Auth is **opt-in**: if none of `AUTH_PASSWORD`, `AUTH_SECRET_KEY`, `API_KEY` are set, every endpoint remains open (existing dev/test behaviour preserved)
- JWT algorithm: HS256, expiry: 30 days, subject claim: `"owner"`
- Library for JWT: `python-jose[cryptography]` (NOT PyJWT)
- localStorage key: `ancestry_token`
- All new backend tests follow the pattern in `backend/tests/test_ai_router.py` — set env vars via `monkeypatch.setenv`, clear settings cache with `get_settings.cache_clear()` before and after

---

## File Map

**Created:**
- `backend/app/auth.py` — `require_auth` FastAPI dependency
- `backend/app/routers/auth.py` — `/auth/status` and `/auth/login` endpoints
- `backend/tests/test_auth.py` — backend auth tests
- `frontend/src/hooks/useAuth.ts` — auth state (token, login, logout, authEnabled)
- `frontend/src/pages/LoginPage.tsx` — password form UI

**Modified:**
- `backend/pyproject.toml` — add `python-jose[cryptography]`
- `backend/app/config.py` — add `auth_password`, `auth_secret_key`, `api_key` fields
- `backend/app/main.py` — register auth router (public), add `Depends(require_auth)` to all other routers
- `frontend/src/api/client.ts` — add `authApi`, add Bearer request interceptor, add 401 response interceptor
- `frontend/src/App.tsx` — auth status check, auth guard, logout button in Nav

---

### Task 1: Backend config + dependency

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/config.py`
- Create: `backend/app/auth.py`

**Interfaces:**
- Produces: `require_auth` async function (FastAPI dependency, importable from `app.auth`)

---

- [ ] **Step 1: Add python-jose to pyproject.toml**

In `backend/pyproject.toml`, add to the `dependencies` list:
```toml
"python-jose[cryptography]>=3.3.0",
```

The full dependencies block becomes:
```toml
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
    "pymupdf>=1.24.0",
    "python-jose[cryptography]>=3.3.0",
]
```

- [ ] **Step 2: Add auth config fields to Settings**

Edit `backend/app/config.py`. Replace the class body so it reads:
```python
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    media_storage_path: str = "/data/media"
    max_upload_size_mb: int = 20
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: str = "gpt-4o"
    auth_password: Optional[str] = None
    auth_secret_key: Optional[str] = None
    api_key: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 3: Write failing tests for require_auth**

Create `backend/tests/test_auth.py`:
```python
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
```

- [ ] **Step 4: Run tests — expect failures**

```bash
cd /project/src/ancestry-app
docker compose exec backend pytest tests/test_auth.py -v
```

Expected: `test_persons_blocked_without_token`, `test_persons_accessible_with_api_key`, `test_persons_blocked_with_wrong_api_key` should FAIL (auth not yet wired).

- [ ] **Step 5: Create backend/app/auth.py**

```python
from typing import Optional
from fastapi import Header, HTTPException
from jose import JWTError, jwt
from app.config import get_settings


async def require_auth(authorization: Optional[str] = Header(None)) -> None:
    settings = get_settings()

    if not settings.auth_password and not settings.api_key:
        return  # auth disabled

    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    token = authorization.removeprefix("Bearer ").strip()

    if settings.api_key and token == settings.api_key:
        return

    if not settings.auth_secret_key:
        raise HTTPException(status_code=503, detail="AUTH_SECRET_KEY not configured")

    try:
        jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

- [ ] **Step 6: Wire require_auth into main.py**

Edit `backend/app/main.py`. Add the import and update all `include_router` calls except the auth router (which doesn't exist yet but will be added in Task 2 — add its include here too, without `dependencies`):

```python
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
import app.models  # noqa: F401
from app.routers import persons, relationships, tree, media, gedcom, ai
from app.auth import require_auth

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

_auth_dep = [Depends(require_auth)]

app.include_router(persons.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(relationships.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(tree.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(media.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(gedcom.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(ai.router, prefix="/api/v1", dependencies=_auth_dep)


@app.get("/health", tags=["system"], summary="Health check")
async def health():
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
```

Note: the auth router (Task 2) will be added here without `_auth_dep`.

- [ ] **Step 7: Run tests — expect them to pass**

```bash
docker compose exec backend pytest tests/test_auth.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 8: Run full test suite to check for regressions**

```bash
docker compose exec backend pytest tests/ -v
```

Expected: all existing tests still pass (auth is disabled when no env vars set, so existing tests are unaffected).

- [ ] **Step 9: Commit**

```bash
git add backend/pyproject.toml backend/app/config.py backend/app/auth.py backend/app/main.py backend/tests/test_auth.py
git commit -m "feat: add require_auth dependency and auth config fields"
```

---

### Task 2: Auth router (status + login endpoints)

**Files:**
- Create: `backend/app/routers/auth.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `require_auth` from `app.auth`, `get_settings` from `app.config`
- Produces:
  - `GET /api/v1/auth/status` → `{"auth_enabled": bool}`
  - `POST /api/v1/auth/login` body `{"password": str}` → `{"access_token": str, "token_type": "bearer"}` or 401

---

- [ ] **Step 1: Add auth router tests to test_auth.py**

Append these tests to `backend/tests/test_auth.py`:

```python
@pytest.mark.asyncio
async def test_auth_status_disabled(async_client):
    r = await async_client.get("/api/v1/auth/status")
    assert r.status_code == 200
    assert r.json()["auth_enabled"] is False


@pytest.mark.asyncio
async def test_auth_status_enabled(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/auth/status")
    assert r.json()["auth_enabled"] is True
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_wrong_password(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "correct")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "wrong"})
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_correct_password(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "correct")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_returns_usable_jwt(async_client, monkeypatch):
    """Token from /login should grant access to a protected endpoint."""
    monkeypatch.setenv("AUTH_PASSWORD", "correct")
    monkeypatch.setenv("AUTH_SECRET_KEY", "deadbeef" * 8)
    from app.config import get_settings
    get_settings.cache_clear()

    login_r = await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    token = login_r.json()["access_token"]

    persons_r = await async_client.get(
        "/api/v1/persons",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert persons_r.status_code == 200
    get_settings.cache_clear()
```

- [ ] **Step 2: Run new tests — expect failures**

```bash
docker compose exec backend pytest tests/test_auth.py -v -k "status or login"
```

Expected: FAIL — `/api/v1/auth/status` and `/api/v1/auth/login` don't exist yet (404).

- [ ] **Step 3: Create backend/app/routers/auth.py**

```python
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from jose import jwt
from pydantic import BaseModel
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.get("/status", summary="Auth availability check")
async def auth_status():
    """Returns whether authentication is enabled on this server."""
    settings = get_settings()
    return {"auth_enabled": bool(settings.auth_password or settings.api_key)}


@router.post("/login", response_model=TokenResponse, summary="Obtain a JWT")
async def login(body: LoginRequest):
    """Exchange the admin password for a 30-day JWT."""
    settings = get_settings()
    if not settings.auth_password or body.password != settings.auth_password:
        raise HTTPException(status_code=401, detail="Invalid password")
    if not settings.auth_secret_key:
        raise HTTPException(status_code=503, detail="AUTH_SECRET_KEY not configured")
    exp = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode(
        {"sub": "owner", "exp": exp},
        settings.auth_secret_key,
        algorithm="HS256",
    )
    return TokenResponse(access_token=token)
```

- [ ] **Step 4: Register auth router in main.py (public — no _auth_dep)**

Edit `backend/app/main.py`. Add `auth` to the routers import and register it **without** `_auth_dep`:

```python
from app.routers import persons, relationships, tree, media, gedcom, ai, auth

# ... after the other include_router calls:
app.include_router(auth.router, prefix="/api/v1")  # no auth dep — public
```

Full updated import + router section:
```python
from app.routers import persons, relationships, tree, media, gedcom, ai, auth

_auth_dep = [Depends(require_auth)]

app.include_router(auth.router, prefix="/api/v1")
app.include_router(persons.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(relationships.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(tree.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(media.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(gedcom.router, prefix="/api/v1", dependencies=_auth_dep)
app.include_router(ai.router, prefix="/api/v1", dependencies=_auth_dep)
```

- [ ] **Step 5: Run all auth tests**

```bash
docker compose exec backend pytest tests/test_auth.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
docker compose exec backend pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/auth.py backend/app/main.py backend/tests/test_auth.py
git commit -m "feat: add auth router with /auth/status and /auth/login"
```

---

### Task 3: Frontend auth hook + API client updates

**Files:**
- Create: `frontend/src/hooks/useAuth.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces from `useAuth.ts`:
  ```ts
  interface AuthState {
    token: string | null
    authEnabled: boolean | null  // null = loading
    login: (password: string) => Promise<void>
    logout: () => void
  }
  export function useAuthState(): AuthState
  ```
- Produces from `client.ts`:
  ```ts
  export const authApi: {
    status: () => Promise<{ auth_enabled: boolean }>
    login: (password: string) => Promise<{ access_token: string; token_type: string }>
  }
  ```

---

- [ ] **Step 1: Create frontend/src/hooks/useAuth.ts**

```typescript
import { useState, useCallback } from 'react'
import axios from 'axios'

const TOKEN_KEY = 'ancestry_token'

export interface AuthState {
  token: string | null
  authEnabled: boolean | null
  login: (password: string) => Promise<void>
  logout: () => void
  setAuthEnabled: (v: boolean) => void
}

export function useAuthState(): AuthState {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null)

  const login = useCallback(async (password: string) => {
    const res = await axios.post<{ access_token: string; token_type: string }>(
      '/api/v1/auth/login',
      { password },
    )
    localStorage.setItem(TOKEN_KEY, res.data.access_token)
    setToken(res.data.access_token)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }, [])

  return { token, authEnabled, login, logout, setAuthEnabled }
}
```

- [ ] **Step 2: Add authApi and interceptors to client.ts**

Edit `frontend/src/api/client.ts`. Add `authApi` and the two interceptors. The full updated file:

```typescript
import axios from 'axios'
import type { Person, PersonCreate, Relationship, RelationshipCreate, TreeData, MediaItem, GedcomImportResult, ExtractionResult } from '../types'

const TOKEN_KEY = 'ancestry_token'

const api = axios.create({
  baseURL: '/api/v1',
})

// Attach stored JWT on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401 (not from login itself), clear token and redirect to root
api.interceptors.response.use(
  res => res,
  err => {
    if (
      err.response?.status === 401 &&
      !err.config?.url?.includes('/auth/login')
    ) {
      localStorage.removeItem(TOKEN_KEY)
      window.location.href = '/'
    }
    return Promise.reject(err)
  },
)

export const authApi = {
  status: () =>
    api.get<{ auth_enabled: boolean }>('/auth/status').then(r => r.data),
  login: (password: string) =>
    api.post<{ access_token: string; token_type: string }>('/auth/login', { password }).then(r => r.data),
}

export const personsApi = {
  list: () => api.get<Person[]>('/persons').then(r => r.data),
  get: (id: string) => api.get<Person>(`/persons/${id}`).then(r => r.data),
  create: (data: PersonCreate) => api.post<Person>('/persons', data).then(r => r.data),
  update: (id: string, data: Partial<PersonCreate>) =>
    api.patch<Person>(`/persons/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/persons/${id}`),
}

export const relationshipsApi = {
  list: (personId?: string) =>
    api.get<Relationship[]>('/relationships', { params: personId ? { person_id: personId } : {} }).then(r => r.data),
  create: (data: RelationshipCreate) => api.post<Relationship>('/relationships', data).then(r => r.data),
  delete: (id: string) => api.delete(`/relationships/${id}`),
}

export const treeApi = {
  get: () => api.get<TreeData>('/tree').then(r => r.data),
}

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

export const gedcomApi = {
  exportUrl: (anonymizeLiving = false) =>
    `/api/v1/gedcom/export${anonymizeLiving ? '?anonymize_living=true' : ''}`,
  import: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<GedcomImportResult>('/gedcom/import', form).then(r => r.data)
  },
}

export const exportApi = {
  jsonExportUrl: (anonymizeLiving = false) =>
    `/api/v1/export/json${anonymizeLiving ? '?anonymize_living=true' : ''}`,
  importJson: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<GedcomImportResult>('/import/json', form).then(r => r.data)
  },
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /project/src/ancestry-app/frontend && docker compose exec frontend npx tsc --noEmit
```

Expected: no errors related to `useAuth.ts` or `client.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useAuth.ts frontend/src/api/client.ts
git commit -m "feat: add useAuth hook and auth interceptors to API client"
```

---

### Task 4: Frontend LoginPage + App auth guard + Nav logout

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useAuthState` from `../hooks/useAuth`, `authApi` from `../api/client`

---

- [ ] **Step 1: Create frontend/src/pages/LoginPage.tsx**

```tsx
import { useState, FormEvent } from 'react'

interface Props {
  onLogin: (password: string) => Promise<void>
}

export default function LoginPage({ onLogin }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onLogin(password)
    } catch {
      setError('Falsches Passwort')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="bg-white dark:bg-gray-900 shadow-md rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-6 text-center">
          🌳 Stammbaum
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
              autoFocus
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update App.tsx with auth guard and logout button**

Replace the full contents of `frontend/src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PersonListPage from './pages/PersonListPage'
import PersonFormPage from './pages/PersonFormPage'
import PersonDetailPage from './pages/PersonDetailPage'
import TreePage from './pages/TreePage'
import TimelinePage from './pages/TimelinePage'
import GedcomPage from './pages/GedcomPage'
import DashboardPage from './pages/DashboardPage'
import SurnamesPage from './pages/SurnamesPage'
import SettingsPage from './pages/SettingsPage'
import SearchPage from './pages/SearchPage'
import LoginPage from './pages/LoginPage'
import { ToastProvider } from './hooks/useToast'
import { useAuthState } from './hooks/useAuth'
import { authApi } from './api/client'

interface NavProps {
  onLogout: () => void
  showLogout: boolean
}

function Nav({ onLogout, showLogout }: NavProps) {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded font-medium transition-colors text-sm ${
      isActive
        ? 'bg-indigo-600 text-white'
        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`
  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center gap-2 shadow-sm flex-wrap">
      <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mr-4">🌳 Stammbaum</span>
      <NavLink to="/" end className={cls}>Übersicht</NavLink>
      <NavLink to="/persons" className={cls}>Personen</NavLink>
      <NavLink to="/tree" className={cls}>Stammbaum</NavLink>
      <NavLink to="/timeline" className={cls}>Zeitleiste</NavLink>
      <NavLink to="/surnames" className={cls}>Familien</NavLink>
      <NavLink to="/gedcom" className={cls}>GEDCOM</NavLink>
      <NavLink to="/search" className={cls}>Suche</NavLink>
      <NavLink to="/settings" className={cls}>Einstellungen</NavLink>
      {showLogout && (
        <button
          onClick={onLogout}
          className="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
        >
          Abmelden
        </button>
      )}
    </nav>
  )
}

function AppRoutes({ onLogout, showLogout }: NavProps) {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Nav onLogout={onLogout} showLogout={showLogout} />
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/persons" element={<PersonListPage />} />
            <Route path="/persons/new" element={<PersonFormPage />} />
            <Route path="/persons/:id" element={<PersonDetailPage />} />
            <Route path="/persons/:id/edit" element={<PersonFormPage />} />
            <Route path="/tree" element={<TreePage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/surnames" element={<SurnamesPage />} />
            <Route path="/gedcom" element={<GedcomPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default function App() {
  const { token, authEnabled, login, logout, setAuthEnabled } = useAuthState()

  useEffect(() => {
    authApi.status().then(({ auth_enabled }) => setAuthEnabled(auth_enabled))
  }, [setAuthEnabled])

  if (authEnabled === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Laden…</div>
      </div>
    )
  }

  if (authEnabled && !token) {
    return <LoginPage onLogin={login} />
  }

  return (
    <ToastProvider>
      <AppRoutes onLogout={logout} showLogout={authEnabled} />
    </ToastProvider>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
docker compose exec frontend npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run frontend tests**

```bash
docker compose exec frontend npm test
```

Expected: all existing tests pass (dashboard, treeHierarchy, documentScanPrecheck).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/App.tsx
git commit -m "feat: add LoginPage and auth guard to App"
```

---

### Task 5: Docker env vars + rebuild

**Files:**
- Modify: `docker-compose.override.yml`

---

- [ ] **Step 1: Generate a secret key**

Run this and copy the output:
```bash
openssl rand -hex 32
```

- [ ] **Step 2: Add auth env vars to docker-compose.override.yml**

Edit `docker-compose.override.yml`. Under the `backend` service `environment` block, add:

```yaml
AUTH_PASSWORD: "choose-a-strong-password"
AUTH_SECRET_KEY: "<paste-openssl-output-here>"
API_KEY: "sk-ancestry-<random-suffix>"
```

The full `environment` block should look like:
```yaml
environment:
  OPENAI_API_KEY: "sk-bzfasUbS_iiFKzZ2msuVYA"
  OPENAI_BASE_URL: "http://192.168.178.20:4000"
  OPENAI_MODEL: "gpt-4o"
  AUTH_PASSWORD: "choose-a-strong-password"
  AUTH_SECRET_KEY: "<output of openssl rand -hex 32>"
  API_KEY: "sk-ancestry-<random-suffix>"
```

- [ ] **Step 3: Install new backend dependency**

The docker image needs to be rebuilt to pick up `python-jose`:
```bash
cd /project/src/ancestry-app
docker compose build backend
```

- [ ] **Step 4: Restart services**

```bash
docker compose up -d
```

- [ ] **Step 5: Verify health endpoint still works**

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `{"status": "ok", "db": "connected"}`

- [ ] **Step 6: Verify auth status endpoint**

```bash
curl -s http://localhost:8000/api/v1/auth/status | python3 -m json.tool
```

Expected: `{"auth_enabled": true}`

- [ ] **Step 7: Verify login works**

```bash
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-chosen-password"}' | python3 -m json.tool
```

Expected: `{"access_token": "eyJ...", "token_type": "bearer"}`

- [ ] **Step 8: Verify protected endpoint requires token**

```bash
curl -s http://localhost:8000/api/v1/persons
```

Expected: `{"detail": "Authorization header required"}` (status 401)

- [ ] **Step 9: Open app in browser and verify login screen appears**

Navigate to `http://localhost:3000` (or the configured frontend URL). The login screen should appear. Enter the password from `AUTH_PASSWORD` — the app should load normally.

- [ ] **Step 10: Commit docker config**

```bash
git add docker-compose.override.yml
git commit -m "feat: configure auth env vars in docker-compose.override.yml"
```

> Note: `docker-compose.override.yml` contains credentials. Ensure this file is in `.gitignore` if pushing to a public repo, or use Docker secrets for production.
