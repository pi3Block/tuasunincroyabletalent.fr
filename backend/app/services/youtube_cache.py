"""
YouTube download cache service.
Stores references to downloaded audio files to avoid re-downloading.
Also caches Demucs separation results (vocals/instrumentals).
"""
import json
from datetime import datetime
from pathlib import Path
from typing import NamedTuple

from app.services.redis_client import redis_client
from app.config import settings


CACHE_KEY_PREFIX = "yt_cache:"
DEMUCS_CACHE_KEY_PREFIX = "demucs_cache:"
CACHE_TTL = 86400 * 7  # 7 days
DEMUCS_CACHE_TTL = 86400 * 90  # 90 days (expensive to regenerate)


class DemucsResult(NamedTuple):
    """Result of Demucs separation."""
    vocals_path: Path
    instrumentals_path: Path
    model_version: str
    created_at: str


class YouTubeCache:
    """Cache for YouTube audio downloads and Demucs separations."""

    def get_cache_dir(self) -> Path:
        """Get the cache directory path."""
        cache_dir = Path(settings.audio_upload_dir) / "cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir

    # ============================================
    # Reference Audio Cache (Original)
    # ============================================

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

    # ============================================
    # Demucs Separation Cache (NEW)
    # ============================================

    def get_demucs_paths(self, youtube_id: str) -> dict[str, Path]:
        """
        Get paths for Demucs separated audio files.

        Args:
            youtube_id: YouTube video ID

        Returns:
            Dict with paths for vocals, instrumentals, and metadata
        """
        cache_dir = self.get_cache_dir() / youtube_id
        cache_dir.mkdir(parents=True, exist_ok=True)
        return {
            "vocals": cache_dir / "vocals.wav",
            "instrumentals": cache_dir / "instrumentals.wav",
            "metadata": cache_dir / "demucs_metadata.json",
        }

    async def get_cached_demucs(self, youtube_id: str) -> DemucsResult | None:
        """
        Check if Demucs separation is already cached.

        Args:
            youtube_id: YouTube video ID

        Returns:
            DemucsResult if found and files exist, None otherwise
        """
        client = await redis_client.get_client()
        cache_key = f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}"
        data = await client.get(cache_key)

        if data:
            cache_entry = json.loads(data)
            vocals_path = Path(cache_entry["vocals_path"])
            instrumentals_path = Path(cache_entry["instrumentals_path"])

            # Verify both files still exist
            if vocals_path.exists() and instrumentals_path.exists():
                print(f"[DemucsCache] HIT for {youtube_id}")
                return DemucsResult(
                    vocals_path=vocals_path,
                    instrumentals_path=instrumentals_path,
                    model_version=cache_entry.get("model_version", "unknown"),
                    created_at=cache_entry.get("created_at", ""),
                )

            # Files were deleted, invalidate cache
            print(f"[DemucsCache] Files missing for {youtube_id}, invalidating")
            await client.delete(cache_key)

        return None

    async def set_cached_demucs(
        self,
        youtube_id: str,
        vocals_path: Path,
        instrumentals_path: Path,
        model_version: str = "htdemucs",
    ) -> None:
        """
        Store Demucs separation results in cache.

        Args:
            youtube_id: YouTube video ID
            vocals_path: Path to separated vocals file
            instrumentals_path: Path to separated instrumentals file
            model_version: Demucs model used (for invalidation on upgrade)
        """
        cache_entry = {
            "vocals_path": str(vocals_path),
            "instrumentals_path": str(instrumentals_path),
            "model_version": model_version,
            "created_at": datetime.utcnow().isoformat(),
            "youtube_id": youtube_id,
        }

        # Store in Redis
        client = await redis_client.get_client()
        await client.setex(
            f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}",
            DEMUCS_CACHE_TTL,
            json.dumps(cache_entry),
        )

        # Also write metadata file for backup
        paths = self.get_demucs_paths(youtube_id)
        paths["metadata"].write_text(json.dumps(cache_entry, indent=2))

        print(f"[DemucsCache] SET for {youtube_id} (model: {model_version})")

    async def invalidate_demucs(self, youtube_id: str) -> None:
        """
        Invalidate Demucs cache for a YouTube ID.
        Does NOT delete files (call cleanup separately).

        Args:
            youtube_id: YouTube video ID
        """
        client = await redis_client.get_client()
        await client.delete(f"{DEMUCS_CACHE_KEY_PREFIX}{youtube_id}")
        print(f"[DemucsCache] Invalidated {youtube_id}")

    async def get_or_check_demucs_files(self, youtube_id: str) -> DemucsResult | None:
        """
        Get cached Demucs result, falling back to checking files on disk.

        Useful when Redis cache expired but files still exist.

        Args:
            youtube_id: YouTube video ID

        Returns:
            DemucsResult if files exist, None otherwise
        """
        # Try Redis first
        cached = await self.get_cached_demucs(youtube_id)
        if cached:
            return cached

        # Check if files exist on disk (Redis may have expired)
        paths = self.get_demucs_paths(youtube_id)
        if paths["vocals"].exists() and paths["instrumentals"].exists():
            # Files exist, restore Redis cache
            metadata = {}
            if paths["metadata"].exists():
                try:
                    metadata = json.loads(paths["metadata"].read_text())
                except Exception:
                    pass

            model_version = metadata.get("model_version", "htdemucs")
            created_at = metadata.get("created_at", "")

            # Restore Redis cache
            await self.set_cached_demucs(
                youtube_id,
                paths["vocals"],
                paths["instrumentals"],
                model_version,
            )

            print(f"[DemucsCache] Restored from disk for {youtube_id}")
            return DemucsResult(
                vocals_path=paths["vocals"],
                instrumentals_path=paths["instrumentals"],
                model_version=model_version,
                created_at=created_at,
            )

        return None

    # ============================================
    # Cleanup Utilities
    # ============================================

    def get_cache_size(self, youtube_id: str) -> int:
        """
        Get total size of cached files for a YouTube ID.

        Args:
            youtube_id: YouTube video ID

        Returns:
            Total size in bytes
        """
        cache_dir = self.get_cache_dir() / youtube_id
        if not cache_dir.exists():
            return 0

        total = 0
        for f in cache_dir.iterdir():
            if f.is_file():
                total += f.stat().st_size
        return total

    def cleanup_cache(self, youtube_id: str) -> None:
        """
        Delete all cached files for a YouTube ID.

        Args:
            youtube_id: YouTube video ID
        """
        import shutil
        cache_dir = self.get_cache_dir() / youtube_id
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
            print(f"[YouTubeCache] Cleaned up {youtube_id}")


youtube_cache = YouTubeCache()
