"""
Scoring and jury feedback generation.
Compares user performance with reference and generates AI feedback.

Phase 1 - Scoring Avancé:
- Pitch DTW (Dynamic Time Warping) pour alignement temporel
- Rhythm Onset Detection via librosa
- Lyrics WER (Word Error Rate) via jiwer

Improvements (2026-02-11):
- Parallel jury generation (asyncio.gather, 3x faster)
- Langfuse tracing for all LLM calls
- Structured logging (logging module)

Improvements (2026-02-25):
- LLM via LiteLLM proxy → Groq qwen3-32b (free, 32B params, best French)
- Fallback chain: LiteLLM/Groq → Ollama local → heuristic
- Removed litellm SDK import (heavy, synchronous) — pure httpx async
"""
import os
import re
import asyncio
import json
import time
import logging
from pathlib import Path
from celery import shared_task
import httpx
import numpy as np
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
from jiwer import wer

from .tracing import trace_jury_comment, TracingSpan

logger = logging.getLogger(__name__)

LITELLM_HOST = os.getenv("LITELLM_HOST", "http://host.docker.internal:4000")
LITELLM_API_KEY = os.getenv("LITELLM_API_KEY", "")
LITELLM_JURY_MODEL = os.getenv("LITELLM_JURY_MODEL", "jury-comment")
LITELLM_JURY_FALLBACK_MODEL = os.getenv("LITELLM_JURY_FALLBACK_MODEL", "jury-comment-fallback")


