"""
Celery application configuration.
"""
import os
from celery import Celery

# Redis URL from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

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
