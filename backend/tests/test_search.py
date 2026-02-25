"""
Tests for Spotify search endpoints.
"""
import pytest
from unittest.mock import AsyncMock


async def test_search_tracks(client):
    """Search should return Spotify tracks."""
    resp = await client.get("/api/search/tracks?q=rick+astley")
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "rick astley"
    assert data["count"] == 1
    assert data["tracks"][0]["name"] == "Never Gonna Give You Up"
    assert data["tracks"][0]["artists"] == ["Rick Astley"]

    # Spotify service should have been called
    client.mock_spotify.search_tracks.assert_called_once_with("rick astley", limit=10)


async def test_search_tracks_with_limit(client):
    """Search should pass limit parameter."""
    resp = await client.get("/api/search/tracks?q=test&limit=5")
    assert resp.status_code == 200
    client.mock_spotify.search_tracks.assert_called_once_with("test", limit=5)


async def test_search_tracks_empty_query(client):
    """Empty query should return 422 validation error."""
    resp = await client.get("/api/search/tracks?q=")
    assert resp.status_code == 422


async def test_search_tracks_missing_query(client):
    """Missing query parameter should return 422."""
    resp = await client.get("/api/search/tracks")
    assert resp.status_code == 422


async def test_search_tracks_service_error(client):
    """Service error should return 500."""
    client.mock_spotify.search_tracks.side_effect = Exception("API unavailable")

    resp = await client.get("/api/search/tracks?q=test")
    assert resp.status_code == 500
    assert "Spotify search failed" in resp.json()["detail"]


async def test_get_track_by_id(client):
    """Get track by ID should return track details."""
    resp = await client.get("/api/search/tracks/4cOdK2wGLETKBW3PvgPWqT")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "4cOdK2wGLETKBW3PvgPWqT"
    assert data["name"] == "Never Gonna Give You Up"


async def test_get_track_not_found(client):
    """Nonexistent track should return 404."""
    client.mock_spotify.get_track.return_value = None

    resp = await client.get("/api/search/tracks/nonexistent")
    assert resp.status_code == 404


async def test_recent_searches(client):
    """Recent searches should return empty list when no history."""
    resp = await client.get("/api/search/recent")
    assert resp.status_code == 200
    assert resp.json() == []
