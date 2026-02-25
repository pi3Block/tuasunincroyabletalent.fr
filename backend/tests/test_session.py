"""
Tests for session management: start, status, upload, analyze flow.
"""
import pytest


async def test_start_session(client):
    """Starting a session should create it in Redis and return YouTube match."""
    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
        "spotify_track_name": "Never Gonna Give You Up",
        "artist_name": "Rick Astley",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "created"
    assert data["session_id"]
    assert data["youtube_match"]["id"] == "dQw4w9WgXcQ"

    # Session should exist in Redis
    session = await client.mock_redis.get_session(data["session_id"])
    assert session is not None
    assert session["track_name"] == "Never Gonna Give You Up"


async def test_start_session_needs_fallback(client):
    """If YouTube match has low confidence, status should be needs_fallback."""
    # Make YouTube return a match with very different duration
    client.mock_youtube.search_for_track.return_value = {
        "id": "abc123",
        "title": "Some Video",
        "duration": 600,  # 10 min vs 3.5 min track
        "channel": "Test",
        "url": "https://www.youtube.com/watch?v=abc123",
    }

    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
    })
    assert resp.status_code == 200
    assert resp.json()["reference_status"] == "needs_fallback"


async def test_session_status_not_found(client):
    """Querying a nonexistent session should return 404."""
    resp = await client.get("/api/session/nonexistent/status")
    assert resp.status_code == 404


async def test_session_status(client):
    """Session status should reflect current state."""
    # Create a session first
    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
    })
    session_id = resp.json()["session_id"]

    # Mark reference as ready
    await client.mock_redis.update_session(session_id, {"reference_status": "ready"})

    resp = await client.get(f"/api/session/{session_id}/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["reference_status"] == "ready"
    assert data["reference_ready"] is True


async def test_upload_recording(client, tmp_path):
    """Uploading a recording should save the file and update session."""
    # Create session and mark reference ready
    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
    })
    session_id = resp.json()["session_id"]
    await client.mock_redis.update_session(session_id, {"reference_status": "ready"})

    # Upload a fake audio file
    resp = await client.post(
        f"/api/session/{session_id}/upload-recording",
        files={"audio": ("recording.webm", b"fake-audio-data", "audio/webm")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "uploaded"
    assert data["file_size"] > 0


async def test_upload_recording_reference_not_ready(client):
    """Uploading before reference is ready should fail."""
    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
    })
    session_id = resp.json()["session_id"]

    resp = await client.post(
        f"/api/session/{session_id}/upload-recording",
        files={"audio": ("recording.webm", b"fake-audio-data", "audio/webm")},
    )
    assert resp.status_code == 400


async def test_start_analysis(client):
    """Starting analysis should trigger Celery task and return task ID."""
    # Create session, mark ready, set paths
    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
    })
    session_id = resp.json()["session_id"]
    await client.mock_redis.update_session(session_id, {
        "reference_status": "ready",
        "reference_path": "/app/audio_files/ref.wav",
        "user_audio_path": "/app/audio_files/user.webm",
    })

    resp = await client.post(f"/api/session/{session_id}/analyze")
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_id"] == "test-task-id-123"
    assert data["status"] == "analyzing"

    # Celery should have been called
    client.mock_celery.send_task.assert_called_once()


async def test_analysis_status_pending(client):
    """Analysis status should return PENDING when task is queued."""
    # Create session with task ID
    resp = await client.post("/api/session/start", json={
        "spotify_track_id": "4cOdK2wGLETKBW3PvgPWqT",
    })
    session_id = resp.json()["session_id"]
    await client.mock_redis.update_session(session_id, {
        "analysis_task_id": "test-task-id-123",
    })

    resp = await client.get(f"/api/session/{session_id}/analysis-status")
    assert resp.status_code == 200
    assert resp.json()["analysis_status"] == "PENDING"
