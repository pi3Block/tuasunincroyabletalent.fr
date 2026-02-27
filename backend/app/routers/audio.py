"""
Audio file serving routes.
Serves separated audio tracks (vocals, instrumentals) for playback.

After storage migration: redirects (302) to storages.augmenter.pro public URLs.
Backward-compat: legacy local paths still served directly if files exist.
"""
import asyncio
import re
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse

from app.services.redis_client import redis_client
from app.services.storage import storage
from app.config import settings

router = APIRouter()

# Valid track types
TrackType = Literal["vocals", "instrumentals", "original"]
SourceType = Literal["user", "ref"]


def _is_storage_url(path: str) -> bool:
    return path.startswith("http://") or path.startswith("https://")


def _get_storage_relative(session_id: str, source: str, track_type: str) -> str:
    """Build the storage relative path for a given source/track combination."""
    if track_type == "original":
        if source == "user":
            # user_recording can be .webm or .wav — try webm first (most common)
            return f"sessions/{session_id}/user_recording.webm"
        else:
            return f"cache/UNKNOWN/reference.wav"  # handled separately via session data
    elif source == "ref":
        return f"sessions/{session_id}_ref/{track_type}.wav"
    else:
        return f"sessions/{session_id}_user/{track_type}.wav"


@router.get("/{session_id}/tracks")
async def list_available_tracks(session_id: str):
    """
    List all available audio tracks for a session.

    Returns:
        {
            "session_id": "...",
            "tracks": {
                "ref": {"vocals": true, "instrumentals": true, "original": true},
                "user": {"vocals": true, "instrumentals": false, "original": true}
            }
        }
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_audio_path = session.get("user_audio_path", "")
    reference_path = session.get("reference_path", "")

    # Original tracks: check session data (storage URLs) or legacy local paths
    user_original_ready = bool(user_audio_path) and (
        _is_storage_url(user_audio_path) or Path(user_audio_path).exists()
    )
    ref_original_ready = bool(reference_path) and (
        _is_storage_url(reference_path) or Path(reference_path).exists()
    )

    # Separated tracks: check storage (4 HEAD requests, concurrent)
    async def _check(rel_path: str) -> bool:
        try:
            return await storage.exists(rel_path)
        except Exception:
            return False

    ref_vocals_path = f"sessions/{session_id}_ref/vocals.wav"
    ref_instru_path = f"sessions/{session_id}_ref/instrumentals.wav"
    user_vocals_path = f"sessions/{session_id}_user/vocals.wav"
    user_instru_path = f"sessions/{session_id}_user/instrumentals.wav"

    (
        ref_vocals_ready,
        ref_instru_ready,
        user_vocals_ready,
        user_instru_ready,
    ) = await asyncio.gather(
        _check(ref_vocals_path),
        _check(ref_instru_path),
        _check(user_vocals_path),
        _check(user_instru_path),
    )

    return {
        "session_id": session_id,
        "tracks": {
            "ref": {
                "vocals": ref_vocals_ready,
                "instrumentals": ref_instru_ready,
                "original": ref_original_ready,
            },
            "user": {
                "vocals": user_vocals_ready,
                "instrumentals": user_instru_ready,
                "original": user_original_ready,
            },
        }
    }


@router.get("/{session_id}/{source}/{track_type}")
async def get_audio_track(
    session_id: str,
    source: SourceType,
    track_type: TrackType,
    range: str = Header(None),
):
    """
    Serve separated audio track for a session.

    After storage migration: returns a 302 redirect to the storage public URL.
    The storage server (storages.augmenter.pro) supports HTTP Range for seeking.

    Backward-compat: falls back to local file serving if reference_path/user_audio_path
    is a legacy local path (sessions created before migration).

    Args:
        session_id: The session UUID
        source: 'user' for user recording, 'ref' for reference
        track_type: 'vocals', 'instrumentals', or 'original'
    """
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── Original tracks: use stored path/URL from session ──────────────────
    if track_type == "original":
        if source == "user":
            file_ref = session.get("user_audio_path", "")
            media_type = "audio/webm"
        else:
            file_ref = session.get("reference_path", "")
            media_type = "audio/wav"

        if not file_ref:
            raise HTTPException(status_code=404, detail=f"Audio track not found: {source}/original")

        if _is_storage_url(file_ref):
            return RedirectResponse(url=file_ref, status_code=302)

        # Legacy: serve from local filesystem
        file_path = Path(file_ref)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"Audio track not found: {source}/original")
        media_type = "audio/webm" if file_path.suffix == ".webm" else "audio/wav"
        return await _serve_local_file(file_path, media_type, range)

    # ── Separated tracks: storage URL (constructed from known pattern) ─────
    if source == "ref":
        rel_path = f"sessions/{session_id}_ref/{track_type}.wav"
    else:
        rel_path = f"sessions/{session_id}_user/{track_type}.wav"

    storage_url = storage.public_url(rel_path)

    # Quick storage existence check (also handles backward-compat via legacy dirs)
    if await storage.exists(rel_path):
        return RedirectResponse(url=storage_url, status_code=302)

    # Backward-compat: try legacy local path
    legacy_base = Path(settings.audio_upload_dir)
    if source == "ref":
        legacy_path = legacy_base / f"{session_id}_ref" / f"{track_type}.wav"
    else:
        legacy_path = legacy_base / f"{session_id}_user" / f"{track_type}.wav"

    if legacy_path.exists():
        return await _serve_local_file(legacy_path, "audio/wav", range)

    raise HTTPException(
        status_code=404,
        detail=f"Audio track not found: {source}/{track_type}"
    )


async def _serve_local_file(
    file_path: Path,
    media_type: str,
    range_header: str | None,
) -> FileResponse | StreamingResponse:
    """Serve a local file with optional Range support (legacy backward-compat)."""
    file_size = file_path.stat().st_size

    if range_header:
        return await _stream_range_response(file_path, range_header, file_size, media_type)

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Cache-Control": "private, max-age=3600",
        }
    )


async def _stream_range_response(
    file_path: Path,
    range_header: str,
    file_size: int,
    media_type: str
) -> StreamingResponse:
    """Handle HTTP Range requests for audio seeking (legacy local files)."""
    range_match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not range_match:
        raise HTTPException(status_code=416, detail="Invalid Range header")

    start = int(range_match.group(1))
    end = int(range_match.group(2)) if range_match.group(2) else file_size - 1

    if start >= file_size:
        raise HTTPException(status_code=416, detail="Range not satisfiable")

    end = min(end, file_size - 1)
    content_length = end - start + 1

    def iter_file():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk_size = min(8192, remaining)
                data = f.read(chunk_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    return StreamingResponse(
        iter_file(),
        status_code=206,
        media_type=media_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
        }
    )
