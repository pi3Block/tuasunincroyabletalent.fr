"""
Local LRU disk cache for audio files — worker (synchronous).

Provides a fast local cache layer between the worker and remote storage
(storages.augmenter.pro). Shared with the backend API via a Docker volume.

Cache structure:
  /cache/references/{youtube_id}/   — reference tracks (vocals, instrumentals, pitch, etc.)
  /cache/sessions/{session_id}/     — user session files (recording, separated stems)

LRU metadata stored in Redis sorted sets:
  cache:lru:references  — member=youtube_id, score=last_access_timestamp
  cache:lru:sessions    — member=session_id, score=last_access_timestamp
"""
import logging
import os
import shutil
import time
from pathlib import Path

import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_DIR = os.getenv("LOCAL_CACHE_DIR", "/cache")
MAX_REFERENCES = int(os.getenv("LOCAL_CACHE_MAX_REFERENCES", "20"))
MAX_SESSIONS = int(os.getenv("LOCAL_CACHE_MAX_SESSIONS", "20"))

_LRU_KEY_REFS = "cache:lru:references"
_LRU_KEY_SESSIONS = "cache:lru:sessions"


class LocalCache:
    """LRU disk cache backed by Redis sorted sets (synchronous)."""

    def __init__(
        self,
        cache_dir: str = CACHE_DIR,
        redis_url: str = REDIS_URL,
        max_refs: int = MAX_REFERENCES,
        max_sessions: int = MAX_SESSIONS,
    ):
        self.cache_dir = Path(cache_dir)
        self.refs_dir = self.cache_dir / "references"
        self.sessions_dir = self.cache_dir / "sessions"
        self.max_refs = max_refs
        self.max_sessions = max_sessions
        self._redis_url = redis_url
        self._redis: redis.Redis | None = None

        # Ensure base dirs exist
        self.refs_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "[LOCAL_CACHE] Initialized: dir=%s max_refs=%d max_sessions=%d",
            self.cache_dir, self.max_refs, self.max_sessions,
        )

    def _get_redis(self) -> redis.Redis:
        if self._redis is None or self._redis.connection_pool._created_connections == 0:
            try:
                self._redis = redis.from_url(
                    self._redis_url, decode_responses=True, socket_connect_timeout=3,
                )
            except Exception as e:
                logger.warning("[LOCAL_CACHE] Redis connection failed: %s", e)
                raise
        return self._redis

    # ── References (youtube_id) ──────────────────────────────────────────────

    def _ref_path(self, youtube_id: str, filename: str) -> Path:
        return self.refs_dir / youtube_id / filename

    def get_reference_file(self, youtube_id: str, filename: str) -> Path | None:
        """Return local path if cached, None otherwise. Updates LRU timestamp."""
        path = self._ref_path(youtube_id, filename)
        if not path.exists():
            logger.debug("[LOCAL_CACHE] MISS ref %s/%s", youtube_id, filename)
            return None
        # Update LRU
        try:
            self._get_redis().zadd(_LRU_KEY_REFS, {youtube_id: time.time()})
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Redis ZADD failed (non-fatal): %s", e)
        logger.info("[LOCAL_CACHE] HIT ref %s/%s", youtube_id, filename)
        return path

    def put_reference_file(
        self, youtube_id: str, filename: str, source_path: Path,
    ) -> Path:
        """Copy a file into the reference cache. Triggers eviction if needed."""
        dest = self._ref_path(youtube_id, filename)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, dest)
        # Update LRU
        try:
            r = self._get_redis()
            r.zadd(_LRU_KEY_REFS, {youtube_id: time.time()})
            self._evict_references(r)
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Redis update failed (non-fatal): %s", e)
        logger.info("[LOCAL_CACHE] PUT ref %s/%s (%d bytes)", youtube_id, filename, dest.stat().st_size)
        return dest

    def has_reference(self, youtube_id: str, filename: str) -> bool:
        """Check existence without touching LRU."""
        return self._ref_path(youtube_id, filename).exists()

    def has_reference_dir(self, youtube_id: str) -> bool:
        """Check if any files exist for this youtube_id."""
        ref_dir = self.refs_dir / youtube_id
        return ref_dir.exists() and any(ref_dir.iterdir())

    # ── Sessions (session_id) ────────────────────────────────────────────────

    def _session_path(self, session_id: str, filename: str) -> Path:
        return self.sessions_dir / session_id / filename

    def get_session_file(self, session_id: str, filename: str) -> Path | None:
        """Return local path if cached, None otherwise. Updates LRU timestamp."""
        path = self._session_path(session_id, filename)
        if not path.exists():
            logger.debug("[LOCAL_CACHE] MISS session %s/%s", session_id, filename)
            return None
        try:
            self._get_redis().zadd(_LRU_KEY_SESSIONS, {session_id: time.time()})
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Redis ZADD failed (non-fatal): %s", e)
        logger.info("[LOCAL_CACHE] HIT session %s/%s", session_id, filename)
        return path

    def put_session_file(
        self, session_id: str, filename: str, source_path: Path,
    ) -> Path:
        """Copy a file into the session cache. Triggers eviction if needed."""
        dest = self._session_path(session_id, filename)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, dest)
        try:
            r = self._get_redis()
            r.zadd(_LRU_KEY_SESSIONS, {session_id: time.time()})
            self._evict_sessions(r)
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Redis update failed (non-fatal): %s", e)
        logger.info("[LOCAL_CACHE] PUT session %s/%s (%d bytes)", session_id, filename, dest.stat().st_size)
        return dest

    def has_session(self, session_id: str, filename: str) -> bool:
        """Check existence without touching LRU."""
        return self._session_path(session_id, filename).exists()

    # ── Eviction ─────────────────────────────────────────────────────────────

    def _evict_references(self, r: redis.Redis | None = None) -> int:
        """Keep only max_refs entries, delete oldest. Returns count evicted."""
        if r is None:
            r = self._get_redis()
        count = r.zcard(_LRU_KEY_REFS)
        if count <= self.max_refs:
            return 0
        to_evict = count - self.max_refs
        # Get oldest entries (lowest scores)
        oldest = r.zrange(_LRU_KEY_REFS, 0, to_evict - 1)
        evicted = 0
        for youtube_id in oldest:
            self._delete_reference_dir(youtube_id, r)
            evicted += 1
        logger.info("[LOCAL_CACHE] Evicted %d references (was %d, max %d)", evicted, count, self.max_refs)
        return evicted

    def _evict_sessions(self, r: redis.Redis | None = None) -> int:
        """Keep only max_sessions entries, delete oldest. Returns count evicted."""
        if r is None:
            r = self._get_redis()
        count = r.zcard(_LRU_KEY_SESSIONS)
        if count <= self.max_sessions:
            return 0
        to_evict = count - self.max_sessions
        oldest = r.zrange(_LRU_KEY_SESSIONS, 0, to_evict - 1)
        evicted = 0
        for session_id in oldest:
            self._delete_session_dir(session_id, r)
            evicted += 1
        logger.info("[LOCAL_CACHE] Evicted %d sessions (was %d, max %d)", evicted, count, self.max_sessions)
        return evicted

    def _delete_reference_dir(self, youtube_id: str, r: redis.Redis | None = None):
        """Delete /cache/references/{youtube_id}/ and remove from Redis."""
        ref_dir = self.refs_dir / youtube_id
        if ref_dir.exists():
            shutil.rmtree(ref_dir, ignore_errors=True)
            logger.info("[LOCAL_CACHE] Deleted ref dir: %s", youtube_id)
        if r is None:
            r = self._get_redis()
        r.zrem(_LRU_KEY_REFS, youtube_id)

    def _delete_session_dir(self, session_id: str, r: redis.Redis | None = None):
        """Delete /cache/sessions/{session_id}/ and remove from Redis."""
        session_dir = self.sessions_dir / session_id
        if session_dir.exists():
            shutil.rmtree(session_dir, ignore_errors=True)
            logger.info("[LOCAL_CACHE] Deleted session dir: %s", session_id)
        if r is None:
            r = self._get_redis()
        r.zrem(_LRU_KEY_SESSIONS, session_id)

    def cleanup_orphaned_dirs(self) -> int:
        """Remove cache dirs not tracked in Redis (orphans from crashes)."""
        cleaned = 0
        try:
            r = self._get_redis()
            # References
            tracked_refs = set(r.zrange(_LRU_KEY_REFS, 0, -1))
            if self.refs_dir.exists():
                for entry in self.refs_dir.iterdir():
                    if entry.is_dir() and entry.name not in tracked_refs:
                        shutil.rmtree(entry, ignore_errors=True)
                        cleaned += 1
                        logger.info("[LOCAL_CACHE] Cleaned orphan ref: %s", entry.name)

            # Sessions
            tracked_sessions = set(r.zrange(_LRU_KEY_SESSIONS, 0, -1))
            if self.sessions_dir.exists():
                for entry in self.sessions_dir.iterdir():
                    if entry.is_dir() and entry.name not in tracked_sessions:
                        shutil.rmtree(entry, ignore_errors=True)
                        cleaned += 1
                        logger.info("[LOCAL_CACHE] Cleaned orphan session: %s", entry.name)
        except Exception as e:
            logger.warning("[LOCAL_CACHE] Orphan cleanup failed: %s", e)
        return cleaned

    def stats(self) -> dict:
        """Return cache stats for monitoring."""
        try:
            r = self._get_redis()
            ref_count = r.zcard(_LRU_KEY_REFS)
            session_count = r.zcard(_LRU_KEY_SESSIONS)
        except Exception:
            ref_count = -1
            session_count = -1

        # Disk usage
        ref_size = sum(f.stat().st_size for f in self.refs_dir.rglob("*") if f.is_file()) if self.refs_dir.exists() else 0
        session_size = sum(f.stat().st_size for f in self.sessions_dir.rglob("*") if f.is_file()) if self.sessions_dir.exists() else 0

        return {
            "references": ref_count,
            "sessions": session_count,
            "max_references": self.max_refs,
            "max_sessions": self.max_sessions,
            "disk_refs_mb": round(ref_size / 1024 / 1024, 1),
            "disk_sessions_mb": round(session_size / 1024 / 1024, 1),
            "disk_total_mb": round((ref_size + session_size) / 1024 / 1024, 1),
        }


# Module-level singleton — lazily instantiated
_cache: LocalCache | None = None


def get_local_cache() -> LocalCache:
    global _cache
    if _cache is None:
        _cache = LocalCache()
    return _cache
