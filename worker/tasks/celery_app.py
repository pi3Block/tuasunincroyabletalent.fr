"""
Celery application configuration.
"""
import os
from celery import Celery
from celery.signals import worker_process_init

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
            print(f"[INIT] GPU: {name} ({mem_gb:.1f}GB)")
        else:
            print("[INIT] GPU: NOT AVAILABLE - running on CPU")
        print(f"[INIT] PyTorch: {torch.__version__}, CUDA compiled: {torch.version.cuda}")
        print(f"[INIT] CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')}")
    except Exception as e:
        print(f"[INIT] GPU check failed: {e}")


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

# Task routes - prioritize heavy tasks to high-VRAM GPU
# gpu-heavy: Worker with best GPU (more VRAM) listens first
# gpu: All GPU workers listen (pool workers + heavy worker as fallback)
celery_app.conf.task_routes = {
    # Heavy tasks → gpu-heavy queue (Demucs ~4GB, Whisper ~2-6GB)
    "tasks.audio_separation.*": {"queue": "gpu-heavy"},
    "tasks.transcription.*": {"queue": "gpu-heavy"},
    "tasks.pipeline.*": {"queue": "gpu-heavy"},  # Pipeline runs Demucs+Whisper

    # Light tasks → gpu queue (CREPE ~1GB)
    "tasks.pitch_analysis.*": {"queue": "gpu"},

    # CPU tasks → default queue
    "tasks.scoring.*": {"queue": "default"},
    "tasks.lyrics.*": {"queue": "default"},
}
