"""
Test configuration: uses SQLite in-memory via aiosqlite so tests run without PostgreSQL.
Each test function gets a fresh database via the async_client fixture.
"""
import os
import tempfile

# Must set env vars before any app modules are imported
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("MEDIA_STORAGE_PATH", tempfile.mkdtemp(prefix="ancestry-test-media-"))
# External service keys are unset by default; individual tests enable via monkeypatch
os.environ.pop("AUTH_PASSWORD", None)
os.environ.pop("AUTH_SECRET_KEY", None)
os.environ.pop("API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

import app.models  # noqa: F401 — registers all ORM models with Base metadata
from app.models.base import Base
from app.database import get_db
from app.main import app
from app.config import get_settings

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def async_client():
    """Provide an HTTPX test client backed by a fresh SQLite database."""
    get_settings.cache_clear()

    engine = create_async_engine(TEST_DB_URL, echo=False)

    @event.listens_for(engine.sync_engine, "connect")
    def enable_fk(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSession = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
    await engine.dispose()
