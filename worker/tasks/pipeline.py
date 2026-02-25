"""
Audio analysis pipeline - orchestrates all analysis tasks.
Runs all processing directly (not as sub-tasks) to avoid Celery .get() issues.

Performance optimizations:
- Cache reference separation by YouTube video ID (2min saved per repeated song)
- Use smaller CREPE model (tiny vs medium)
- Parallelize user separation + ref check

Improvements (2026-02-11):
- Langfuse pipeline tracing (parent trace + child spans per step)
- Structured logging (logging module)

Improvements (2026-02-25):
- GPU time-sharing with Ollama Light on GPU 0 (unload before Demucs)
"""
import os
import json
import logging
import shutil
from pathlib import Path
from celery import shared_task

from .tracing import trace_pipeline, flush_traces, TracingSpan

logger = logging.getLogger(__name__)


def update_progress(task, step: str, progress: int, detail: str = ""):
    """Helper to update task progress with consistent format."""
    task.update_state(
        state="PROGRESS",
        meta={
            "step": step,
            "progress": progress,
            "detail": detail,
        }
    )


def get_ref_cache_dir(youtube_id: str) -> Path:
    """Get the cache directory for a YouTube video's separated audio."""
    return Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / "cache" / youtube_id


def is_ref_separation_cached(youtube_id: str) -> bool:
    """Check if reference vocals/instrumentals are already separated and cached."""
    if not youtube_id:
        return False
    cache_dir = get_ref_cache_dir(youtube_id)
    return (cache_dir / "vocals.wav").exists() and (cache_dir / "instrumentals.wav").exists()


def copy_cached_ref_to_session(youtube_id: str, session_id: str) -> dict:
    """Copy cached reference files to session directory for the Studio Mode."""
    cache_dir = get_ref_cache_dir(youtube_id)
    base_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files"))
    session_ref_dir = base_dir / f"{session_id}_ref"
    session_ref_dir.mkdir(parents=True, exist_ok=True)

    # Copy (not move) so cache stays intact
    vocals_src = cache_dir / "vocals.wav"
    instru_src = cache_dir / "instrumentals.wav"
    vocals_dst = session_ref_dir / "vocals.wav"
    instru_dst = session_ref_dir / "instrumentals.wav"

    if not vocals_dst.exists():
        shutil.copy2(vocals_src, vocals_dst)
    if not instru_dst.exists():
        shutil.copy2(instru_src, instru_dst)

    return {
        "vocals_path": str(vocals_dst),
        "instrumentals_path": str(instru_dst),
    }


def log_gpu_status():
    """Log GPU availability and memory usage."""
    import torch
    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        mem_allocated = torch.cuda.memory_allocated(0) / 1024**3
        mem_total = torch.cuda.get_device_properties(0).total_memory / 1024**3
        logger.info("GPU: %s (%.1fGB / %.1fGB)", device_name, mem_allocated, mem_total)
        return True
    else:
        logger.warning("CUDA NOT available - running on CPU (SLOW!)")
        return False


def _unload_ollama_model_for_gpu():
    """
    Unload Ollama Light model from GPU 0 to free VRAM for Demucs/CREPE.

    GPU 0 (RTX 3070, 8 GB) is shared between Ollama Light (qwen3:4b, ~4.1 GB)
    and the voicejury worker (Demucs ~4 GB + CREPE ~1 GB). They cannot coexist.

    Sends keep_alive=0 to force immediate unload. The model auto-reloads
    on next Ollama Light request (~2-3s cold start).
    """
    import httpx

    ollama_host = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11435")
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen3:4b")

    try:
        response = httpx.post(
            f"{ollama_host}/api/generate",
            json={"model": ollama_model, "keep_alive": 0},
            timeout=5.0,
        )
        if response.status_code == 200:
            logger.info(
                "Unloaded Ollama %s from GPU 0 — VRAM freed for Demucs/CREPE",
                ollama_model,
            )
        else:
            logger.warning("Ollama unload returned status %d", response.status_code)
    except Exception as e:
        # Non-fatal: GPU may already be free, or Ollama may not be running
        logger.warning("Failed to unload Ollama model (GPU may be free): %s", e)


