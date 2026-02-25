"""
Tu as un incroyable talent ? - FastAPI Backend
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import session, search, audio, lyrics, results

# Sentry error tracking (optional — enabled when SENTRY_DSN is set)
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=_sentry_dsn,
            traces_sample_rate=0.1,
            environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
            release=f"voicejury-api@0.1.0",
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        )
        print(f"[Sentry] Initialized for API")
    except ImportError:
        print("[Sentry] sentry-sdk not installed, skipping")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Startup
    print(f"🚀 Starting Tu as un incroyable talent ? API (debug={settings.debug})")

    # Initialize database tables
    from app.services.database import init_db, close_db
    try:
        await init_db()
    except Exception as e:
        print(f"⚠️ Database initialization warning: {e}")

    yield

    # Shutdown
    print("👋 Shutting down...")
    await close_db()


app = FastAPI(
    title="Tu as un incroyable talent ?",
    description="API pour l'évaluation vocale par IA",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS - Allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://frontend:5173",
        "https://tuasunincroyabletalent.fr",
        "https://www.tuasunincroyabletalent.fr",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(search.router, prefix="/api/search", tags=["Search"])
app.include_router(session.router, prefix="/api/session", tags=["Session"])
app.include_router(audio.router, prefix="/api/audio", tags=["Audio"])
app.include_router(lyrics.router, prefix="/api/lyrics", tags=["Lyrics"])
app.include_router(results.router, prefix="/api/results", tags=["Results"])


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Tu as un incroyable talent ?"}


@app.get("/health")
async def health():
    """Detailed health check — verifies Redis and PostgreSQL connectivity."""
    checks = {"api": True}

    # Redis
    try:
        from app.services.redis_client import redis_client
        client = await redis_client.get_client()
        await client.ping()
        checks["redis"] = True
    except Exception:
        checks["redis"] = False

    # PostgreSQL
    try:
        from sqlalchemy import text
        from app.services.database import get_db
        async with get_db() as db:
            await db.execute(text("SELECT 1"))
        checks["postgres"] = True
    except Exception:
        checks["postgres"] = False

    status = "healthy" if all(checks.values()) else "degraded"
    return {"status": status, "version": "0.1.0", "services": checks}
