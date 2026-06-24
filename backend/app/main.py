from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
import app.models  # noqa: F401 — registers all mappers with SQLAlchemy
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
    """Liveness + readiness probe. Executes a DB ping and returns `{"status": "ok", "db": "connected"}`."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
