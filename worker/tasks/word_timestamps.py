"""
Word-level timestamps generation using whisper-timestamped.
Provides more accurate word alignment than standard Whisper word_timestamps.

This task integrates with the caching system to avoid reprocessing:
1. Check if word timestamps already exist in cache
2. Check if vocals are already separated (Demucs cache)
3. Generate only if necessary
"""
import os
import json
from pathlib import Path
from celery import shared_task

# Lazy load models for GPU memory management
_whisper_timestamped_model = None


def get_whisper_timestamped_model():
    """
    Lazy load whisper-timestamped model.

    Uses DTW-based alignment on cross-attention weights for better
    word-level timestamp accuracy than standard Whisper.
    """
    global _whisper_timestamped_model
    if _whisper_timestamped_model is None:
        import whisper_timestamped as whisper

        model_name = os.getenv("WHISPER_MODEL", "turbo")
        print(f"[WhisperTimestamped] Loading model: {model_name}")
        _whisper_timestamped_model = whisper.load_model(model_name)
    return _whisper_timestamped_model


def transcribe_with_word_timestamps(
    vocals_path: str,
    language: str = "fr",
    use_vad: bool = True,
) -> dict:
    """
    Transcribe audio with precise word-level timestamps.

    Args:
        vocals_path: Path to vocals audio file (ideally Demucs-separated)
        language: Language code
        use_vad: Use Voice Activity Detection to reduce hallucinations

    Returns:
        dict with words, lines, and metadata
    """
    import whisper_timestamped as whisper

    print(f"[WhisperTimestamped] Transcribing: {vocals_path}")

    model = get_whisper_timestamped_model()

    # Transcribe with whisper-timestamped for better word alignment
    result = whisper.transcribe(
        model,
        vocals_path,
        language=language,
        vad=use_vad,  # VAD reduces hallucinations on silence
        compute_word_confidence=True,
        include_punctuation_in_confidence=False,
        refine_whisper_precision=0.5,  # Refine timestamps by 0.5s
        min_word_duration=0.02,  # Minimum 20ms per word
        detect_disfluencies=False,  # Don't mark hesitations
        verbose=False,
    )

    # Extract word-level data
    words = []
    lines = []
    total_confidence = 0

    for segment in result.get("segments", []):
        segment_words = []
        segment_text_parts = []

        for word_info in segment.get("words", []):
            word_data = {
                "word": word_info["text"].strip(),
                "startMs": int(word_info["start"] * 1000),
                "endMs": int(word_info["end"] * 1000),
                "confidence": round(word_info.get("confidence", 1.0), 3),
            }
            words.append(word_data)
            segment_words.append(word_data)
            segment_text_parts.append(word_info["text"].strip())
            total_confidence += word_data["confidence"]

        if segment_words:
            lines.append({
                "startMs": segment_words[0]["startMs"],
                "endMs": segment_words[-1]["endMs"],
                "words": segment_words,
                "text": " ".join(segment_text_parts),
            })

    # Calculate average confidence
    confidence_avg = total_confidence / len(words) if words else 0

    # Get duration
    duration_ms = words[-1]["endMs"] if words else 0

    print(f"[WhisperTimestamped] Transcribed {len(words)} words, avg confidence: {confidence_avg:.3f}")

    return {
        "text": result.get("text", ""),
        "language": result.get("language", language),
        "words": words,
        "lines": lines,
        "word_count": len(words),
        "duration_ms": duration_ms,
        "confidence_avg": round(confidence_avg, 3),
        "model_version": f"whisper-timestamped-{os.getenv('WHISPER_MODEL', 'turbo')}",
    }


