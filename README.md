# Ancestry App

A self-hosted family tree application for managing biographical data, relationships, and visual genealogy.

## Features

- **Person management** — full CRUD with photos, biography, occupations, nationality, and birth/death details
- **Relationships** — parent-child and partner links with optional start/end dates and end reason
- **Interactive graph view** — React Flow canvas with pan/zoom, minimap, and filter by ancestors or descendants
- **Hierarchical tree view** — D3.js tree rendering with descendants-down and ancestors-up modes, partner companions, pan/zoom
- **Photo gallery** — per-person media uploads with server-side 300×300 thumbnails (Pillow)
- **Timeline** — chronological life events across the whole family
- **Computed relatives** — siblings, cousins, in-laws derived automatically from the relationship graph
- **Relationship path finder** — shortest relationship path between any two people
- **Surnames overview** — family name statistics and per-surname member lists
- **GEDCOM 5.5.1 import/export** — interoperable with standard genealogy software
- **JSON import/export** — full data backup and restore
- **Living-person anonymisation** — redact personal data for living people in all exports
- **Settings page** — toggle anonymisation; shows app version
- **Toast notifications** — non-blocking error and success feedback throughout the UI
- **Dark mode** — automatic via system preference
- **Authentication** — single-user password login with JWT (httpOnly `SameSite=Strict` cookie); optional — app runs open if `AUTH_PASSWORD` is not set
- **AI document extraction** — upload a passport or ID card to extract person fields via GPT-4o; portrait crops use MediaPipe BlazeFace face detection for accurate framing

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.x (async) |
| Database | PostgreSQL 16 |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Visualisation | React Flow (graph) + D3.js v7 (hierarchical tree) |
| Media | Pillow (thumbnails), PyMuPDF (PDF rendering) |
| Face detection | MediaPipe 0.10 BlazeFace (portrait crops) |
| AI extraction | OpenAI / LiteLLM — GPT-4o or compatible (optional) |
| Container | Docker + Docker Compose |

## Setup

### Prerequisites

- Docker and Docker Compose

### 1. Clone the repository

```bash
git clone https://github.com/mleichter/ancestry-app.git
cd ancestry-app
```

### 2. Create the environment file

```bash
cp .env.example .env
```

Edit `.env`. The only required variable is the database password:

```env
DB_PASSWORD=your_secure_password_here
```

To enable password protection (recommended for any internet-exposed instance):

```env
AUTH_PASSWORD=your_login_password
AUTH_SECRET_KEY=your_jwt_signing_secret   # generate with: openssl rand -hex 32
```

To enable AI document extraction (requires a GPT-4o-compatible API):

```env
OPENAI_API_KEY=sk-...
# Optional: point at a LiteLLM proxy or other OpenAI-compatible endpoint
OPENAI_BASE_URL=http://your-litellm:4000
OPENAI_MODEL=gpt-4o                        # default; also accepts claude-sonnet-4-6 etc.
```

### 3. Start the application

```bash
docker compose up -d
```

The app is available at **http://localhost:3000**.

On first start the database schema is created automatically via Alembic migrations.
All three services report their health status — Docker Compose waits for each to be healthy before starting the next.

### Stopping

```bash
docker compose down        # stop containers, keep data
docker compose down -v     # stop containers and delete all data
```

## Development mode

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up
```

Mounts source files and enables hot reload for both backend and frontend. The backend API is also exposed directly on port 8000.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_PASSWORD` | — | PostgreSQL password (required) |
| `AUTH_PASSWORD` | — | Login password; auth disabled if unset |
| `AUTH_SECRET_KEY` | — | JWT signing secret; required when `AUTH_PASSWORD` is set |
| `API_KEY` | — | Static Bearer token for API/MCP access (optional) |
| `OPENAI_API_KEY` | — | API key for AI document extraction (optional) |
| `OPENAI_BASE_URL` | OpenAI | Override API base URL (e.g. LiteLLM proxy) |
| `OPENAI_MODEL` | `gpt-4o` | Model used for extraction |
| `MEDIA_STORAGE_PATH` | `/data/media` | Where uploaded files are stored |
| `MAX_UPLOAD_SIZE_MB` | `20` | Maximum file upload size |

## API Documentation

Interactive API docs (Swagger UI) are available at **http://localhost:3000/docs** once the app is running.
ReDoc is available at **http://localhost:3000/redoc**.

### Endpoint overview

**Authentication** (public — no cookie required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/auth/status` | Whether auth is enabled |
| `POST` | `/api/v1/auth/login` | Log in — sets httpOnly JWT cookie |
| `POST` | `/api/v1/auth/logout` | Clear session cookie |

**Persons**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/persons` | List all persons |
| `POST` | `/api/v1/persons` | Create a person |
| `GET` | `/api/v1/persons/{id}` | Get a person |
| `PATCH` | `/api/v1/persons/{id}` | Update a person |
| `DELETE` | `/api/v1/persons/{id}` | Delete a person |

**Relationships**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/relationships` | List relationships (filter by `?person_id=`) |
| `POST` | `/api/v1/relationships` | Create a relationship |
| `PATCH` | `/api/v1/relationships/{id}` | Update a relationship |
| `DELETE` | `/api/v1/relationships/{id}` | Delete a relationship |

**Media**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/persons/{id}/media` | List person's photos |
| `POST` | `/api/v1/persons/{id}/media` | Upload a photo |
| `POST` | `/api/v1/persons/{id}/media/avatar` | Upload and set avatar |
| `PATCH` | `/api/v1/persons/{id}/avatar/{media_id}` | Promote existing photo to avatar |
| `GET` | `/api/v1/media/{id}/file` | Serve a file (`?thumb=true` for thumbnail) |
| `DELETE` | `/api/v1/media/{id}` | Delete a media file |

**Tree & data**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/tree` | Full graph (nodes + edges) |
| `GET` | `/api/v1/tree/path` | Shortest relationship path between two people |

**Import / Export**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/gedcom/export` | Export GEDCOM (`?anonymize_living=true`) |
| `POST` | `/api/v1/gedcom/import` | Import GEDCOM file |
| `GET` | `/api/v1/export/json` | Export JSON backup (`?anonymize_living=true`) |
| `POST` | `/api/v1/import/json` | Restore from JSON backup |

**AI extraction**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/ai/status` | Whether AI extraction is configured |
| `POST` | `/api/v1/ai/extract-document` | Extract person fields + portrait from a document image |

**System**

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (FastAPI + DB ping) |

## Data

Media files are stored in the `media_data` Docker volume. Database data is in `pg_data`. Both persist across restarts.

To back up all family data, use **GEDCOM → JSON export** in the app, or call the export endpoints directly.
