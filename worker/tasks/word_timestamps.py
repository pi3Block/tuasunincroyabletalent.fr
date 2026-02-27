"""
Word-level timestamps generation via shared-whisper HTTP (GPU 4).

Uses the same 3-tier fallback as transcription.py:
- Tier 1: shared-whisper HTTP (GPU 4, large-v3-turbo int8, ~3s)
- Tier 2: Groq Whisper API (free, whisper-large-v3-turbo)
- Tier 3: None (no local fallback — avoids GPU 0 VRAM conflict)

Integrates with the caching system to avoid reprocessing:
1. Check if word timestamps already exist in cache
2. Check if vocals are already separated (Demucs cache)
3. Generate only if necessary
"""
import os
import json
import logging
from pathlib import Path
from celery import shared_task

logger = logging.getLogger(__name__)

SHARED_WHISPER_URL = os.getenv("SHARED_WHISPER_URL", "http://shared-whisper:9000")
SHARED_WHISPER_TIMEOUT = int(os.getenv("SHARED_WHISPER_TIMEOUT", "120"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Words to filter out (Whisper hallucinations)
HALLUCINATION_WORDS = {
    '...', '..', '.', '♪', '♫', '[Musique]', '[Music]',
    '[Applause]', '(musique)', '*', '(Musique)', '',
}


def _transcribe_via_shared_whisper(
    vocals_path: str,
    language: str = "fr",
    lyrics_text: str | None = None,
) -> dict:
    """
    Word timestamps via shared-whisper HTTP (GPU 4, large-v3-turbo int8).

    If lyrics_text is provided, passes it as initial_prompt to guide
    Whisper's recognition (pseudo forced alignment).
    """
    import httpx

    logger.info("Word timestamps via shared-whisper: %s", vocals_path)

    params = {
        "language": language,
        "output": "json",
        "task": "transcribe",
        "word_timestamps": "true",
        "vad_filter": "true",
    }

    # Pass lyrics as initial_prompt for guided recognition
    if lyrics_text:
        # Truncate to ~500 chars (Whisper prompt limit is ~224 tokens)
        params["initial_prompt"] = lyrics_text[:500]
        logger.info("Using lyrics as initial_prompt (%d chars)", min(len(lyrics_text), 500))

    with open(vocals_path, "rb") as f:
        response = httpx.post(
            f"{SHARED_WHISPER_URL}/asr",
            params=params,
            files={"audio_file": (os.path.basename(vocals_path), f, "audio/wav")},
            timeout=SHARED_WHISPER_TIMEOUT,
        )

    response.raise_for_status()
    return response.json()


def _transcribe_via_groq(
    vocals_path: str,
    language: str = "fr",
    lyrics_text: str | None = None,
) -> dict:
    """Fallback: Groq Whisper API (free tier, whisper-large-v3-turbo)."""
    import httpx

    logger.info("Word timestamps via Groq Whisper: %s", vocals_path)

    data = {
        "model": "whisper-large-v3-turbo",
        "language": language,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "word",
    }

    if lyrics_text:
        data["prompt"] = lyrics_text[:500]

    with open(vocals_path, "rb") as f:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            data=data,
            files={"file": (os.path.basename(vocals_path), f, "audio/wav")},
            timeout=120,
        )

    response.raise_for_status()
    groq_data = response.json()

    # Convert Groq format to shared-whisper segment format
    segments = []
    if groq_data.get("words"):
        segment_words = []
        for w in groq_data["words"]:
            segment_words.append({
                "word": w.get("word", ""),
                "start": w.get("start", 0.0),
                "end": w.get("end", 0.0),
                "probability": 0.9,  # Groq doesn't return per-word confidence
            })
        segments.append({"words": segment_words})

    return {
        "text": groq_data.get("text", ""),
        "language": groq_data.get("language", language),
        "segments": segments,
    }


def _extract_words_and_lines(data: dict, lyrics_text: str | None = None) -> dict:
    """
    Extract word-level data from Whisper response, filter hallucinations,
    and build line structures for karaoke display.
    """
    words = []
    lines = []
    total_confidence = 0
    min_confidence = 0.2 if lyrics_text else 0.3

    for segment in data.get("segments", []):
        segment_words = []
        segment_text_parts = []

        for word_info in segment.get("words", []):
            word_text = word_info.get("word", word_info.get("text", "")).strip()

            if word_text in HALLUCINATION_WORDS or not word_text:
                continue

            confidence = word_info.get("probability", word_info.get("confidence", 1.0))
            if confidence < min_confidence:
                continue

            word_data = {
                "word": word_text,
                "startMs": int(word_info.get("start", 0) * 1000),
                "endMs": int(word_info.get("end", 0) * 1000),
                "confidence": round(confidence, 3),
            }
            words.append(word_data)
            segment_words.append(word_data)
            segment_text_parts.append(word_text)
            total_confidence += word_data["confidence"]

        if segment_words:
            lines.append({
                "startMs": segment_words[0]["startMs"],
                "endMs": segment_words[-1]["endMs"],
                "words": segment_words,
                "text": " ".join(segment_text_parts),
            })

    confidence_avg = total_confidence / len(words) if words else 0
    duration_ms = words[-1]["endMs"] if words else 0

    logger.info("Extracted %d words, avg confidence: %.3f", len(words), confidence_avg)

    return {
        "text": data.get("text", ""),
        "language": data.get("language", "fr"),
        "words": words,
        "lines": lines,
        "word_count": len(words),
        "duration_ms": duration_ms,
        "confidence_avg": round(confidence_avg, 3),
        "model_version": "shared-whisper-large-v3-turbo",
    }


def do_generate_word_timestamps(
    vocals_path: str,
    spotify_track_id: str,
    youtube_video_id: str | None = None,
    language: str = "fr",
    artist_name: str | None = None,
    track_name: str | None = None,
    lyrics_text: str | None = None,
    synced_lines: list[dict] | None = None,
) -> dict:
    """
    Generate word timestamps via shared-whisper HTTP (3-tier fallback).

    Uses shared-whisper on GPU 4 — does NOT load any model on GPU 0.
    """
    # Tier 1: shared-whisper HTTP (GPU 4)
    data = None
    source = "shared_whisper"
    try:
        data = _transcribe_via_shared_whisper(vocals_path, language, lyrics_text)
    except Exception as e:
        logger.warning("shared-whisper failed for word timestamps: %s", e)

        # Tier 2: Groq Whisper API
        if GROQ_API_KEY:
            try:
                logger.info("Falling back to Groq Whisper for word timestamps")
                data = _transcribe_via_groq(vocals_path, language, lyrics_text)
                source = "groq_whisper"
            except Exception as groq_err:
                logger.warning("Groq Whisper fallback failed: %s", groq_err)

    if data is None:
        raise RuntimeError(
            "Word timestamp generation failed — shared-whisper down, "
            f"Groq {'failed' if GROQ_API_KEY else 'not configured'}"
        )

    # Extract and filter words/lines
    result = _extract_words_and_lines(data, lyrics_text)
    if source == "groq_whisper":
        result["model_version"] = "groq-whisper-large-v3-turbo"

    # Save to file for backup
    output_dir = Path(vocals_path).parent
    timestamps_path = output_dir / "word_timestamps.json"

    output_data = {
        "spotify_track_id": spotify_track_id,
        "youtube_video_id": youtube_video_id,
        "source": source,
        "language": result["language"],
        "model_version": result["model_version"],
        "words": result["words"],
        "lines": result["lines"],
        "word_count": result["word_count"],
        "duration_ms": result["duration_ms"],
        "confidence_avg": result["confidence_avg"],
        "artist_name": artist_name,
        "track_name": track_name,
    }

    with open(timestamps_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    logger.info("Saved word timestamps to: %s", timestamps_path)

    return {
        "status": "completed",
        "spotify_track_id": spotify_track_id,
        "youtube_video_id": youtube_video_id,
        "source": source,
        "words": result["words"],
        "lines": result["lines"],
        "language": result["language"],
        "model_version": result["model_version"],
        "word_count": result["word_count"],
        "duration_ms": result["duration_ms"],
        "confidence_avg": result["confidence_avg"],
        "timestamps_path": str(timestamps_path),
    }


@shared_task(bind=True, name="tasks.word_timestamps.generate_word_timestamps")
def generate_word_timestamps(
    self,
    vocals_path: str,
    spotify_track_id: str,
    youtube_video_id: str | None = None,
    language: str = "fr",
    artist_name: str | None = None,
    track_name: str | None = None,
) -> dict:
    """
    Celery task: Generate word-level timestamps for vocals.

    Uses shared-whisper HTTP (GPU 4) — no local GPU model needed.
    """
    self.update_state(state="PROGRESS", meta={
        "step": "generating_timestamps",
        "spotify_track_id": spotify_track_id,
    })

    return do_generate_word_timestamps(
        vocals_path=vocals_path,
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_video_id,
        language=language,
        artist_name=artist_name,
        track_name=track_name,
    )


@shared_task(bind=True, name="tasks.word_timestamps.generate_word_timestamps_cached")
def generate_word_timestamps_cached(
    self,
    reference_path: str,
    spotify_track_id: str,
    youtube_video_id: str,
    language: str = "fr",
    artist_name: str | None = None,
    track_name: str | None = None,
    force_regenerate: bool = False,
) -> dict:
    """
    Celery task: Full pipeline — Demucs separation + shared-whisper timestamps + caching.

    Steps:
    1. Unload Ollama from GPU 0 (if Demucs needed)
    2. Run Demucs separation (GPU 0, ~4 GB VRAM)
    3. Fetch lyrics for guided recognition
    4. Generate word timestamps via shared-whisper HTTP (GPU 4, zero GPU 0 usage)
    5. Cache results in PostgreSQL
    """
    import torch
    import torchaudio
    from demucs.apply import apply_model
    from tasks.audio_separation import get_demucs_model, convert_to_wav
    from tasks.pipeline import _unload_ollama_model_for_gpu

    self.update_state(state="PROGRESS", meta={
        "step": "checking_cache",
        "spotify_track_id": spotify_track_id,
    })

    # Determine output paths
    cache_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / "cache" / youtube_video_id
    cache_dir.mkdir(parents=True, exist_ok=True)

    vocals_path = cache_dir / "vocals.wav"
    instrumentals_path = cache_dir / "instrumentals.wav"

    # Step 1: Check for cached vocals (local → remote storage → Demucs)
    from .storage_client import get_storage
    storage = get_storage()
    need_demucs = (not vocals_path.exists() or force_regenerate)

    if need_demucs:
        # Check remote storage for Demucs cache (uploaded by prepare_reference)
        remote_vocals = f"cache/{youtube_video_id}/vocals.wav"

        if not force_regenerate and storage.exists(remote_vocals):
            logger.info("Found Demucs cache in remote storage for %s — downloading", youtube_video_id)
            self.update_state(state="PROGRESS", meta={
                "step": "downloading_cached",
                "spotify_track_id": spotify_track_id,
            })
            storage.download_to_file(remote_vocals, vocals_path)
            need_demucs = False

    if need_demucs:
        self.update_state(state="PROGRESS", meta={
            "step": "unloading_ollama",
            "spotify_track_id": spotify_track_id,
        })

        # Unload Ollama from GPU 0 to free ~4 GB VRAM for Demucs
        _unload_ollama_model_for_gpu()

        self.update_state(state="PROGRESS", meta={
            "step": "separating_audio",
            "spotify_track_id": spotify_track_id,
        })

        logger.info("Running Demucs separation...")

        # Resolve reference_path: download from storage if it's a URL
        if reference_path.startswith("http://") or reference_path.startswith("https://"):
            # Preserve original extension (.flac or .wav)
            ext = ".flac" if reference_path.endswith(".flac") else ".wav"
            local_ref_path = cache_dir / f"reference_dl{ext}"
            logger.info("Downloading reference from storage: %s", reference_path)
            try:
                storage.download_to_file(reference_path, local_ref_path)
            except Exception:
                # Fallback: try alternate extension (.wav ↔ .flac)
                alt_url = (
                    reference_path.rsplit(".", 1)[0]
                    + (".wav" if ext == ".flac" else ".flac")
                )
                alt_ext = ".wav" if ext == ".flac" else ".flac"
                local_ref_path = cache_dir / f"reference_dl{alt_ext}"
                logger.info("Fallback: trying %s", alt_url)
                storage.download_to_file(alt_url, local_ref_path)
            audio_path = local_ref_path
        else:
            audio_path = Path(reference_path)

        if audio_path.suffix.lower() in [".webm", ".opus", ".ogg"]:
            wav_path = audio_path.with_suffix(".wav")
            convert_to_wav(audio_path, wav_path)
            audio_path = wav_path

        waveform, sample_rate = torchaudio.load(str(audio_path), backend="soundfile")

        if sample_rate != 44100:
            resampler = torchaudio.transforms.Resample(sample_rate, 44100)
            waveform = resampler(waveform)

        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)

        waveform = waveform.unsqueeze(0)
        if torch.cuda.is_available():
            waveform = waveform.cuda()

        model = get_demucs_model()
        with torch.no_grad():
            sources = apply_model(model, waveform, device=waveform.device)

        vocals = sources[0, 3]
        instrumentals = sources[0, :3].sum(dim=0)

        torchaudio.save(str(vocals_path), vocals.cpu(), 44100)
        torchaudio.save(str(instrumentals_path), instrumentals.cpu(), 44100)

        # Free GPU memory after Demucs (no longer needed for timestamps)
        del sources, waveform, vocals, instrumentals
        torch.cuda.empty_cache()

        logger.info("Demucs complete, saved to cache, GPU memory freed")
    else:
        logger.info("Using cached vocals: %s", vocals_path)

    # Step 2: Fetch existing lyrics for guided recognition
    self.update_state(state="PROGRESS", meta={
        "step": "fetching_lyrics",
        "spotify_track_id": spotify_track_id,
    })

    from tasks.word_timestamps_db import get_lyrics_for_alignment

    lyrics_text, synced_lines = get_lyrics_for_alignment(spotify_track_id)
    if lyrics_text:
        logger.info("Found lyrics for guided recognition: %d chars", len(lyrics_text))
    else:
        logger.info("No lyrics found, will use free transcription")

    # Step 3: Generate word timestamps via shared-whisper HTTP (GPU 4)
    # This does NOT use GPU 0 — all inference happens on GPU 4 via HTTP
    self.update_state(state="PROGRESS", meta={
        "step": "generating_timestamps",
        "spotify_track_id": spotify_track_id,
    })

    result = do_generate_word_timestamps(
        vocals_path=str(vocals_path),
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_video_id,
        language=language,
        artist_name=artist_name,
        track_name=track_name,
        lyrics_text=lyrics_text,
        synced_lines=synced_lines,
    )

    # Step 4: Store in PostgreSQL cache
    self.update_state(state="PROGRESS", meta={
        "step": "caching_results",
        "spotify_track_id": spotify_track_id,
    })

    try:
        from tasks.word_timestamps_db import store_word_timestamps

        success = store_word_timestamps(
            spotify_track_id=spotify_track_id,
            youtube_video_id=youtube_video_id,
            words=result["words"],
            lines=result["lines"],
            source=result.get("source", "shared_whisper"),
            language=result.get("language"),
            model_version=result.get("model_version"),
            confidence_avg=result.get("confidence_avg"),
            artist_name=artist_name,
            track_name=track_name,
        )

        if success:
            logger.info("Stored in PostgreSQL cache")
            result["cached_in_postgres"] = True
        else:
            result["cached_in_postgres"] = False
            result["cache_error"] = "Failed to store in PostgreSQL"

    except Exception as e:
        logger.warning("Failed to cache in PostgreSQL: %s", e)
        result["cached_in_postgres"] = False
        result["cache_error"] = str(e)

    result["vocals_path"] = str(vocals_path)
    result["instrumentals_path"] = str(instrumentals_path)

    return result