@shared_task(bind=True, name="tasks.pipeline.analyze_performance")
def analyze_performance(
    self,
    session_id: str,
    user_audio_path: str,
    reference_audio_path: str,
    song_title: str,
    artist_name: str,
    youtube_id: str = None,  # NEW: for cache lookup
) -> dict:
    """
    Full analysis pipeline for a vocal performance.

    Steps:
    1. Separate vocals from user recording (remove bleed from speakers)
    2. Separate vocals from reference (for comparison) - CACHED by YouTube ID
    3. Extract pitch from both
    4. Transcribe user vocals
    5. Generate scores and feedback

    Args:
        session_id: Session identifier
        user_audio_path: Path to user's recording
        reference_audio_path: Path to reference audio
        song_title: Name of the song
        artist_name: Artist name
        youtube_id: YouTube video ID for cache lookup

    Returns:
        dict with all results
    """
    # Import the actual processing functions (not Celery tasks)
    from tasks.audio_separation import do_separate_audio
    from tasks.pitch_analysis import do_extract_pitch
    from tasks.transcription import do_transcribe_audio
    from tasks.scoring import do_generate_feedback
    from tasks.lyrics import get_lyrics

    output_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # ============================================
    # GPU STATUS CHECK
    # ============================================
    has_gpu = log_gpu_status()

    # ============================================
    # GPU TIME-SHARING: Unload Ollama Light from GPU 0
    # ============================================
    # GPU 0 is shared between Ollama Light (qwen3:4b, ~4.1 GB) and
    # Demucs (~4 GB) + CREPE (~1 GB). Unload to free VRAM.
    if has_gpu:
        _unload_ollama_model_for_gpu()

    # ============================================
    # LANGFUSE PIPELINE TRACE
    # ============================================
    with trace_pipeline(
        session_id=session_id,
        song_title=song_title,
        artist_name=artist_name,
        has_gpu=has_gpu,
        youtube_id=youtube_id,
        task_id=self.request.id,
    ) as pipeline_span:

        # ============================================
        # STEP 1: Separate user audio (Demucs)
        # ============================================
        update_progress(self, "loading_model", 5, "Chargement du modele Demucs...")

        update_progress(self, "separating_user", 10, "Isolation de ta voix...")
        user_separation = do_separate_audio(user_audio_path, f"{session_id}_user")
        update_progress(self, "separating_user_done", 20, "Voix isolee !")

        # ============================================
        # STEP 2: Separate reference audio (with CACHE)
        # ============================================
        ref_vocals_path = None
        ref_instrumentals_path = None

        # Check cache first (by YouTube video ID)
        if youtube_id and is_ref_separation_cached(youtube_id):
            logger.info("Reference separation found in cache for %s", youtube_id)
            update_progress(self, "separating_reference_cached", 35, "Reference en cache !")
            cached_paths = copy_cached_ref_to_session(youtube_id, session_id)
            ref_vocals_path = cached_paths["vocals_path"]
            ref_instrumentals_path = cached_paths["instrumentals_path"]
        else:
            # No cache - need to separate
            logger.info("No cache for %s, separating reference...", youtube_id)
            update_progress(self, "separating_reference", 25, "Preparation de la reference...")
            ref_separation = do_separate_audio(reference_audio_path, f"{session_id}_ref")
            ref_vocals_path = ref_separation["vocals_path"]
            ref_instrumentals_path = ref_separation["instrumentals_path"]

            # Save to cache for future sessions
            if youtube_id:
                cache_dir = get_ref_cache_dir(youtube_id)
                cache_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ref_vocals_path, cache_dir / "vocals.wav")
                shutil.copy2(ref_instrumentals_path, cache_dir / "instrumentals.wav")
                logger.info("Saved reference separation to cache: %s", youtube_id)

            update_progress(self, "separating_reference_done", 35, "Reference prete !")

        # ============================================
        # STEP 3: Extract pitch (CREPE)
        # Use 'full' model for user (accuracy matters)
        # Use 'tiny' model for reference (speed matters, already cached)
        # ============================================
        update_progress(self, "extracting_pitch_user", 40, "Analyse de ta justesse...")
        user_pitch = do_extract_pitch(user_separation["vocals_path"], f"{session_id}_user", fast_mode=False)

        update_progress(self, "extracting_pitch_ref", 50, "Analyse de la reference...")
        ref_pitch = do_extract_pitch(str(ref_vocals_path), f"{session_id}_ref", fast_mode=True)
        update_progress(self, "extracting_pitch_done", 55, "Justesse analysee !")

        # ============================================
        # STEP 4: Transcribe vocals (Whisper)
        # ============================================
        update_progress(self, "transcribing", 60, "Transcription de tes paroles...")
        transcription = do_transcribe_audio(user_separation["vocals_path"], session_id, "fr")
        update_progress(self, "transcribing_done", 70, "Paroles transcrites !")

        # ============================================
        # STEP 5: Fetch reference lyrics (Genius)
        # ============================================
        update_progress(self, "fetching_lyrics", 75, "Recuperation des paroles officielles...")
        lyrics_result = get_lyrics(artist_name, song_title)
        reference_lyrics = lyrics_result.get("text", "")

        if lyrics_result.get("status") == "found":
            update_progress(self, "lyrics_found", 78, "Paroles trouvees !")
            logger.info("Lyrics found from %s", lyrics_result.get("source"))
        else:
            update_progress(self, "lyrics_not_found", 78, "Paroles non trouvees (score neutre)")
            logger.info("Lyrics not found: %s", lyrics_result.get("status"))

        # ============================================
        # STEP 6: Calculate scores
        # ============================================
        update_progress(self, "calculating_scores", 80, "Calcul des scores...")

        # ============================================
        # STEP 7: Generate jury feedback (Ollama — parallel)
        # ============================================
        update_progress(self, "jury_deliberation", 85, "Le jury se reunit...")

        results = do_generate_feedback(
            session_id=session_id,
            user_pitch_path=user_pitch["pitch_path"],
            reference_pitch_path=ref_pitch["pitch_path"],
            user_lyrics=transcription["text"],
            reference_lyrics=reference_lyrics,
            song_title=song_title,
            pipeline_span=pipeline_span,
        )

        update_progress(self, "jury_voting", 95, "Le jury vote...")
        update_progress(self, "completed", 100, "Verdict rendu !")

        # Flush Langfuse traces
        flush_traces()

    # Return results directly (contains session_id, score, pitch_accuracy, etc.)
    # The frontend expects this flat structure, not nested under "results"
    return results


