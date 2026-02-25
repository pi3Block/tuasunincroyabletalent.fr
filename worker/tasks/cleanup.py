"""
Periodic cleanup of old session audio files.

Scheduled via Celery beat (every hour).
Preserves the cache/ directory (Demucs reusable separations).
"""
import os
import shutil
import time
import logging
from pathlib import Path

from celery import shared_task

logger = logging.getLogger(__name__)

AUDIO_OUTPUT_DIR = os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")
SESSION_MAX_AGE = 7200  # 2 hours


@shared_task(name="tasks.cleanup.cleanup_session_files")
def cleanup_session_files():
    """Delete session audio files older than 2 hours."""
    audio_dir = Path(AUDIO_OUTPUT_DIR)
    if not audio_dir.exists():
        logger.info("Audio dir %s does not exist, skipping cleanup", audio_dir)
        return {"deleted": 0}

    cutoff = time.time() - SESSION_MAX_AGE
    deleted = 0

    for entry in audio_dir.iterdir():
        if not entry.is_dir():
            continue
        # Preserve the Demucs cache directory
        if entry.name == "cache":
            continue
        if entry.stat().st_mtime < cutoff:
            shutil.rmtree(entry, ignore_errors=True)
            logger.info("Cleaned up session dir: %s", entry.name)
            deleted += 1

    logger.info("Cleanup complete: %d session(s) removed", deleted)
    return {"deleted": deleted}
