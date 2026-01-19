"""
Search routes for Spotify track lookup.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.spotify import spotify_service
from app.services.search_history import search_history

router = APIRouter()


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
    """
    try:
        tracks = await spotify_service.search_tracks(q, limit=limit)
        return SearchResponse(
            query=q,
            tracks=tracks,
            count=len(tracks),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Spotify search failed: {str(e)}")


@router.get("/tracks/{track_id}", response_model=Track)
async def get_track(track_id: str):
    """
    Get track details by Spotify ID.
    """
    track = await spotify_service.get_track(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
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
