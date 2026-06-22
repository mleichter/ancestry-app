from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import app.models  # noqa: F401 — registers all mappers with SQLAlchemy
from app.routers import persons, relationships, tree, media, gedcom

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

app.include_router(persons.router, prefix="/api/v1")
app.include_router(relationships.router, prefix="/api/v1")
app.include_router(tree.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(gedcom.router, prefix="/api/v1")


@app.get("/health", tags=["System"])
async def health():
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
