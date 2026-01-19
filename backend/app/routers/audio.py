"""
Audio file serving routes with session-based authentication.
Serves separated audio tracks (vocals, instrumentals) for playback.
"""
from pathlib import Path
from typing import Literal
import re

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import FileResponse, StreamingResponse

from app.services.redis_client import redis_client
from app.config import settings

router = APIRouter()

# Valid track types
TrackType = Literal["vocals", "instrumentals", "original"]
SourceType = Literal["user", "ref"]


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

    base_path = Path(settings.audio_upload_dir)

    def check_exists(source: str, track: str) -> bool:
        if track == "original":
            if source == "user":
                # Check for both webm and wav
                webm_path = base_path / session_id / "user_recording.webm"
                wav_path = base_path / session_id / "user_recording.wav"
                return webm_path.exists() or wav_path.exists()
            else:
                ref_path = session.get("reference_path", "")
                return Path(ref_path).exists() if ref_path else False
        else:
            suffix = "_user" if source == "user" else "_ref"
            return (base_path / f"{session_id}{suffix}" / f"{track}.wav").exists()

    return {
        "session_id": session_id,
        "tracks": {
            "ref": {
                "vocals": check_exists("ref", "vocals"),
                "instrumentals": check_exists("ref", "instrumentals"),
                "original": check_exists("ref", "original"),
            },
            "user": {
                "vocals": check_exists("user", "vocals"),
                "instrumentals": check_exists("user", "instrumentals"),
                "original": check_exists("user", "original"),
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

    Args:
        session_id: The session UUID
        source: 'user' for user recording, 'ref' for reference
        track_type: 'vocals', 'instrumentals', or 'original'

    Returns:
        Audio file (WAV) with streaming support for large files.

    Example:
        GET /api/audio/{session_id}/ref/vocals
        GET /api/audio/{session_id}/user/instrumentals
    """
    # Validate session exists
    session = await redis_client.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    base_path = Path(settings.audio_upload_dir)

    # Determine file path
    if track_type == "original":
        # Original recording (not separated)
        if source == "user":
            # Try webm first, then wav
            file_path = base_path / session_id / "user_recording.webm"
            if not file_path.exists():
                file_path = base_path / session_id / "user_recording.wav"
            media_type = "audio/webm" if file_path.suffix == ".webm" else "audio/wav"
        else:
            file_path = Path(session.get("reference_path", ""))
            media_type = "audio/wav"
    else:
        # Separated track
        suffix = "_user" if source == "user" else "_ref"
        folder = base_path / f"{session_id}{suffix}"
        file_path = folder / f"{track_type}.wav"
        media_type = "audio/wav"

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Audio track not found: {source}/{track_type}"
        )

    # Get file stats
    file_size = file_path.stat().st_size

    # Support HTTP Range requests for seeking
    if range:
        return await _stream_range_response(file_path, range, file_size, media_type)

    # Full file response
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
    """Handle HTTP Range requests for audio seeking."""
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
