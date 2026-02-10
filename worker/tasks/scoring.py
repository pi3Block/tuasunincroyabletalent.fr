"""
Scoring and jury feedback generation.
Compares user performance with reference and generates AI feedback.

Phase 1 - Scoring Avancé:
- Pitch DTW (Dynamic Time Warping) pour alignement temporel
- Rhythm Onset Detection via librosa
- Lyrics WER (Word Error Rate) via jiwer
"""
import os
import json
from pathlib import Path
from celery import shared_task
import httpx
import numpy as np
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
import librosa
from jiwer import wer


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11435")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:4b")


def do_generate_feedback(
    session_id: str,
    user_pitch_path: str,
    reference_pitch_path: str,
    user_lyrics: str,
    reference_lyrics: str,
    song_title: str,
) -> dict:
    """
    Core logic: Generate final scores and jury feedback.

    Args:
        session_id: Session identifier
        user_pitch_path: Path to user pitch data
        reference_pitch_path: Path to reference pitch data
        user_lyrics: Transcribed user lyrics
        reference_lyrics: Original song lyrics
        song_title: Name of the song

    Returns:
        dict with scores and jury comments
    """
    print(f"[Scoring] Calculating scores for session {session_id}")

    # Load pitch data
    user_pitch = np.load(user_pitch_path)
    reference_pitch = np.load(reference_pitch_path)

    # Calculate pitch accuracy (simplified DTW distance)
    pitch_accuracy = calculate_pitch_accuracy(
        user_pitch["frequency"],
        reference_pitch["frequency"],
    )

    # Calculate rhythm accuracy (based on timing)
    rhythm_accuracy = calculate_rhythm_accuracy(
        user_pitch["time"],
        user_pitch["frequency"],
        reference_pitch["time"],
        reference_pitch["frequency"],
    )

    # Calculate lyrics accuracy (word error rate)
    lyrics_accuracy = calculate_lyrics_accuracy(user_lyrics, reference_lyrics)

    # Overall score
    overall_score = int(
        pitch_accuracy * 0.4 +
        rhythm_accuracy * 0.3 +
        lyrics_accuracy * 0.3
    )

    print(f"[Scoring] Scores: pitch={pitch_accuracy}, rhythm={rhythm_accuracy}, "
          f"lyrics={lyrics_accuracy}, overall={overall_score}")

    # Generate jury comments via Ollama
    jury_comments = generate_jury_comments(
        song_title=song_title,
        overall_score=overall_score,
        pitch_accuracy=pitch_accuracy,
        rhythm_accuracy=rhythm_accuracy,
        lyrics_accuracy=lyrics_accuracy,
    )

    # Save results
    output_dir = Path(user_pitch_path).parent
    results_path = output_dir / "results.json"

    results = {
        "session_id": session_id,
        "score": overall_score,
        "pitch_accuracy": pitch_accuracy,
        "rhythm_accuracy": rhythm_accuracy,
        "lyrics_accuracy": lyrics_accuracy,
        "jury_comments": jury_comments,
    }

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"[Scoring] Results saved to {results_path}")

    return results


@shared_task(bind=True, name="tasks.scoring.generate_feedback")
def generate_feedback(
    self,
    session_id: str,
    user_pitch_path: str,
    reference_pitch_path: str,
    user_lyrics: str,
    reference_lyrics: str,
    song_title: str,
) -> dict:
    """
    Celery task wrapper for feedback generation.
    """
    self.update_state(state="PROGRESS", meta={"step": "calculating_scores"})
    result = do_generate_feedback(
        session_id, user_pitch_path, reference_pitch_path,
        user_lyrics, reference_lyrics, song_title
    )
    return result


def calculate_pitch_accuracy(user_freq: np.ndarray, ref_freq: np.ndarray) -> float:
    """
    Calculate pitch accuracy using Dynamic Time Warping (DTW).

    DTW aligns the two pitch contours temporally, allowing for small
    timing differences while measuring melodic accuracy.

    Args:
        user_freq: User pitch frequencies in Hz (from CREPE)
        ref_freq: Reference pitch frequencies in Hz

    Returns:
        Score 0-100 where 100 = perfect pitch match
    """
    # Filter voiced regions (frequency > 0 means voice detected)
    user_voiced = user_freq[user_freq > 0]
    ref_voiced = ref_freq[ref_freq > 0]

    # Need minimum samples for meaningful comparison
    if len(user_voiced) < 10 or len(ref_voiced) < 10:
        print("[Scoring] Not enough voiced samples for pitch comparison")
        return 50.0

    # Convert to cents (logarithmic scale, semitone = 100 cents)
    # Using A4 = 440Hz as reference
    user_cents = 1200 * np.log2(user_voiced / 440)
    ref_cents = 1200 * np.log2(ref_voiced / 440)

    # DTW alignment - finds optimal path between sequences
    # This handles tempo differences and slight timing variations
    try:
        distance, path = fastdtw(
            user_cents.reshape(-1, 1),
            ref_cents.reshape(-1, 1),
            dist=euclidean
        )
    except Exception as e:
        print(f"[Scoring] DTW error: {e}")
        return 50.0

    # Normalize by path length to get average cents difference
    avg_distance = distance / len(path)

    # Scoring curve:
    # 0 cents diff = 100 points
    # 50 cents diff (quarter tone) = 75 points
    # 100 cents diff (semitone) = 50 points
    # 200 cents diff (whole tone) = 0 points
    score = max(0, 100 - avg_distance / 2)

    print(f"[Scoring] Pitch DTW: avg_distance={avg_distance:.1f} cents, score={score:.1f}")
    return round(score, 1)


