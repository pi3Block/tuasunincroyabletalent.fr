"""
The AI Voice Jury - FastAPI Backend
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import session, results, search


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Startup
    print(f"🚀 Starting The AI Voice Jury API (debug={settings.debug})")

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
    title="The AI Voice Jury",
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
app.include_router(results.router, prefix="/api/results", tags=["Results"])


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "The AI Voice Jury"}


@app.get("/health")
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "version": "0.1.0",
        "services": {
            "api": True,
            # TODO: Add Redis/Postgres/Ollama checks
        }
    }
