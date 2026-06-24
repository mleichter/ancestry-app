# Authentication Design — Ancestry App

**Date:** 2026-06-24  
**Scope:** Single-user JWT authentication for the web UI + static API key for future MCP server access. No multi-user, no OAuth, no registration flow.

---

## 1. Backend

### New env vars

| Var | Required | Purpose |
|-----|----------|---------|
| `AUTH_PASSWORD` | No (disables auth if absent) | Web UI login password |
| `AUTH_SECRET_KEY` | No (disables auth if absent) | JWT signing secret (`openssl rand -hex 32`) |
| `API_KEY` | No | Static bearer token for MCP server |

If neither `AUTH_PASSWORD` nor `API_KEY` is set, auth is entirely disabled — the `require_auth` dependency becomes a no-op. This preserves zero-credential local dev. Setting only `API_KEY` (without `AUTH_PASSWORD`) enables auth — MCP calls need the key, but the web UI login screen would be unreachable; that config is not recommended.

### New endpoints

`GET /api/v1/auth/status`  
Response: `{"auth_enabled": bool}` — public, no auth required. Used by the frontend to decide whether to show the login screen.

`POST /api/v1/auth/login`  
Body: `{"password": "..."}`  
Response: `{"access_token": "<JWT>", "token_type": "bearer"}`  
Error: `401` on wrong password.

JWT payload: `{"sub": "owner", "exp": now + 30 days}`.  
Algorithm: HS256.  
Library: `python-jose[cryptography]`.

### Auth dependency

```python
async def require_auth(authorization: str = Header(...)):
    if not settings.auth_password and not settings.api_key:
        return  # auth disabled

    token = authorization.removeprefix("Bearer ").strip()

    # Static API key (fast path for MCP)
    if settings.api_key and token == settings.api_key:
        return

    # JWT
    try:
        jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

### Public endpoints (no auth required)

- `GET /health`
- `GET /api/v1/auth/status`
- `POST /api/v1/auth/login`

All other `/api/v1/*` endpoints require `require_auth` via a global dependency on the main router.

### New router

`backend/app/routers/auth.py` — contains only the login endpoint.  
Registered in `main.py` as `app.include_router(auth.router, prefix="/api/v1")`.

### Config additions (`backend/app/config.py`)

```python
auth_password: Optional[str] = None
auth_secret_key: Optional[str] = None
api_key: Optional[str] = None
```

No DB migration needed — all credentials live in env vars.

---

## 2. Frontend

### New files

**`src/pages/LoginPage.tsx`**  
Centered card, single password field, "Anmelden" submit button, inline error on 401. No username field.

**`src/hooks/useAuth.ts`**  
- Reads/writes JWT from `localStorage` key `ancestry_token`
- `login(password: string): Promise<void>` — calls `POST /auth/login`, stores token on success, throws on 401
- `logout(): void` — clears token, forces re-render

### Modified files

**`src/App.tsx`**  
Wraps all routes in an auth guard:
```tsx
const { token } = useAuth()
if (!token) return <LoginPage />
return <RouterOutlet />
```

**`src/api/client.ts`** — axios interceptors:
- **Request:** attach `Authorization: Bearer <token>` on every call
- **Response 401:** clear token from localStorage, reload to LoginPage via `window.location.href = '/'`

**Nav component** — logout button right-aligned, calls `logout()`.

### Auth-disabled state

If the backend has no `AUTH_PASSWORD` set, `POST /auth/login` will still return a token (or the UI can detect via a `GET /api/v1/auth/status` endpoint returning `{"auth_enabled": false}` and skip the login screen entirely).

> Decision: add `GET /api/v1/auth/status` → `{"auth_enabled": bool}`. The frontend checks this on load; if `false`, auto-sets a placeholder token and shows the app directly.

---

## 3. MCP API key

The `require_auth` dependency accepts `Authorization: Bearer <API_KEY>` as an alternative to a JWT — same header, no special treatment. The MCP server will use this static key.

The `API_KEY` env var is independent of `AUTH_PASSWORD` — you can configure one without the other. Setting only `API_KEY` without `AUTH_PASSWORD` means the web UI is open but the MCP server has a key.

---

## Out of scope

- Multi-user / per-user data isolation
- Token refresh (30-day JWT is sufficient for homelab use)
- OAuth / SSO
- Password change UI (edit env var and restart)
- MCP server implementation (separate sub-project)
