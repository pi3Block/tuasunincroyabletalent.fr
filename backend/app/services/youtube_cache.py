"""
YouTube download cache service.
Stores references to downloaded audio files to avoid re-downloading.
"""
import json
from pathlib import Path

from app.services.redis_client import redis_client
from app.config import settings


CACHE_KEY_PREFIX = "yt_cache:"
CACHE_TTL = 86400 * 7  # 7 days


class YouTubeCache:
    """Cache for YouTube audio downloads."""

    def get_cache_dir(self) -> Path:
        """Get the cache directory path."""
        cache_dir = Path(settings.audio_upload_dir) / "cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir

    async def get_cached_reference(self, youtube_id: str) -> dict | None:
        """
        Check if a YouTube reference is already downloaded.

        Args:
            youtube_id: YouTube video ID

        Returns:
            Cache entry dict if found and file exists, None otherwise
        """
        client = await redis_client.get_client()
        data = await client.get(f"{CACHE_KEY_PREFIX}{youtube_id}")
        if data:
            cache_entry = json.loads(data)
            # Verify the file still exists
            if Path(cache_entry["reference_path"]).exists():
                return cache_entry
            # File was deleted, invalidate cache
            await client.delete(f"{CACHE_KEY_PREFIX}{youtube_id}")
        return None

    async def set_cached_reference(self, youtube_id: str, data: dict):
        """
        Store a downloaded reference in the cache.

        Args:
            youtube_id: YouTube video ID
            data: Cache entry with reference_path and metadata
        """
        client = await redis_client.get_client()
        await client.setex(
            f"{CACHE_KEY_PREFIX}{youtube_id}",
            CACHE_TTL,
            json.dumps(data)
        )

    def get_reference_path(self, youtube_id: str) -> Path:
        """
        Get the path where a reference should be cached.

        Args:
            youtube_id: YouTube video ID

        Returns:
            Path to the cached reference file
        """
        cache_dir = self.get_cache_dir() / youtube_id
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir / "reference.wav"


youtube_cache = YouTubeCache()
