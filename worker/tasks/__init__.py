"""
Celery tasks for audio processing.
"""
from .celery_app import celery_app
from .audio_separation import separate_audio
from .pitch_analysis import extract_pitch
from .transcription import transcribe_audio
from .scoring import generate_feedback

__all__ = [
    "celery_app",
    "separate_audio",
    "extract_pitch",
    "transcribe_audio",
    "generate_feedback",
]
