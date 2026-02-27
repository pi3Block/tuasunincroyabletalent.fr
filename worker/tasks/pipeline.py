"""
Audio analysis pipeline - orchestrates all analysis tasks.
Runs all processing directly (not as sub-tasks) to avoid Celery .get() issues.

Multi-GPU architecture (2026-02-27):
- GPU 1 (RTX 3080 10GB, cuda:0): Demucs + de-bleeding (dedicated, no Ollama)
- GPU 4 (RTX 3060 Ti 8GB, cuda:1): CREPE pitch extraction (dedicated)
- GPU 3 (RTX 3070 8GB): shared-whisper HTTP (separate container)
- Jury LLM: 100% LiteLLM/Groq (no local GPU needed)

Storage (storages.augmenter.pro, bucket: kiaraoke):
  cache/{youtube_id}/reference.wav         <- YouTube original (permanent)
  cache/{youtube_id}/vocals.wav            <- Demucs ref cache (90 days)
  cache/{youtube_id}/instrumentals.wav
  cache/{youtube_id}/pitch_data.npz        <- CREPE ref cache
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

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Dedicated GPU devices — no Ollama sharing, no locks needed
DEMUCS_DEVICE = os.getenv("DEMUCS_DEVICE", "cuda:0")  # GPU 1 RTX 3080 10GB
CREPE_DEVICE = os.getenv("CREPE_DEVICE", "cuda:1")     # GPU 4 RTX 3060 Ti 8GB


def _notify_tracks_ready(session_id: str):
    """
    Set tracks_ready_at timestamp in the session Redis hash.
    The SSE router polls this field and emits a 'tracks_ready' event to the frontend.
    """
    try:
        import redis
        import time
        client = redis.from_url(REDIS_URL, socket_timeout=2)
        session_key = f"session:{session_id}"
        # Update the session hash with a timestamp
        session_data = client.get(session_key)
        if session_data:
            data = json.loads(session_data)
            data["tracks_ready_at"] = str(time.time())
            client.set(session_key, json.dumps(data))
            logger.info("Notified tracks_ready for session %s", session_id)
    except Exception as e:
        logger.warning("Failed to notify tracks_ready: %s", e)


def _is_storage_url(path: str) -> bool:
    return path.startswith("http://") or path.startswith("https://")


def _safe_upload(storage, local_path: Path, relative_path: str, content_type: str = "audio/wav") -> str | None:
    """
    Upload a file to storage, returning public URL on success or None on failure.

    Used for non-critical uploads (cache, session tracks) where failure should
    degrade gracefully instead of crashing the pipeline.
    """
    try:
        return storage.upload_from_file(local_path, relative_path, content_type)
    except Exception as e:
        logger.warning("Upload failed (non-fatal) %s: %s", relative_path, e)
        return None


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


def _download_youtube_audio(youtube_url: str, dest: Path) -> Path:
    """
    Optimization A: download YouTube audio directly in the worker.

    Eliminates the backend→storage→worker double transit (~-15s on first run).

    Format: FLAC (lossless, ~15-20 MB vs ~50 MB WAV).
    FLAC is ~50% lighter than uncompressed WAV while being fully lossless.
    torchaudio/soundfile read FLAC natively — no quality loss for Demucs.

    Args:
        youtube_url: YouTube video URL
        dest: Target .flac file path

    Returns:
        dest (the downloaded .flac file)
    """
    import yt_dlp

    dest.parent.mkdir(parents=True, exist_ok=True)
    # yt-dlp appends the extension after FFmpeg conversion — strip it for outtmpl
    output_stem = str(dest.with_suffix(""))
    opts = {
        "format": "bestaudio/best",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "flac",
            # preferredquality has no effect for lossless FLAC
        }],
        "outtmpl": output_stem,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }
    logger.info("Worker: downloading YouTube audio (FLAC) %s → %s", youtube_url, dest)
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([youtube_url])
    if not dest.exists():
        raise FileNotFoundError(f"yt-dlp download failed: expected {dest}")
    return dest


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
    """Log GPU availability and memory usage for all visible devices."""
    import torch
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            name = torch.cuda.get_device_name(i)
            used = torch.cuda.memory_allocated(i) / 1024**3
            total = torch.cuda.get_device_properties(i).total_memory / 1024**3
            logger.info("GPU cuda:%d: %s (%.1fGB / %.1fGB)", i, name, used, total)
        return True
    else:
        logger.warning("CUDA NOT available - running on CPU (SLOW!)")
        return False


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

    Multi-GPU: Demucs on cuda:0 (GPU 1), CREPE on cuda:1 (GPU 4), Whisper via HTTP (GPU 3).

    Steps:
    1. Download user audio from storage -> /tmp/kiaraoke/
    2. Separate user audio (Demucs, cuda:0)
    3. Check ref separation in storage cache (Demucs if MISS)
    4. Cross-correlation sync (CPU)
    5. CREPE pitch (cuda:1) || Whisper+Lyrics (HTTP) — parallel
    6. Score + Jury feedback (LiteLLM, no GPU)
    7. Cleanup /tmp/kiaraoke/
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
        # GPU STATUS CHECK (dedicated GPUs, no locks needed)
        # ============================================================
        has_gpu = log_gpu_status()

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
            # Non-fatal: pipeline continues even if storage is unavailable (tracks won't be in StudioMode)
            user_vocals_local = Path(user_separation["vocals_path"])
            user_instru_local = Path(user_separation["instrumentals_path"])
            with ThreadPoolExecutor(max_workers=2) as pool:
                pool.submit(
                    _safe_upload, storage,
                    user_vocals_local,
                    f"sessions/{session_id}_user/vocals.wav",
                )
                pool.submit(
                    _safe_upload, storage,
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
                # Non-fatal: StudioMode degrades but analysis completes
                if not storage.exists(f"sessions/{session_id}_ref/vocals.wav"):
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        pool.submit(
                            _safe_upload, storage,
                            ref_vocals_local,
                            f"sessions/{session_id}_ref/vocals.wav",
                        )
                        pool.submit(
                            _safe_upload, storage,
                            ref_instru_local,
                            f"sessions/{session_id}_ref/instrumentals.wav",
                        )
            else:
                # CACHE MISS: download reference audio, separate, upload to cache + session_ref
                logger.info("No storage cache for %s, separating reference...", youtube_id)
                update_progress(self, "separating_reference", 25, "Preparation de la reference...")

                # Preserve extension from URL (.flac or .wav)
                ref_ext = ".flac" if reference_audio_path.endswith(".flac") else ".wav"
                local_ref = _resolve_audio(
                    reference_audio_path,
                    ref_temp / f"reference{ref_ext}",
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
                # Non-fatal: analysis uses local files, uploads are for StudioMode + future cache
                with ThreadPoolExecutor(max_workers=4) as pool:
                    pool.submit(
                        _safe_upload, storage,
                        ref_vocals_local,
                        f"sessions/{session_id}_ref/vocals.wav",
                    )
                    pool.submit(
                        _safe_upload, storage,
                        ref_instru_local,
                        f"sessions/{session_id}_ref/instrumentals.wav",
                    )
                    if youtube_id:
                        pool.submit(
                            _safe_upload, storage,
                            ref_vocals_local,
                            f"cache/{youtube_id}/vocals.wav",
                        )
                        pool.submit(
                            _safe_upload, storage,
                            ref_instru_local,
                            f"cache/{youtube_id}/instrumentals.wav",
                        )

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
            # STEPS 4-6: PARALLEL — CREPE (cuda:1 GPU 4) || Whisper+Lyrics (GPU 3 HTTP)
            # Dedicated GPUs: no contention, no locks.
            # ========================================================
            update_progress(self, "analyzing_parallel", 40, "Analyse en cours...")

            def _do_crepe():
                """Thread A: CREPE pitch extraction on cuda:1 (GPU 4)."""
                up = do_extract_pitch(
                    user_separation["vocals_path"], f"{session_id}_user",
                    fast_mode=False, device=CREPE_DEVICE,
                )
                # Reference pitch: check cache first
                ref_pitch_cache_key = (
                    f"cache/{youtube_id}/pitch_data.npz" if youtube_id else None
                )
                if ref_pitch_cache_key and storage.exists(ref_pitch_cache_key):
                    logger.info("Pitch cache HIT for reference %s — skipping CREPE", youtube_id)
                    cached_npz = ref_temp / "pitch_data_cached.npz"
                    storage.download_to_file(ref_pitch_cache_key, cached_npz)
                    rp = {"pitch_path": str(cached_npz), "stats": {}, "status": "cached"}
                else:
                    rp = do_extract_pitch(
                        str(ref_vocals_path), f"{session_id}_ref",
                        fast_mode=True, device=CREPE_DEVICE,
                    )
                    if ref_pitch_cache_key and rp.get("pitch_path"):
                        _safe_upload(
                            storage,
                            Path(rp["pitch_path"]),
                            ref_pitch_cache_key,
                            content_type="application/octet-stream",
                        )
                return up, rp

            def _do_whisper_lyrics():
                """Thread B: Whisper transcription (GPU 3 HTTP) + Lyrics (Genius HTTP)."""
                trans = do_transcribe_audio(user_separation["vocals_path"], session_id, "fr")
                lr = get_lyrics(artist_name, song_title)
                return trans, lr

            with ThreadPoolExecutor(max_workers=2) as pool:
                crepe_future = pool.submit(_do_crepe)
                whisper_future = pool.submit(_do_whisper_lyrics)
                user_pitch, ref_pitch = crepe_future.result()
                transcription, lyrics_result = whisper_future.result()

            reference_lyrics = lyrics_result.get("text", "")

            if lyrics_result.get("status") == "found":
                update_progress(self, "analysis_done", 78, "Analyse terminee !")
                logger.info("Lyrics found from %s", lyrics_result.get("source"))
            else:
                update_progress(self, "analysis_done", 78, "Analyse terminee (paroles non trouvees)")

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
    youtube_url: str = None,
) -> dict:
    """
    Pre-process reference audio (separate vocals, extract pitch) for StudioMode.

    Storage cache strategy (3 levels):
      1. Demucs cache:  cache/{youtube_id}/vocals.wav  → skip Demucs entirely
      2. Pitch cache:   cache/{youtube_id}/pitch_data.npz → skip CREPE entirely
      3. Session copy:  sessions/{session_id}_ref/vocals.wav → StudioMode access

    Optimization A (youtube_url provided + Demucs MISS):
      Worker downloads reference.wav directly from YouTube via yt-dlp (~-15s).
      Uploads reference.wav to storage for analyze_performance fallback, then
      runs Demucs as usual.

    Perf targets (warm cache):
      Demucs+CREPE miss, direct YT download (Opt A):  ~50s   (was ~65s)
      Demucs+CREPE miss, storage download:            ~65s
      Demucs cached, CREPE miss:                      ~35s
      Both cached (2nd session+):                     ~10s
    """
    from tasks.audio_separation import do_separate_audio
    from tasks.pitch_analysis import do_extract_pitch

    storage = get_storage()
    ref_temp = _temp_dir(f"{session_id}_ref")

    try:
        has_gpu = log_gpu_status()
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
            if youtube_url:
                # Optimization A: direct download from YouTube (skip backend→storage→worker transit)
                # FLAC: lossless, ~15-20 MB vs ~50 MB WAV — torchaudio reads it natively for Demucs
                local_ref_path = ref_temp / "reference.flac"
                _download_youtube_audio(youtube_url, local_ref_path)
                local_ref = str(local_ref_path)
                # Upload reference to storage for word_timestamps task (needs it if Demucs cache misses)
                if youtube_id:
                    _safe_upload(
                        storage,
                        local_ref_path,
                        f"cache/{youtube_id}/reference.flac",
                        content_type="audio/flac",
                    )
            else:
                local_ref = _resolve_audio(
                    reference_audio_path,
                    ref_temp / "reference.wav",
                )
            self.update_state(
                state="PROGRESS",
                meta={"step": "separating", "progress": 30},
            )
            result = do_separate_audio(local_ref, f"{session_id}_ref")

            # Free GPU cache after Demucs (prevent VRAM fragmentation for CREPE)
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

            vocals_local = Path(result["vocals_path"])
            instrumentals_local = Path(result["instrumentals_path"])

            # Persist to permanent cache — non-fatal (future sessions benefit from cache)
            if youtube_id:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    f_cv = pool.submit(
                        _safe_upload, storage,
                        vocals_local,
                        f"cache/{youtube_id}/vocals.wav",
                    )
                    f_ci = pool.submit(
                        _safe_upload, storage,
                        instrumentals_local,
                        f"cache/{youtube_id}/instrumentals.wav",
                    )
                if f_cv.result() and f_ci.result():
                    logger.info("Saved Demucs output to storage cache: %s", youtube_id)
                else:
                    logger.warning("Demucs cache upload failed for %s (non-fatal)", youtube_id)

        # ================================================================
        # UPLOAD SESSION COPIES — parallel (StudioMode access via audio.py)
        # Non-fatal: use expected URL as fallback if upload fails
        # ================================================================
        self.update_state(
            state="PROGRESS",
            meta={"step": "uploading_session", "progress": 55},
        )
        vocals_rel = f"sessions/{session_id}_ref/vocals.wav"
        instru_rel = f"sessions/{session_id}_ref/instrumentals.wav"
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_v = pool.submit(_safe_upload, storage, vocals_local, vocals_rel)
            f_i = pool.submit(_safe_upload, storage, instrumentals_local, instru_rel)
        vocals_url = f_v.result() or storage.public_url(vocals_rel)
        instru_url = f_i.result() or storage.public_url(instru_rel)

        # Notify frontend that ref tracks are available for multi-track playback
        _notify_tracks_ready(session_id)

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
            pitch_result = do_extract_pitch(
                str(vocals_local), f"{session_id}_ref",
                fast_mode=True, device=CREPE_DEVICE,
            )

            # Free GPU cache after CREPE
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

            pitch_path = pitch_result.get("pitch_path", "")
            # Cache pitch for future sessions with same video — non-fatal
            if pitch_cache_key and pitch_path:
                _safe_upload(
                    storage,
                    Path(pitch_path),
                    pitch_cache_key,
                    content_type="application/octet-stream",
                )

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
