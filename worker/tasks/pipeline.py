"""
Audio analysis pipeline - orchestrates all analysis tasks.
Runs all processing directly (not as sub-tasks) to avoid Celery .get() issues.

Storage migration (2026-02-27):
- Audio files live on storages.augmenter.pro (bucket: kiaraoke)
- GPU tasks use local temp /tmp/kiaraoke/ for processing
- Pattern: download from storage -> GPU process -> upload to storage -> delete temp

Storage paths:
  cache/{youtube_id}/reference.wav         <- YouTube original (permanent)
  cache/{youtube_id}/vocals.wav            <- Demucs ref cache (90 days)
  cache/{youtube_id}/instrumentals.wav
  sessions/{session_id}_ref/vocals.wav     <- StudioMode ref tracks
  sessions/{session_id}_ref/instrumentals.wav
  sessions/{session_id}_user/vocals.wav    <- User separated tracks
  sessions/{session_id}_user/instrumentals.wav
  sessions/{session_id}/user_recording.*   <- User raw recording (2h TTL)
"""
import os
import json
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from celery import shared_task

from .tracing import trace_pipeline, flush_traces, TracingSpan
from .storage_client import get_storage

logger = logging.getLogger(__name__)


def _is_storage_url(path: str) -> bool:
    return path.startswith("http://") or path.startswith("https://")


def _temp_dir(name: str) -> Path:
    """Create and return a temp processing dir under /tmp/kiaraoke/."""
    base = Path(os.getenv("AUDIO_TEMP_DIR", "/tmp/kiaraoke"))
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _resolve_audio(url_or_path: str, dest: Path) -> str:
    """
    Ensure audio is available locally for GPU processing.

    If url_or_path is a storage URL: download to dest and return local path.
    If url_or_path is already a local path: return as-is (backward-compat).
    """
    if _is_storage_url(url_or_path):
        storage = get_storage()
        storage.download_to_file(url_or_path, dest)
        return str(dest)
    return url_or_path


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


