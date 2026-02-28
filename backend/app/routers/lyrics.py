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
from celery import Celery

from app.services.lyrics import lyrics_service
from app.services.word_timestamps_cache import word_timestamps_cache_service
from app.services.redis_client import redis_client
from app.services.storage import storage as storage_client
from app.config import settings

# Celery app for triggering tasks (same config as session.py)
celery_app = Celery(
    "voicejury",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

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
    from app.services.youtube_cache import youtube_cache

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

    try:
        # Get reference audio path from YouTube cache
        cached_ref = await youtube_cache.get_cached_reference(request.youtube_video_id)
        if not cached_ref:
            raise HTTPException(
                status_code=400,
                detail="Reference audio not found. Start a session first to download the reference."
            )

        reference_path = cached_ref["reference_path"]

        # Queue Celery task using send_task (no import needed)
        # Route to gpu-heavy queue for Demucs + Whisper processing
        task = celery_app.send_task(
            "tasks.word_timestamps.generate_word_timestamps_cached",
            kwargs={
                "reference_path": reference_path,
                "spotify_track_id": request.spotify_track_id,
                "youtube_video_id": request.youtube_video_id,
                "language": request.language,
                "artist_name": request.artist_name,
                "track_name": request.track_name,
            },
            queue="gpu-heavy",
        )

        return GenerateResponse(
            status="queued",
            task_id=task.id,
            message="Word timestamp generation queued",
        )

    except HTTPException:
        raise
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

        # Use the celery_app defined at module level
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
# Flow Envelope Endpoints
# ============================================

class FlowEnvelopeResponse(BaseModel):
    """Response for flow envelope (vocal energy visualization)."""
    status: str  # 'found', 'not_found'
    sample_rate_hz: Optional[int] = None
    values: Optional[list[float]] = None
    duration_seconds: Optional[float] = None


@router.get("/flow-envelope/{youtube_video_id}", response_model=FlowEnvelopeResponse)
async def get_flow_envelope(youtube_video_id: str):
    """
    Get pre-computed amplitude envelope of reference vocals for flow visualization.

    The envelope is computed in the worker during `prepare_reference` (after Demucs).
    Returns a compact time-series (20 Hz / 50ms windows) of normalized RMS values (0-1).

    Cache strategy: Redis (1h TTL) → storage → not_found.
    """
    import json

    redis_key = f"flow_env:{youtube_video_id}"

    # Tier 1: Redis cache (1h TTL)
    try:
        client = await redis_client.get_client()
        cached = await client.get(redis_key)
        if cached:
            data = json.loads(cached)
            return FlowEnvelopeResponse(
                status="found",
                sample_rate_hz=data["sample_rate_hz"],
                values=data["values"],
                duration_seconds=data["duration_seconds"],
            )
    except Exception:
        pass

    # Tier 2: Storage fallback
    storage_path = f"cache/{youtube_video_id}/flow_envelope.json"
    try:
        if await storage_client.exists(storage_path):
            raw = await storage_client.download(storage_path)
            data = json.loads(raw)
            # Populate Redis cache for next request
            try:
                client = await redis_client.get_client()
                await client.setex(redis_key, 3600, raw.decode("utf-8") if isinstance(raw, bytes) else raw)
            except Exception:
                pass
            return FlowEnvelopeResponse(
                status="found",
                sample_rate_hz=data["sample_rate_hz"],
                values=data["values"],
                duration_seconds=data["duration_seconds"],
            )
    except Exception:
        pass

    # Tier 3: On-demand generation — download vocals.wav from cache, compute envelope
    # CPU-bound numpy work runs in a thread to avoid blocking the event loop.
    # First request is slow (~2-3s for download + compute), subsequent ones hit Redis.
    vocals_path = f"cache/{youtube_video_id}/vocals.wav"
    try:
        if await storage_client.exists(vocals_path):
            import asyncio

            raw_wav = await storage_client.download(vocals_path)

            def _compute_envelope(raw_wav_bytes: bytes) -> dict:
                import io
                import numpy as np
                from scipy.io import wavfile

                sr, wav_data = wavfile.read(io.BytesIO(raw_wav_bytes))

                # Convert to float mono
                if wav_data.dtype != np.float32 and wav_data.dtype != np.float64:
                    wav_data = wav_data.astype(np.float32) / np.iinfo(wav_data.dtype).max
                if wav_data.ndim > 1:
                    wav_data = wav_data.mean(axis=1)

                # Downsample to 8kHz via simple decimation (good enough for envelope)
                target_sr = 8000
                if sr != target_sr:
                    factor = sr // target_sr
                    if factor > 1:
                        wav_data = wav_data[::factor]
                        sr = sr // factor

                # RMS envelope (50ms windows)
                window_size = max(1, int(sr * 0.05))
                kernel = np.ones(window_size) / window_size
                envelope = np.convolve(np.abs(wav_data), kernel, mode="same")

                # Downsample to one value per window
                downsampled = envelope[::window_size]
                peak = downsampled.max()
                if peak > 1e-8:
                    downsampled = downsampled / peak

                sample_rate_hz = sr // window_size
                duration_seconds = round(len(wav_data) / sr, 2)
                values = [round(float(v), 4) for v in downsampled]

                return {
                    "sample_rate_hz": sample_rate_hz,
                    "values": values,
                    "duration_seconds": duration_seconds,
                }

            envelope_data = await asyncio.to_thread(_compute_envelope, raw_wav)

            # Upload to storage + Redis for future requests (non-fatal)
            try:
                json_bytes = json.dumps(envelope_data, separators=(",", ":")).encode("utf-8")
                await storage_client.upload(
                    json_bytes,
                    f"cache/{youtube_video_id}/flow_envelope.json",
                    "application/json",
                )
                client = await redis_client.get_client()
                await client.setex(redis_key, 3600, json_bytes.decode("utf-8"))
            except Exception:
                pass

            return FlowEnvelopeResponse(
                status="found",
                sample_rate_hz=envelope_data["sample_rate_hz"],
                values=envelope_data["values"],
                duration_seconds=envelope_data["duration_seconds"],
            )
    except Exception:
        pass

    return FlowEnvelopeResponse(status="not_found")


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
