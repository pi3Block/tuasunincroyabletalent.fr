"""
Periodic cleanup of old session audio files from remote storage and local temp.

Scheduled via Celery beat (every hour).

Strategy (after storage migration):
- Sessions are stored in Redis with 3h TTL and a created_at timestamp.
- Cleanup scans Redis session:* keys, finds sessions older than 2h, and
  deletes their files from storages.augmenter.pro.
- Also deletes any leftover /tmp/kiaraoke/ temp dirs older than 2h.
- Reference Demucs cache (cache/{youtube_id}/) is permanent -- never deleted here.
"""
import json
import logging
import os
import shutil
import time
from pathlib import Path

import redis
from celery import shared_task

from .storage_client import get_storage
from .local_cache import get_local_cache

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
AUDIO_TEMP_DIR = os.getenv("AUDIO_TEMP_DIR", "/tmp/kiaraoke")
SESSION_MAX_AGE = 7200  # 2 hours


def _session_storage_paths(session_id: str) -> list:
    """Return all storage relative paths that belong to a session."""
    return [
        f"sessions/{session_id}/user_recording.webm",
        f"sessions/{session_id}/user_recording.wav",
        f"sessions/{session_id}_user/vocals.wav",
        f"sessions/{session_id}_user/instrumentals.wav",
        f"sessions/{session_id}_ref/vocals.wav",
        f"sessions/{session_id}_ref/instrumentals.wav",
    ]


@shared_task(name="tasks.cleanup.cleanup_session_files")
def cleanup_session_files():
    """
    Delete session audio files (storage + local temp) older than 2 hours.

    Does NOT delete the Demucs reference cache (cache/{youtube_id}/).
    """
    storage = get_storage()

    # Connect to Redis synchronously to scan session keys
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=5)
    except Exception as e:
        logger.error("Failed to connect to Redis for cleanup: %s", e)
        return {"error": str(e)}

    cutoff = time.time() - SESSION_MAX_AGE
    deleted_sessions = 0
    deleted_storage_files = 0

    # SCAN for all session:* keys (non-blocking, batched)
    try:
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match="session:*", count=100)
            for key in keys:
                try:
                    data_raw = r.get(key)
                    if not data_raw:
                        continue
                    session_data = json.loads(data_raw)
                    created_at = session_data.get("created_at", 0)

                    # Skip if session is recent (< 2h) or has no created_at
                    if not created_at or time.time() - float(created_at) < SESSION_MAX_AGE:
                        continue

                    session_id = session_data.get("session_id") or key.replace("session:", "")

                    # Delete storage files for this session
                    for rel_path in _session_storage_paths(session_id):
                        try:
                            storage.delete(rel_path)
                            deleted_storage_files += 1
                        except Exception as e:
                            logger.warning("Failed to delete %s: %s", rel_path, e)

                    deleted_sessions += 1
                    logger.info("Cleaned up storage for session: %s", session_id)

                except Exception as e:
                    logger.warning("Error processing key %s: %s", key, e)

            if cursor == 0:
                break

    except Exception as e:
        logger.error("Redis SCAN failed during cleanup: %s", e)

    # Also cleanup local /tmp/kiaraoke/ leftover temp dirs (GPU task remnants)
    deleted_temp_dirs = 0
    temp_dir = Path(AUDIO_TEMP_DIR)
    if temp_dir.exists():
        for entry in temp_dir.iterdir():
            if entry.is_dir() and entry.stat().st_mtime < cutoff:
                shutil.rmtree(entry, ignore_errors=True)
                deleted_temp_dirs += 1
                logger.debug("Removed temp dir: %s", entry.name)

    # ── Local cache LRU eviction ────────────────────────────────────────────
    evicted_refs = 0
    evicted_sessions = 0
    cleaned_orphans = 0
    try:
        lcache = get_local_cache()
        evicted_refs = lcache._evict_references()
        evicted_sessions = lcache._evict_sessions()
        cleaned_orphans = lcache.cleanup_orphaned_dirs()
    except Exception as e:
        logger.warning("Local cache eviction failed (non-fatal): %s", e)

    logger.info(
        "Cleanup complete: %d sessions, %d storage files, %d temp dirs, "
        "cache evicted: %d refs + %d sessions, %d orphans",
        deleted_sessions,
        deleted_storage_files,
        deleted_temp_dirs,
        evicted_refs,
        evicted_sessions,
        cleaned_orphans,
    )
    return {
        "deleted_sessions": deleted_sessions,
        "deleted_storage_files": deleted_storage_files,
        "deleted_temp_dirs": deleted_temp_dirs,
        "cache_evicted_refs": evicted_refs,
        "cache_evicted_sessions": evicted_sessions,
        "cache_cleaned_orphans": cleaned_orphans,
    }
