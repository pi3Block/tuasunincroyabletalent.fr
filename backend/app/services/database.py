"""
Async database connection using SQLAlchemy + asyncpg.
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.config import settings

# Convert postgresql:// to postgresql+asyncpg://
_db_url = settings.database_url
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    _db_url,
    echo=settings.debug,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Async context manager for database sessions.

    Usage:
        async with get_db() as session:
            result = await session.execute(...)
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """
    Initialize database tables using Alembic migrations.
    Falls back to create_all() if Alembic is not available.
    Called at application startup.
    """
    try:
        from alembic.config import Config
        from alembic import command
        import os

        alembic_ini = os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini")
        if os.path.exists(alembic_ini):
            alembic_cfg = Config(alembic_ini)
            # Stamp existing DB if no version table yet, then upgrade
            command.upgrade(alembic_cfg, "head")
            print("[Database] Alembic migrations applied")
            return
    except Exception as e:
        print(f"[Database] Alembic migration failed ({e}), falling back to create_all()")

    # Fallback: create_all() for dev or if Alembic is not configured
    from app.models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[Database] Tables created/verified (create_all fallback)")


async def close_db() -> None:
    """
    Close database connections.
    Called at application shutdown.
    """
    await engine.dispose()
    print("[Database] Connections closed")
