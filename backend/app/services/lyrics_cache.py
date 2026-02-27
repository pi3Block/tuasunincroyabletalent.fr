"""
Lyrics cache service for efficient lyrics retrieval.
Implements a two-tier caching strategy:
1. Redis (fast, in-memory) - First tier
2. PostgreSQL (persistent, larger capacity) - Second tier

Cache hierarchy:
Redis Cache (1h TTL) → PostgreSQL Cache (90-365 days TTL) → External APIs

TTL Strategy:
- Synced lyrics (lrclib): 365 days (stable, reliable source)
- Unsynced lyrics (genius): 90 days (may get updated)
- Not found results: 7 days (retry after a week)
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, delete, func
from sqlalchemy.dialects.postgresql import insert

from app.config import settings
from app.services.redis_client import redis_client
from app.services.database import get_db
from app.models.lyrics_cache import LyricsCache


# Cache configuration
REDIS_CACHE_PREFIX = "lyrics:"
REDIS_CACHE_TTL = 3600  # 1 hour (fast layer, increased from 5min)

# PostgreSQL TTL by source/status (in days)
POSTGRES_TTL_SYNCED = 365      # 1 year for synced lyrics (stable)
POSTGRES_TTL_UNSYNCED = 90     # 3 months for unsynced lyrics
POSTGRES_TTL_NOT_FOUND = 7     # 1 week for not found (retry later)


class LyricsCacheService:
    """
    Two-tier lyrics caching service.

    Provides fast access to lyrics data with automatic cache population
    and expiration handling.
    """

    # ============================================
    # Redis Cache Layer (Tier 1 - Fast)
    # ============================================

    async def get_from_redis(self, spotify_track_id: str) -> dict | None:
        """
        Get lyrics from Redis cache (fast layer).

        Args:
            spotify_track_id: Spotify track ID

        Returns:
            Cached lyrics data or None if not found/expired
        """
        try:
            client = await redis_client.get_client()
            data = await client.get(f"{REDIS_CACHE_PREFIX}{spotify_track_id}")
            if data:
                print(f"[LyricsCache] Redis HIT for {spotify_track_id}")
                return json.loads(data)
        except Exception as e:
            print(f"[LyricsCache] Redis error: {e}")
        return None

    async def set_in_redis(self, spotify_track_id: str, data: dict) -> None:
        """
        Store lyrics in Redis cache.

        Args:
            spotify_track_id: Spotify track ID
            data: Lyrics data to cache
        """
        try:
            client = await redis_client.get_client()
            await client.setex(
                f"{REDIS_CACHE_PREFIX}{spotify_track_id}",
                REDIS_CACHE_TTL,
                json.dumps(data),
            )
            print(f"[LyricsCache] Redis SET for {spotify_track_id}")
        except Exception as e:
            print(f"[LyricsCache] Redis set error: {e}")

    async def invalidate_redis(self, spotify_track_id: str) -> None:
        """Remove lyrics from Redis cache."""
        try:
            client = await redis_client.get_client()
            await client.delete(f"{REDIS_CACHE_PREFIX}{spotify_track_id}")
        except Exception as e:
            print(f"[LyricsCache] Redis delete error: {e}")

    # ============================================
    # PostgreSQL Cache Layer (Tier 2 - Persistent)
    # ============================================

    async def get_from_postgres(self, spotify_track_id: str) -> dict | None:
        """
        Get lyrics from PostgreSQL cache (persistent layer).

        Automatically handles expiration checking.

        Args:
            spotify_track_id: Spotify track ID

        Returns:
            Cached lyrics data or None if not found/expired
        """
        try:
            async with get_db() as session:
                result = await session.execute(
                    select(LyricsCache).where(
                        LyricsCache.spotify_track_id == spotify_track_id
                    )
                )
                cache_entry = result.scalar_one_or_none()

                if cache_entry is None:
                    return None

                # Check expiration
                if cache_entry.is_expired:
                    print(f"[LyricsCache] PostgreSQL EXPIRED for {spotify_track_id}")
                    return None

                print(f"[LyricsCache] PostgreSQL HIT for {spotify_track_id}")
                return cache_entry.to_dict()

        except Exception as e:
            print(f"[LyricsCache] PostgreSQL get error: {e}")
            return None

    def _get_ttl_days(self, sync_type: str, source: str, has_lyrics: bool) -> int:
        """
        Determine cache TTL based on lyrics quality/source.

        Strategy:
        - Synced lyrics from reliable sources: 1 year
        - Unsynced lyrics: 3 months
        - Not found: 1 week (retry soon)
        """
        if not has_lyrics or source == "none":
            return POSTGRES_TTL_NOT_FOUND

        if sync_type == "synced":
            return POSTGRES_TTL_SYNCED

        return POSTGRES_TTL_UNSYNCED

    async def set_in_postgres(
        self,
        spotify_track_id: str,
        lyrics_text: str | None,
        synced_lines: list[dict] | None,
        sync_type: str,
        source: str,
        source_url: str | None = None,
        artist_name: str | None = None,
        track_name: str | None = None,
    ) -> None:
        """
        Store lyrics in PostgreSQL cache with UPSERT.

        TTL varies by lyrics quality:
        - Synced lyrics: 365 days
        - Unsynced lyrics: 90 days
        - Not found: 7 days

        Args:
            spotify_track_id: Spotify track ID
            lyrics_text: Plain text lyrics
            synced_lines: Array of synced lyrics lines
            sync_type: 'synced', 'unsynced', or 'none'
            source: 'lrclib', 'genius', or 'none'
            source_url: URL to lyrics source
            artist_name: Artist name for debugging
            track_name: Track name for debugging
        """
        try:
            has_lyrics = bool(lyrics_text) or bool(synced_lines)
            ttl_days = self._get_ttl_days(sync_type, source, has_lyrics)
            expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)

            async with get_db() as session:
                stmt = insert(LyricsCache).values(
                    spotify_track_id=spotify_track_id,
                    lyrics_text=lyrics_text,
                    synced_lines=synced_lines,
                    sync_type=sync_type,
                    source=source,
                    source_url=source_url,
                    artist_name=artist_name,
                    track_name=track_name,
                    fetched_at=datetime.now(timezone.utc),
                    expires_at=expires_at,
                ).on_conflict_do_update(
                    index_elements=['spotify_track_id'],
                    set_={
                        'lyrics_text': lyrics_text,
                        'synced_lines': synced_lines,
                        'sync_type': sync_type,
                        'source': source,
                        'source_url': source_url,
                        'artist_name': artist_name,
                        'track_name': track_name,
                        'fetched_at': datetime.now(timezone.utc),
                        'expires_at': expires_at,
                    }
                )
                await session.execute(stmt)
                print(f"[LyricsCache] PostgreSQL SET for {spotify_track_id} (TTL: {ttl_days}d, source: {source})")

        except Exception as e:
            print(f"[LyricsCache] PostgreSQL set error: {e}")

    async def invalidate_postgres(self, spotify_track_id: str) -> None:
        """Remove lyrics from PostgreSQL cache."""
        try:
            async with get_db() as session:
                await session.execute(
                    delete(LyricsCache).where(
                        LyricsCache.spotify_track_id == spotify_track_id
                    )
                )
        except Exception as e:
            print(f"[LyricsCache] PostgreSQL delete error: {e}")

    async def cleanup_expired(self) -> int:
        """
        Remove expired entries from PostgreSQL cache.

        Returns:
            Number of entries deleted
        """
        try:
            async with get_db() as session:
                result = await session.execute(
                    delete(LyricsCache).where(
                        LyricsCache.expires_at < datetime.now(timezone.utc)
                    )
                )
                deleted = result.rowcount
                print(f"[LyricsCache] Cleaned up {deleted} expired entries")
                return deleted
        except Exception as e:
            print(f"[LyricsCache] Cleanup error: {e}")
            return 0

    async def get_stats(self) -> dict:
        """
        Get cache statistics.

        Returns:
            Dict with cache stats (total entries, by source, by sync type)
        """
        try:
            async with get_db() as session:
                # Total count
                total_result = await session.execute(
                    select(func.count()).select_from(LyricsCache)
                )
                total = total_result.scalar() or 0

                # Count by source
                source_result = await session.execute(
                    select(
                        LyricsCache.source,
                        func.count().label("count")
                    ).group_by(LyricsCache.source)
                )
                by_source = {row.source: row.count for row in source_result}

                # Count by sync type
                sync_result = await session.execute(
                    select(
                        LyricsCache.sync_type,
                        func.count().label("count")
                    ).group_by(LyricsCache.sync_type)
                )
                by_sync_type = {row.sync_type: row.count for row in sync_result}

                # Expired count
                expired_result = await session.execute(
                    select(func.count()).select_from(LyricsCache).where(
                        LyricsCache.expires_at < datetime.now(timezone.utc)
                    )
                )
                expired = expired_result.scalar() or 0

                return {
                    "total": total,
                    "valid": total - expired,
                    "expired": expired,
                    "by_source": by_source,
                    "by_sync_type": by_sync_type,
                    "ttl_config": {
                        "synced_days": POSTGRES_TTL_SYNCED,
                        "unsynced_days": POSTGRES_TTL_UNSYNCED,
                        "not_found_days": POSTGRES_TTL_NOT_FOUND,
                        "redis_seconds": REDIS_CACHE_TTL,
                    }
                }

        except Exception as e:
            print(f"[LyricsCache] Stats error: {e}")
            return {"error": str(e)}

    # ============================================
    # Unified Cache Interface
    # ============================================

    async def get(self, spotify_track_id: str) -> dict | None:
        """
        Get lyrics from cache (tries Redis first, then PostgreSQL).

        Args:
            spotify_track_id: Spotify track ID

        Returns:
            Cached lyrics data or None if not found
        """
        # Tier 1: Redis (fast)
        data = await self.get_from_redis(spotify_track_id)
        if data:
            return data

        # Tier 2: PostgreSQL (persistent)
        data = await self.get_from_postgres(spotify_track_id)
        if data:
            # Populate Redis cache for faster subsequent access
            await self.set_in_redis(spotify_track_id, data)
            return data

        return None

    async def set(
        self,
        spotify_track_id: str,
        lyrics_text: str | None,
        synced_lines: list[dict] | None,
        sync_type: str,
        source: str,
        source_url: str | None = None,
        artist_name: str | None = None,
        track_name: str | None = None,
    ) -> None:
        """
        Store lyrics in both cache tiers.

        Args:
            spotify_track_id: Spotify track ID
            lyrics_text: Plain text lyrics
            synced_lines: Array of synced lyrics lines
            sync_type: 'synced', 'unsynced', or 'none'
            source: 'spotify', 'genius', or 'none'
            source_url: URL to lyrics source
            artist_name: Artist name for debugging
            track_name: Track name for debugging
        """
        # Build cache data for Redis
        # Determine status based on whether we have lyrics
        has_lyrics = bool(lyrics_text) or bool(synced_lines)
        cache_data = {
            "spotify_track_id": spotify_track_id,
            "lyrics": lyrics_text or "",
            "lines": synced_lines,
            "syncType": sync_type,
            "source": source,
            "url": source_url,
            "status": "found" if has_lyrics else "not_found",
            "cachedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Set in both tiers
        await self.set_in_redis(spotify_track_id, cache_data)
        await self.set_in_postgres(
            spotify_track_id=spotify_track_id,
            lyrics_text=lyrics_text,
            synced_lines=synced_lines,
            sync_type=sync_type,
            source=source,
            source_url=source_url,
            artist_name=artist_name,
            track_name=track_name,
        )

    async def invalidate(self, spotify_track_id: str) -> None:
        """Remove lyrics from all cache tiers."""
        await self.invalidate_redis(spotify_track_id)
        await self.invalidate_postgres(spotify_track_id)


# Singleton instance
lyrics_cache_service = LyricsCacheService()