def is_ref_separation_in_storage(youtube_id: str) -> bool:
    """Check if reference separation (vocals.wav) is cached in remote storage."""
    if not youtube_id:
        return False
    storage = get_storage()
    return storage.exists(f"cache/{youtube_id}/vocals.wav")


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
    Unload Ollama Heavy model from GPU 1 to free VRAM for Demucs/CREPE.

    GPU 1 (RTX 3080, 10 GB) is shared between Ollama Heavy (qwen3:8b, ~6 GB)
    and the voicejury worker (Demucs ~3.5 GB + CREPE ~1 GB). Peak usage ~5 GB,
    but with Ollama loaded concurrently the total would exceed 10 GB.

    Sends keep_alive=0 to force immediate unload, then polls /api/ps until the
    model is confirmed gone from VRAM (max 20s). The model auto-reloads
    on next Ollama Heavy request (~2-3s cold start, jury runs after GPU tasks).
    """
    import time
    import httpx

    ollama_host = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen3:8b")

    # Step 1: Request unload (keep_alive=0 overrides OLLAMA_KEEP_ALIVE=-1 for this call)
    try:
        response = httpx.post(
            f"{ollama_host}/api/generate",
            json={"model": ollama_model, "keep_alive": 0},
            timeout=10.0,
        )
        if response.status_code == 200:
            logger.info("Sent unload request for Ollama %s -- waiting for VRAM release...", ollama_model)
        else:
            logger.warning("Ollama unload request returned status %d", response.status_code)
    except Exception as e:
        logger.warning("Failed to send Ollama unload request (GPU may already be free): %s", e)
        return

    # Step 2: Poll /api/ps until model is confirmed unloaded (max 20s)
    deadline = time.time() + 20.0
    while time.time() < deadline:
        time.sleep(0.5)
        try:
            ps_resp = httpx.get(f"{ollama_host}/api/ps", timeout=3.0)
            if ps_resp.status_code == 200:
                loaded_models = ps_resp.json().get("models", [])
                if not loaded_models:
                    logger.info("Ollama VRAM confirmed free -- proceeding with Demucs/CREPE")
                    return
        except Exception:
            pass  # Transient error, keep polling

    logger.warning("Ollama model may still be in VRAM after 20s -- proceeding anyway")


@shared_task(bind=True, name="tasks.pipeline.analyze_performance")
def analyze_performance(
    self,
    session_id: str,
    user_audio_path: str,
    reference_audio_path: str,
    song_title: str,
    artist_name: str,
    youtube_id: str = None,
) -> dict:
    """
    Full analysis pipeline for a vocal performance.

    Steps:
    1. Unload Ollama to free GPU VRAM
    2. Download user audio from storage -> /tmp/kiaraoke/
    3. Separate user audio (Demucs) -> upload user_vocals/instrumentals to storage
    4. Check ref separation in storage cache:
       - Cache HIT:  download ref vocals/instrumentals from storage
       - Cache MISS: download reference audio, separate, upload to storage cache
    5. Cross-correlation sync (auto offset detection)
    6. Extract pitch (CREPE)
    7. Transcribe user vocals (Whisper)
    8. Fetch reference lyrics (Genius)
    9. Score + Jury feedback (LLM, parallel x3 personas)
    10. Cleanup /tmp/kiaraoke/

    Args:
        session_id: Session identifier
        user_audio_path: Storage URL or legacy local path for user recording
        reference_audio_path: Storage URL or legacy local path for reference audio
        song_title: Name of the song
        artist_name: Artist name
        youtube_id: YouTube video ID for reference separation cache lookup
    """
    from tasks.audio_separation import do_separate_audio
    from tasks.pitch_analysis import do_extract_pitch
    from tasks.transcription import do_transcribe_audio
    from tasks.scoring import do_generate_feedback
    from tasks.lyrics import get_lyrics

    storage = get_storage()

    # Temp dirs for this session's GPU processing
    user_temp = _temp_dir(f"{session_id}_user")
    ref_temp = _temp_dir(f"{session_id}_ref")
    session_temp = _temp_dir(session_id)

    try:
        # ============================================================
        # GPU STATUS CHECK
        # ============================================================
        has_gpu = log_gpu_status()

        # ============================================================
        # GPU TIME-SHARING: Unload Ollama Heavy from GPU 1
        # ============================================================
        if has_gpu:
            _unload_ollama_model_for_gpu()

        # ============================================================
        # LANGFUSE PIPELINE TRACE
        # ============================================================
        with trace_pipeline(
            session_id=session_id,
            song_title=song_title,
            artist_name=artist_name,
            has_gpu=has_gpu,
            youtube_id=youtube_id,
            task_id=self.request.id,
        ) as pipeline_span:

            # ========================================================
            # STEP 1: Download user audio from storage (if URL)
            # ========================================================
            update_progress(self, "loading_model", 5, "Chargement du modele Demucs...")

            # Guess extension from URL tail to preserve format for ffmpeg
            ext_guess = ".webm"
            if user_audio_path and "." in user_audio_path.split("/")[-1]:
                ext_guess = "." + user_audio_path.rsplit(".", 1)[-1]
            local_user_path = _resolve_audio(
                user_audio_path,
                session_temp / f"user_recording{ext_guess}",
            )

            # ========================================================
            # STEP 2: Separate user audio (Demucs)
            # AUDIO_OUTPUT_DIR=/tmp/kiaraoke -> outputs to /tmp/kiaraoke/{session_id}_user/
            # ========================================================
            update_progress(self, "separating_user", 10, "Isolation de ta voix...")
            user_separation = do_separate_audio(local_user_path, f"{session_id}_user")

            # Free GPU cache after Demucs
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

            # Upload user vocals/instrumentals to storage — parallel (StudioMode access)
            user_vocals_local = Path(user_separation["vocals_path"])
            user_instru_local = Path(user_separation["instrumentals_path"])
            with ThreadPoolExecutor(max_workers=2) as pool:
                pool.submit(
                    storage.upload_from_file,
                    user_vocals_local,
                    f"sessions/{session_id}_user/vocals.wav",
                )
                pool.submit(
                    storage.upload_from_file,
                    user_instru_local,
                    f"sessions/{session_id}_user/instrumentals.wav",
                )

            update_progress(self, "separating_user_done", 20, "Voix isolee !")

            # ========================================================
            # STEP 3: Reference separation (with STORAGE CACHE)
            # ========================================================
            ref_vocals_path = None
            ref_instrumentals_path = None

            if youtube_id and is_ref_separation_in_storage(youtube_id):
                # CACHE HIT: download from storage to temp
                logger.info("Reference separation found in storage cache for %s", youtube_id)
                update_progress(self, "separating_reference_cached", 35, "Reference en cache !")
                ref_vocals_local = storage.download_to_file(
                    f"cache/{youtube_id}/vocals.wav",
                    ref_temp / "vocals.wav",
                )
                ref_instru_local = storage.download_to_file(
                    f"cache/{youtube_id}/instrumentals.wav",
                    ref_temp / "instrumentals.wav",
                )
                ref_vocals_path = str(ref_vocals_local)
                ref_instrumentals_path = str(ref_instru_local)
                # Ensure session_ref tracks exist in storage for StudioMode — parallel
                if not storage.exists(f"sessions/{session_id}_ref/vocals.wav"):
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        pool.submit(
                            storage.upload_from_file,
                            ref_vocals_local,
                            f"sessions/{session_id}_ref/vocals.wav",
                        )
                        pool.submit(
                            storage.upload_from_file,
                            ref_instru_local,
                            f"sessions/{session_id}_ref/instrumentals.wav",
                        )
            else:
                # CACHE MISS: download reference audio, separate, upload to cache + session_ref
                logger.info("No storage cache for %s, separating reference...", youtube_id)
                update_progress(self, "separating_reference", 25, "Preparation de la reference...")

                local_ref = _resolve_audio(
                    reference_audio_path,
                    ref_temp / "reference.wav",
                )
                ref_separation = do_separate_audio(local_ref, f"{session_id}_ref")

                # Free GPU cache after 2nd Demucs pass
                try:
                    import torch
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:
                    pass

                ref_vocals_path = ref_separation["vocals_path"]
                ref_instrumentals_path = ref_separation["instrumentals_path"]
                ref_vocals_local = Path(ref_vocals_path)
                ref_instru_local = Path(ref_instrumentals_path)

                # Upload to permanent cache + session_ref — all in parallel
                with ThreadPoolExecutor(max_workers=4) as pool:
                    futures = [
                        pool.submit(
                            storage.upload_from_file,
                            ref_vocals_local,
                            f"sessions/{session_id}_ref/vocals.wav",
                        ),
                        pool.submit(
                            storage.upload_from_file,
                            ref_instru_local,
                            f"sessions/{session_id}_ref/instrumentals.wav",
                        ),
                    ]
                    if youtube_id:
                        futures += [
                            pool.submit(
                                storage.upload_from_file,
                                ref_vocals_local,
                                f"cache/{youtube_id}/vocals.wav",
                            ),
                            pool.submit(
                                storage.upload_from_file,
                                ref_instru_local,
                                f"cache/{youtube_id}/instrumentals.wav",
                            ),
                        ]
                    for f in futures:
                        f.result()  # propagate upload errors
                if youtube_id:
                    logger.info("Saved ref separation to storage cache: %s", youtube_id)

                update_progress(self, "separating_reference_done", 35, "Reference prete !")

            # ========================================================
            # STEP 3.5: Cross-correlation sync (auto offset detection)
            # ========================================================
            update_progress(self, "computing_sync", 37, "Synchronisation automatique...")

            from tasks.sync import compute_sync_offset
            try:
                sync_result = compute_sync_offset(
                    user_vocals_path=user_separation["vocals_path"],
                    ref_vocals_path=str(ref_vocals_path),
                )
                auto_offset = sync_result["offset_seconds"]
                sync_confidence = sync_result["confidence"]
                logger.info(
                    "Auto sync offset: %.3fs (confidence: %.2f)", auto_offset, sync_confidence,
                )
            except Exception as e:
                logger.warning("Cross-correlation sync failed: %s, using offset=0", e)
                auto_offset = 0.0
                sync_confidence = 0.0
                sync_result = {"offset_seconds": 0.0, "confidence": 0.0, "method": "fallback"}

            # ========================================================
            # STEP 4: Extract pitch (CREPE)
            # Use 'full' model for user (accuracy), 'tiny' for ref (speed)
            # ========================================================
            update_progress(self, "extracting_pitch_user", 40, "Analyse de ta justesse...")
            user_pitch = do_extract_pitch(user_separation["vocals_path"], f"{session_id}_user", fast_mode=False)

            update_progress(self, "extracting_pitch_ref", 50, "Analyse de la reference...")
            # Fix #4: check pitch cache before running CREPE on reference
            ref_pitch_cache_key = (
                f"cache/{youtube_id}/pitch_data.npz" if youtube_id else None
            )
            if ref_pitch_cache_key and storage.exists(ref_pitch_cache_key):
                logger.info("Pitch cache HIT for reference %s — skipping CREPE", youtube_id)
                cached_npz = ref_temp / "pitch_data_cached.npz"
                storage.download_to_file(ref_pitch_cache_key, cached_npz)
                ref_pitch = {"pitch_path": str(cached_npz), "stats": {}, "status": "cached"}
            else:
                ref_pitch = do_extract_pitch(
                    str(ref_vocals_path), f"{session_id}_ref", fast_mode=True
                )
                # Persist pitch to storage cache for future sessions
                if ref_pitch_cache_key and ref_pitch.get("pitch_path"):
                    storage.upload_from_file(
                        Path(ref_pitch["pitch_path"]),
                        ref_pitch_cache_key,
                        content_type="application/octet-stream",
                    )
                    logger.info("Cached reference pitch to storage: %s", youtube_id)
            update_progress(self, "extracting_pitch_done", 55, "Justesse analysee !")

            # ========================================================
            # STEP 5: Transcribe vocals (Whisper 3-tier fallback)
            # ========================================================
            update_progress(self, "transcribing", 60, "Transcription de tes paroles...")
            transcription = do_transcribe_audio(user_separation["vocals_path"], session_id, "fr")
            update_progress(self, "transcribing_done", 70, "Paroles transcrites !")

            # ========================================================
            # STEP 6: Fetch reference lyrics (Genius)
            # ========================================================
            update_progress(self, "fetching_lyrics", 75, "Recuperation des paroles officielles...")
            lyrics_result = get_lyrics(artist_name, song_title)
            reference_lyrics = lyrics_result.get("text", "")

            if lyrics_result.get("status") == "found":
                update_progress(self, "lyrics_found", 78, "Paroles trouvees !")
                logger.info("Lyrics found from %s", lyrics_result.get("source"))
            else:
                update_progress(self, "lyrics_not_found", 78, "Paroles non trouvees (score neutre)")

            # ========================================================
            # STEP 7: Score + Jury feedback (parallel x3 personas)
            # ========================================================
            update_progress(self, "calculating_scores", 80, "Calcul des scores...")
            update_progress(self, "jury_deliberation", 85, "Le jury se reunit...")

            # Only apply auto offset if confidence is above threshold
            effective_offset = auto_offset if sync_confidence > 0.3 else 0.0

            results = do_generate_feedback(
                session_id=session_id,
                user_pitch_path=user_pitch["pitch_path"],
                reference_pitch_path=ref_pitch["pitch_path"],
                user_lyrics=transcription["text"],
                reference_lyrics=reference_lyrics,
                song_title=song_title,
                pipeline_span=pipeline_span,
                offset_seconds=effective_offset,
            )

            results["auto_sync"] = sync_result

            update_progress(self, "jury_voting", 95, "Le jury vote...")
            update_progress(self, "completed", 100, "Verdict rendu !")

            flush_traces()

    finally:
        # ============================================================
        # CLEANUP: Delete all temp dirs for this session
        # ============================================================
        for temp_path in [session_temp, user_temp, ref_temp]:
            shutil.rmtree(temp_path, ignore_errors=True)
        logger.info("Cleaned up temp dirs for session %s", session_id)

    return results


@shared_task(bind=True, name="tasks.pipeline.prepare_reference")
def prepare_reference(
    self,
    session_id: str,
    reference_audio_path: str,
    youtube_id: str = None,
) -> dict:
    """
    Pre-process reference audio (separate vocals, extract pitch) for StudioMode.

    Storage cache strategy (3 levels):
      1. Demucs cache:  cache/{youtube_id}/vocals.wav  → skip Demucs entirely
      2. Pitch cache:   cache/{youtube_id}/pitch_data.npz → skip CREPE entirely
      3. Session copy:  sessions/{session_id}_ref/vocals.wav → StudioMode access

    Perf targets (warm cache):
      Demucs+CREPE miss (1st time):  ~65s
      Demucs cached, CREPE miss:     ~35s
      Both cached (2nd session+):    ~10s
    """
    from tasks.audio_separation import do_separate_audio
    from tasks.pitch_analysis import do_extract_pitch

    storage = get_storage()
    ref_temp = _temp_dir(f"{session_id}_ref")

    try:
        vocals_local = None
        instrumentals_local = None

        # ================================================================
        # DEMUCS CACHE CHECK — skip GPU separation if already done
        # ================================================================
        demucs_cached = youtube_id and storage.exists(
            f"cache/{youtube_id}/vocals.wav"
        )

        if demucs_cached:
            logger.info("Demucs cache HIT for %s — skipping separation", youtube_id)
            self.update_state(
                state="PROGRESS",
                meta={"step": "downloading_cached", "progress": 20},
            )
            # Download in parallel (both files needed locally for CREPE)
            with ThreadPoolExecutor(max_workers=2) as pool:
                f_v = pool.submit(
                    storage.download_to_file,
                    f"cache/{youtube_id}/vocals.wav",
                    ref_temp / "vocals.wav",
                )
                f_i = pool.submit(
                    storage.download_to_file,
                    f"cache/{youtube_id}/instrumentals.wav",
                    ref_temp / "instrumentals.wav",
                )
                vocals_local = f_v.result()
                instrumentals_local = f_i.result()
        else:
            logger.info("Demucs cache MISS for %s — separating...", youtube_id or "unknown")
            self.update_state(
                state="PROGRESS",
                meta={"step": "downloading", "progress": 10},
            )
            local_ref = _resolve_audio(
                reference_audio_path,
                ref_temp / "reference.wav",
            )
            self.update_state(
                state="PROGRESS",
                meta={"step": "separating", "progress": 30},
            )
            result = do_separate_audio(local_ref, f"{session_id}_ref")
            vocals_local = Path(result["vocals_path"])
            instrumentals_local = Path(result["instrumentals_path"])

            # Persist to permanent cache (parallel, non-blocking for session upload)
            if youtube_id:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    pool.submit(
                        storage.upload_from_file,
                        vocals_local,
                        f"cache/{youtube_id}/vocals.wav",
                    )
                    pool.submit(
                        storage.upload_from_file,
                        instrumentals_local,
                        f"cache/{youtube_id}/instrumentals.wav",
                    )
                logger.info("Saved Demucs output to storage cache: %s", youtube_id)

        # ================================================================
        # UPLOAD SESSION COPIES — parallel (StudioMode access via audio.py)
        # ================================================================
        self.update_state(
            state="PROGRESS",
            meta={"step": "uploading_session", "progress": 55},
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_v = pool.submit(
                storage.upload_from_file,
                vocals_local,
                f"sessions/{session_id}_ref/vocals.wav",
            )
            f_i = pool.submit(
                storage.upload_from_file,
                instrumentals_local,
                f"sessions/{session_id}_ref/instrumentals.wav",
            )
            vocals_url = f_v.result()
            instru_url = f_i.result()

        # ================================================================
        # PITCH CACHE CHECK — skip CREPE if already done for this video
        # ================================================================
        self.update_state(
            state="PROGRESS",
            meta={"step": "extracting_pitch", "progress": 70},
        )

        pitch_path = None
        pitch_cache_key = f"cache/{youtube_id}/pitch_data.npz" if youtube_id else None

        if pitch_cache_key and storage.exists(pitch_cache_key):
            logger.info("Pitch cache HIT for %s — skipping CREPE", youtube_id)
            cached_npz = ref_temp / "pitch_data_cached.npz"
            storage.download_to_file(pitch_cache_key, cached_npz)
            pitch_path = str(cached_npz)
        else:
            # Fix #1: use tiny model for reference (3x faster than full)
            pitch_result = do_extract_pitch(
                str(vocals_local), f"{session_id}_ref", fast_mode=True
            )
            pitch_path = pitch_result.get("pitch_path", "")
            # Cache pitch for future sessions with same video
            if pitch_cache_key and pitch_path:
                storage.upload_from_file(
                    Path(pitch_path),
                    pitch_cache_key,
                    content_type="application/octet-stream",
                )
                logger.info("Saved pitch data to storage cache: %s", youtube_id)

        return {
            "session_id": session_id,
            "status": "ready",
            "reference_vocals_url": vocals_url,
            "reference_instrumentals_url": instru_url,
            "reference_pitch_path": pitch_path or "",
        }

    finally:
        shutil.rmtree(ref_temp, ignore_errors=True)
        logger.info("Cleaned up temp dir for prepare_reference session %s", session_id)
