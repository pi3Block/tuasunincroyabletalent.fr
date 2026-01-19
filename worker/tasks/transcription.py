"""
Speech-to-text transcription using Whisper.
Extracts lyrics from user vocals.
"""
import os
from pathlib import Path
from celery import shared_task

# Lazy load Whisper model
_whisper_model = None


def get_whisper_model():
    """Lazy load Whisper model."""
    global _whisper_model
    if _whisper_model is None:
        import whisper

        model_name = os.getenv("WHISPER_MODEL", "turbo")
        print(f"[Whisper] Loading model: {model_name}")
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model


def do_transcribe_audio(vocals_path: str, session_id: str, language: str = "fr") -> dict:
    """
    Core logic: Transcribe vocals to text using Whisper.

    Args:
        vocals_path: Path to vocals audio file
        session_id: Session identifier
        language: Language code (default: French)

    Returns:
        dict with transcription data
    """
    print(f"[Whisper] Transcribing: {vocals_path}")

    model = get_whisper_model()

    # Transcribe with word-level timestamps
    result = model.transcribe(
        vocals_path,
        language=language,
        task="transcribe",
        word_timestamps=True,
        verbose=False,
    )

    # Extract word-level data for alignment
    words = []
    for segment in result.get("segments", []):
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info["word"].strip(),
                "start": word_info["start"],
                "end": word_info["end"],
                "confidence": word_info.get("probability", 1.0),
            })

    # Save transcription
    output_dir = Path(vocals_path).parent
    transcription_path = output_dir / "transcription.json"

    import json
    with open(transcription_path, "w", encoding="utf-8") as f:
        json.dump({
            "text": result["text"],
            "language": result["language"],
            "words": words,
        }, f, ensure_ascii=False, indent=2)

    print(f"[Whisper] Transcription complete: {result['text'][:100]}...")

    return {
        "session_id": session_id,
        "text": result["text"],
        "word_count": len(words),
        "transcription_path": str(transcription_path),
        "status": "completed",
    }


@shared_task(bind=True, name="tasks.transcription.transcribe_audio")
def transcribe_audio(self, vocals_path: str, session_id: str, language: str = "fr") -> dict:
    """
    Celery task wrapper for transcription.
    """
    self.update_state(state="PROGRESS", meta={"step": "loading_model"})
    result = do_transcribe_audio(vocals_path, session_id, language)
    return result
