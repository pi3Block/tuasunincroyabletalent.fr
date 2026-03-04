"""
Persistent results routes.
Serves historical performance data, public feed, leaderboards, and social features.
"""
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update, delete, desc, and_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.services.database import get_db
from app.models.session_results import SessionResult
from app.models.performance_likes import PerformanceLike

router = APIRouter()


# ──────────────────────────────────────────────────────────
# GET /api/results/history (existing)
# ──────────────────────────────────────────────────────────
@router.get("/history")
async def get_results_history(limit: int = 20):
    """Recent performance results for landing page."""
    limit = min(limit, 50)
    async with get_db() as db:
        query = (
            select(SessionResult)
            .order_by(SessionResult.created_at.desc())
            .limit(limit)
        )
        result = await db.execute(query)
        rows = result.scalars().all()
    return {"results": [r.to_dict() for r in rows]}


# ──────────────────────────────────────────────────────────
# GET /api/results/feed
# ──────────────────────────────────────────────────────────
@router.get("/feed")
async def get_public_feed(
    page: int = 1,
    limit: int = 20,
    sort: str = "recent",
    song: str | None = None,
):
    """Public feed of published performances with pagination."""
    limit = min(limit, 50)
    offset = (page - 1) * limit

    async with get_db() as db:
        q = select(SessionResult).where(SessionResult.is_public == True)  # noqa: E712
        if song:
            q = q.where(SessionResult.spotify_track_id == song)
        if sort == "top":
            q = q.order_by(desc(SessionResult.like_count), desc(SessionResult.score))
        else:
            q = q.order_by(desc(SessionResult.published_at))
        q = q.offset(offset).limit(limit)
        result = await db.execute(q)
        rows = result.scalars().all()

    return {
        "page": page,
        "limit": limit,
        "sort": sort,
        "results": [r.to_dict() for r in rows],
    }


# ──────────────────────────────────────────────────────────
# GET /api/results/leaderboard/{spotify_track_id}
# ──────────────────────────────────────────────────────────
@router.get("/leaderboard/{spotify_track_id}")
async def get_leaderboard(
    spotify_track_id: str,
    period: str = "all",
    limit: int = 20,
):
    """Per-song leaderboard with optional time period filter."""
    limit = min(limit, 50)

    async with get_db() as db:
        q = (
            select(SessionResult)
            .where(
                and_(
                    SessionResult.is_public == True,  # noqa: E712
                    SessionResult.spotify_track_id == spotify_track_id,
                )
            )
            .order_by(desc(SessionResult.score))
            .limit(limit)
        )
        if period == "week":
            cutoff = datetime.now(timezone.utc) - timedelta(days=7)
            q = q.where(SessionResult.published_at >= cutoff)
        elif period == "month":
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            q = q.where(SessionResult.published_at >= cutoff)

        result = await db.execute(q)
        rows = result.scalars().all()

    return {
        "spotify_track_id": spotify_track_id,
        "period": period,
        "entries": [
            {**r.to_dict(), "rank": i + 1}
            for i, r in enumerate(rows)
        ],
    }


# ──────────────────────────────────────────────────────────
# GET /api/results/{session_id}  — single result (fixes SSR)
# ──────────────────────────────────────────────────────────
@router.get("/{session_id}")
async def get_single_result(session_id: str):
    """Get a single result by session_id. Increments play_count."""
    async with get_db() as db:
        result = await db.execute(
            select(SessionResult).where(SessionResult.session_id == session_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Result not found")

        # Increment play_count (same transaction)
        await db.execute(
            update(SessionResult)
            .where(SessionResult.session_id == session_id)
            .values(play_count=SessionResult.play_count + 1)
        )

        return {
            "session_id": session_id,
            "results": row.to_dict(),
        }


# ──────────────────────────────────────────────────────────
# POST /api/results/{session_id}/publish
# ──────────────────────────────────────────────────────────
class PublishRequest(BaseModel):
    display_name: str
    include_audio: bool = True


@router.post("/{session_id}/publish")
async def publish_performance(session_id: str, req: PublishRequest):
    """Publish a performance to the public feed."""
    name = req.display_name.strip()
    if not name or len(name) > 64:
        raise HTTPException(status_code=422, detail="Nom invalide (1-64 caracteres)")

    async with get_db() as db:
        result = await db.execute(
            select(SessionResult).where(SessionResult.session_id == session_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Performance non trouvee")
        if row.is_public:
            return {"status": "already_published", "session_id": session_id}

        youtube_video_id = row.youtube_video_id

        await db.execute(
            update(SessionResult)
            .where(SessionResult.session_id == session_id)
            .values(
                display_name=name,
                is_public=True,
                published_at=datetime.now(timezone.utc),
            )
        )

    # Trigger audio permanence via Celery (non-blocking)
    if req.include_audio:
        try:
            from celery import Celery
            from app.config import settings
            celery_app = Celery("voicejury", broker=settings.redis_url)
            celery_app.send_task(
                "tasks.pipeline.make_audio_permanent",
                args=[session_id, youtube_video_id],
                queue="default",
            )
        except Exception:
            pass  # Non-fatal — performance is published even without audio

    return {
        "status": "published",
        "session_id": session_id,
        "display_name": name,
    }


# ──────────────────────────────────────────────────────────
# Like endpoints
# ──────────────────────────────────────────────────────────
def _fingerprint(request: Request) -> str:
    """Anonymous fingerprint from IP + User-Agent (behind Traefik)."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    ua = request.headers.get("user-agent", "")
    return hashlib.sha256(f"{ip}:{ua}".encode()).hexdigest()


@router.post("/{session_id}/like")
async def like_performance(session_id: str, request: Request):
    """Add a like (idempotent, fingerprint-based dedup)."""
    fp = _fingerprint(request)
    async with get_db() as db:
        stmt = (
            pg_insert(PerformanceLike)
            .values(session_id=session_id, fingerprint=fp)
            .on_conflict_do_nothing(constraint="uq_performance_like")
        )
        result = await db.execute(stmt)
        inserted = result.rowcount > 0

        if inserted:
            await db.execute(
                update(SessionResult)
                .where(SessionResult.session_id == session_id)
                .values(like_count=SessionResult.like_count + 1)
            )

    return {"liked": True, "inserted": inserted}


@router.delete("/{session_id}/like")
async def unlike_performance(session_id: str, request: Request):
    """Remove a like."""
    fp = _fingerprint(request)
    async with get_db() as db:
        result = await db.execute(
            delete(PerformanceLike).where(
                and_(
                    PerformanceLike.session_id == session_id,
                    PerformanceLike.fingerprint == fp,
                )
            )
        )
        deleted = result.rowcount > 0
        if deleted:
            await db.execute(
                update(SessionResult)
                .where(SessionResult.session_id == session_id)
                .values(like_count=func.greatest(SessionResult.like_count - 1, 0))
            )

    return {"liked": False, "deleted": deleted}


@router.get("/{session_id}/like-status")
async def get_like_status(session_id: str, request: Request):
    """Check if current visitor has liked this performance."""
    fp = _fingerprint(request)
    async with get_db() as db:
        result = await db.execute(
            select(PerformanceLike).where(
                and_(
                    PerformanceLike.session_id == session_id,
                    PerformanceLike.fingerprint == fp,
                )
            )
        )
        liked = result.scalar_one_or_none() is not None
    return {"liked": liked}
