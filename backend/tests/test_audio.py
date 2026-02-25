"""
Tests for audio track serving with HTTP Range support.
"""
import pytest
from pathlib import Path
from unittest.mock import patch


async def test_list_tracks_session_not_found(client):
    """Listing tracks for nonexistent session should return 404."""
    resp = await client.get("/api/audio/nonexistent/tracks")
    assert resp.status_code == 404


async def test_list_tracks(client):
    """Listing tracks should return availability map."""
    # Create a session
    await client.mock_redis.set_session("test-session", {
        "reference_path": "/app/audio_files/cache/ref.wav",
    })

    resp = await client.get("/api/audio/test-session/tracks")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == "test-session"
    assert "ref" in data["tracks"]
    assert "user" in data["tracks"]
    # Files don't exist on disk in test, so all should be false
    assert data["tracks"]["ref"]["vocals"] is False
    assert data["tracks"]["user"]["vocals"] is False


async def test_get_audio_track_not_found(client):
    """Getting a track file that doesn't exist should return 404."""
    await client.mock_redis.set_session("test-session", {
        "reference_path": "/nonexistent/ref.wav",
    })

    resp = await client.get("/api/audio/test-session/ref/vocals")
    assert resp.status_code == 404


async def test_get_audio_track_session_not_found(client):
    """Getting a track for nonexistent session should return 404."""
    resp = await client.get("/api/audio/nonexistent/ref/vocals")
    assert resp.status_code == 404


async def test_get_audio_track_with_file(client, tmp_path):
    """Getting an existing track should return the file."""
    # Create a fake audio file
    session_dir = tmp_path / "test-session_ref"
    session_dir.mkdir()
    audio_file = session_dir / "vocals.wav"
    audio_file.write_bytes(b"RIFF" + b"\x00" * 100)  # Fake WAV header

    await client.mock_redis.set_session("test-session", {
        "reference_path": str(tmp_path / "ref.wav"),
    })

    with patch("app.routers.audio.settings") as mock_settings:
        mock_settings.audio_upload_dir = str(tmp_path)
        resp = await client.get("/api/audio/test-session/ref/vocals")

    assert resp.status_code == 200
    assert resp.headers["accept-ranges"] == "bytes"


async def test_get_audio_track_range_request(client, tmp_path):
    """Range request should return 206 with partial content."""
    # Create a fake audio file
    session_dir = tmp_path / "test-session_ref"
    session_dir.mkdir()
    audio_file = session_dir / "vocals.wav"
    content = b"RIFF" + b"\x00" * 1000
    audio_file.write_bytes(content)

    await client.mock_redis.set_session("test-session", {
        "reference_path": str(tmp_path / "ref.wav"),
    })

    with patch("app.routers.audio.settings") as mock_settings:
        mock_settings.audio_upload_dir = str(tmp_path)
        resp = await client.get(
            "/api/audio/test-session/ref/vocals",
            headers={"Range": "bytes=0-99"},
        )

    assert resp.status_code == 206
    assert "content-range" in resp.headers
    assert resp.headers["content-length"] == "100"
