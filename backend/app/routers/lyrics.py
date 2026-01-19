"""
Lyrics routes for synced lyrics and word-level timestamps.

Provides endpoints for:
- Line-synced lyrics (from LRCLib, Genius)
- Word-level timestamps (from Musixmatch or Whisper-generated)
- Triggering word timestamp generation via Celery
"""
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from app.services.lyrics import lyrics_service
from app.services.word_timestamps_cache import word_timestamps_cache_service


router = APIRouter()


# ============================================
# Response Models
# ============================================

class LyricLine(BaseModel):
    """A single synced line of lyrics."""
    text: str
    startTimeMs: int
    endTimeMs: Optional[int] = None


class LyricsResponse(BaseModel):
    """Response for basic lyrics endpoint."""
    text: str
    lines: Optional[list[LyricLine]] = None
    syncType: str  # 'synced', 'unsynced', 'none'
    source: str  # 'lrclib', 'genius', 'none'
    status: str  # 'found', 'not_found', 'error'
    cachedAt: Optional[str] = None


class WordTimestamp(BaseModel):
    """A single word with timestamps."""
    word: str
    startMs: int
    endMs: int
    confidence: Optional[float] = None


class WordLine(BaseModel):
    """A line with word-level timestamps."""
    startMs: int
    endMs: int
    text: str
    words: list[WordTimestamp]


class WordTimestampsResponse(BaseModel):
    """Response for word-level timestamps endpoint."""
    syncType: str  # 'WORD_SYNCED', 'LINE_SYNCED', 'none'
    words: Optional[list[WordTimestamp]] = None
    lines: Optional[list[WordLine]] = None
    source: str  # 'musixmatch_word', 'whisper_timestamped', 'lrclib', 'none'
    language: Optional[str] = None
    status: str  # 'found', 'generating', 'not_found', 'error'
    quality: Optional[dict] = None
    cachedAt: Optional[str] = None


class GenerateRequest(BaseModel):
    """Request to generate word timestamps."""
    spotify_track_id: str
    youtube_video_id: str
    artist_name: Optional[str] = None
    track_name: Optional[str] = None
    language: str = "fr"
    force_regenerate: bool = False


class GenerateResponse(BaseModel):
    """Response for generate endpoint."""
    status: str  # 'queued', 'cached', 'error'
    task_id: Optional[str] = None
    message: str


# ============================================
# Lyrics Endpoints
# ============================================

@router.get("/track/{spotify_track_id}", response_model=LyricsResponse)
async def get_lyrics(
    spotify_track_id: str,
    artist: str = Query(..., description="Artist name"),
    title: str = Query(..., description="Track title"),
    album: Optional[str] = Query(None, description="Album name"),
    duration_sec: Optional[int] = Query(None, description="Track duration in seconds"),
):
    """
    Get lyrics for a track (line-synced or plain text).

    Uses hierarchical provider chain:
    1. Cache (Redis → PostgreSQL)
    2. LRCLib (free, legal, line-synced)
    3. Genius (plain text fallback)
    """
    result = await lyrics_service.get_lyrics(
        spotify_track_id=spotify_track_id,
        artist=artist,
        title=title,
        album=album,
        duration_sec=duration_sec,
    )

    return LyricsResponse(
        text=result.get("text", ""),
        lines=[LyricLine(**line) for line in result.get("lines", [])] if result.get("lines") else None,
        syncType=result.get("syncType", "none"),
        source=result.get("source", "none"),
        status=result.get("status", "error"),
        cachedAt=result.get("cachedAt"),
    )


# ============================================
# Word Timestamps Endpoints
# ============================================

