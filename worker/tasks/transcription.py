"""
Speech-to-text transcription using Whisper.
Extracts lyrics from user vocals.

Primary: HTTP call to shared-whisper microservice (Faster Whisper, GPU 3)
Fallback: Local PyTorch Whisper (if shared-whisper is down)
"""
import os
import json
import logging
from pathlib import Path
from celery import shared_task

logger = logging.getLogger(__name__)

SHARED_WHISPER_URL = os.getenv("SHARED_WHISPER_URL", "http://shared-whisper:9000")
SHARED_WHISPER_TIMEOUT = int(os.getenv("SHARED_WHISPER_TIMEOUT", "120"))

# Lazy load Whisper model (fallback only)
_whisper_model = None


def get_whisper_model():
    """Lazy load Whisper model (fallback when shared-whisper is down)."""
    global _whisper_model
    if _whisper_model is None:
        import whisper

        model_name = os.getenv("WHISPER_MODEL", "turbo")
        logger.info("Loading local Whisper model: %s", model_name)
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model


def _transcribe_via_http(vocals_path: str, language: str = "fr") -> dict:
    """Transcribe via shared-whisper HTTP microservice."""
    import httpx

    logger.info("Transcribing via %s: %s", SHARED_WHISPER_URL, vocals_path)

    with open(vocals_path, "rb") as f:
        response = httpx.post(
            f"{SHARED_WHISPER_URL}/asr",
            params={
                "language": language,
                "output": "json",
                "task": "transcribe",
                "word_timestamps": "true",
            },
            files={"audio_file": (os.path.basename(vocals_path), f, "audio/mpeg")},
            timeout=SHARED_WHISPER_TIMEOUT,
        )

    response.raise_for_status()
    data = response.json()

    # Extract words from segments
    words = []
    for segment in data.get("segments", []):
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info.get("word", "").strip(),
                "start": word_info.get("start", 0.0),
                "end": word_info.get("end", 0.0),
                "confidence": word_info.get("probability", 1.0),
            })

    return {
        "text": data.get("text", ""),
        "language": data.get("language", language),
        "words": words,
    }


def _transcribe_via_local(vocals_path: str, language: str = "fr") -> dict:
    """Fallback: local PyTorch Whisper transcription."""
    logger.info("Processing locally: %s", vocals_path)

    model = get_whisper_model()
    result = model.transcribe(
        vocals_path,
        language=language,
        task="transcribe",
        word_timestamps=True,
        verbose=False,
    )

    words = []
    for segment in result.get("segments", []):
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info["word"].strip(),
                "start": word_info["start"],
                "end": word_info["end"],
                "confidence": word_info.get("probability", 1.0),
            })

    return {
        "text": result["text"],
        "language": result["language"],
        "words": words,
    }


def do_transcribe_audio(vocals_path: str, session_id: str, language: str = "fr") -> dict:
    """
    Core logic: Transcribe vocals to text.
    Primary: shared-whisper HTTP. Fallback: local PyTorch.
    """
    # Primary: shared-whisper HTTP
    try:
        data = _transcribe_via_http(vocals_path, language)
    except Exception as e:
        logger.warning("Shared-whisper HTTP failed (%s), falling back to local", e)
        data = _transcribe_via_local(vocals_path, language)

    # Save transcription
    output_dir = Path(vocals_path).parent
    transcription_path = output_dir / "transcription.json"

    with open(transcription_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info("Transcription complete: %s...", data["text"][:100])

    return {
        "session_id": session_id,
        "text": data["text"],
        "word_count": len(data["words"]),
        "transcription_path": str(transcription_path),
        "status": "completed",
    }


@shared_task(bind=True, name="tasks.transcription.transcribe_audio")
def transcribe_audio(self, vocals_path: str, session_id: str, language: str = "fr") -> dict:
    """Celery task wrapper for transcription."""
    self.update_state(state="PROGRESS", meta={"step": "transcribing"})
    return do_transcribe_audio(vocals_path, session_id, language)
