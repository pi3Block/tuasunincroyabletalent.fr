"""
YouTube download cache service.
Stores references to downloaded audio files to avoid re-downloading.
Also caches Demucs separation results (vocals/instrumentals).

After storage migration: paths are storage URLs (https://storages.augmenter.pro/...).
Backward-compat: legacy local paths still accepted (file-existence check).
"""
import json
from datetime import datetime
from pathlib import Path
from typing import NamedTuple

from app.services.redis_client import redis_client
from app.config import settings


CACHE_KEY_PREFIX = "yt_cache:"
DEMUCS_CACHE_KEY_PREFIX = "demucs_cache:"
CACHE_TTL = 86400 * 7   # 7 days
DEMUCS_CACHE_TTL = 86400 * 90  # 90 days (expensive to regenerate)


def _is_storage_url(path: str) -> bool:
    """Detect if a value is a remote storage URL vs a local path."""
    return path.startswith("http://") or path.startswith("https://")


class DemucsResult(NamedTuple):
    """Result of Demucs separation (vocals/instrumentals as storage URLs or local paths)."""
    vocals_path: str
    instrumentals_path: str
    model_version: str
    created_at: str


class YouTubeCache:
    """Cache for YouTube audio downloads and Demucs separations."""

    # ============================================
    # Reference Audio Cache (Original)
    # ============================================

    async def get_cached_reference(self, youtube_id: str) -> dict | None:
        """
        Check if a YouTube reference is already downloaded.

        Returns cache entry dict if found and file is accessible, None otherwise.
        Supports both storage URLs (new) and legacy local paths (backward-compat).
        """
        client = await redis_client.get_client()
        data = await client.get(f"{CACHE_KEY_PREFIX}{youtube_id}")
        if data:
            cache_entry = json.loads(data)
            ref_path = cache_entry.get("reference_path", "")
            # Storage URL: always valid (trust the remote cache)
            if _is_storage_url(ref_path):
                return cache_entry
            # Legacy local path: verify file still exists
            if ref_path and Path(ref_path).exists():
                return cache_entry
            # File was deleted or URL is empty, invalidate cache
            await client.delete(f"{CACHE_KEY_PREFIX}{youtube_id}")
        return None

    async def set_cached_reference(self, youtube_id: str, data: dict):
        """
        Store a downloaded reference in the cache.

        Args:
            youtube_id: YouTube video ID
            data: Cache entry with reference_path (storage URL or local path) and metadata
        """
        client = await redis_client.get_client()
        await client.setex(
            f"{CACHE_KEY_PREFIX}{youtube_id}",
            CACHE_TTL,
            json.dumps(data)
        )

    def get_reference_path(self, youtube_id: str) -> Path:
        """
        Get the temp path where a reference could be cached locally.
        Legacy method — kept for backward-compat; after migration the actual
        download path is returned by youtube_service.download_audio() as a URL.
        """
        cache_dir = Path(settings.audio_temp_dir) / "cache" / youtube_id
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir / "reference.wav"

    # ============================================
    # Demucs Separation Cache
    # ============================================

    async def get_cached_demucs(self, youtube_id: str) -> DemucsResult | None:
        """
        Check if Demucs separation is already cached.

        Returns DemucsResult with storage URLs (new) or local paths (legacy).
        """
        client = await redis_client.get_client()
        cache_key = f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}"
        data = await client.get(cache_key)

        if data:
            cache_entry = json.loads(data)
            vocals_val = cache_entry["vocals_path"]
            instru_val = cache_entry["instrumentals_path"]

            # Storage URLs: trust the cache (verified by the worker that uploaded them)
            if _is_storage_url(vocals_val) and _is_storage_url(instru_val):
                return DemucsResult(
                    vocals_path=vocals_val,
                    instrumentals_path=instru_val,
                    model_version=cache_entry.get("model_version", "unknown"),
                    created_at=cache_entry.get("created_at", ""),
                )

            # Legacy local paths: verify both files still exist
            if Path(vocals_val).exists() and Path(instru_val).exists():
                return DemucsResult(
                    vocals_path=vocals_val,
                    instrumentals_path=instru_val,
                    model_version=cache_entry.get("model_version", "unknown"),
                    created_at=cache_entry.get("created_at", ""),
                )

            # Files missing — invalidate cache
            print(f"[DemucsCache] Files missing for {youtube_id}, invalidating")
            await client.delete(cache_key)

        return None

    async def set_cached_demucs(
        self,
        youtube_id: str,
        vocals_path: str,
        instrumentals_path: str,
        model_version: str = "htdemucs",
    ) -> None:
        """
        Store Demucs separation results in cache.

        Args:
            youtube_id: YouTube video ID
            vocals_path: Storage URL or local path to separated vocals
            instrumentals_path: Storage URL or local path to separated instrumentals
            model_version: Demucs model used (for invalidation on upgrade)
        """
        cache_entry = {
            "vocals_path": vocals_path,
            "instrumentals_path": instrumentals_path,
            "model_version": model_version,
            "created_at": datetime.utcnow().isoformat(),
            "youtube_id": youtube_id,
        }

        client = await redis_client.get_client()
        await client.setex(
            f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}",
            DEMUCS_CACHE_TTL,
            json.dumps(cache_entry),
        )

        print(f"[DemucsCache] SET for {youtube_id} (model: {model_version})")

    async def invalidate_demucs(self, youtube_id: str) -> None:
        """Invalidate Demucs cache for a YouTube ID."""
        client = await redis_client.get_client()
        await client.delete(f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}")
        print(f"[DemucsCache] Invalidated {youtube_id}")

    async def get_or_check_demucs_files(self, youtube_id: str) -> DemucsResult | None:
        """
        Get cached Demucs result from Redis.
        Storage migration: disk fallback removed (files live remotely).
        """
        return await self.get_cached_demucs(youtube_id)

    # ============================================
    # Cleanup Utilities
    # ============================================

    def get_cache_size(self, youtube_id: str) -> int:
        """Returns 0 after storage migration — remote files not measured locally."""
        return 0

    async def cleanup_cache(self, youtube_id: str) -> None:
        """
        Delete all cached files for a YouTube ID from remote storage and Redis.
        """
        from app.services.storage import storage
        await storage.delete(f"cache/{youtube_id}/reference.wav")
        await storage.delete(f"cache/{youtube_id}/vocals.wav")
        await storage.delete(f"cache/{youtube_id}/instrumentals.wav")

        client = await redis_client.get_client()
        await client.delete(f"{CACHE_KEY_PREFIX}{youtube_id}")
        await client.delete(f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}")
        print(f"[YouTubeCache] Cleaned up storage for {youtube_id}")


youtube_cache = YouTubeCache()
