# Phase 1 Foundation Design

**Date:** 2026-06-22  
**Status:** Approved

## Decisions

- PostgreSQL from the start (asyncpg driver)
- Always Docker Compose (dev + prod)
- Everything in repo root
- Base + override compose pattern (`docker-compose.yml` + `docker-compose.override.yml`)

## Structure

Repo-contained: backend + docker configs at repo root. Frontend scaffold added in Phase 3.

## Docker Compose

- `docker-compose.yml`: prod, builds images, no volume mounts
- `docker-compose.override.yml`: dev, source volume mount, uvicorn --reload
- DB healthcheck gates backend startup
- Async SQLAlchemy (`postgresql+asyncpg://`)

## Backend

- FastAPI + pydantic-settings for config
- Stub routers for all API sections; only `GET /health` implemented in Phase 1
- Alembic async migrations with autogenerate
- `TimestampMixin` on Base for created_at/updated_at

## Models

- `Person`: UUID PK, full biographical fields, JSON occupations, avatar_media_id FK (use_alter=True)
- `Relationship`: directed edge, parent_child / partner types, date range + end_reason
- `Media`: file metadata, linked to person, uploaded_at timestamp
