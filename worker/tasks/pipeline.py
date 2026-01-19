"""
Audio analysis pipeline - orchestrates all analysis tasks.
Runs all processing directly (not as sub-tasks) to avoid Celery .get() issues.
"""
import os
import json
from pathlib import Path
from celery import shared_task


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


@shared_task(bind=True, name="tasks.pipeline.analyze_performance")
def analyze_performance(
    self,
    session_id: str,
    user_audio_path: str,
    reference_audio_path: str,
    song_title: str,
    artist_name: str,
) -> dict:
    """
    Full analysis pipeline for a vocal performance.

    Steps:
    1. Separate vocals from user recording (remove bleed from speakers)
    2. Separate vocals from reference (for comparison)
    3. Extract pitch from both
    4. Transcribe user vocals
    5. Generate scores and feedback

    Args:
        session_id: Session identifier
        user_audio_path: Path to user's recording
        reference_audio_path: Path to reference audio
        song_title: Name of the song
        artist_name: Artist name

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
    # STEP 1: Separate user audio (Demucs)
    # ============================================
    update_progress(self, "loading_model", 5, "Chargement du modele Demucs...")

    update_progress(self, "separating_user", 10, "Isolation de ta voix...")
    user_separation = do_separate_audio(user_audio_path, f"{session_id}_user")
    update_progress(self, "separating_user_done", 20, "Voix isolee !")

    # ============================================
    # STEP 2: Separate reference audio
    # ============================================
    ref_vocals_path = output_dir / "reference_vocals.wav"
    if not ref_vocals_path.exists():
        update_progress(self, "separating_reference", 25, "Preparation de la reference...")
        ref_separation = do_separate_audio(reference_audio_path, f"{session_id}_ref")
        ref_vocals_path = ref_separation["vocals_path"]
        update_progress(self, "separating_reference_done", 35, "Reference prete !")
    else:
        ref_vocals_path = str(ref_vocals_path)
        update_progress(self, "separating_reference_cached", 35, "Reference deja prete !")

    # ============================================
    # STEP 3: Extract pitch (CREPE)
    # ============================================
    update_progress(self, "extracting_pitch_user", 40, "Analyse de ta justesse...")
    user_pitch = do_extract_pitch(user_separation["vocals_path"], f"{session_id}_user")

    update_progress(self, "extracting_pitch_ref", 50, "Analyse de la reference...")
    ref_pitch = do_extract_pitch(str(ref_vocals_path), f"{session_id}_ref")
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
        print(f"[Pipeline] Lyrics found from {lyrics_result.get('source')}")
    else:
        update_progress(self, "lyrics_not_found", 78, "Paroles non trouvees (score neutre)")
        print(f"[Pipeline] Lyrics not found: {lyrics_result.get('status')}")

    # ============================================
    # STEP 6: Calculate scores
    # ============================================
    update_progress(self, "calculating_scores", 80, "Calcul des scores...")

    # ============================================
    # STEP 7: Generate jury feedback (Ollama)
    # ============================================
    update_progress(self, "jury_deliberation", 85, "Le jury se reunit...")

    results = do_generate_feedback(
        session_id=session_id,
        user_pitch_path=user_pitch["pitch_path"],
        reference_pitch_path=ref_pitch["pitch_path"],
        user_lyrics=transcription["text"],
        reference_lyrics=reference_lyrics,
        song_title=song_title,
    )

    update_progress(self, "jury_voting", 95, "Le jury vote...")
    update_progress(self, "completed", 100, "Verdict rendu !")

    return {
        "session_id": session_id,
        "status": "completed",
        "results": results,
    }


@shared_task(bind=True, name="tasks.pipeline.prepare_reference")
def prepare_reference(self, session_id: str, reference_audio_path: str) -> dict:
    """
    Pre-process reference audio (separate vocals, extract pitch).
    Called after YouTube download completes.
    """
    from tasks.audio_separation import do_separate_audio
    from tasks.pitch_analysis import do_extract_pitch

    output_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    self.update_state(state="PROGRESS", meta={"step": "separating", "progress": 30})

    # Separate vocals from reference
    separation_result = do_separate_audio(reference_audio_path, session_id)

    # Rename outputs to reference_*
    vocals_path = Path(separation_result["vocals_path"])
    instrumentals_path = Path(separation_result["instrumentals_path"])

    ref_vocals_path = output_dir / "reference_vocals.wav"
    ref_instrumentals_path = output_dir / "reference_instrumentals.wav"

    if vocals_path.exists():
        vocals_path.rename(ref_vocals_path)
    if instrumentals_path.exists():
        instrumentals_path.rename(ref_instrumentals_path)

    self.update_state(state="PROGRESS", meta={"step": "extracting_pitch", "progress": 70})

    # Extract pitch from reference vocals
    pitch_result = do_extract_pitch(str(ref_vocals_path), session_id)

    # Rename pitch file
    pitch_path = Path(pitch_result["pitch_path"])
    ref_pitch_path = output_dir / "reference_pitch.npz"
    if pitch_path.exists():
        pitch_path.rename(ref_pitch_path)

    return {
        "session_id": session_id,
        "status": "ready",
        "reference_vocals_path": str(ref_vocals_path),
        "reference_instrumentals_path": str(ref_instrumentals_path),
        "reference_pitch_path": str(ref_pitch_path),
    }
