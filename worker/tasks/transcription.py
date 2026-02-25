"""
Transcription speech-to-text via Whisper pour tuasunincroyabletalent.fr
Extrait les paroles des vocaux utilisateurs.

Architecture 3-tier (infra unifiée, zero cost) :
- Tier 1 : HTTP vers shared-whisper (GPU 4, modèle medium en prod)
- Tier 2 : Groq Whisper API (whisper-large-v3-turbo, free, 20 RPM, 2K RPD)
- Tier 3 : Local PyTorch Whisper (désactivé par défaut en production)

Variables d'environnement :
- SHARED_WHISPER_URL : URL du microservice HTTP (défaut: http://shared-whisper:9000)
- SHARED_WHISPER_TIMEOUT : Timeout HTTP en secondes (défaut: 120)
- GROQ_API_KEY : Clé API Groq pour le fallback cloud Whisper (défaut: vide)
- WHISPER_LOCAL_FALLBACK : Activer le fallback local PyTorch (défaut: false)
  ATTENTION : Le modèle 'turbo' charge ~6 Go. Ne PAS activer dans un container
  sans GPU et <4 Go RAM (OOM Kill garanti).
- WHISPER_MODEL : Modèle pour le fallback local (défaut: base)
"""
import os
import json
import logging
from pathlib import Path
from celery import shared_task

logger = logging.getLogger(__name__)

SHARED_WHISPER_URL = os.getenv("SHARED_WHISPER_URL", "http://shared-whisper:9000")
SHARED_WHISPER_TIMEOUT = int(os.getenv("SHARED_WHISPER_TIMEOUT", "120"))

# Groq Whisper fallback (free tier: 20 RPM, 2K RPD, whisper-large-v3-turbo)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Fallback local désactivé par défaut en production (évite OOM dans container sans GPU)
WHISPER_LOCAL_FALLBACK = os.getenv("WHISPER_LOCAL_FALLBACK", "false").lower() in (
    "true", "1", "yes",
)

# Lazy load Whisper model (fallback uniquement, si activé)
_whisper_model = None


class TranscriptionError(Exception):
    """Erreur de transcription — shared-whisper indisponible et fallback local désactivé."""
    pass


def get_whisper_model():
    """
    Chargement paresseux du modèle Whisper (fallback local uniquement).

    ATTENTION : Le modèle 'turbo' nécessite ~6 Go RAM. En production sans GPU,
    utiliser 'base' (~140 Mo) ou 'small' (~460 Mo) pour éviter OOM Kill.
    """
    global _whisper_model
    if _whisper_model is None:
        import whisper

        # Modèle 'base' par défaut (sûr pour container CPU-only)
        model_name = os.getenv("WHISPER_MODEL", "base")
        logger.info("Loading local Whisper model: %s", model_name)
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model


def _transcribe_via_http(vocals_path: str, language: str = "fr") -> dict:
    """
    Transcription via shared-whisper HTTP (GPU 4, modèle medium en prod).

    Optimisations appliquées :
    - vad_filter=true : Silero VAD pré-filtre le silence (gain 2-5x)
    - language hint : skip la détection auto de langue (~200-500ms)
    """
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
                # Silero VAD : filtre le silence avant inférence GPU (gain 2-5x)
                "vad_filter": "true",
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


def _transcribe_via_groq(vocals_path: str, language: str = "fr") -> dict:
    """
    Fallback: Groq Whisper API (whisper-large-v3-turbo, free tier).

    Free limits: 20 RPM, 2K requests/day.
    Uses OpenAI-compatible audio transcription endpoint.
    File size limit: 25 MB (WAV ~3min @ 16kHz mono fits).
    """
    import httpx

    logger.info("Transcribing via Groq Whisper: %s", vocals_path)

    with open(vocals_path, "rb") as f:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            data={
                "model": "whisper-large-v3-turbo",
                "language": language,
                "response_format": "verbose_json",
                "timestamp_granularities[]": "word",
            },
            files={"file": (os.path.basename(vocals_path), f, "audio/wav")},
            timeout=120,
        )

    response.raise_for_status()
    data = response.json()

    words = []
    for word_info in data.get("words", []):
        words.append({
            "word": word_info.get("word", "").strip(),
            "start": word_info.get("start", 0.0),
            "end": word_info.get("end", 0.0),
            "confidence": 1.0,  # Groq doesn't return per-word confidence
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
    Transcription audio avec fallback 3-tier (zero cost).

    Tier 1 : shared-whisper HTTP (GPU 4, modèle medium en prod)
    Tier 2 : Groq Whisper API (whisper-large-v3-turbo, free, 20 RPM)
    Tier 3 : Local PyTorch Whisper (si WHISPER_LOCAL_FALLBACK=true)

    Si tous les tiers échouent, une TranscriptionError est levée.
    """
    # Tier 1 : shared-whisper HTTP
    try:
        data = _transcribe_via_http(vocals_path, language)
    except Exception as e:
        logger.warning("Shared-whisper HTTP failed (%s)", e)
        data = None

        # Tier 2 : Groq Whisper (cloud, free, whisper-large-v3-turbo)
        if GROQ_API_KEY:
            try:
                logger.info("[Transcription] Falling back to Groq Whisper")
                data = _transcribe_via_groq(vocals_path, language)
            except Exception as groq_err:
                logger.warning("Groq Whisper fallback failed (%s)", groq_err)

        # Tier 3 : Local PyTorch Whisper (if enabled and previous tiers failed)
        if data is None and WHISPER_LOCAL_FALLBACK:
            try:
                logger.info("[Transcription] Falling back to local PyTorch Whisper")
                data = _transcribe_via_local(vocals_path, language)
            except Exception as local_err:
                logger.warning("Local Whisper fallback failed (%s)", local_err)

        if data is None:
            logger.error(
                "[Transcription] All tiers failed. shared-whisper down, "
                "Groq %s, local fallback %s.",
                "failed" if GROQ_API_KEY else "not configured",
                "failed" if WHISPER_LOCAL_FALLBACK else "disabled",
            )
            raise TranscriptionError(
                f"Transcription impossible — tous les tiers ont échoué. "
                f"shared-whisper: {e}"
            ) from e

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


@shared_task(
    bind=True,
    name="tasks.transcription.transcribe_audio",
    autoretry_for=(TranscriptionError,),
    retry_backoff=30,
    retry_backoff_max=120,
    max_retries=3,
    retry_jitter=True,
)
def transcribe_audio(self, vocals_path: str, session_id: str, language: str = "fr") -> dict:
    """
    Celery task : transcription audio avec retry automatique.

    Retry 3x (backoff 30-120s) si shared-whisper est down (TranscriptionError).
    Les erreurs non-transitoires ne sont pas retryées.
    """
    self.update_state(state="PROGRESS", meta={"step": "transcribing"})
    return do_transcribe_audio(vocals_path, session_id, language)
