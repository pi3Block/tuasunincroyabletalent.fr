"""
Local LRU disk cache for audio files — backend (asynchronous).

Provides a fast local cache layer for serving audio directly instead of
302 redirects to storages.augmenter.pro. Shared with the worker via a Docker volume.

Cache structure:
  /cache/references/{youtube_id}/   — reference tracks (vocals, instrumentals, etc.)
  /cache/sessions/{session_id}/     — user session files

LRU metadata stored in Redis sorted sets:
  cache:lru:references  — member=youtube_id, score=last_access_timestamp
  cache:lru:sessions    — member=session_id, score=last_access_timestamp
"""
import logging
import time
from pathlib import Path

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

_LRU_KEY_REFS = "cache:lru:references"
_LRU_KEY_SESSIONS = "cache:lru:sessions"


class LocalCache:
    """LRU disk cache backed by Redis sorted sets (async)."""

    def __init__(self):
        self.cache_dir = Path(settings.local_cache_dir)
        self.refs_dir = self.cache_dir / "references"
        self.sessions_dir = self.cache_dir / "sessions"
        self.max_refs = settings.local_cache_max_references
        self.max_sessions = settings.local_cache_max_sessions
        self._redis: aioredis.Redis | None = None
        self._enabled = self.cache_dir.exists() or settings.local_cache_dir != "/cache"

        # Ensure base dirs exist (non-fatal if volume not mounted)
        try:
            self.refs_dir.mkdir(parents=True, exist_ok=True)
            self.sessions_dir.mkdir(parents=True, exist_ok=True)
            self._enabled = True
        except OSError as e:
            logger.warning("[LOCAL_CACHE] Cannot create cache dirs (disabled): %s", e)
            self._enabled = False

        logger.info(
            "[LOCAL_CACHE] Initialized: dir=%s enabled=%s max_refs=%d max_sessions=%d",
            self.cache_dir, self._enabled, self.max_refs, self.max_sessions,
        )

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=3,
            )
        return self._redis

    async def close(self):
        if self._redis:
            await self._redis.close()
            self._redis = None

    # ── References (youtube_id) ──────────────────────────────────────────────

    def _ref_path(self, youtube_id: str, filename: str) -> Path:
        return self.refs_dir / youtube_id / filename

    async def get_reference_file(self, youtube_id: str, filename: str) -> Path | None:
        """Return local path if cached, None otherwise. Updates LRU timestamp."""
        if not self._enabled:
            return None
        path = self._ref_path(youtube_id, filename)
        if not path.exists():
            logger.debug("[LOCAL_CACHE] MISS ref %s/%s", youtube_id, filename)
            return None
        try:
            r = await self._get_redis()
            await r.zadd(_LRU_KEY_REFS, {youtube_id: time.time()})
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Redis ZADD failed (non-fatal): %s", e)
        logger.info("[LOCAL_CACHE] HIT ref %s/%s", youtube_id, filename)
        return path

    async def has_reference(self, youtube_id: str, filename: str) -> bool:
        """Check existence without touching LRU."""
        if not self._enabled:
            return False
        return self._ref_path(youtube_id, filename).exists()

    # ── Sessions (session_id) ────────────────────────────────────────────────

    def _session_path(self, session_id: str, filename: str) -> Path:
        return self.sessions_dir / session_id / filename

    async def get_session_file(self, session_id: str, filename: str) -> Path | None:
        """Return local path if cached, None otherwise. Updates LRU timestamp."""
        if not self._enabled:
            return None
        path = self._session_path(session_id, filename)
        if not path.exists():
            logger.debug("[LOCAL_CACHE] MISS session %s/%s", session_id, filename)
            return None
        try:
            r = await self._get_redis()
            await r.zadd(_LRU_KEY_SESSIONS, {session_id: time.time()})
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Redis ZADD failed (non-fatal): %s", e)
        logger.info("[LOCAL_CACHE] HIT session %s/%s", session_id, filename)
        return path

    async def has_session(self, session_id: str, filename: str) -> bool:
        """Check existence without touching LRU."""
        if not self._enabled:
            return False
        return self._session_path(session_id, filename).exists()

    # ── Stats ────────────────────────────────────────────────────────────────

    async def stats(self) -> dict:
        """Return cache stats for monitoring."""
        try:
            r = await self._get_redis()
            ref_count = await r.zcard(_LRU_KEY_REFS)
            session_count = await r.zcard(_LRU_KEY_SESSIONS)
        except Exception:
            ref_count = -1
            session_count = -1

        ref_size = sum(f.stat().st_size for f in self.refs_dir.rglob("*") if f.is_file()) if self.refs_dir.exists() else 0
        session_size = sum(f.stat().st_size for f in self.sessions_dir.rglob("*") if f.is_file()) if self.sessions_dir.exists() else 0

        return {
            "enabled": self._enabled,
            "references": ref_count,
            "sessions": session_count,
            "max_references": self.max_refs,
            "max_sessions": self.max_sessions,
            "disk_refs_mb": round(ref_size / 1024 / 1024, 1),
            "disk_sessions_mb": round(session_size / 1024 / 1024, 1),
            "disk_total_mb": round((ref_size + session_size) / 1024 / 1024, 1),
        }


# Singleton
local_cache = LocalCache()
