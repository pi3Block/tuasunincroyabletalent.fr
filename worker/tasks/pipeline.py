"""
Audio analysis pipeline - orchestrates all analysis tasks.
Runs all processing directly (not as sub-tasks) to avoid Celery .get() issues.

Multi-GPU architecture (2026-02-28):
- GPU 1 (RTX 3080 10GB, cuda:0): Demucs + de-bleeding — shared with Ollama Heavy
- GPU 2 (RTX 3070 8GB, cuda:1): CREPE pitch — coexists with Ollama (CREPE ~1GB)
- GPU 3 (RTX 3070 8GB): shared-whisper HTTP (separate container)
- Jury LLM: 100% LiteLLM/Groq (no local GPU needed)

GPU time-sharing (GPU 1):
  Normal state: Ollama Heavy qwen3:8b resident (~5.8 GB) for augmenter.pro
  Pipeline start: POST keep_alive:0 → Ollama unloads → Demucs uses GPU (~4 GB)
  Pipeline end: Ollama reloads on next request (~2-3s cold start)

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

# GPU devices — shared with Ollama via keep_alive:0 time-sharing
DEMUCS_DEVICE = os.getenv("DEMUCS_DEVICE", "cuda:0")  # GPU 1 RTX 3080 10GB
CREPE_DEVICE = os.getenv("CREPE_DEVICE", "cuda:1")     # GPU 2 RTX 3070 8GB

# Ollama Heavy on GPU 1 (same as Demucs) — unloaded before Demucs, reloads on next request
OLLAMA_HEAVY_HOST = os.getenv("OLLAMA_HEAVY_HOST", "http://host.docker.internal:11434")
try:
    STORAGE_UPLOAD_PARALLELISM = max(1, min(2, int(os.getenv("STORAGE_UPLOAD_PARALLELISM", "1"))))
except ValueError:
    STORAGE_UPLOAD_PARALLELISM = 1


def _notify_tracks_ready(session_id: str):
    """
    Set tracks_ready_at timestamp as a dedicated Redis key (atomic, no race condition).
    The SSE router polls this key and emits a 'tracks_ready' event to the frontend.
    """
    try:
        import redis
        import time
        client = redis.from_url(REDIS_URL, socket_timeout=2)
        # Atomic SET on a dedicated key — avoids read-modify-write race on session JSON
        client.setex(f"session:{session_id}:tracks_ready_at", 3600, str(time.time()))
        logger.info("Notified tracks_ready for session %s", session_id)
    except Exception as e:
        logger.warning("Failed to notify tracks_ready: %s", e)


def _notify_user_tracks_ready(session_id: str):
    """
    Set user_tracks_ready_at timestamp as a dedicated Redis key (atomic, no race condition).
    The SSE router polls this key and emits a 'user_tracks_ready' event to the frontend,
    allowing the user to listen to their separated vocals before the jury finishes.
    Called from Thread A (upload thread) after user stems are uploaded to storage.
    """
    try:
        import redis
        import time
        client = redis.from_url(REDIS_URL, socket_timeout=2)
        # Atomic SET on a dedicated key — avoids read-modify-write race on session JSON
        client.setex(f"session:{session_id}:user_tracks_ready_at", 3600, str(time.time()))
        logger.info("Notified user_tracks_ready for session %s", session_id)
    except Exception as e:
        logger.warning("Failed to notify user_tracks_ready: %s", e)


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


def _upload_pair(storage, first: tuple[Path, str], second: tuple[Path, str]) -> tuple[str | None, str | None]:
    """
    Upload two files with bounded parallelism.

    Large WAV uploads to the storage gateway can timeout when sent concurrently;
    default to sequential uploads unless explicitly overridden.
    """
    if STORAGE_UPLOAD_PARALLELISM <= 1:
        u1 = _safe_upload(storage, first[0], first[1])
        u2 = _safe_upload(storage, second[0], second[1])
        return u1, u2
    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(_safe_upload, storage, first[0], first[1])
        f2 = pool.submit(_safe_upload, storage, second[0], second[1])
        return f1.result(timeout=120), f2.result(timeout=120)


def _temp_dir(name: str) -> Path:
    """Create and return a temp processing dir under /tmp/kiaraoke/."""
    base = Path(os.getenv("AUDIO_TEMP_DIR", "/tmp/kiaraoke"))
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    return d


_ollama_unload_ok = True  # Tracks whether Ollama unload succeeded (for Demucs OOM fallback)


def _unload_ollama_for_demucs():
    """Unload Ollama Heavy model from GPU 1 to free VRAM for Demucs.

    Ollama Heavy (qwen3:8b, ~5.8 GB) shares GPU 1 with Demucs (~4 GB).
    Combined they exceed 10 GB RTX 3080 VRAM, so we unload before Demucs runs.
    Ollama reloads automatically on next request (~2-3s cold start).

    Non-fatal: if Ollama is unreachable or already unloaded, Demucs proceeds anyway.
    Sets _ollama_unload_ok = False on failure so Demucs can adapt (e.g. reduce batch).
    """
    global _ollama_unload_ok
    import httpx

    try:
        resp = httpx.post(
            f"{OLLAMA_HEAVY_HOST}/api/generate",
            json={"model": "qwen3:8b", "keep_alive": 0},
            timeout=10.0,
        )
        if resp.status_code == 200:
            logger.info("Ollama Heavy unloaded from GPU 1 (keep_alive:0)")
            _ollama_unload_ok = True
        else:
            logger.warning("Ollama Heavy unload returned %d — Demucs may OOM!", resp.status_code)
            _ollama_unload_ok = False
    except Exception as e:
        logger.warning("Ollama Heavy not reachable: %s — Demucs may OOM if Ollama is loaded!", e)
        _ollama_unload_ok = False


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
        # GPU PREP — unload Ollama Heavy from GPU 1 to free VRAM for Demucs
        # ============================================================
        _unload_ollama_for_demucs()
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
            # PHASE 1 — Download + Demucs user (séquentiel, cuda:0)
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

            update_progress(self, "separating_user", 10, "Isolation de ta voix...")
            user_separation = do_separate_audio(local_user_path, f"{session_id}_user")

            # Free GPU cache after Demucs user
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception as cuda_err:
                logger.warning("CUDA empty_cache failed: %s", cuda_err)

            user_vocals_local = Path(user_separation["vocals_path"])
            user_instru_local = Path(user_separation["instrumentals_path"])

            update_progress(self, "separating_user_done", 20, "Voix isolee !")

            # ========================================================
            # PHASE 2 — 4 threads parallèles lancés simultanément :
            #
            #   Thread A (upload_notify) : upload user stems → notifie le frontend
            #   Thread B (separate_ref)  : Demucs ref / cache (cuda:0)
            #   Thread C (crepe_user)    : CREPE user pitch (cuda:1)
            #   Thread D (whisper_lyrics): Whisper HTTP (GPU 3) + Genius API
            #
            # Thread A et Thread B utilisent le réseau / storage (I/O).
            # Thread B utilise cuda:0, Thread C utilise cuda:1 → pas de contention GPU.
            # update_progress() N'est PAS appelé depuis les threads (non thread-safe avec Celery).
            # _notify_user_tracks_ready() écrit directement dans la session Redis (clé distincte).
            # ========================================================
            update_progress(self, "analyzing_parallel", 25, "Analyse approfondie en cours...")

            def _upload_and_notify():
                """
                Thread A: upload user stems puis notifie le frontend.

                Appelé uniquement depuis Phase 2. N'appelle pas update_progress() (Celery).
                Écrit user_tracks_ready_at dans Redis session → SSE router émet user_tracks_ready.
                """
                _upload_pair(
                    storage,
                    (user_vocals_local, f"sessions/{session_id}_user/vocals.wav"),
                    (user_instru_local, f"sessions/{session_id}_user/instrumentals.wav"),
                )
                _notify_user_tracks_ready(session_id)

            def _separate_ref() -> tuple:
                """
                Thread B: séparation référence (cuda:0) avec cache storage.

                CACHE HIT  → download 2 fichiers depuis storage (~2s).
                CACHE MISS → yt-dlp + Demucs htdemucs (~25s) + upload cache + session_ref.
                Retourne (ref_vocals_path: str, ref_instru_path: str).
                """
                if youtube_id and is_ref_separation_in_storage(youtube_id):
                    logger.info("Reference separation cache HIT for %s", youtube_id)
                    rv_local = storage.download_to_file(
                        f"cache/{youtube_id}/vocals.wav",
                        ref_temp / "vocals.wav",
                    )
                    ri_local = storage.download_to_file(
                        f"cache/{youtube_id}/instrumentals.wav",
                        ref_temp / "instrumentals.wav",
                    )
                    rv_path = str(rv_local)
                    ri_path = str(ri_local)
                    # Ensure session_ref tracks exist for StudioMode (non-fatal if missing)
                    if not storage.exists(f"sessions/{session_id}_ref/vocals.wav"):
                        _upload_pair(
                            storage,
                            (Path(rv_path), f"sessions/{session_id}_ref/vocals.wav"),
                            (Path(ri_path), f"sessions/{session_id}_ref/instrumentals.wav"),
                        )
                else:
                    logger.info("Reference separation cache MISS for %s — running Demucs", youtube_id)
                    ref_ext = ".flac" if reference_audio_path.endswith(".flac") else ".wav"
                    local_ref = _resolve_audio(
                        reference_audio_path,
                        ref_temp / f"reference{ref_ext}",
                    )
                    ref_sep = do_separate_audio(local_ref, f"{session_id}_ref")
                    # Free GPU cache after 2nd Demucs pass
                    try:
                        import torch
                        if torch.cuda.is_available():
                            torch.cuda.empty_cache()
                    except Exception:
                        pass
                    rv_path = ref_sep["vocals_path"]
                    ri_path = ref_sep["instrumentals_path"]
                    # Upload to permanent cache + session_ref — all in parallel
                    with ThreadPoolExecutor(max_workers=4) as up_pool:
                        up_pool.submit(
                            _safe_upload, storage,
                            Path(rv_path), f"sessions/{session_id}_ref/vocals.wav",
                        )
                        up_pool.submit(
                            _safe_upload, storage,
                            Path(ri_path), f"sessions/{session_id}_ref/instrumentals.wav",
                        )
                        if youtube_id:
                            up_pool.submit(
                                _safe_upload, storage,
                                Path(rv_path), f"cache/{youtube_id}/vocals.wav",
                            )
                            up_pool.submit(
                                _safe_upload, storage,
                                Path(ri_path), f"cache/{youtube_id}/instrumentals.wav",
                            )
                    # Flow envelope (non-fatal, <1s CPU)
                    if youtube_id and not storage.exists(f"cache/{youtube_id}/flow_envelope.json"):
                        from tasks.flow_envelope import compute_and_upload_envelope
                        compute_and_upload_envelope(rv_path, youtube_id, storage)
                return rv_path, ri_path

            def _crepe_user() -> dict:
                """Thread C: CREPE user pitch (cuda:1, full model pour précision max)."""
                return do_extract_pitch(
                    user_separation["vocals_path"], f"{session_id}_user",
                    fast_mode=False, device=CREPE_DEVICE,
                )

            def _whisper_lyrics() -> tuple:
                """Thread D: Whisper HTTP (GPU 3) + Genius API (HTTP)."""
                trans = do_transcribe_audio(user_separation["vocals_path"], session_id, "fr")
                lr = get_lyrics(artist_name, song_title)
                return trans, lr

            with ThreadPoolExecutor(max_workers=4) as pool:
                fut_upload     = pool.submit(_upload_and_notify)
                fut_ref        = pool.submit(_separate_ref)
                fut_crepe_user = pool.submit(_crepe_user)
                fut_whisper    = pool.submit(_whisper_lyrics)
            # pool.__exit__ (shutdown wait=True) attend la fin des 4 threads.

            # Critical threads — pipeline cannot continue without these (5 min timeout)
            ref_vocals_path, ref_instru_path = fut_ref.result(timeout=300)
            user_pitch = fut_crepe_user.result(timeout=300)

            # Non-critical threads — degrade gracefully instead of crashing
            try:
                transcription, lyrics_result = fut_whisper.result(timeout=120)
            except Exception as whisper_err:
                logger.error("Whisper/Lyrics thread failed, using fallback: %s", whisper_err)
                transcription = {"text": "", "words": []}
                lyrics_result = {"text": "", "source": "none", "status": "error"}

            try:
                fut_upload.result(timeout=120)
            except Exception as upload_err:
                logger.error("Upload thread failed (non-fatal): %s", upload_err)

            # ========================================================
            # PHASE 3 — 2 threads parallèles après Phase 2 :
            #
            #   Thread E (sync)      : cross-correlation offset (CPU, ~1s)
            #   Thread F (crepe_ref) : CREPE ref pitch (cuda:1, tiny, ~1.5s ou 0s cache)
            #
            # Les deux ne dépendent que de ref_vocals_path (disponible après Phase 2).
            # ========================================================
            update_progress(self, "sync_and_pitch_ref", 65, "Synchronisation et pitch ref...")

            def _sync() -> dict:
                """Thread E: cross-correlation sync offset (CPU)."""
                from tasks.sync import compute_sync_offset
                try:
                    result = compute_sync_offset(
                        user_vocals_path=user_separation["vocals_path"],
                        ref_vocals_path=str(ref_vocals_path),
                    )
                    logger.info(
                        "Auto sync offset: %.3fs (confidence: %.2f)",
                        result["offset_seconds"], result["confidence"],
                    )
                    return result
                except Exception as e:
                    logger.warning("Cross-correlation sync failed: %s, using offset=0", e)
                    return {"offset_seconds": 0.0, "confidence": 0.0, "method": "fallback"}

            def _crepe_ref() -> dict:
                """Thread F: CREPE ref pitch (cuda:1, tiny model) avec cache pitch NPZ."""
                ref_pitch_cache_key = (
                    f"cache/{youtube_id}/pitch_data.npz" if youtube_id else None
                )
                if ref_pitch_cache_key and storage.exists(ref_pitch_cache_key):
                    logger.info("Pitch cache HIT for reference %s — skipping CREPE", youtube_id)
                    cached_npz = ref_temp / "pitch_data_cached.npz"
                    storage.download_to_file(ref_pitch_cache_key, cached_npz)
                    # Validate NPZ integrity — re-run CREPE if corrupt
                    try:
                        import numpy as _np
                        with _np.load(str(cached_npz)) as npz:
                            if "frequency" not in npz or "time" not in npz:
                                raise ValueError("Missing keys in cached NPZ")
                        return {"pitch_path": str(cached_npz), "stats": {}, "status": "cached"}
                    except Exception as npz_err:
                        logger.warning("Cached pitch NPZ invalid for %s, re-running CREPE: %s", youtube_id, npz_err)
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
                return rp

            with ThreadPoolExecutor(max_workers=2) as pool:
                fut_sync      = pool.submit(_sync)
                fut_crepe_ref = pool.submit(_crepe_ref)
            sync_result = fut_sync.result(timeout=60)
            ref_pitch   = fut_crepe_ref.result(timeout=300)

            auto_offset = sync_result["offset_seconds"]
            sync_confidence = sync_result["confidence"]

            reference_lyrics = lyrics_result.get("text", "")

            if lyrics_result.get("status") == "found":
                update_progress(self, "analysis_done", 78, "Analyse terminee !")
                logger.info("Lyrics found from %s", lyrics_result.get("source"))
            else:
                update_progress(self, "analysis_done", 78, "Analyse terminee (paroles non trouvees)")

            # ========================================================
            # PHASE 4 — Scoring + Jury (séquentiel, CPU + LiteLLM)
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

    except Exception as exc:
        # Pipeline failed — update Redis session so frontend stops waiting
        logger.error("Pipeline FAILED for session %s: %s", session_id, exc, exc_info=True)
        try:
            import redis as _redis
            _r = _redis.from_url(REDIS_URL, socket_timeout=2)
            raw = _r.get(f"session:{session_id}")
            if raw:
                session_data = json.loads(raw)
                session_data["status"] = "error"
                session_data["error"] = f"Analyse échouée : {type(exc).__name__}"
                _r.setex(f"session:{session_id}", 3600, json.dumps(session_data, ensure_ascii=False))
                logger.info("Session %s marked as error in Redis", session_id)
        except Exception as redis_err:
            logger.warning("Failed to update session error state: %s", redis_err)
        raise  # Re-raise so Celery marks the task as FAILURE

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
    logger.info(
        "prepare_reference storage upload parallelism=%d (STORAGE_UPLOAD_PARALLELISM)",
        STORAGE_UPLOAD_PARALLELISM,
    )

    try:
        # Unload Ollama Heavy from GPU 1 before any Demucs work
        _unload_ollama_for_demucs()
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
            except Exception as cuda_err:
                logger.warning("CUDA empty_cache failed: %s", cuda_err)

            vocals_local = Path(result["vocals_path"])
            instrumentals_local = Path(result["instrumentals_path"])

            # Persist to permanent cache — non-fatal (future sessions benefit from cache)
            if youtube_id:
                cv_url, ci_url = _upload_pair(
                    storage,
                    (vocals_local, f"cache/{youtube_id}/vocals.wav"),
                    (instrumentals_local, f"cache/{youtube_id}/instrumentals.wav"),
                )
                if cv_url and ci_url:
                    logger.info("Saved Demucs output to storage cache: %s", youtube_id)
                else:
                    logger.warning("Demucs cache upload failed for %s (non-fatal)", youtube_id)

        # ================================================================
        # FLOW ENVELOPE — compute and cache (non-fatal, <1s CPU)
        # ================================================================
        if youtube_id and not storage.exists(f"cache/{youtube_id}/flow_envelope.json"):
            from tasks.flow_envelope import compute_and_upload_envelope
            compute_and_upload_envelope(str(vocals_local), youtube_id, storage)

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
        v_url, i_url = _upload_pair(
            storage,
            (vocals_local, vocals_rel),
            (instrumentals_local, instru_rel),
        )
        if v_url:
            vocals_url = v_url
        elif youtube_id and demucs_cached:
            # Session copy failed: fallback to known-good cache URL.
            vocals_url = storage.public_url(f"cache/{youtube_id}/vocals.wav")
            logger.warning(
                "Session vocals upload failed for %s; using cache fallback URL",
                session_id,
            )
        else:
            vocals_url = storage.public_url(vocals_rel)
            logger.warning(
                "Session vocals upload failed for %s; using expected session URL fallback",
                session_id,
            )

        if i_url:
            instru_url = i_url
        elif youtube_id and demucs_cached:
            # Session copy failed: fallback to known-good cache URL.
            instru_url = storage.public_url(f"cache/{youtube_id}/instrumentals.wav")
            logger.warning(
                "Session instrumentals upload failed for %s; using cache fallback URL",
                session_id,
            )
        else:
            instru_url = storage.public_url(instru_rel)
            logger.warning(
                "Session instrumentals upload failed for %s; using expected session URL fallback",
                session_id,
            )

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
            except Exception as cuda_err:
                logger.warning("CUDA empty_cache failed: %s", cuda_err)

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