def do_generate_feedback(
    session_id: str,
    user_pitch_path: str,
    reference_pitch_path: str,
    user_lyrics: str,
    reference_lyrics: str,
    song_title: str,
    pipeline_span: TracingSpan = None,
    offset_seconds: float = 0.0,
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
        pipeline_span: Optional Langfuse pipeline trace for child spans
        offset_seconds: Auto-detected temporal offset (from cross-correlation)

    Returns:
        dict with scores and jury comments
    """
    logger.info("Calculating scores for session %s (offset=%.3fs)", session_id, offset_seconds)

    # Load pitch data with validation
    for path in [user_pitch_path, reference_pitch_path]:
        if not Path(path).exists():
            raise FileNotFoundError(f"Pitch data not found: {path}")
    user_pitch = np.load(user_pitch_path)
    reference_pitch = np.load(reference_pitch_path)

    # Diagnostic logging + user-facing warnings
    u_freq = user_pitch["frequency"]
    r_freq = reference_pitch["frequency"]
    u_voiced = int(np.sum(u_freq > 0))
    r_voiced = int(np.sum(r_freq > 0))
    user_duration_s = len(u_freq) * 0.01  # 10ms hop
    ref_duration_s = len(r_freq) * 0.01
    logger.info(
        "Scoring inputs: user_freq=%d samples (%d voiced, %.1fs), "
        "ref_freq=%d samples (%d voiced, %.1fs), "
        "user_lyrics=%d chars, ref_lyrics=%d chars",
        len(u_freq), u_voiced, user_duration_s,
        len(r_freq), r_voiced, ref_duration_s,
        len(user_lyrics), len(reference_lyrics),
    )

    # Collect warnings to surface to the user
    warnings = []
    if u_voiced == 0:
        warnings.append("Aucune voix détectée dans ton enregistrement. "
                         "Vérifie que ton micro fonctionne et chante plus fort !")
    elif u_voiced < 10:
        warnings.append(f"Très peu de voix détectée ({u_voiced} échantillons). "
                         "Essaie de chanter plus fort ou plus près du micro.")
    if user_duration_s < 15:
        warnings.append(f"Enregistrement très court ({user_duration_s:.0f}s). "
                         "Essaie de chanter au moins 30 secondes pour un score fiable.")
    if not reference_lyrics.strip():
        warnings.append("Paroles de référence non trouvées pour cette chanson. "
                         "Le score paroles n'a pas pu être calculé.")

    # Calculate pitch accuracy (simplified DTW distance)
    pitch_accuracy = calculate_pitch_accuracy(
        user_pitch["frequency"],
        reference_pitch["frequency"],
        user_time=user_pitch["time"],
        ref_time=reference_pitch["time"],
        offset_seconds=offset_seconds,
    )

    # Calculate rhythm accuracy (based on timing)
    rhythm_accuracy = calculate_rhythm_accuracy(
        user_pitch["time"],
        user_pitch["frequency"],
        reference_pitch["time"],
        reference_pitch["frequency"],
        offset_seconds=offset_seconds,
    )

    # Calculate lyrics accuracy (word error rate)
    lyrics_accuracy = calculate_lyrics_accuracy(user_lyrics, reference_lyrics)

    # Overall score
    overall_score = int(
        pitch_accuracy * 0.4 +
        rhythm_accuracy * 0.3 +
        lyrics_accuracy * 0.3
    )

    logger.info(
        "Scores: pitch=%.1f, rhythm=%.1f, lyrics=%.1f, overall=%d, warnings=%d",
        pitch_accuracy, rhythm_accuracy, lyrics_accuracy, overall_score,
        len(warnings),
    )

    # Generate jury comments via Ollama (parallel, with fallback)
    jury_comments = generate_jury_comments(
        song_title=song_title,
        overall_score=overall_score,
        pitch_accuracy=pitch_accuracy,
        rhythm_accuracy=rhythm_accuracy,
        lyrics_accuracy=lyrics_accuracy,
        pipeline_span=pipeline_span,
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
        "warnings": warnings,
    }

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    logger.info("Results saved to %s", results_path)

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


def _apply_time_offset(
    user_freq: np.ndarray,
    ref_freq: np.ndarray,
    user_time: np.ndarray,
    ref_time: np.ndarray,
    offset_seconds: float,
) -> tuple:
    """
    Align user and reference frequency arrays by applying a temporal offset.

    Shifts the user time axis by offset_seconds and trims both arrays
    to the overlapping time region.

    Returns:
        Tuple of (aligned_user_freq, aligned_ref_freq)
    """
    if len(user_time) == 0 or len(ref_time) == 0:
        return user_freq, ref_freq

    shifted_user_time = user_time - offset_seconds

    # Find overlapping time region
    overlap_start = max(shifted_user_time[0], ref_time[0])
    overlap_end = min(shifted_user_time[-1], ref_time[-1])

    if overlap_start >= overlap_end:
        logger.warning("No time overlap after offset, returning original arrays")
        return user_freq, ref_freq

    # Trim to overlapping region
    user_mask = (shifted_user_time >= overlap_start) & (shifted_user_time <= overlap_end)
    ref_mask = (ref_time >= overlap_start) & (ref_time <= overlap_end)

    trimmed_user = user_freq[user_mask]
    trimmed_ref = ref_freq[ref_mask]

    if len(trimmed_user) < 10 or len(trimmed_ref) < 10:
        logger.warning("Too few samples after offset trimming, returning original arrays")
        return user_freq, ref_freq

    return trimmed_user, trimmed_ref


def calculate_pitch_accuracy(
    user_freq: np.ndarray,
    ref_freq: np.ndarray,
    user_time: np.ndarray = None,
    ref_time: np.ndarray = None,
    offset_seconds: float = 0.0,
) -> float:
    """
    Calculate pitch accuracy using Dynamic Time Warping (DTW).

    DTW aligns the two pitch contours temporally, allowing for small
    timing differences while measuring melodic accuracy.

    Args:
        user_freq: User pitch frequencies in Hz (from CREPE)
        ref_freq: Reference pitch frequencies in Hz
        user_time: User time array (optional, for offset alignment)
        ref_time: Reference time array (optional, for offset alignment)
        offset_seconds: Temporal offset to apply to user time axis

    Returns:
        Score 0-100 where 100 = perfect pitch match
    """
    # Apply temporal offset: trim user/ref to overlapping region
    if offset_seconds != 0.0 and user_time is not None and ref_time is not None:
        user_freq, ref_freq = _apply_time_offset(
            user_freq, ref_freq, user_time, ref_time, offset_seconds,
        )

    # Filter voiced regions (frequency > 0 means voice detected)
    user_voiced = user_freq[user_freq > 0]
    ref_voiced = ref_freq[ref_freq > 0]

    # Need minimum samples for meaningful comparison
    if len(user_voiced) < 10 or len(ref_voiced) < 10:
        logger.warning(
            "PITCH FALLBACK 50: not enough voiced samples "
            "(user=%d, ref=%d, need >=10 each)",
            len(user_voiced), len(ref_voiced),
        )
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
        logger.warning(
            "PITCH FALLBACK 50: DTW error: %s "
            "(user_cents=%d, ref_cents=%d)",
            e, len(user_cents), len(ref_cents),
        )
        return 50.0

    # Normalize by path length to get average cents difference
    avg_distance = distance / len(path)

    # Scoring curve:
    # 0 cents diff = 100 points
    # 50 cents diff (quarter tone) = 75 points
    # 100 cents diff (semitone) = 50 points
    # 200 cents diff (whole tone) = 0 points
    score = max(0, 100 - avg_distance / 2)

    logger.debug("Pitch DTW: avg_distance=%.1f cents, score=%.1f", avg_distance, score)
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
    import librosa

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
        logger.warning("Onset detection error: %s", e)
        return 50.0

    if len(user_onsets) == 0 or len(ref_onsets) == 0:
        logger.debug("No onsets detected for rhythm analysis")
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

    logger.debug(
        "Rhythm: %d onsets, avg_error=%.1fms, score=%.1f",
        len(user_onsets), avg_error_ms, score,
    )
    return round(score, 1)


def calculate_rhythm_accuracy(
    user_time: np.ndarray,
    user_freq: np.ndarray,
    ref_time: np.ndarray,
    ref_freq: np.ndarray,
    offset_seconds: float = 0.0,
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
        offset_seconds: Temporal offset to apply to user onsets

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

    # Apply temporal offset to user onsets
    if offset_seconds != 0.0 and len(user_onsets) > 0:
        user_onsets = user_onsets - offset_seconds

    if len(user_onsets) == 0 or len(ref_onsets) == 0:
        logger.warning(
            "RHYTHM FALLBACK 50: no voice onsets "
            "(user=%d, ref=%d)",
            len(user_onsets), len(ref_onsets),
        )
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

    logger.debug(
        "Rhythm (pitch-based): %d onsets, avg_error=%.1fms, score=%.1f",
        len(user_onsets), avg_error_ms, score,
    )
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
        logger.warning(
            "LYRICS FALLBACK 50: no reference lyrics available "
            "(user_lyrics=%d chars)",
            len(user_clean),
        )
        return 50.0

    # Handle empty user transcription
    if not user_clean:
        logger.debug("No user lyrics detected")
        return 0.0

    # Calculate Word Error Rate
    # WER = (Substitutions + Insertions + Deletions) / Reference Words
    try:
        error_rate = wer(ref_clean, user_clean)
    except Exception as e:
        logger.warning("WER calculation error: %s", e)
        # Fallback to simple word overlap
        return _calculate_lyrics_overlap(user_clean, ref_clean)

    # Convert WER to score (0-100)
    # WER of 0 = 100 points (perfect)
    # WER of 0.5 = 50 points (half wrong)
    # WER of 1+ = 0 points (completely wrong)
    score = max(0, (1 - error_rate) * 100)

    logger.debug("Lyrics WER: %.2f, score=%.1f", error_rate, score)
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


# =============================================================================
# JURY GENERATION — PARALLEL + FALLBACK + TRACING
# =============================================================================

JURY_PERSONAS = [
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


def _build_jury_prompt(
    persona: dict,
    song_title: str,
    overall_score: int,
    pitch_accuracy: float,
    rhythm_accuracy: float,
    lyrics_accuracy: float,
) -> str:
    """Build the LLM prompt for a jury persona."""
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

    return f"""Tu es "{persona['name']}", un jury d'un concours de chant type "Incroyable Talent".
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
Réponds UNIQUEMENT avec le commentaire, sans préfixe, sans balises.
/no_think"""


def _get_vote(persona_name: str, overall_score: int) -> str:
    """Determine vote based on score and persona personality."""
    if persona_name == "Le Cassant":
        return "yes" if overall_score >= 70 else "no"
    elif persona_name == "L'Encourageant":
        return "yes" if overall_score >= 40 else "no"
    else:
        return "yes" if overall_score >= 55 else "no"


def _heuristic_comment(persona_name: str, overall_score: int) -> str:
    """Generate a heuristic comment when all LLM providers fail."""
    if persona_name == "Le Cassant":
        if overall_score >= 70:
            return "Pas mal du tout ! Tu as du potentiel, mais ne te repose pas sur tes lauriers."
        return "Il y a du travail... Beaucoup de travail. Mais au moins tu as eu le courage de monter sur scène."
    elif persona_name == "L'Encourageant":
        if overall_score >= 50:
            return "Bravo pour cette prestation ! On sent que tu y as mis du cœur, continue comme ça !"
        return "L'important c'est de participer ! Tu as osé et c'est déjà une victoire. Continue à travailler !"
    else:
        if overall_score >= 60:
            return "Techniquement, il y a de bonnes bases. Travaille la justesse et le placement pour progresser."
        return "Quelques points techniques à revoir : la justesse et le rythme nécessitent plus de travail."


async def _litellm_call(
    client: httpx.AsyncClient,
    model: str,
    prompt: str,
    max_retries: int = 2,
) -> tuple[str, str]:
    """
    Call LiteLLM proxy with retries. Returns (comment, model_used) or ("", "") on failure.
    """
    if not LITELLM_API_KEY:
        return "", ""

    headers = {
        "Authorization": f"Bearer {LITELLM_API_KEY}",
        "Content-Type": "application/json",
    }
    for attempt in range(max_retries + 1):
        try:
            response = await client.post(
                f"{LITELLM_HOST}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 500,
                    "temperature": 0.8,
                },
                timeout=15.0,
            )
            response.raise_for_status()
            data = response.json()
            comment = data["choices"][0]["message"]["content"].strip()
            # Strip Qwen3 thinking blocks (<think>...</think>)
            # Also handle unclosed <think> (truncated by max_tokens)
            comment = re.sub(
                r"<think>[\s\S]*?</think>", "", comment,
            ).strip()
            comment = re.sub(r"<think>[\s\S]*", "", comment).strip()
            actual_model = data.get("model", model)
            if not comment:
                raise ValueError("Empty response from LiteLLM")
            return comment, f"litellm/{actual_model}"
        except Exception as e:
            if attempt < max_retries:
                wait = 1.0 * (2 ** attempt)
                logger.info(
                    "LiteLLM %s attempt %d/%d failed: %s — retrying in %.0fs",
                    model, attempt + 1, max_retries + 1, e, wait,
                )
                await asyncio.sleep(wait)
            else:
                logger.warning("LiteLLM %s failed after %d attempts: %s", model, max_retries + 1, e)
    return "", ""


async def _generate_comment_async(
    client: httpx.AsyncClient,
    persona: dict,
    prompt: str,
    overall_score: int,
    pipeline_span: TracingSpan = None,
) -> dict:
    """
    Generate a single jury comment with 3-tier fallback (all via LiteLLM, zero local GPU):
      Tier 1: LiteLLM → Groq qwen3-32b (free, 32B, best French)
      Tier 2: LiteLLM → qwen3-8b fallback (configurable via LITELLM_JURY_FALLBACK_MODEL)
      Tier 3: Heuristic (hardcoded persona-based comments)
    """
    start = time.time()
    model_used = LITELLM_JURY_MODEL
    comment = ""

    with trace_jury_comment(
        pipeline_span or TracingSpan(),
        persona_name=persona["name"],
        model=LITELLM_JURY_MODEL,
        prompt=prompt,
    ) as gen:
        # ── Tier 1: LiteLLM → Groq qwen3-32b ──
        comment, model_used = await _litellm_call(client, LITELLM_JURY_MODEL, prompt)

        # ── Tier 2: LiteLLM → fallback model (qwen3-8b or configured) ──
        if not comment and LITELLM_JURY_FALLBACK_MODEL != LITELLM_JURY_MODEL:
            logger.info("Tier 1 failed for %s, trying fallback model %s", persona["name"], LITELLM_JURY_FALLBACK_MODEL)
            comment, model_used = await _litellm_call(client, LITELLM_JURY_FALLBACK_MODEL, prompt, max_retries=1)

        # ── Tier 3: Heuristic (no API, always works) ──
        if not comment:
            comment = _heuristic_comment(persona["name"], overall_score)
            model_used = "heuristic"

        latency_ms = (time.time() - start) * 1000

        gen.update(
            output=comment,
            model=model_used,
            metadata={
                "persona": persona["name"],
                "latency_ms": round(latency_ms),
            },
        )

    vote = _get_vote(persona["name"], overall_score)

    logger.debug(
        "Jury %s: model=%s, latency=%.0fms, vote=%s",
        persona["name"], model_used, latency_ms, vote,
    )

    return {
        "persona": persona["name"],
        "comment": comment,
        "vote": vote,
        "model": model_used,
        "latency_ms": round(latency_ms),
    }


async def _generate_all_comments_async(
    song_title: str,
    overall_score: int,
    pitch_accuracy: float,
    rhythm_accuracy: float,
    lyrics_accuracy: float,
    pipeline_span: TracingSpan = None,
) -> list[dict]:
    """Run all 3 jury LLM calls in parallel."""
    async with httpx.AsyncClient() as client:
        tasks = []
        for persona in JURY_PERSONAS:
            prompt = _build_jury_prompt(
                persona, song_title, overall_score,
                pitch_accuracy, rhythm_accuracy, lyrics_accuracy,
            )
            tasks.append(
                _generate_comment_async(
                    client, persona, prompt, overall_score, pipeline_span,
                )
            )
        return await asyncio.gather(*tasks)


def _cleanup_clients():
    """Called by celery_app on worker shutdown."""
    pass  # httpx.AsyncClient is context-managed, no persistent client to close


def generate_jury_comments(
    song_title: str,
    overall_score: int,
    pitch_accuracy: float,
    rhythm_accuracy: float,
    lyrics_accuracy: float,
    pipeline_span: TracingSpan = None,
) -> list[dict]:
    """
    Generate jury AI comments (parallel, 3-tier zero-cost fallback, no local GPU).

    Runs 3 persona LLM calls concurrently via asyncio.gather.
    Each call: LiteLLM/Groq qwen3-32b → LiteLLM/qwen3-8b → heuristic.
    """
    start = time.time()

    comments = asyncio.run(
        _generate_all_comments_async(
            song_title, overall_score,
            pitch_accuracy, rhythm_accuracy, lyrics_accuracy,
            pipeline_span,
        )
    )

    total_ms = (time.time() - start) * 1000
    models_used = set(c.get("model", "unknown") for c in comments)
    logger.info(
        "Jury generation complete: %d comments, %.0fms total, models=%s",
        len(comments), total_ms, models_used,
    )

    return comments