@router.get("/word-timestamps/{spotify_track_id}", response_model=WordTimestampsResponse)
async def get_word_timestamps(
    spotify_track_id: str,
    youtube_video_id: Optional[str] = Query(None, description="YouTube video ID (for Whisper-generated)"),
):
    """
    Get word-level timestamps for karaoke display.

    Priority order:
    1. User-corrected (permanent cache)
    2. Musixmatch word-synced (365 days cache)
    3. Whisper-generated (90 days cache)

    If not cached, returns status='not_found'. Use POST /generate to trigger generation.
    """
    # Check cache
    cached = await word_timestamps_cache_service.get(
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_video_id,
    )

    if cached:
        return WordTimestampsResponse(
            syncType="WORD_SYNCED",
            words=cached.get("words"),
            lines=cached.get("lines"),
            source=cached.get("source", "unknown"),
            language=cached.get("language"),
            status="found",
            quality={
                "confidence": cached.get("confidence_avg"),
                "word_count": cached.get("word_count"),
            },
            cachedAt=cached.get("created_at") or cached.get("cached_at"),
        )

    # Not found - client should call POST /generate
    return WordTimestampsResponse(
        syncType="none",
        words=None,
        lines=None,
        source="none",
        status="not_found",
    )


@router.post("/word-timestamps/generate", response_model=GenerateResponse)
async def generate_word_timestamps(
    request: GenerateRequest,
    background_tasks: BackgroundTasks,
):
    """
    Trigger word timestamp generation via Whisper.

    This is an async operation - the task runs in Celery worker.
    Poll GET /word-timestamps/{spotify_track_id} to check when ready.

    Requirements:
    - Reference audio must already be downloaded (via session start)
    - YouTube video ID is required for matching timestamps to video
    """
    # Check if already cached (unless force_regenerate)
    if not request.force_regenerate:
        exists = await word_timestamps_cache_service.exists(
            spotify_track_id=request.spotify_track_id,
            youtube_video_id=request.youtube_video_id,
        )
        if exists:
            return GenerateResponse(
                status="cached",
                message="Word timestamps already cached",
            )

    # Import Celery task
    try:
        from worker.tasks.word_timestamps import generate_word_timestamps_cached

        # Get reference audio path from YouTube cache
        from app.services.youtube_cache import youtube_cache

        cached_ref = await youtube_cache.get_cached_reference(request.youtube_video_id)
        if not cached_ref:
            raise HTTPException(
                status_code=400,
                detail="Reference audio not found. Start a session first to download the reference."
            )

        reference_path = cached_ref["reference_path"]

        # Queue Celery task
        task = generate_word_timestamps_cached.delay(
            reference_path=reference_path,
            spotify_track_id=request.spotify_track_id,
            youtube_video_id=request.youtube_video_id,
            language=request.language,
            artist_name=request.artist_name,
            track_name=request.track_name,
        )

        return GenerateResponse(
            status="queued",
            task_id=task.id,
            message="Word timestamp generation queued",
        )

    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Celery worker not available: {e}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to queue generation: {e}"
        )


@router.get("/word-timestamps/task/{task_id}")
async def get_task_status(task_id: str):
    """
    Check status of a word timestamp generation task.
    """
    try:
        from celery.result import AsyncResult
        from worker.tasks.celery_app import celery_app

        result = AsyncResult(task_id, app=celery_app)

        return {
            "task_id": task_id,
            "status": result.status,
            "ready": result.ready(),
            "successful": result.successful() if result.ready() else None,
            "result": result.result if result.ready() and result.successful() else None,
            "error": str(result.result) if result.ready() and not result.successful() else None,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get task status: {e}"
        )


# ============================================
# Cache Management Endpoints
# ============================================

@router.delete("/word-timestamps/{spotify_track_id}")
async def invalidate_word_timestamps(
    spotify_track_id: str,
    youtube_video_id: Optional[str] = Query(None),
):
    """
    Invalidate cached word timestamps.

    Use this to force regeneration of timestamps.
    """
    await word_timestamps_cache_service.invalidate(
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_video_id,
    )

    return {"status": "invalidated", "spotify_track_id": spotify_track_id}


@router.get("/word-timestamps/stats")
async def get_cache_stats():
    """
    Get word timestamps cache statistics.
    """
    return await word_timestamps_cache_service.get_stats()


@router.delete("/cache/{spotify_track_id}")
async def invalidate_all_lyrics_cache(spotify_track_id: str):
    """
    Invalidate all lyrics caches for a track (both line-synced and word-synced).
    """
    await lyrics_service.invalidate_cache(spotify_track_id)
    await word_timestamps_cache_service.invalidate(spotify_track_id)

    return {"status": "invalidated", "spotify_track_id": spotify_track_id}
