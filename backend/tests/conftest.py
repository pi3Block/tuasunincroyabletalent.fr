"""
Test fixtures for the VoiceJury backend.

Provides:
- FastAPI test client (httpx AsyncClient)
- Mock Redis (in-memory dict-based)
- Mock services (Spotify, YouTube, search history, lyrics)
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


# ============================================
# Sample data
# ============================================

SAMPLE_TRACK = {
    "id": "4cOdK2wGLETKBW3PvgPWqT",
    "name": "Never Gonna Give You Up",
    "artists": ["Rick Astley"],
    "album": {"name": "Whenever You Need Somebody", "image": "https://i.scdn.co/image/abc123"},
    "album_image": "https://i.scdn.co/image/abc123",
    "duration_ms": 213573,
    "preview_url": None,
    "external_url": "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
}

SAMPLE_YOUTUBE_MATCH = {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up (Official Video)",
    "duration": 212,
    "channel": "Rick Astley",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
}

SAMPLE_LYRICS = {
    "text": "We're no strangers to love\nYou know the rules and so do I",
    "lyrics": "We're no strangers to love\nYou know the rules and so do I",
    "lines": [
        {"text": "We're no strangers to love", "startTimeMs": 18000, "endTimeMs": 22000},
        {"text": "You know the rules and so do I", "startTimeMs": 22000, "endTimeMs": 27000},
    ],
    "syncType": "synced",
    "source": "lrclib",
    "status": "found",
    "url": "https://lrclib.net/api/get/12345",
    "cachedAt": None,
}


# ============================================
# Mock Redis (in-memory)
# ============================================

class MockRedisClient:
    """In-memory Redis mock for testing."""

    def __init__(self):
        self._store: dict[str, str] = {}
        self._ttls: dict[str, int] = {}

    async def get_client(self):
        return self

    async def ping(self):
        return True

    async def close(self):
        pass

    async def set_session(self, session_id: str, data: dict, ttl: int = 3600):
        self._store[f"session:{session_id}"] = json.dumps(data)
        self._ttls[f"session:{session_id}"] = ttl

    async def get_session(self, session_id: str) -> dict | None:
        raw = self._store.get(f"session:{session_id}")
        if raw:
            return json.loads(raw)
        return None

    async def update_session(self, session_id: str, updates: dict) -> bool:
        current = await self.get_session(session_id)
        if current is None:
            return False
        current.update(updates)
        await self.set_session(session_id, current)
        return True

    async def delete_session(self, session_id: str):
        self._store.pop(f"session:{session_id}", None)

    # Generic Redis ops used by search_history
    async def lpush(self, key, *values):
        pass

    async def ltrim(self, key, start, stop):
        pass

    async def lrange(self, key, start, stop):
        return []


# ============================================
# Fixtures
# ============================================

@pytest.fixture
def mock_redis():
    """Provide an in-memory Redis mock."""
    return MockRedisClient()


@pytest.fixture
def mock_spotify():
    """Mock Spotify service."""
    service = AsyncMock()
    service.search_tracks.return_value = [SAMPLE_TRACK]
    service.get_track.return_value = SAMPLE_TRACK
    return service


@pytest.fixture
def mock_youtube():
    """Mock YouTube service."""
    service = AsyncMock()
    service.search_for_track.return_value = SAMPLE_YOUTUBE_MATCH
    service.download_audio.return_value = Path("/app/audio_files/cache/dQw4w9WgXcQ/reference.wav")
    service.validate_youtube_url.return_value = True
    service.get_video_info.return_value = SAMPLE_YOUTUBE_MATCH
    return service


@pytest.fixture
def mock_search_history():
    """Mock search history service."""
    service = AsyncMock()
    service.add_track.return_value = None
    service.get_recent_tracks.return_value = []
    return service


@pytest.fixture
def mock_lyrics():
    """Mock lyrics service."""
    service = AsyncMock()
    service.get_lyrics.return_value = SAMPLE_LYRICS
    return service


@pytest.fixture
def mock_youtube_cache():
    """Mock YouTube cache."""
    cache = AsyncMock()
    cache.get_cached_reference.return_value = None
    cache.set_cached_reference.return_value = None
    cache.get_reference_path.return_value = Path("/app/audio_files/cache/dQw4w9WgXcQ")
    return cache


@pytest.fixture
def mock_celery():
    """Mock Celery app for task sending."""
    mock = MagicMock()
    mock_task = MagicMock()
    mock_task.id = "test-task-id-123"
    mock.send_task.return_value = mock_task
    mock_result = MagicMock()
    mock_result.status = "PENDING"
    mock_result.info = None
    mock_result.result = None
    mock.AsyncResult.return_value = mock_result
    return mock


@pytest.fixture
async def client(
    mock_redis,
    mock_spotify,
    mock_youtube,
    mock_search_history,
    mock_lyrics,
    mock_youtube_cache,
    mock_celery,
):
    """
    Async test client with all services mocked.

    Patches singleton services so routes use mocks instead of real connections.
    """
    with (
        patch("app.routers.session.redis_client", mock_redis),
        patch("app.routers.session.spotify_service", mock_spotify),
        patch("app.routers.session.youtube_service", mock_youtube),
        patch("app.routers.session.youtube_cache", mock_youtube_cache),
        patch("app.routers.session.search_history", mock_search_history),
        patch("app.routers.session.lyrics_service", mock_lyrics),
        patch("app.routers.session.celery_app", mock_celery),
        patch("app.routers.search.spotify_service", mock_spotify),
        patch("app.routers.search.search_history", mock_search_history),
        patch("app.routers.audio.redis_client", mock_redis),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # Expose mocks on client for assertions
            ac.mock_redis = mock_redis  # type: ignore
            ac.mock_spotify = mock_spotify  # type: ignore
            ac.mock_youtube = mock_youtube  # type: ignore
            ac.mock_celery = mock_celery  # type: ignore
            yield ac
