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
