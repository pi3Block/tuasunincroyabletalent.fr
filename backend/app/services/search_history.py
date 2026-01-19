"""
Search history service.
Tracks recently selected tracks across all users.
"""
import json
from datetime import datetime

from app.services.redis_client import redis_client


HISTORY_KEY = "search_history"
MAX_HISTORY = 20


class SearchHistory:
    """Service for tracking search/selection history."""

    async def add_track(self, track: dict):
        """
        Add a track to the history.

        Args:
            track: Track data with id, name, artists, album, duration_ms
        """
        # Get album image safely
        album = track.get("album", {})
        if isinstance(album, dict):
            album_image = album.get("image")
        else:
            album_image = None

        # Get artists as list
        artists = track.get("artists", [])
        if isinstance(artists, list):
            artist_name = ", ".join(artists)
        else:
            artist_name = str(artists)

        entry = {
            "spotify_track_id": track["id"],
            "track_name": track["name"],
            "artist_name": artist_name,
            "album_image": album_image,
            "duration_ms": track.get("duration_ms", 0),
            "timestamp": datetime.utcnow().isoformat(),
        }
        # Use Redis list (LPUSH + LTRIM)
        client = await redis_client.get_client()
        await client.lpush(HISTORY_KEY, json.dumps(entry))
        await client.ltrim(HISTORY_KEY, 0, MAX_HISTORY - 1)

    async def get_recent_tracks(self, limit: int = 10) -> list[dict]:
        """
        Get recently selected tracks.

        Args:
            limit: Maximum number of tracks to return

        Returns:
            List of recent tracks (deduplicated)
        """
        client = await redis_client.get_client()
        items = await client.lrange(HISTORY_KEY, 0, limit * 2 - 1)

        # Deduplicate by spotify_track_id
        seen = set()
        unique = []
        for item in items:
            track = json.loads(item)
            if track["spotify_track_id"] not in seen:
                seen.add(track["spotify_track_id"])
                unique.append(track)
                if len(unique) >= limit:
                    break

        return unique


search_history = SearchHistory()
