# Security Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the ancestry app against the top security issues identified in the audit: httpOnly cookie auth, security headers, input validation, MIME magic-byte checks, relationship integrity, security logging, and pagination limits.

**Architecture:** The largest change is moving JWT from localStorage to an httpOnly SameSite=Strict cookie — backend `/auth/login` sets the cookie, `require_auth` reads it, frontend removes all localStorage usage and uses axios `withCredentials: true`. All other changes are isolated to individual files. No database migrations are needed.

**Tech Stack:** FastAPI, python-jose, python-magic (new), Pydantic v2, Axios, React, nginx

## Global Constraints

- Python 3.12, FastAPI ≥0.115, Pydantic v2 (use `model_dump`, `Field`, `field_validator`)
- Credentials in `.env` and `docker-compose.override.yml` are kept as-is (local test environment)
- `docker-compose.override.yml` added to `.gitignore` to prevent future accidental commits
- Tests run with: `docker compose exec backend pytest` or `cd backend && pytest`
- All tests must pass after each task; run the full suite before committing
- Cookie `secure=False` in dev (no HTTPS); nginx in prod should set HTTPS — do not force `secure=True`

---

## Task 1: Gitignore + Security Headers

**Files:**
- Modify: `.gitignore`
- Modify: `frontend/nginx.conf`

**Interfaces:**
- Produces: nginx serves security headers on every response

- [ ] **Step 1: Add docker-compose.override.yml to .gitignore**

In `/project/src/ancestry-app/.gitignore`, add after the existing `.env` line:

```
docker-compose.override.yml
```

- [ ] **Step 2: Add security headers to nginx.conf**

Replace the contents of `/project/src/ancestry-app/frontend/nginx.conf` with:

```nginx
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    resolver 127.0.0.11 valid=10s;
    set $backend http://backend:8000;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self';" always;

    location /api/ {
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 50m;
    }

    location ~ ^/(docs|redoc|openapi.json)$ {
        proxy_pass $backend;
        proxy_set_header Host $host;
    }

    location /health {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Rebuild frontend container and verify headers**

```bash
docker compose build frontend && docker compose up -d frontend
curl -sI http://localhost:3000/ | grep -E "X-Frame|X-Content|Referrer|Content-Security"
```

Expected: all four headers present.

- [ ] **Step 4: Commit**

```bash
git -C /project/src/ancestry-app add .gitignore frontend/nginx.conf
git -C /project/src/ancestry-app commit -m "security: add nginx security headers and gitignore override file"
```

---

## Task 2: JWT → httpOnly Cookie Auth

Move token storage from `localStorage` to an httpOnly SameSite=Strict cookie. The backend sets the cookie on login and clears it on logout. The frontend removes all localStorage references and uses `withCredentials: true` so axios sends the cookie automatically.

**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/auth.py`
- Modify: `backend/tests/test_auth.py`
- Modify: `frontend/src/hooks/useAuth.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- `/auth/login` sets cookie `access_token`; still returns `{ access_token, token_type }` for API compat
- `/auth/logout` (new POST) clears cookie
- `/auth/status` returns `{ auth_enabled: bool, authenticated: bool }`
- `require_auth` reads cookie `access_token` OR `Authorization: Bearer <api_key>`

- [ ] **Step 1: Write failing tests for cookie auth**

Replace the full content of `backend/tests/test_auth.py` with:

```python
import os
import tempfile
from unittest.mock import patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("MEDIA_STORAGE_PATH", tempfile.mkdtemp(prefix="ancestry-test-auth-"))

from tests.conftest import *  # noqa: F401,F403


AUTH_ENV = {
    "AUTH_PASSWORD": "correct",
    "AUTH_SECRET_KEY": "deadbeef" * 8,
}