def calculate_rhythm_accuracy_from_audio(
    user_audio: np.ndarray,
    ref_audio: np.ndarray,
    sr: int = 16000
) -> float:
    """
    Calculate rhythm accuracy via onset alignment.

    Detects note onsets (attack transients) in both recordings and
    measures how well the user's timing aligns with the reference.

    Args:
        user_audio: User audio waveform (mono)
        ref_audio: Reference audio waveform (mono)
        sr: Sample rate (default 16000Hz)

    Returns:
        Score 0-100 where 100 = perfect timing
    """
    # Ensure mono audio
    if user_audio.ndim > 1:
        user_audio = user_audio.mean(axis=0)
    if ref_audio.ndim > 1:
        ref_audio = ref_audio.mean(axis=0)

    # Detect onsets (note attacks) in both recordings
    try:
        user_onsets = librosa.onset.onset_detect(
            y=user_audio.astype(np.float32),
            sr=sr,
            units='time',
            backtrack=True
        )
        ref_onsets = librosa.onset.onset_detect(
            y=ref_audio.astype(np.float32),
            sr=sr,
            units='time',
            backtrack=True
        )
    except Exception as e:
        print(f"[Scoring] Onset detection error: {e}")
        return 50.0

    if len(user_onsets) == 0 or len(ref_onsets) == 0:
        print("[Scoring] No onsets detected for rhythm analysis")
        return 50.0

    # For each user onset, find closest reference onset
    timing_errors = []
    for user_onset in user_onsets:
        closest_ref = ref_onsets[np.argmin(np.abs(ref_onsets - user_onset))]
        error_ms = abs(user_onset - closest_ref) * 1000  # Convert to ms
        timing_errors.append(error_ms)

    avg_error_ms = np.mean(timing_errors)

    # Scoring curve:
    # 0ms error = 100 points
    # 50ms error = 75 points (tight but acceptable)
    # 100ms error = 50 points (noticeable lag)
    # 200ms error = 0 points (badly off-beat)
    score = max(0, 100 - avg_error_ms / 2)

    print(f"[Scoring] Rhythm: {len(user_onsets)} onsets, "
          f"avg_error={avg_error_ms:.1f}ms, score={score:.1f}")
    return round(score, 1)


def calculate_rhythm_accuracy(
    user_time: np.ndarray,
    user_freq: np.ndarray,
    ref_time: np.ndarray,
    ref_freq: np.ndarray,
) -> float:
    """
    Calculate rhythm accuracy from pitch data (fallback method).

    Uses voiced/unvoiced transitions as proxy for onset detection
    when raw audio is not available.

    Args:
        user_time: User time array
        user_freq: User frequency array
        ref_time: Reference time array
        ref_freq: Reference frequency array

    Returns:
        Score 0-100 where 100 = perfect timing
    """
    # Detect voice onset times (transitions from unvoiced to voiced)
    def get_voice_onsets(freq: np.ndarray, time: np.ndarray) -> np.ndarray:
        voiced = freq > 0
        # Find rising edges (silence -> voice)
        onsets_idx = np.where(np.diff(voiced.astype(int)) == 1)[0]
        if len(onsets_idx) == 0:
            return np.array([])
        return time[onsets_idx + 1]

    user_onsets = get_voice_onsets(user_freq, user_time)
    ref_onsets = get_voice_onsets(ref_freq, ref_time)

    if len(user_onsets) == 0 or len(ref_onsets) == 0:
        print("[Scoring] No voice onsets detected for rhythm analysis")
        return 50.0

    # Match user onsets to closest reference onsets
    timing_errors = []
    for user_onset in user_onsets:
        closest_ref = ref_onsets[np.argmin(np.abs(ref_onsets - user_onset))]
        error_ms = abs(user_onset - closest_ref) * 1000
        timing_errors.append(error_ms)

    avg_error_ms = np.mean(timing_errors)

    # Same scoring curve as audio-based method
    score = max(0, 100 - avg_error_ms / 2)

    print(f"[Scoring] Rhythm (pitch-based): {len(user_onsets)} onsets, "
          f"avg_error={avg_error_ms:.1f}ms, score={score:.1f}")
    return round(score, 1)


