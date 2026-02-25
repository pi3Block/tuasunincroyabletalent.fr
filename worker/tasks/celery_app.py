"""
Celery application configuration.

Improvements (2026-02-11):
- Structured logging (logging.basicConfig)
- Langfuse flush + httpx client cleanup on worker shutdown
"""
import os
import logging
from celery import Celery
from celery.signals import worker_process_init, worker_shutdown

# Structured logging config
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Redis URL from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


@worker_process_init.connect
def _log_gpu_on_worker_init(**kwargs):
    """Log GPU status once per worker process (after fork, safe for CUDA)."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            mem_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
            logger.info("GPU: %s (%.1fGB)", name, mem_gb)
        else:
            logger.warning("GPU: NOT AVAILABLE - running on CPU")
        logger.info(
            "PyTorch: %s, CUDA compiled: %s, CUDA_VISIBLE_DEVICES=%s",
            torch.__version__,
            torch.version.cuda,
            os.environ.get("CUDA_VISIBLE_DEVICES", "not set"),
        )
    except Exception as e:
        logger.error("GPU check failed: %s", e)


@worker_shutdown.connect
def _cleanup_on_shutdown(**kwargs):
    """Flush Langfuse traces and close HTTP clients on worker shutdown."""
    logger.info("Worker shutting down — flushing traces and closing clients")

    # Flush Langfuse
    try:
        from .tracing import flush_traces
        flush_traces()
    except Exception as e:
        logger.debug("Langfuse flush on shutdown failed: %s", e)

    # Close any httpx clients
    try:
        from .scoring import _cleanup_clients
        _cleanup_clients()
    except (ImportError, AttributeError):
        pass


celery_app = Celery(
    "voicejury",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "tasks.audio_separation",
        "tasks.pitch_analysis",
        "tasks.transcription",
        "tasks.scoring",
        "tasks.lyrics",
        "tasks.pipeline",
        "tasks.word_timestamps",
        "tasks.cleanup",
    ],
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Paris",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,  # 10 minutes max per task
    worker_prefetch_multiplier=1,  # For GPU tasks, process one at a time
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)

# Task routes - prioritize heavy tasks to high-VRAM GPU
# gpu-heavy: Worker with best GPU (more VRAM) listens first
# gpu: All GPU workers listen (pool workers + heavy worker as fallback)
celery_app.conf.task_routes = {
    # Heavy tasks → gpu-heavy queue (Demucs ~4GB, Whisper ~2-6GB)
    "tasks.audio_separation.*": {"queue": "gpu-heavy"},
    "tasks.transcription.*": {"queue": "gpu-heavy"},
    "tasks.pipeline.*": {"queue": "gpu-heavy"},  # Pipeline runs Demucs+Whisper
    "tasks.word_timestamps.*": {"queue": "gpu-heavy"},  # Demucs + Whisper-timestamped

    # Light tasks → gpu queue (CREPE ~1GB)
    "tasks.pitch_analysis.*": {"queue": "gpu"},

    # CPU tasks → default queue
    "tasks.scoring.*": {"queue": "default"},
    "tasks.lyrics.*": {"queue": "default"},
    "tasks.cleanup.*": {"queue": "default"},
}

# Periodic tasks (Celery beat)
celery_app.conf.beat_schedule = {
    "cleanup-old-sessions": {
        "task": "tasks.cleanup.cleanup_session_files",
        "schedule": 3600.0,  # Every hour
    },
}