def do_generate_word_timestamps(
    vocals_path: str,
    spotify_track_id: str,
    youtube_video_id: str | None = None,
    language: str = "fr",
    artist_name: str | None = None,
    track_name: str | None = None,
) -> dict:
    """
    Core logic: Generate word timestamps with caching.

    This function is designed to be called from the backend API
    with cache checking already done. It focuses on generation only.

    Args:
        vocals_path: Path to vocals audio file
        spotify_track_id: Spotify track ID (for caching)
        youtube_video_id: YouTube video ID (for caching)
        language: Language code
        artist_name: For debugging/metadata
        track_name: For debugging/metadata

    Returns:
        dict with word timestamps data
    """
    # Generate timestamps
    result = transcribe_with_word_timestamps(
        vocals_path=vocals_path,
        language=language,
        use_vad=True,
    )

    # Save to file for backup
    output_dir = Path(vocals_path).parent
    timestamps_path = output_dir / "word_timestamps.json"

    output_data = {
        "spotify_track_id": spotify_track_id,
        "youtube_video_id": youtube_video_id,
        "source": "whisper_timestamped",
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

    print(f"[WhisperTimestamped] Saved to: {timestamps_path}")

    return {
        "status": "completed",
        "spotify_track_id": spotify_track_id,
        "youtube_video_id": youtube_video_id,
        "source": "whisper_timestamped",
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

    This task should be called after:
    1. Checking word_timestamps_cache (API layer)
    2. Ensuring vocals are available (via Demucs cache or separation)

    Args:
        vocals_path: Path to separated vocals
        spotify_track_id: Spotify track ID for caching
        youtube_video_id: YouTube video ID for caching
        language: Language code (default: French)
        artist_name: For metadata
        track_name: For metadata

    Returns:
        dict with word timestamps and metadata
    """
    self.update_state(state="PROGRESS", meta={
        "step": "loading_model",
        "spotify_track_id": spotify_track_id,
    })

    result = do_generate_word_timestamps(
        vocals_path=vocals_path,
        spotify_track_id=spotify_track_id,
        youtube_video_id=youtube_video_id,
        language=language,
        artist_name=artist_name,
        track_name=track_name,
    )

    return result


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
    Celery task: Full pipeline with Demucs + WhisperTimestamped + Caching.

    This is the main entry point that handles the full workflow:
    1. Check if word timestamps already cached
    2. Check if vocals already separated (Demucs cache)
    3. Run Demucs if needed
    4. Run WhisperTimestamped
    5. Cache the results in PostgreSQL

    Args:
        reference_path: Path to reference audio (full mix)
        spotify_track_id: Spotify track ID
        youtube_video_id: YouTube video ID
        language: Language code
        artist_name: For metadata
        track_name: For metadata
        force_regenerate: Skip cache and regenerate

    Returns:
        dict with word timestamps
    """
    import torch
    import torchaudio
    from demucs.apply import apply_model
    from tasks.audio_separation import get_demucs_model, convert_to_wav

    self.update_state(state="PROGRESS", meta={
        "step": "checking_cache",
        "spotify_track_id": spotify_track_id,
    })

    # Determine output paths
    cache_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / "cache" / youtube_video_id
    cache_dir.mkdir(parents=True, exist_ok=True)

    vocals_path = cache_dir / "vocals.wav"
    instrumentals_path = cache_dir / "instrumentals.wav"

    # Step 1: Check if vocals already exist (Demucs cache)
    if not vocals_path.exists() or force_regenerate:
        self.update_state(state="PROGRESS", meta={
            "step": "separating_audio",
            "spotify_track_id": spotify_track_id,
        })

        print(f"[WordTimestampsCached] Running Demucs separation...")

        # Load and prepare audio
        audio_path = Path(reference_path)
        if audio_path.suffix.lower() in [".webm", ".opus", ".ogg"]:
            wav_path = audio_path.with_suffix(".wav")
            convert_to_wav(audio_path, wav_path)
            audio_path = wav_path

        waveform, sample_rate = torchaudio.load(str(audio_path), backend="soundfile")

        # Resample to 44100Hz
        if sample_rate != 44100:
            resampler = torchaudio.transforms.Resample(sample_rate, 44100)
            waveform = resampler(waveform)

        # Convert to stereo
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)

        waveform = waveform.unsqueeze(0)
        if torch.cuda.is_available():
            waveform = waveform.cuda()

        # Apply Demucs
        model = get_demucs_model()
        with torch.no_grad():
            sources = apply_model(model, waveform, device=waveform.device)

        vocals = sources[0, 3]
        instrumentals = sources[0, :3].sum(dim=0)

        torchaudio.save(str(vocals_path), vocals.cpu(), 44100)
        torchaudio.save(str(instrumentals_path), instrumentals.cpu(), 44100)

        print(f"[WordTimestampsCached] Demucs complete, saved to cache")
    else:
        print(f"[WordTimestampsCached] Using cached vocals: {vocals_path}")

    # Step 2: Generate word timestamps
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
    )

    # Step 3: Store in PostgreSQL cache
    self.update_state(state="PROGRESS", meta={
        "step": "caching_results",
        "spotify_track_id": spotify_track_id,
    })

    try:
        # Use direct PostgreSQL access (no async needed)
        from tasks.word_timestamps_db import store_word_timestamps

        success = store_word_timestamps(
            spotify_track_id=spotify_track_id,
            youtube_video_id=youtube_video_id,
            words=result["words"],
            lines=result["lines"],
            source="whisper_timestamped",
            language=result.get("language"),
            model_version=result.get("model_version"),
            confidence_avg=result.get("confidence_avg"),
            artist_name=artist_name,
            track_name=track_name,
        )

        if success:
            print(f"[WordTimestampsCached] Stored in PostgreSQL cache")
            result["cached_in_postgres"] = True
        else:
            result["cached_in_postgres"] = False
            result["cache_error"] = "Failed to store in PostgreSQL"

    except Exception as e:
        print(f"[WordTimestampsCached] Failed to cache in PostgreSQL: {e}")
        result["cached_in_postgres"] = False
        result["cache_error"] = str(e)

    # Add cache paths to result
    result["vocals_path"] = str(vocals_path)
    result["instrumentals_path"] = str(instrumentals_path)

    return result