def calculate_lyrics_accuracy(user_lyrics: str, ref_lyrics: str) -> float:
    """
    Calculate lyrics accuracy using Word Error Rate (WER).

    WER measures the minimum edit distance between transcriptions,
    accounting for insertions, deletions, and substitutions.

    Args:
        user_lyrics: Transcribed user lyrics (from Whisper)
        ref_lyrics: Reference lyrics (from Genius API or manual)

    Returns:
        Score 0-100 where 100 = perfect lyrics match
    """
    # Normalize text
    user_clean = user_lyrics.lower().strip()
    ref_clean = ref_lyrics.lower().strip()

    # Handle missing reference lyrics
    if not ref_clean:
        print("[Scoring] No reference lyrics available, using neutral score")
        return 50.0

    # Handle empty user transcription
    if not user_clean:
        print("[Scoring] No user lyrics detected")
        return 0.0

    # Calculate Word Error Rate
    # WER = (Substitutions + Insertions + Deletions) / Reference Words
    try:
        error_rate = wer(ref_clean, user_clean)
    except Exception as e:
        print(f"[Scoring] WER calculation error: {e}")
        # Fallback to simple word overlap
        return _calculate_lyrics_overlap(user_clean, ref_clean)

    # Convert WER to score (0-100)
    # WER of 0 = 100 points (perfect)
    # WER of 0.5 = 50 points (half wrong)
    # WER of 1+ = 0 points (completely wrong)
    score = max(0, (1 - error_rate) * 100)

    print(f"[Scoring] Lyrics WER: {error_rate:.2f}, score={score:.1f}")
    return round(score, 1)


def _calculate_lyrics_overlap(user_lyrics: str, ref_lyrics: str) -> float:
    """Fallback: simple word overlap calculation."""
    user_words = set(user_lyrics.split())
    ref_words = set(ref_lyrics.split())

    if not ref_words:
        return 50.0

    overlap = len(user_words & ref_words)
    accuracy = (overlap / len(ref_words)) * 100

    return round(min(100, accuracy), 1)


def generate_jury_comments(
    song_title: str,
    overall_score: int,
    pitch_accuracy: float,
    rhythm_accuracy: float,
    lyrics_accuracy: float,
) -> list[dict]:
    """Generate jury AI comments using Ollama."""

    personas = [
        {
            "name": "Le Cassant",
            "style": "impitoyable mais juste, utilise des métaphores drôles et cinglantes",
        },
        {
            "name": "L'Encourageant",
            "style": "bienveillant, trouve toujours du positif même dans les pires performances",
        },
        {
            "name": "Le Technique",
            "style": "précis et analytique, parle de technique vocale",
        },
    ]

    # Determine main issues
    issues = []
    strengths = []

    if pitch_accuracy < 60:
        issues.append("Justesse (faux)")
    elif pitch_accuracy > 80:
        strengths.append("Justesse")

    if rhythm_accuracy < 60:
        issues.append("Rythme (décalé)")
    elif rhythm_accuracy > 80:
        strengths.append("Rythme")

    if lyrics_accuracy < 60:
        issues.append("Paroles (oubliées)")
    elif lyrics_accuracy > 80:
        strengths.append("Connaissance des paroles")

    comments = []

    for persona in personas:
        prompt = f"""Tu es "{persona['name']}", un jury d'un concours de chant type "Incroyable Talent".
Style: {persona['style']}

CONTEXTE:
- Chanson: "{song_title}"
- Score global: {overall_score}/100
- Justesse: {pitch_accuracy}%
- Rythme: {rhythm_accuracy}%
- Paroles: {lyrics_accuracy}%
- Problèmes: {', '.join(issues) if issues else 'Aucun majeur'}
- Points forts: {', '.join(strengths) if strengths else 'À développer'}

TÂCHE: Écris UN commentaire de 2-3 phrases pour le candidat. Sois fidèle à ton personnage.
Réponds UNIQUEMENT avec le commentaire, sans préfixe."""

        try:
            response = httpx.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.8,
                        "top_p": 0.9,
                    },
                },
                timeout=30.0,
            )
            response.raise_for_status()
            comment = response.json().get("response", "").strip()
        except Exception as e:
            comment = f"[Erreur génération: {e}]"

        # Determine vote based on score and persona
        if persona["name"] == "Le Cassant":
            vote = "yes" if overall_score >= 70 else "no"
        elif persona["name"] == "L'Encourageant":
            vote = "yes" if overall_score >= 40 else "no"
        else:
            vote = "yes" if overall_score >= 55 else "no"

        comments.append({
            "persona": persona["name"],
            "comment": comment,
            "vote": vote,
        })

    return comments
