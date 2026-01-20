"""
Celery application configuration.
"""
import os
from celery import Celery

# Redis URL from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def _log_gpu_init():
    """Log GPU status once at worker startup (minimal overhead)."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            mem_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
            print(f"[INIT] GPU: {name} ({mem_gb:.1f}GB)")
        else:
            print("[INIT] GPU: NOT AVAILABLE - running on CPU")
        print(f"[INIT] PyTorch: {torch.__version__}, CUDA compiled: {torch.version.cuda}")
        print(f"[INIT] CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')}")
    except Exception as e:
        print(f"[INIT] GPU check failed: {e}")


# Log GPU status at import time (once per worker process)
_log_gpu_init()

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

# Task routes - separate queues for different task types
celery_app.conf.task_routes = {
    "tasks.audio_separation.*": {"queue": "gpu"},
    "tasks.pitch_analysis.*": {"queue": "gpu"},
    "tasks.transcription.*": {"queue": "gpu"},
    "tasks.scoring.*": {"queue": "default"},
    "tasks.pipeline.*": {"queue": "gpu"},  # Pipeline orchestrates GPU tasks
}
