"""
Word timestamps cache service for efficient word-level lyrics retrieval.
Implements a two-tier caching strategy similar to lyrics_cache:
1. Redis (fast, in-memory) - First tier
2. PostgreSQL (persistent) - Second tier

Cache hierarchy:
Redis Cache (1h TTL) → PostgreSQL Cache (90-365 days TTL) → Generation Pipeline

TTL Strategy:
- Musixmatch word-synced: 365 days (professional quality)
- Whisper-generated: 90 days (can be regenerated)
- User-corrected: No expiry (permanent)
"""
import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, delete, func, or_
from sqlalchemy.dialects.postgresql import insert

from app.services.redis_client import redis_client
from app.services.database import get_db
from app.models.word_timestamps_cache import WordTimestampsCache


# Cache configuration
REDIS_CACHE_PREFIX = "word_ts:"
REDIS_CACHE_TTL = 3600  # 1 hour

# PostgreSQL TTL by source (in days)
POSTGRES_TTL_MUSIXMATCH = 365     # Professional word-sync
POSTGRES_TTL_WHISPER = 90         # Generated, can be regenerated
POSTGRES_TTL_USER_CORRECTED = None  # Never expires


class WordTimestampsCacheService:
    """
    Two-tier word timestamps caching service.

    Provides fast access to word-level lyrics data with automatic cache
    population and expiration handling.
    """

    # ============================================
    # Redis Cache Layer (Tier 1 - Fast)
    # ============================================

    def _get_redis_key(self, spotify_track_id: str, youtube_video_id: str | None) -> str:
        """Generate Redis cache key."""
        video_part = youtube_video_id or "any"
        return f"{REDIS_CACHE_PREFIX}{spotify_track_id}:{video_part}"

    async def get_from_redis(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None
    ) -> dict | None:
        """
        Get word timestamps from Redis cache.

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: Optional YouTube video ID

        Returns:
            Cached data or None if not found
        """
        try:
            client = await redis_client.get_client()
            key = self._get_redis_key(spotify_track_id, youtube_video_id)
            data = await client.get(key)
            if data:
                print(f"[WordTimestampsCache] Redis HIT for {spotify_track_id}")
                return json.loads(data)
        except Exception as e:
            print(f"[WordTimestampsCache] Redis error: {e}")
        return None

    async def set_in_redis(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None,
        data: dict
    ) -> None:
        """Store word timestamps in Redis cache."""
        try:
            client = await redis_client.get_client()
            key = self._get_redis_key(spotify_track_id, youtube_video_id)
            await client.setex(key, REDIS_CACHE_TTL, json.dumps(data))
            print(f"[WordTimestampsCache] Redis SET for {spotify_track_id}")
        except Exception as e:
            print(f"[WordTimestampsCache] Redis set error: {e}")

    async def invalidate_redis(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None
    ) -> None:
        """Remove word timestamps from Redis cache."""
        try:
            client = await redis_client.get_client()
            key = self._get_redis_key(spotify_track_id, youtube_video_id)
            await client.delete(key)
        except Exception as e:
            print(f"[WordTimestampsCache] Redis delete error: {e}")

    # ============================================
    # PostgreSQL Cache Layer (Tier 2 - Persistent)
    # ============================================

    def _get_ttl_days(self, source: str) -> int | None:
        """
        Determine cache TTL based on source.

        Returns:
            TTL in days, or None for no expiry
        """
        ttl_map = {
            'musixmatch_word': POSTGRES_TTL_MUSIXMATCH,
            'whisper_timestamped': POSTGRES_TTL_WHISPER,
            'user_corrected': POSTGRES_TTL_USER_CORRECTED,
        }
        return ttl_map.get(source, POSTGRES_TTL_WHISPER)

    async def get_from_postgres(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None
    ) -> dict | None:
        """
        Get word timestamps from PostgreSQL cache.

        Priority order:
        1. Exact match (spotify_track_id + youtube_video_id)
        2. Musixmatch-only (youtube_video_id is NULL)
        3. Any match for the track (fallback)

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: Optional YouTube video ID

        Returns:
            Cached data or None
        """
        try:
            async with get_db() as session:
                # Build query with priority ordering
                query = (
                    select(WordTimestampsCache)
                    .where(WordTimestampsCache.spotify_track_id == spotify_track_id)
                    .where(
                        or_(
                            WordTimestampsCache.expires_at.is_(None),
                            WordTimestampsCache.expires_at > datetime.utcnow()
                        )
                    )
                )

                # If youtube_video_id provided, prefer exact match
                if youtube_video_id:
                    query = query.where(
                        or_(
                            WordTimestampsCache.youtube_video_id == youtube_video_id,
                            WordTimestampsCache.youtube_video_id.is_(None)
                        )
                    )

                # Order by source priority (user_corrected > musixmatch > whisper)
                # and prefer exact youtube match
                result = await session.execute(query)
                entries = result.scalars().all()

                if not entries:
                    return None

                # Sort by priority
                def sort_key(entry):
                    # Exact youtube match gets priority 0
                    youtube_match = 0 if entry.youtube_video_id == youtube_video_id else 1
                    return (youtube_match, entry.source_priority)

                best = sorted(entries, key=sort_key)[0]
                print(f"[WordTimestampsCache] PostgreSQL HIT for {spotify_track_id} (source: {best.source})")
                return best.to_dict()

        except Exception as e:
            print(f"[WordTimestampsCache] PostgreSQL get error: {e}")
            return None

    async def set_in_postgres(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None,
        words: list[dict],
        lines: list[dict],
        source: str,
        language: str | None = None,
        model_version: str | None = None,
        confidence_avg: float | None = None,
        artist_name: str | None = None,
        track_name: str | None = None,
    ) -> None:
        """
        Store word timestamps in PostgreSQL with UPSERT.

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: YouTube video ID (optional for Musixmatch)
            words: List of word objects with timestamps
            lines: List of line objects with nested words
            source: Source identifier
            language: Language code
            model_version: Model version for tracking
            confidence_avg: Average confidence score
            artist_name: For debugging
            track_name: For debugging
        """
        try:
            ttl_days = self._get_ttl_days(source)
            expires_at = None
            if ttl_days is not None:
                expires_at = datetime.utcnow() + timedelta(days=ttl_days)

            # Calculate metadata
            word_count = len(words)
            duration_ms = 0
            if words:
                duration_ms = max(w.get('endMs', 0) for w in words)

            async with get_db() as session:
                stmt = insert(WordTimestampsCache).values(
                    spotify_track_id=spotify_track_id,
                    youtube_video_id=youtube_video_id,
                    words=words,
                    lines=lines,
                    source=source,
                    language=language,
                    model_version=model_version,
                    confidence_avg=confidence_avg,
                    word_count=word_count,
                    duration_ms=duration_ms,
                    artist_name=artist_name,
                    track_name=track_name,
                    created_at=datetime.utcnow(),
                    expires_at=expires_at,
                ).on_conflict_do_update(
                    constraint='uq_word_timestamps_track_video',
                    set_={
                        'words': words,
                        'lines': lines,
                        'source': source,
                        'language': language,
                        'model_version': model_version,
                        'confidence_avg': confidence_avg,
                        'word_count': word_count,
                        'duration_ms': duration_ms,
                        'artist_name': artist_name,
                        'track_name': track_name,
                        'created_at': datetime.utcnow(),
                        'expires_at': expires_at,
                    }
                )
                await session.execute(stmt)

                ttl_str = f"{ttl_days}d" if ttl_days else "permanent"
                print(f"[WordTimestampsCache] PostgreSQL SET for {spotify_track_id} (TTL: {ttl_str}, source: {source})")

        except Exception as e:
            print(f"[WordTimestampsCache] PostgreSQL set error: {e}")

    async def invalidate_postgres(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None
    ) -> None:
        """Remove word timestamps from PostgreSQL."""
        try:
            async with get_db() as session:
                query = delete(WordTimestampsCache).where(
                    WordTimestampsCache.spotify_track_id == spotify_track_id
                )
                if youtube_video_id:
                    query = query.where(
                        WordTimestampsCache.youtube_video_id == youtube_video_id
                    )
                await session.execute(query)
        except Exception as e:
            print(f"[WordTimestampsCache] PostgreSQL delete error: {e}")

    async def cleanup_expired(self) -> int:
        """Remove expired entries from PostgreSQL."""
        try:
            async with get_db() as session:
                result = await session.execute(
                    delete(WordTimestampsCache).where(
                        WordTimestampsCache.expires_at.isnot(None),
                        WordTimestampsCache.expires_at < datetime.utcnow()
                    )
                )
                deleted = result.rowcount
                print(f"[WordTimestampsCache] Cleaned up {deleted} expired entries")
                return deleted
        except Exception as e:
            print(f"[WordTimestampsCache] Cleanup error: {e}")
            return 0

    # ============================================
    # Unified Cache Interface
    # ============================================

    async def get(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None
    ) -> dict | None:
        """
        Get word timestamps from cache (Redis first, then PostgreSQL).

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: Optional YouTube video ID

        Returns:
            Cached data or None
        """
        # Tier 1: Redis
        data = await self.get_from_redis(spotify_track_id, youtube_video_id)
        if data:
            return data

        # Tier 2: PostgreSQL
        data = await self.get_from_postgres(spotify_track_id, youtube_video_id)
        if data:
            # Populate Redis for faster subsequent access
            await self.set_in_redis(spotify_track_id, youtube_video_id, data)
            return data

        return None

    async def set(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None,
        words: list[dict],
        lines: list[dict],
        source: str,
        language: str | None = None,
        model_version: str | None = None,
        confidence_avg: float | None = None,
        artist_name: str | None = None,
        track_name: str | None = None,
    ) -> None:
        """
        Store word timestamps in both cache tiers.

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: YouTube video ID
            words: Word list with timestamps
            lines: Line list with nested words
            source: Source identifier
            language: Language code
            model_version: Model version
            confidence_avg: Average confidence
            artist_name: For debugging
            track_name: For debugging
        """
        # Build Redis cache data
        cache_data = {
            "spotify_track_id": spotify_track_id,
            "youtube_video_id": youtube_video_id,
            "words": words,
            "lines": lines,
            "source": source,
            "language": language,
            "model_version": model_version,
            "confidence_avg": confidence_avg,
            "word_count": len(words),
            "cached_at": datetime.utcnow().isoformat(),
        }

        # Set in both tiers
        await self.set_in_redis(spotify_track_id, youtube_video_id, cache_data)
        await self.set_in_postgres(
            spotify_track_id=spotify_track_id,
            youtube_video_id=youtube_video_id,
            words=words,
            lines=lines,
            source=source,
            language=language,
            model_version=model_version,
            confidence_avg=confidence_avg,
            artist_name=artist_name,
            track_name=track_name,
        )

    async def invalidate(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None
    ) -> None:
        """Remove word timestamps from all cache tiers."""
        await self.invalidate_redis(spotify_track_id, youtube_video_id)
        await self.invalidate_postgres(spotify_track_id, youtube_video_id)

    # ============================================
    # Statistics & Debugging
    # ============================================

    async def get_stats(self) -> dict:
        """Get cache statistics."""
        try:
            async with get_db() as session:
                # Total count
                total_result = await session.execute(
                    select(func.count()).select_from(WordTimestampsCache)
                )
                total = total_result.scalar() or 0

                # Count by source
                source_result = await session.execute(
                    select(
                        WordTimestampsCache.source,
                        func.count().label("count")
                    ).group_by(WordTimestampsCache.source)
                )
                by_source = {row.source: row.count for row in source_result}

                # Expired count
                expired_result = await session.execute(
                    select(func.count()).select_from(WordTimestampsCache).where(
                        WordTimestampsCache.expires_at.isnot(None),
                        WordTimestampsCache.expires_at < datetime.utcnow()
                    )
                )
                expired = expired_result.scalar() or 0

                return {
                    "total": total,
                    "valid": total - expired,
                    "expired": expired,
                    "by_source": by_source,
                    "ttl_config": {
                        "musixmatch_days": POSTGRES_TTL_MUSIXMATCH,
                        "whisper_days": POSTGRES_TTL_WHISPER,
                        "user_corrected": "permanent",
                        "redis_seconds": REDIS_CACHE_TTL,
                    }
                }

        except Exception as e:
            print(f"[WordTimestampsCache] Stats error: {e}")
            return {"error": str(e)}

    async def exists(
        self,
        spotify_track_id: str,
        youtube_video_id: str | None = None,
        source: str | None = None
    ) -> bool:
        """
        Check if word timestamps exist in cache.

        Useful for avoiding regeneration if already cached.

        Args:
            spotify_track_id: Spotify track ID
            youtube_video_id: Optional YouTube video ID
            source: Optional specific source to check

        Returns:
            True if cached data exists
        """
        try:
            # Quick Redis check first
            client = await redis_client.get_client()
            key = self._get_redis_key(spotify_track_id, youtube_video_id)
            if await client.exists(key):
                return True

            # PostgreSQL check
            async with get_db() as session:
                query = (
                    select(func.count())
                    .select_from(WordTimestampsCache)
                    .where(WordTimestampsCache.spotify_track_id == spotify_track_id)
                    .where(
                        or_(
                            WordTimestampsCache.expires_at.is_(None),
                            WordTimestampsCache.expires_at > datetime.utcnow()
                        )
                    )
                )

                if youtube_video_id:
                    query = query.where(
                        or_(
                            WordTimestampsCache.youtube_video_id == youtube_video_id,
                            WordTimestampsCache.youtube_video_id.is_(None)
                        )
                    )

                if source:
                    query = query.where(WordTimestampsCache.source == source)

                result = await session.execute(query)
                count = result.scalar() or 0
                return count > 0

        except Exception as e:
            print(f"[WordTimestampsCache] Exists check error: {e}")
            return False


# Singleton instance
word_timestamps_cache_service = WordTimestampsCacheService()
