"""
Session management routes.
"""
import time
import uuid
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.services.youtube import youtube_service
from app.services.spotify import spotify_service
from app.services.redis_client import redis_client
from app.services.youtube_cache import youtube_cache
from app.services.search_history import search_history
from app.services.lyrics import lyrics_service
from app.services.lyrics_offset import lyrics_offset_service
from app.services.lyrics_cache import lyrics_cache_service
from app.config import settings

# Celery app for triggering tasks
from celery import Celery

celery_app = Celery(
    "voicejury",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

router = APIRouter()


class StartSessionRequest(BaseModel):
    """Request to start a new session."""
    spotify_track_id: str
    spotify_track_name: str | None = None
    artist_name: str | None = None


class StartSessionResponse(BaseModel):
    """Response with session info."""
    session_id: str
    status: str
    reference_status: str
    youtube_match: dict | None = None


class FallbackSourceRequest(BaseModel):
    """Request to provide manual YouTube URL."""
    session_id: str
    youtube_url: str


class SessionStatus(BaseModel):
    """Session status response."""
    session_id: str
    status: str
    reference_status: str
    reference_ready: bool
    track_name: str | None = None
    artist_name: str | None = None
    youtube_url: str | None = None
    error: str | None = None


class LyricsOffsetRequest(BaseModel):
    """Request to set lyrics offset."""
    offset_seconds: float


class LyricsOffsetResponse(BaseModel):
    """Response with offset data."""
    spotify_track_id: str
    youtube_video_id: str
    offset_seconds: float


async def prepare_reference_audio(session_id: str, youtube_url: str, youtube_id: str):
    """Background task to download reference audio from YouTube (with caching)
    and trigger GPU separation (Demucs) for StudioMode.
    """
    try:
        # Check cache first
        cached = await youtube_cache.get_cached_reference(youtube_id)
        if cached:
            print(f"[Session {session_id}] Using cached reference from {cached['reference_path']}")
            await redis_client.update_session(session_id, {
                "reference_status": "ready",
                "reference_path": cached["reference_path"],
                "youtube_id": youtube_id,
            })
            # Trigger GPU separation for StudioMode (uses its own cache internally)
            celery_app.send_task(
                "tasks.pipeline.prepare_reference",
                args=[session_id, cached["reference_path"], youtube_id],
                queue="gpu-heavy",  # Demucs requires high VRAM
            )
            print(f"[Session {session_id}] Queued GPU separation for StudioMode")
            return

        # Optimization A: skip backend download — worker downloads directly from YouTube.
        # Saves ~15s (backend download + upload to storage + worker download from storage).
        # Worker will upload reference.wav to storage after downloading, so future
        # analyze_performance tasks can fall back to it if Demucs cache is cold.
        expected_ref_url = (
            f"{settings.storage_url}/files/{settings.storage_bucket}"
            f"/cache/{youtube_id}/reference.wav"
        )

        # Pre-populate cache with expected URL so future sessions hit cache directly
        await youtube_cache.set_cached_reference(youtube_id, {
            "reference_path": expected_ref_url,
            "youtube_url": youtube_url,
        })

        # Mark as ready immediately — user can start recording while worker downloads
        await redis_client.update_session(session_id, {
            "reference_status": "ready",
            "reference_path": expected_ref_url,
            "youtube_id": youtube_id,
        })

        print(f"[Session {session_id}] Reference queued (worker will download directly from YouTube)")

        # Trigger GPU separation — worker downloads reference via yt-dlp (Optimization A)
        celery_app.send_task(
            "tasks.pipeline.prepare_reference",
            args=[session_id, expected_ref_url, youtube_id, youtube_url],
            queue="gpu-heavy",
        )
        print(f"[Session {session_id}] Queued GPU separation with direct YouTube download")

    except Exception as e:
        print(f"[Session {session_id}] Error: {e}")
        import traceback
        traceback.print_exc()
        await redis_client.update_session(session_id, {
            "reference_status": "error",
            "error": str(e),
        })


@router.post("/start", response_model=StartSessionResponse)
async def start_session(request: StartSessionRequest, background_tasks: BackgroundTasks):
    """
    Start a new vocal evaluation session.

    1. Creates session ID
    2. Gets track info from Spotify
    3. Searches YouTube for reference audio
    4. Queues audio download in background
    """
    session_id = str(uuid.uuid4())

    # Get track details from Spotify
    track = await spotify_service.get_track(request.spotify_track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found on Spotify")

    track_name = track["name"]
    artist_name = ", ".join(track["artists"])
    duration_ms = track["duration_ms"]

    # Search YouTube for the track
    youtube_match = await youtube_service.search_for_track(artist_name, track_name)

    # Calculate confidence score based on duration match
    confidence = 0.0
    if youtube_match and youtube_match.get("duration"):
        spotify_duration = duration_ms / 1000  # Convert to seconds
        youtube_duration = youtube_match["duration"]
        duration_diff = abs(spotify_duration - youtube_duration)

        # High confidence if duration differs by less than 10 seconds
        if duration_diff < 10:
            confidence = 1.0
        elif duration_diff < 30:
            confidence = 0.7
        elif duration_diff < 60:
            confidence = 0.5
        else:
            confidence = 0.3

        youtube_match["confidence"] = confidence
        youtube_match["spotify_duration"] = spotify_duration

    # Initialize session in Redis
    album_name = track.get("album", {}).get("name")

    session_data = {
        "session_id": session_id,
        "status": "created",
        "reference_status": "searching",
        "spotify_track_id": request.spotify_track_id,
        "track_name": track_name,
        "artist_name": artist_name,
        "album_name": album_name,
        "duration_ms": duration_ms,
        "youtube_match": youtube_match,
    }

    # Log to search history
    await search_history.add_track({
        "id": request.spotify_track_id,
        "name": track_name,
        "artists": track["artists"],
        "album": {"image": track.get("album_image")},
        "duration_ms": duration_ms,
    })

    # Add creation timestamp for cleanup tracking
    session_data["created_at"] = time.time()

    # If good match found, start downloading in background
    if youtube_match and confidence >= 0.5:
        session_data["reference_status"] = "pending"
        session_data["youtube_url"] = youtube_match["url"]
        session_data["youtube_id"] = youtube_match["id"]
        await redis_client.set_session(session_id, session_data, ttl=10800)  # 3h TTL for cleanup

        # Queue background download (with cache support)
        background_tasks.add_task(
            prepare_reference_audio,
            session_id,
            youtube_match["url"],
            youtube_match["id"],
        )
    else:
        # Low confidence - need user to provide URL
        session_data["reference_status"] = "needs_fallback"
        await redis_client.set_session(session_id, session_data, ttl=10800)  # 3h TTL for cleanup

    return StartSessionResponse(
        session_id=session_id,
        status="created",
        reference_status=session_data["reference_status"],
        youtube_match=youtube_match,
    )


@router.post("/fallback-source")
async def set_fallback_source(request: FallbackSourceRequest, background_tasks: BackgroundTasks):
    """
    Provide manual YouTube URL when auto-search fails or user wants different version.
    """
    # Validate URL
    if not youtube_service.validate_youtube_url(request.youtube_url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    # Get session
    session = await redis_client.get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get video info
    video_info = await youtube_service.get_video_info(request.youtube_url)
    if not video_info:
        raise HTTPException(status_code=400, detail="Could not fetch video info")

    youtube_id = video_info.get("id", "")

    # Update session
    await redis_client.update_session(request.session_id, {
        "reference_status": "pending",
        "youtube_url": request.youtube_url,
        "youtube_match": video_info,
        "youtube_id": youtube_id,
    })

    # Queue background download (with cache support)
    background_tasks.add_task(
        prepare_reference_audio,
        request.session_id,
        request.youtube_url,
        youtube_id,
    )

    return {
        "session_id": request.session_id,
        "status": "downloading",
        "video_info": video_info,
        "message": "Téléchargement de la référence en cours...",
    }


@router.get("/{session_id}/status", response_model=SessionStatus)
async def get_session_status(session_id: str):
    """Get current session status."""
    session = await redis_client.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionStatus(
        session_id=session_id,
        status=session.get("status", "unknown"),
        reference_status=session.get("reference_status", "unknown"),
        reference_ready=session.get("reference_status") == "ready",
        track_name=session.get("track_name"),
        artist_name=session.get("artist_name"),
        youtube_url=session.get("youtube_url"),
        error=session.get("error"),
    )


class AnalyzeResponse(BaseModel):
    """Response for analysis request."""
    session_id: str
    task_id: str
    status: str
    message: str


@router.post("/{session_id}/upload-recording")
async def upload_recording(session_id: str, audio: UploadFile = File(...)):
    """
    Upload user's vocal recording for analysis.

    Accepts WAV or WebM audio file from browser MediaRecorder.
    Uploads directly to remote storage (storages.augmenter.pro).
    """
    from app.services.storage import storage

    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.get("reference_status") != "ready":
        raise HTTPException(
            status_code=400,
            detail="Reference audio not ready yet"
        )

    content = await audio.read()
    ext = Path(audio.filename or "user_recording.webm").suffix or ".webm"

    # Upload directly to remote storage
    relative_path = f"sessions/{session_id}/user_recording{ext}"
    content_type = "audio/webm" if ext == ".webm" else "audio/wav"
    storage_url = await storage.upload(content, relative_path, content_type)

    # Update session with storage URL
    await redis_client.update_session(session_id, {
        "user_audio_path": storage_url,
        "status": "recording_uploaded",
    })

    return {
        "session_id": session_id,
        "status": "uploaded",
        "file_size": len(content),
        "message": "Enregistrement reçu. Prêt pour l'analyse.",
    }


@router.post("/{session_id}/analyze", response_model=AnalyzeResponse)
async def start_analysis(session_id: str, background_tasks: BackgroundTasks):
    """
    Start the full vocal analysis pipeline.

    Requires:
    - Reference audio prepared (status: ready)
    - User recording uploaded
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Validate prerequisites
    if session.get("reference_status") != "ready":
        raise HTTPException(
            status_code=400,
            detail="Reference audio not ready"
        )

    user_audio_path = session.get("user_audio_path")
    if not user_audio_path:
        raise HTTPException(
            status_code=400,
            detail="User recording not uploaded"
        )

    reference_path = session.get("reference_path")
    if not reference_path:
        raise HTTPException(
            status_code=400,
            detail="Reference audio path not found"
        )

    # Update session status
    await redis_client.update_session(session_id, {
        "status": "analyzing",
    })

    # Trigger the full analysis pipeline
    # Pass youtube_id for reference separation cache lookup
    task = celery_app.send_task(
        "tasks.pipeline.analyze_performance",
        args=[
            session_id,
            user_audio_path,
            reference_path,
            session.get("track_name", "Unknown"),
            session.get("artist_name", "Unknown"),
            session.get("youtube_id"),  # Cache key for reference separation
        ],
        queue="gpu",  # Explicitly route to gpu queue
    )

    # Store task ID
    await redis_client.update_session(session_id, {
        "analysis_task_id": task.id,
    })

    return AnalyzeResponse(
        session_id=session_id,
        task_id=task.id,
        status="analyzing",
        message="Analyse en cours... Le jury délibère!",
    )


@router.get("/{session_id}/analysis-status")
async def get_analysis_status(session_id: str):
    """
    Get the status of the analysis task.
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    task_id = session.get("analysis_task_id")
    if not task_id:
        return {
            "session_id": session_id,
            "status": session.get("status", "unknown"),
            "analysis_status": "not_started",
        }

    # Check task status
    task_result = celery_app.AsyncResult(task_id)

    response = {
        "session_id": session_id,
        "task_id": task_id,
        "analysis_status": task_result.status,
    }

    if task_result.status == "PROGRESS":
        response["progress"] = task_result.info
    elif task_result.status == "SUCCESS":
        response["results"] = task_result.result
        # Update session with results
        await redis_client.update_session(session_id, {
            "status": "completed",
            "results": task_result.result,
        })
        # Persist to PostgreSQL for history
        await _persist_results(session_id, session, task_result.result)
    elif task_result.status == "FAILURE":
        response["error"] = str(task_result.result)
        await redis_client.update_session(session_id, {
            "status": "error",
            "error": str(task_result.result),
        })

    return response


@router.get("/{session_id}/results")
async def get_results(session_id: str):
    """
    Get the final results and jury feedback.
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    results = session.get("results")
    if not results:
        # Check if analysis is still running
        task_id = session.get("analysis_task_id")
        if task_id:
            task_result = celery_app.AsyncResult(task_id)
            if task_result.status == "SUCCESS":
                results = task_result.result
                await redis_client.update_session(session_id, {
                    "results": results,
                    "status": "completed",
                })
            else:
                raise HTTPException(
                    status_code=202,
                    detail=f"Analysis in progress: {task_result.status}"
                )
        else:
            raise HTTPException(
                status_code=404,
                detail="No results available"
            )

    return {
        "session_id": session_id,
        "track_name": session.get("track_name"),
        "artist_name": session.get("artist_name"),
        "results": results,
    }


@router.get("/{session_id}/lyrics")
async def get_session_lyrics(session_id: str):
    """
    Get lyrics for the session's track.

    Uses hierarchical provider chain:
    1. Global cache (Redis → PostgreSQL)
    2. LRCLib (free, legal, synced lyrics)
    3. Genius plain text lyrics (fallback)

    Returns:
        - lyrics: Plain text lyrics (for backward compatibility)
        - lines: Array of synced lyrics with timestamps (if available)
        - syncType: 'synced', 'unsynced', or 'none'
        - source: 'lrclib', 'genius', or 'none'
        - status: 'found', 'not_found', or 'error'
        - url: Source URL (if available)
        - cachedAt: Cache timestamp (if from cache)
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get track info from session
    spotify_track_id = session.get("spotify_track_id", "")
    artist_name = session.get("artist_name", "")
    track_name = session.get("track_name", "")
    album_name = session.get("album_name")
    duration_ms = session.get("duration_ms")

    if not spotify_track_id:
        return {
            "session_id": session_id,
            "lyrics": "",
            "lines": None,
            "syncType": "none",
            "source": "none",
            "status": "not_found",
            "error": "Track ID not available",
        }

    if not artist_name or not track_name:
        return {
            "session_id": session_id,
            "lyrics": "",
            "lines": None,
            "syncType": "none",
            "source": "none",
            "status": "not_found",
            "error": "Track info not available",
        }

    # Convert duration to seconds for LRCLib
    duration_sec = int(duration_ms / 1000) if duration_ms else None

    # Fetch lyrics using unified service (handles caching internally)
    lyrics_result = await lyrics_service.get_lyrics(
        spotify_track_id=spotify_track_id,
        artist=artist_name,
        title=track_name,
        album=album_name,
        duration_sec=duration_sec,
    )

    return {
        "session_id": session_id,
        "lyrics": lyrics_result.get("lyrics", lyrics_result.get("text", "")),
        "lines": lyrics_result.get("lines"),
        "syncType": lyrics_result.get("syncType", "none"),
        "source": lyrics_result.get("source", "none"),
        "status": lyrics_result.get("status", "not_found"),
        "url": lyrics_result.get("url"),
        "cachedAt": lyrics_result.get("cachedAt"),
    }


@router.get("/{session_id}/lyrics-offset", response_model=LyricsOffsetResponse)
async def get_lyrics_offset(session_id: str):
    """
    Get the saved lyrics offset for the current session's track/video pair.
    Returns 0.0 if no offset has been saved.
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    spotify_track_id = session.get("spotify_track_id")
    youtube_id = session.get("youtube_id")

    if not spotify_track_id or not youtube_id:
        raise HTTPException(status_code=400, detail="Session missing track/video info")

    offset = await lyrics_offset_service.get_offset(spotify_track_id, youtube_id)

    return LyricsOffsetResponse(
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_id,
        offset_seconds=offset,
    )


@router.post("/{session_id}/lyrics-offset", response_model=LyricsOffsetResponse)
async def set_lyrics_offset(session_id: str, request: LyricsOffsetRequest):
    """
    Save or update the lyrics offset for the current session's track/video pair.
    Offset is stored permanently in PostgreSQL.

    Positive offset = lyrics appear earlier (video is ahead)
    Negative offset = lyrics appear later (video is behind)
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    spotify_track_id = session.get("spotify_track_id")
    youtube_id = session.get("youtube_id")

    if not spotify_track_id or not youtube_id:
        raise HTTPException(status_code=400, detail="Session missing track/video info")

    offset = await lyrics_offset_service.set_offset(
        spotify_track_id, youtube_id, request.offset_seconds
    )

    return LyricsOffsetResponse(
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_id,
        offset_seconds=offset,
    )


# ============================================
# Lyrics Cache Management Endpoints
# ============================================

@router.get("/lyrics-cache/stats")
async def get_lyrics_cache_stats():
    """
    Get lyrics cache statistics.

    Returns cache metrics including:
    - Total cached entries
    - Entries by source (lrclib, genius)
    - Entries by sync type (synced, unsynced, none)
    - TTL configuration
    """
    stats = await lyrics_cache_service.get_stats()
    return stats


@router.post("/{session_id}/lyrics/refresh")
async def refresh_session_lyrics(session_id: str):
    """
    Force refresh lyrics for the current session's track.

    Invalidates the cache and fetches fresh lyrics from providers.
    Use this if lyrics are incorrect or a better version is available.

    Returns:
        Fresh lyrics data
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    spotify_track_id = session.get("spotify_track_id", "")
    artist_name = session.get("artist_name", "")
    track_name = session.get("track_name", "")
    album_name = session.get("album_name")
    duration_ms = session.get("duration_ms")

    if not spotify_track_id:
        raise HTTPException(status_code=400, detail="Track ID not available")

    # Invalidate existing cache
    await lyrics_cache_service.invalidate(spotify_track_id)

    # Convert duration to seconds for LRCLib
    duration_sec = int(duration_ms / 1000) if duration_ms else None

    # Fetch fresh lyrics
    lyrics_result = await lyrics_service.get_lyrics(
        spotify_track_id=spotify_track_id,
        artist=artist_name,
        title=track_name,
        album=album_name,
        duration_sec=duration_sec,
    )

    return {
        "session_id": session_id,
        "refreshed": True,
        "lyrics": lyrics_result.get("text", ""),
        "lines": lyrics_result.get("lines"),
        "syncType": lyrics_result.get("syncType", "none"),
        "source": lyrics_result.get("source", "none"),
        "status": lyrics_result.get("status", "not_found"),
    }


@router.post("/lyrics-cache/cleanup")
async def cleanup_lyrics_cache():
    """
    Remove expired entries from the lyrics cache.

    This is typically run automatically, but can be triggered manually.

    Returns:
        Number of entries cleaned up
    """
    deleted = await lyrics_cache_service.cleanup_expired()
    return {"deleted": deleted, "status": "ok"}


# ============================================
# Persistent Results
# ============================================

async def _persist_results(session_id: str, session: dict, results: dict) -> None:
    """Persist analysis results to PostgreSQL for history."""
    try:
        from app.services.database import get_db
        from app.models.session_results import SessionResult
        from sqlalchemy import select

        async with get_db() as db:
            # Skip if already persisted
            existing = await db.execute(
                select(SessionResult).where(SessionResult.session_id == session_id)
            )
            if existing.scalar_one_or_none():
                logger.debug("Results already persisted for %s", session_id)
                return

            row = SessionResult(
                session_id=session_id,
                spotify_track_id=session.get("spotify_track_id", ""),
                youtube_video_id=session.get("youtube_id"),
                track_name=session.get("track_name"),
                artist_name=session.get("artist_name"),
                album_image=session.get("youtube_match", {}).get("thumbnail")
                    if isinstance(session.get("youtube_match"), dict) else None,
                score=results.get("score"),
                pitch_accuracy=results.get("pitch_accuracy"),
                rhythm_accuracy=results.get("rhythm_accuracy"),
                lyrics_accuracy=results.get("lyrics_accuracy"),
                jury_comments=results.get("jury_comments"),
            )
            db.add(row)
            # commit is handled by get_db() context manager
        logger.info("Results persisted for session %s (score=%s)", session_id, results.get("score"))
    except Exception as e:
        logger.error("Failed to persist results for %s: %s", session_id, e)