@pytest.mark.asyncio
async def test_persons_open_when_auth_disabled(async_client, monkeypatch):
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("AUTH_SECRET_KEY", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 200
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_persons_blocked_without_token(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_persons_accessible_with_api_key(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
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
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("API_KEY", "sk-test-static")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get(
        "/api/v1/persons",
        headers={"Authorization": "Bearer sk-wrong"},
    )
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_disabled(async_client, monkeypatch):
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/auth/status")
    assert r.status_code == 200
    data = r.json()
    assert data["auth_enabled"] is False
    assert data["authenticated"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_enabled_not_authenticated(async_client, monkeypatch):
    monkeypatch.setenv("AUTH_PASSWORD", "secret")
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.get("/api/v1/auth/status")
    data = r.json()
    assert data["auth_enabled"] is True
    assert data["authenticated"] is False
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_wrong_password(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "wrong"})
    assert r.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_sets_cookie(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()
    r = await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    assert r.status_code == 200
    assert "access_token" in r.cookies
    body = r.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_cookie_grants_access(async_client, monkeypatch):
    """Cookie from /login should grant access to a protected endpoint."""
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()

    await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    # httpx test client automatically sends cookies from previous responses
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 200
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_logout_clears_cookie(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()

    await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    r = await async_client.post("/api/v1/auth/logout")
    assert r.status_code == 200
    # after logout, persons should be blocked again
    r2 = await async_client.get("/api/v1/persons")
    assert r2.status_code == 401
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_auth_status_authenticated_after_login(async_client, monkeypatch):
    for k, v in AUTH_ENV.items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings
    get_settings.cache_clear()

    await async_client.post("/api/v1/auth/login", json={"password": "correct"})
    r = await async_client.get("/api/v1/auth/status")
    data = r.json()
    assert data["auth_enabled"] is True
    assert data["authenticated"] is True
    get_settings.cache_clear()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec backend pytest tests/test_auth.py -v 2>&1 | tail -30
```

Expected: several FAILED — `authenticated` key missing, no cookie set, logout endpoint missing.

- [ ] **Step 3: Update backend/app/routers/auth.py**

Replace the full file content:

```python
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Response
from jose import JWTError, jwt
from pydantic import BaseModel
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days


class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.get("/status", summary="Auth availability check")
async def auth_status(request: Request):
    """Returns whether authentication is enabled and whether the current session is authenticated."""
    settings = get_settings()
    auth_enabled = bool(settings.auth_password)
    authenticated = False

    if auth_enabled and settings.auth_secret_key:
        token = request.cookies.get(COOKIE_NAME)
        if token:
            try:
                jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
                authenticated = True
            except JWTError:
                pass

        if not authenticated and settings.api_key:
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer ") and auth_header[7:] == settings.api_key:
                authenticated = True

    return {"auth_enabled": auth_enabled, "authenticated": authenticated}


@router.post("/login", response_model=TokenResponse, summary="Obtain a JWT")
async def login(body: LoginRequest, response: Response):
    """Exchange the admin password for a JWT stored in an httpOnly cookie."""
    settings = get_settings()
    if not settings.auth_password or body.password != settings.auth_password:
        logger.warning("Failed login attempt with wrong password")
        raise HTTPException(status_code=401, detail="Invalid password")
    if not settings.auth_secret_key:
        raise HTTPException(status_code=503, detail="AUTH_SECRET_KEY not configured")
    exp = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode(
        {"sub": "owner", "exp": exp},
        settings.auth_secret_key,
        algorithm="HS256",
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        secure=False,  # set to True when serving over HTTPS
        max_age=COOKIE_MAX_AGE,
    )
    return TokenResponse(access_token=token)


@router.post("/logout", summary="Invalidate session cookie")
async def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME, samesite="strict")
    return {"detail": "logged out"}
```

- [ ] **Step 4: Update backend/app/auth.py**

Replace the full file content:

```python
import logging
from typing import Optional
from fastapi import Cookie, Header, HTTPException, Request
from jose import JWTError, jwt
from app.config import get_settings

logger = logging.getLogger(__name__)

COOKIE_NAME = "access_token"


async def require_auth(
    request: Request,
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> None:
    settings = get_settings()

    if not settings.auth_password and not settings.api_key:
        return  # auth disabled

    # API key via Bearer header (for scripts / API usage)
    if authorization and settings.api_key:
        token = authorization.removeprefix("Bearer ").strip()
        if token == settings.api_key:
            return

    # JWT via httpOnly cookie
    if access_token and settings.auth_secret_key:
        try:
            jwt.decode(access_token, settings.auth_secret_key, algorithms=["HS256"])
            return
        except JWTError:
            logger.warning("Invalid or expired JWT cookie from %s", request.client.host if request.client else "unknown")

    logger.warning("Unauthorized request to %s from %s", request.url.path, request.client.host if request.client else "unknown")
    raise HTTPException(status_code=401, detail="Authentication required")
```

- [ ] **Step 5: Run backend tests**

```bash
docker compose exec backend pytest tests/test_auth.py -v 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 6: Update frontend/src/api/client.ts**

Replace the full file content:

```typescript
import axios from 'axios'
import type { Person, PersonCreate, Relationship, RelationshipCreate, TreeData, MediaItem, GedcomImportResult, ExtractionResult } from '../types'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,  // send httpOnly cookie on every request
})

// On 401 (not from login itself), redirect to root so App re-checks auth status
api.interceptors.response.use(
  res => res,
  err => {
    if (
      err.response?.status === 401 &&
      !err.config?.url?.includes('/auth/login')
    ) {
      window.location.href = '/'
    }
    return Promise.reject(err)
  },
)

export const authApi = {
  status: () =>
    api.get<{ auth_enabled: boolean; authenticated: boolean }>('/auth/status').then(r => r.data),
  login: (password: string) =>
    api.post<{ access_token: string; token_type: string }>('/auth/login', { password }).then(r => r.data),
  logout: () =>
    api.post('/auth/logout').then(r => r.data),
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

- [ ] **Step 7: Update frontend/src/hooks/useAuth.ts**

Replace the full file content:

```typescript
import { useState, useCallback } from 'react'
import { authApi } from '../api/client'

export interface AuthState {
  authenticated: boolean | null
  authEnabled: boolean | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  setAuthStatus: (enabled: boolean, authenticated: boolean) => void
}

export function useAuthState(): AuthState {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null)

  const login = useCallback(async (password: string) => {
    await authApi.login(password)
    // Re-fetch status so authenticated flips to true from the cookie
    const status = await authApi.status()
    setAuthEnabled(status.auth_enabled)
    setAuthenticated(status.authenticated)
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setAuthenticated(false)
  }, [])

  const setAuthStatus = useCallback((enabled: boolean, auth: boolean) => {
    setAuthEnabled(enabled)
    setAuthenticated(auth)
  }, [])

  return { authenticated, authEnabled, login, logout, setAuthStatus }
}
```

- [ ] **Step 8: Update frontend/src/App.tsx**

Replace the full file content:

```typescript
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
  const { authenticated, authEnabled, login, logout, setAuthStatus } = useAuthState()

  useEffect(() => {
    authApi.status().then(({ auth_enabled, authenticated }) => setAuthStatus(auth_enabled, authenticated))
  }, [setAuthStatus])

  if (authEnabled === null || authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Laden…</div>
      </div>
    )
  }

  if (authEnabled && !authenticated) {
    return <LoginPage onLogin={login} />
  }

  return (
    <ToastProvider>
      <AppRoutes onLogout={logout} showLogout={!!authEnabled} />
    </ToastProvider>
  )
}
```

- [ ] **Step 9: Check LoginPage for token prop usage**

Read `frontend/src/pages/LoginPage.tsx`. If `onLogin` is typed as `(password: string) => Promise<void>`, no change needed. The prop signature is unchanged.

- [ ] **Step 10: Run full backend test suite**

```bash
docker compose exec backend pytest -v 2>&1 | tail -40
```

Expected: all tests PASS.

- [ ] **Step 11: Rebuild and smoke-test in browser**

```bash
docker compose build backend frontend && docker compose up -d
```

Open http://localhost:3000, log in, confirm you can browse the app, confirm logout redirects to login page.

- [ ] **Step 12: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/auth.py backend/app/routers/auth.py backend/tests/test_auth.py frontend/src/api/client.ts frontend/src/hooks/useAuth.ts frontend/src/App.tsx
git -C /project/src/ancestry-app commit -m "security: move JWT from localStorage to httpOnly SameSite=Strict cookie"
```

---

## Task 3: Pydantic Field Constraints + Pagination Limits

Add length/pattern constraints on person schema fields and cap the persons list endpoint's `limit` parameter.

**Files:**
- Modify: `backend/app/schemas/person.py`
- Modify: `backend/app/routers/persons.py`
- Modify: `backend/tests/test_persons.py` (add validation tests)

**Interfaces:**
- `PersonBase.first_name`: `str = Field(..., min_length=1, max_length=100)`
- `PersonBase.last_name`: `str = Field(..., min_length=1, max_length=100)`
- `GET /persons?limit=` capped at 1000, default 100

- [ ] **Step 1: Write failing validation tests**

Append to `backend/tests/test_persons.py`:

```python
@pytest.mark.asyncio
async def test_create_person_empty_first_name_rejected(async_client):
    r = await async_client.post("/api/v1/persons", json={"first_name": "", "last_name": "Müller"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_person_name_too_long_rejected(async_client):
    r = await async_client.post("/api/v1/persons", json={"first_name": "A" * 101, "last_name": "B"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_persons_limit_cap(async_client):
    """limit > 1000 should be rejected with 422."""
    r = await async_client.get("/api/v1/persons?limit=9999")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_persons_negative_skip_rejected(async_client):
    r = await async_client.get("/api/v1/persons?skip=-1")
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose exec backend pytest tests/test_persons.py::test_create_person_empty_first_name_rejected tests/test_persons.py::test_list_persons_limit_cap -v
```

Expected: FAILED (currently accepts empty names and unlimited limits).

- [ ] **Step 3: Update backend/app/schemas/person.py**

Replace the full file content:

```python
import re
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from app.models.person import GenderEnum

_DATE_RE = re.compile(r'^\d{4}(-\d{2}(-\d{2})?)?$')


def _validate_partial_date(v: Optional[str]) -> Optional[str]:
    if v is not None and not _DATE_RE.match(v):
        raise ValueError('Date must be YYYY, YYYY-MM, or YYYY-MM-DD')
    return v


class PersonBase(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    birth_name: Optional[str] = Field(None, max_length=100)
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = Field(None, max_length=10)
    place_of_birth: Optional[str] = Field(None, max_length=200)
    date_of_death: Optional[str] = Field(None, max_length=10)
    place_of_death: Optional[str] = Field(None, max_length=200)
    is_living: bool = True
    nationality: Optional[str] = Field(None, max_length=100)
    origin: Optional[str] = Field(None, max_length=200)
    occupations: Optional[list] = None
    sources: Optional[list] = None
    biography: Optional[str] = Field(None, max_length=10000)

    @field_validator('date_of_birth', 'date_of_death', mode='before')
    @classmethod
    def validate_date(cls, v: Optional[str]) -> Optional[str]:
        return _validate_partial_date(v)


class PersonCreate(PersonBase):
    pass


class PersonUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    birth_name: Optional[str] = Field(None, max_length=100)
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = Field(None, max_length=10)
    place_of_birth: Optional[str] = Field(None, max_length=200)
    date_of_death: Optional[str] = Field(None, max_length=10)
    place_of_death: Optional[str] = Field(None, max_length=200)
    is_living: Optional[bool] = None
    nationality: Optional[str] = Field(None, max_length=100)
    origin: Optional[str] = Field(None, max_length=200)
    occupations: Optional[list] = None
    sources: Optional[list] = None
    biography: Optional[str] = Field(None, max_length=10000)

    @field_validator('date_of_birth', 'date_of_death', mode='before')
    @classmethod
    def validate_date(cls, v: Optional[str]) -> Optional[str]:
        return _validate_partial_date(v)


class PersonResponse(PersonBase):
    id: UUID
    avatar_media_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Update backend/app/routers/persons.py list endpoint**

In `backend/app/routers/persons.py`, replace the `list_persons` function signature:

```python
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.person import Person
from app.schemas.person import PersonCreate, PersonUpdate, PersonResponse

router = APIRouter(prefix="/persons", tags=["persons"])


@router.get("", response_model=list[PersonResponse], summary="List all persons")
async def list_persons(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Return persons in the family tree. Max 1000 per page; use skip for pagination."""
    result = await db.execute(select(Person).offset(skip).limit(limit))
    return result.scalars().all()
```

(Keep the rest of the file unchanged.)

- [ ] **Step 5: Run tests**

```bash
docker compose exec backend pytest tests/test_persons.py -v 2>&1 | tail -20
```

Expected: all PASS. Note: `test_list_persons_returns_all` creates 2 persons and fetches all — still works since default limit is 100 ≥ 2.

- [ ] **Step 6: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/schemas/person.py backend/app/routers/persons.py backend/tests/test_persons.py
git -C /project/src/ancestry-app commit -m "security: add Pydantic field constraints and cap persons list limit"
```

---

## Task 4: MIME Magic Byte Validation

Validate uploaded file content using `python-magic` (reads the actual file header bytes), not just the `Content-Type` header which can be spoofed.

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/routers/media.py`
- Modify: `backend/Dockerfile` (install `libmagic1`)

**Interfaces:**
- New helper `_validate_mime(content: bytes, allowed: set[str]) -> str` — raises 400 if MIME doesn't match allowed set, returns detected MIME type
- Upload handlers call `_validate_mime` after reading file bytes, before saving

- [ ] **Step 1: Add python-magic to pyproject.toml**

In `backend/pyproject.toml`, in the `dependencies` list, add:

```
"python-magic>=0.4.27",
```

- [ ] **Step 2: Add libmagic1 to Dockerfile**

In `backend/Dockerfile`, find the `RUN apt-get` or similar system package install line. If none exists, add before the `COPY` or `pip install` step:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 && rm -rf /var/lib/apt/lists/*
```

If there's already an `apt-get install` line, just append `libmagic1` to it.

- [ ] **Step 3: Add _validate_mime helper and update upload handlers in media.py**

At the top of `backend/app/routers/media.py`, after the existing imports, add:

```python
import magic
```

After the `EXT_BY_MIME` dict definition, add the helper function:

```python
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
DOCUMENT_MIMES = IMAGE_MIMES | {"application/pdf"}


def _validate_mime(content: bytes, allowed: set[str]) -> str:
    """Detect MIME type from file magic bytes and reject if not in allowed set."""
    detected = magic.from_buffer(content, mime=True)
    if detected not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed (detected: {detected})",
        )
    return detected
```

In each upload handler (`upload_avatar`, `upload_photo`, `upload_document`), replace:

```python
    ext = EXT_BY_MIME.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF allowed")

    content = await file.read()
```

with:

```python
    content = await file.read()
    detected_mime = _validate_mime(content, IMAGE_MIMES)
    ext = EXT_BY_MIME.get(detected_mime, "bin")
```

For `upload_document` use `DOCUMENT_MIMES` instead of `IMAGE_MIMES`:

```python
    content = await file.read()
    detected_mime = _validate_mime(content, DOCUMENT_MIMES)
    ext = EXT_BY_MIME.get(detected_mime, "bin")
```

Also in each handler, replace `mime_type=file.content_type` with `mime_type=detected_mime` when constructing the `Media` object.

- [ ] **Step 4: Rebuild backend and run tests**

```bash
docker compose build backend && docker compose exec backend pytest -v 2>&1 | tail -30
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git -C /project/src/ancestry-app add backend/pyproject.toml backend/Dockerfile backend/app/routers/media.py
git -C /project/src/ancestry-app commit -m "security: validate file uploads by magic bytes, not Content-Type header"
```

---

## Task 5: Relationship Existence Check

Verify both persons exist before creating a relationship, and add a logging import that will be used across routers.

**Files:**
- Modify: `backend/app/routers/relationships.py`
- Modify: `backend/tests/test_relationships.py` (add negative test)

**Interfaces:**
- `POST /relationships` returns 404 if either `person_a_id` or `person_b_id` is not a valid person UUID

- [ ] **Step 1: Write failing test**

Read `backend/tests/test_relationships.py`, then append:

```python
@pytest.mark.asyncio
async def test_create_relationship_invalid_person_rejected(async_client):
    """Creating a relationship with a non-existent person should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = await async_client.post("/api/v1/relationships", json={
        "person_a_id": fake_id,
        "person_b_id": fake_id,
        "type": "partner",
    })
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to confirm failure**

```bash
docker compose exec backend pytest tests/test_relationships.py::test_create_relationship_invalid_person_rejected -v
```

Expected: FAILED (currently 201).

- [ ] **Step 3: Update create_relationship in routers/relationships.py**

Replace the `create_relationship` function:

```python
@router.post("", response_model=RelationshipResponse, status_code=201, summary="Create a relationship")
async def create_relationship(data: RelationshipCreate, db: AsyncSession = Depends(get_db)):
    """Link two persons. For `parent_child`, person_a is the parent and person_b is the child."""
    from app.models.person import Person
    person_a = await db.get(Person, data.person_a_id)
    person_b = await db.get(Person, data.person_b_id)
    if not person_a or not person_b:
        raise HTTPException(status_code=404, detail="One or both persons not found")
    rel = Relationship(**data.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    return rel
```

- [ ] **Step 4: Run tests**

```bash
docker compose exec backend pytest tests/test_relationships.py -v 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/routers/relationships.py backend/tests/test_relationships.py
git -C /project/src/ancestry-app commit -m "security: verify both persons exist before creating relationship"
```

---

## Task 6: Security Logging Setup

Add structured logging configuration to the FastAPI app so auth failures, upload errors, and unauthorized access attempts are visible in container logs.

**Files:**
- Modify: `backend/app/main.py`

**Interfaces:**
- `logging.basicConfig` called at startup with INFO level and timestamp format
- `logger.warning(...)` calls already added in Task 2's `auth.py` and `routers/auth.py` will now output to logs

- [ ] **Step 1: Add logging configuration to main.py**

In `backend/app/main.py`, add after the existing imports and before `app = FastAPI(...)`:

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
```

- [ ] **Step 2: Add error logging for silent exception in delete_media**

In `backend/app/routers/media.py`, add `import logging` and `logger = logging.getLogger(__name__)` near the top (after existing imports).

Find the `delete_media` handler's silent except block:

```python
    try:
        abs_path = _safe_media_path(settings.media_storage_path, media.file_path)
        if os.path.exists(abs_path):
            os.remove(abs_path)
    except Exception:
        pass
```

Replace with:

```python
    try:
        abs_path = _safe_media_path(settings.media_storage_path, media.file_path)
        if os.path.exists(abs_path):
            os.remove(abs_path)
    except Exception as exc:
        logger.error("Failed to delete file for media %s: %s", media_id, exc)
```

- [ ] **Step 3: Verify logs appear after rebuild**

```bash
docker compose build backend && docker compose up -d backend
docker compose logs backend 2>&1 | head -20
```

Expected: timestamped INFO/WARNING lines visible.

- [ ] **Step 4: Run full test suite**

```bash
docker compose exec backend pytest -v 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git -C /project/src/ancestry-app add backend/app/main.py backend/app/routers/media.py
git -C /project/src/ancestry-app commit -m "security: add structured logging for auth failures and file errors"
```

---

## Self-Review

**Spec coverage:**
- ✅ .gitignore — Task 1
- ✅ JWT → httpOnly cookie — Task 2
- ✅ CSRF mitigation — Task 2 (SameSite=Strict cookie + CORS already restricted to localhost)
- ✅ Security headers — Task 1
- ✅ Pagination limits — Task 3
- ✅ Pydantic field constraints — Task 3
- ✅ MIME magic bytes — Task 4
- ✅ Relationship existence check — Task 5
- ✅ Security logging — Task 6
- ✅ AI router auth — already protected in main.py (line 29), no fix needed
- ✅ Docker root user — deferred (low risk in private homelab, no impact on app behavior)

**Placeholder scan:** None found — all steps have concrete code.

**Type consistency:**
- `useAuth.ts` exports `AuthState` with `authenticated: boolean | null` and `logout: () => Promise<void>`
- `App.tsx` uses `authenticated` (not `token`), `logout` (called as `() => void` from button click — ok, Promise returned is ignored)
- `authApi.status()` returns `{ auth_enabled: boolean; authenticated: boolean }` — matches backend response
