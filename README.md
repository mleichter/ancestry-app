# Ancestry App

A self-hosted family tree application for managing biographical data, relationships, and visual genealogy.

## Features

- **Person management** — full CRUD with photos, biography, occupations, nationality, and birth/death details
- **Relationships** — parent-child and partner links with start/end dates
- **Interactive graph view** — React Flow canvas with filter by ancestors or descendants
- **Hierarchical tree view** — D3.js tree rendering with descendants-down and ancestors-up modes, partner companions, pan/zoom
- **Photo gallery** — per-person media uploads
- **Timeline** — chronological life events across the family
- **Computed relatives** — siblings, cousins, in-laws derived automatically
- **Relationship path finder** — shortest relationship path between any two people
- **Surnames overview** — family name statistics and groupings
- **GEDCOM import/export** — interoperable with standard genealogy software
- **JSON import/export** — full data backup and restore
- **Dark mode** — automatic via system preference

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.x |
| Database | PostgreSQL 16 |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Visualization | React Flow (graph) + D3.js (tree) |
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

Edit `.env` and set a secure database password:

```env
DB_PASSWORD=your_secure_password_here
```

### 3. Start the application

```bash
docker compose up -d
```

The app will be available at **http://localhost:3000**.

On first start, the database schema is created automatically via Alembic migrations.

### Development mode

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up
```

Development mode mounts source files and enables hot reload for both backend and frontend. The backend API is also exposed on port 8000.

### Stopping

```bash
docker compose down         # stop containers
docker compose down -v      # stop and delete all data
```

## Environment Variables

| Variable | Description |
|---|---|
| `DB_PASSWORD` | PostgreSQL password (required) |

## Data

Media files (photos, documents) are stored in a Docker volume `media_data`. Database data is stored in `pg_data`. Both persist across container restarts.

To back up all family data, use the JSON export feature in the app under Settings → Export.