@shared_task(bind=True, name="tasks.pipeline.prepare_reference")
def prepare_reference(self, session_id: str, reference_audio_path: str) -> dict:
    """
    Pre-process reference audio (separate vocals, extract pitch).
    Called after YouTube download completes.

    Files are stored in {session_id}_ref/ directory to match the API's expected paths:
    - {session_id}_ref/vocals.wav
    - {session_id}_ref/instrumentals.wav
    This allows the StudioMode to access reference tracks before analysis.
    """
    from tasks.audio_separation import do_separate_audio
    from tasks.pitch_analysis import do_extract_pitch

    base_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files"))
    # Use {session_id}_ref format to match API endpoint expectations
    ref_dir = base_dir / f"{session_id}_ref"
    ref_dir.mkdir(parents=True, exist_ok=True)

    self.update_state(state="PROGRESS", meta={"step": "separating", "progress": 30})

    # Separate vocals from reference - outputs to {session_id}_ref/
    separation_result = do_separate_audio(reference_audio_path, f"{session_id}_ref")

    # Files are already in correct location: {session_id}_ref/vocals.wav
    ref_vocals_path = Path(separation_result["vocals_path"])
    ref_instrumentals_path = Path(separation_result["instrumentals_path"])

    self.update_state(state="PROGRESS", meta={"step": "extracting_pitch", "progress": 70})

    # Extract pitch from reference vocals
    pitch_result = do_extract_pitch(str(ref_vocals_path), f"{session_id}_ref")

    return {
        "session_id": session_id,
        "status": "ready",
        "reference_vocals_path": str(ref_vocals_path),
        "reference_instrumentals_path": str(ref_instrumentals_path),
        "reference_pitch_path": pitch_result["pitch_path"],
    }
