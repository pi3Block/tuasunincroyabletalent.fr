"""
Search routes for Spotify track lookup.
Includes Redis caching for search results (24h TTL) to reduce Spotify API calls.
"""
import hashlib
import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.spotify import spotify_service
from app.services.search_history import search_history
from app.services.redis_client import redis_client

router = APIRouter()

SEARCH_CACHE_TTL = 86400  # 24 hours
TRACK_CACHE_TTL = 172800  # 48 hours


class TrackAlbum(BaseModel):
    """Album info."""
    name: str | None
    image: str | None


class Track(BaseModel):
    """Track info from Spotify."""
    id: str
    name: str
    artists: list[str]
    album: TrackAlbum
    duration_ms: int
    preview_url: str | None
    external_url: str | None


class SearchResponse(BaseModel):
    """Search results response."""
    query: str
    tracks: list[Track]
    count: int


@router.get("/tracks", response_model=SearchResponse)
async def search_tracks(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
):
    """
    Search for tracks on Spotify.

    Returns matching tracks with metadata (name, artists, album art, duration).
    Results are cached in Redis for 24h to reduce Spotify API calls.
    """
    # Check Redis cache
    cache_key = f"search:{hashlib.md5(f'{q.lower().strip()}:{limit}'.encode()).hexdigest()}"
    try:
        client = await redis_client.get_client()
        cached = await client.get(cache_key)
        if cached:
            data = json.loads(cached)
            return SearchResponse(query=q, tracks=data, count=len(data))
    except Exception:
        pass  # Cache miss or Redis down — fall through to Spotify

    try:
        tracks = await spotify_service.search_tracks(q, limit=limit)

        # Cache results
        try:
            client = await redis_client.get_client()
            await client.setex(cache_key, SEARCH_CACHE_TTL, json.dumps([t.dict() if hasattr(t, 'dict') else t for t in tracks]))
        except Exception:
            pass  # Non-critical: caching failure doesn't block response

        return SearchResponse(query=q, tracks=tracks, count=len(tracks))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Spotify search failed: {str(e)}")


@router.get("/tracks/{track_id}", response_model=Track)
async def get_track(track_id: str):
    """
    Get track details by Spotify ID. Cached in Redis for 48h.
    """
    # Check Redis cache
    cache_key = f"track:{track_id}"
    try:
        client = await redis_client.get_client()
        cached = await client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    track = await spotify_service.get_track(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Cache result
    try:
        client = await redis_client.get_client()
        await client.setex(cache_key, TRACK_CACHE_TTL, json.dumps(track.dict() if hasattr(track, 'dict') else track))
    except Exception:
        pass

    return track


class RecentTrack(BaseModel):
    """Recently selected track."""
    spotify_track_id: str
    track_name: str
    artist_name: str
    album_image: str | None
    duration_ms: int
    timestamp: str


@router.get("/recent", response_model=list[RecentTrack])
async def get_recent_searches(
    limit: int = Query(10, ge=1, le=20, description="Max results"),
):
    """
    Get recently selected tracks across all users.

    Returns the most recently chosen tracks for quick access.
    """
    return await search_history.get_recent_tracks(limit)
