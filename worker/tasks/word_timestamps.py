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
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Protocol
from celery import shared_task

logger = logging.getLogger(__name__)

SHARED_WHISPER_URL = os.getenv("SHARED_WHISPER_URL", "http://shared-whisper:9000")
SHARED_WHISPER_TIMEOUT = int(os.getenv("SHARED_WHISPER_TIMEOUT", "120"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
KARAOKE_ALIGNMENT_ENGINE = os.getenv("KARAOKE_ALIGNMENT_ENGINE", "auto").strip().lower()
KARAOKE_ALIGNMENT_LICENSE_MODE = os.getenv("KARAOKE_ALIGNMENT_LICENSE_MODE", "non_commercial").strip().lower()
KARAOKE_ALIGNMENT_ENGINE_VERSION = os.getenv("KARAOKE_ALIGNMENT_ENGINE_VERSION", "v2-p0")
CTC_ALIGN_DEVICE = os.getenv("CTC_ALIGN_DEVICE", "cpu")
KARAOKE_REGROUP_TOLERANCE_MS = int(os.getenv("KARAOKE_REGROUP_TOLERANCE_MS", "500"))
KARAOKE_SYNCED_REGROUP_MAX_SKIPPED_RATIO = float(os.getenv("KARAOKE_SYNCED_REGROUP_MAX_SKIPPED_RATIO", "0.20"))
KARAOKE_CTC_MIN_CONFIDENCE_AVG = float(os.getenv("KARAOKE_CTC_MIN_CONFIDENCE_AVG", "0.45"))
KARAOKE_CTC_LOW_CONF_THRESHOLD = float(os.getenv("KARAOKE_CTC_LOW_CONF_THRESHOLD", "0.30"))
KARAOKE_CTC_MAX_LOW_CONF_RATIO = float(os.getenv("KARAOKE_CTC_MAX_LOW_CONF_RATIO", "0.35"))
KARAOKE_ONSET_REFINE = os.getenv("KARAOKE_ONSET_REFINE", "false").strip().lower() == "true"
KARAOKE_ONSET_SNAP_THRESHOLD_MS = int(os.getenv("KARAOKE_ONSET_SNAP_THRESHOLD_MS", "80"))

# Words to filter out (Whisper hallucinations)
HALLUCINATION_WORDS = {
    '...', '..', '.', '♪', '♫', '[Musique]', '[Music]',
    '[Applause]', '(musique)', '*', '(Musique)', '',
}

LANG_TO_ISO3 = {
    "fr": "fra",
    "en": "eng",
    "es": "spa",
    "de": "deu",
    "it": "ita",
    "pt": "por",
}

_ctc_model = None
_ctc_tokenizer = None
_torchaudio_fa_model = None
_torchaudio_fa_tokenizer = None
_torchaudio_fa_aligner = None


class AlignmentEngine(Protocol):
    """Abstraction layer for alignment engines."""
    name: str

    def align(
        self,
        vocals_path: str,
        language: str,
        lyrics_text: str | None = None,
        synced_lines: list[dict] | None = None,
    ) -> dict:
        """Return normalized alignment payload with words/lines/confidence fields."""


def _normalize_word(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = "".join(ch for ch in ascii_text.lower() if ch.isalnum() or ch == "'")
    return cleaned.strip("'")


def _tokenize_line_text(line: dict) -> list[str]:
    raw = (line.get("text") or line.get("words") or "").strip()
    return [tok for tok in (_normalize_word(t) for t in raw.split()) if tok]


def _build_line(words: list[dict]) -> dict:
    return {
        "startMs": words[0]["startMs"],
        "endMs": words[-1]["endMs"],
        "words": words,
        "text": " ".join(w["word"] for w in words),
    }


def _build_lines_from_words(words: list[dict], line_gap_threshold_ms: int = 1500) -> list[dict]:
    if not words:
        return []

    lines: list[dict] = []
    current: list[dict] = [words[0]]
    for word in words[1:]:
        if word["startMs"] - current[-1]["endMs"] > line_gap_threshold_ms:
            lines.append(_build_line(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(_build_line(current))
    return lines


def _get_ctc_align_model():
    global _ctc_model, _ctc_tokenizer
    if _ctc_model is not None and _ctc_tokenizer is not None:
        return _ctc_model, _ctc_tokenizer

    import torch
    from ctc_forced_aligner import load_alignment_model

    device = CTC_ALIGN_DEVICE
    if "cuda" in device and not torch.cuda.is_available():
        logger.warning("CTC_ALIGN_DEVICE=%s but CUDA unavailable, falling back to CPU", device)
        device = "cpu"

    dtype = torch.float16 if "cuda" in device else torch.float32
    _ctc_model, _ctc_tokenizer = load_alignment_model(device, dtype=dtype)
    logger.info("CTC aligner loaded on %s (dtype=%s)", device, dtype)
    return _ctc_model, _ctc_tokenizer


def _get_torchaudio_fa_model():
    """Lazy-load torchaudio MMS_FA forced alignment model (licence-compatible)."""
    global _torchaudio_fa_model, _torchaudio_fa_tokenizer, _torchaudio_fa_aligner
    if _torchaudio_fa_model is not None:
        return _torchaudio_fa_model, _torchaudio_fa_tokenizer, _torchaudio_fa_aligner

    import torch
    import torchaudio

    bundle = torchaudio.pipelines.MMS_FA

    device = CTC_ALIGN_DEVICE
    if "cuda" in device and not torch.cuda.is_available():
        logger.warning("CTC_ALIGN_DEVICE=%s but CUDA unavailable, using CPU", device)
        device = "cpu"

    _torchaudio_fa_model = bundle.get_model().to(device)
    _torchaudio_fa_tokenizer = bundle.get_tokenizer()
    _torchaudio_fa_aligner = bundle.get_aligner()
    logger.info("Torchaudio MMS_FA model loaded on %s", device)
    return _torchaudio_fa_model, _torchaudio_fa_tokenizer, _torchaudio_fa_aligner


def _extract_ctc_word_results(
    word_results: list[dict],
    audio_duration_ms: int | None,
) -> tuple[list[dict], float]:
    words: list[dict] = []
    total_confidence = 0.0

    for wr in word_results:
        raw_word = str(wr.get("text", "")).strip()
        if not raw_word or raw_word in HALLUCINATION_WORDS:
            continue

        # ctc-forced-aligner output fields are expected as start/end in seconds.
        # _to_ms guards against unexpected units.
        start_ms, end_ms = _to_ms(wr.get("start"), wr.get("end"), audio_duration_ms)
        if end_ms < start_ms:
            continue

        confidence = float(wr.get("score", 0.9))
        word = {
            "word": raw_word,
            "startMs": start_ms,
            "endMs": end_ms,
            "confidence": round(confidence, 3),
        }
        words.append(word)
        total_confidence += word["confidence"]

    confidence_avg = (total_confidence / len(words)) if words else 0.0
    return words, confidence_avg


def _regroup_words_by_synced_lines(
    words: list[dict],
    synced_lines: list[dict] | None,
    tolerance_ms: int,
) -> tuple[list[dict], int, float]:
    """
    Re-group words using synced lyrics with a hybrid strategy:
    - primary: temporal window match
    - secondary: text token match (normalized)
    Never drops words silently; unmatched words are appended as extra lines.
    """
    if not words:
        return [], 0, 0.0
    if not synced_lines:
        return _build_lines_from_words(words), 0, 0.0

    buckets: list[list[dict]] = [[] for _ in synced_lines]
    line_tokens: list[list[str]] = [_tokenize_line_text(line) for line in synced_lines]
    line_token_sets = [set(tokens) for tokens in line_tokens]
    word_assignment: list[int | None] = [None] * len(words)
    prev_assigned_idx = 0

    for idx, word in enumerate(words):
        word_start = int(word.get("startMs", 0))
        normalized_word = _normalize_word(word.get("word", ""))

        temporal_candidates: list[int] = []
        for line_idx, sline in enumerate(synced_lines):
            line_start = int(sline.get("startMs", 0))
            line_end = int(sline.get("endMs", line_start + 10_000))
            if line_start - tolerance_ms <= word_start <= line_end + tolerance_ms:
                temporal_candidates.append(line_idx)

        chosen_idx: int | None = None
        if temporal_candidates:
            chosen_idx = min(
                temporal_candidates,
                key=lambda i: abs(i - prev_assigned_idx),
            )
        elif normalized_word:
            fuzzy_candidates: list[tuple[int, float]] = []
            for line_idx, token_set in enumerate(line_token_sets):
                if not token_set:
                    continue
                if normalized_word in token_set:
                    fuzzy_candidates.append((line_idx, 1.0))
                    continue
                similarity = max(
                    (SequenceMatcher(None, normalized_word, tok).ratio() for tok in token_set),
                    default=0.0,
                )
                if similarity >= 0.90:
                    fuzzy_candidates.append((line_idx, similarity))
            if fuzzy_candidates:
                chosen_idx = max(
                    fuzzy_candidates,
                    key=lambda pair: (pair[1], -abs(pair[0] - prev_assigned_idx)),
                )[0]

        if chosen_idx is not None:
            buckets[chosen_idx].append(word)
            word_assignment[idx] = chosen_idx
            prev_assigned_idx = chosen_idx

    missing_words = [words[i] for i, assigned in enumerate(word_assignment) if assigned is None]
    skipped_words = len(missing_words)
    skipped_ratio = skipped_words / len(words) if words else 0.0

    lines: list[dict] = []
    for bucket in buckets:
        if bucket:
            lines.append(_build_line(bucket))

    if missing_words:
        lines.extend(_build_lines_from_words(missing_words))

    return lines, skipped_words, skipped_ratio


def _get_audio_duration_ms(vocals_path: str) -> int | None:
    try:
        import soundfile as sf

        info = sf.info(vocals_path)
        if info.frames > 0 and info.samplerate > 0:
            return int((info.frames / info.samplerate) * 1000)
    except Exception as exc:
        logger.warning("Failed to inspect audio duration for %s: %s", vocals_path, exc)
    return None


def _to_ms(
    raw_start: float | int | None,
    raw_end: float | int | None,
    audio_duration_ms: int | None,
) -> tuple[int, int]:
    if raw_start is None or raw_end is None:
        raise ValueError("Missing start/end timing")

    start_f = float(raw_start)
    end_f = float(raw_end)
    if end_f < start_f:
        raise ValueError(f"Invalid timing range: start={start_f}, end={end_f}")

    # Explicit unit contract:
    # - canonical for ASR/forced align APIs: seconds float
    # - allow ms ints as compatibility fallback
    if audio_duration_ms is not None:
        max_secs = (audio_duration_ms / 1000.0) + 120.0
        max_ms = audio_duration_ms + 120_000
        if start_f <= max_secs and end_f <= max_secs:
            return int(start_f * 1000), int(end_f * 1000)
        if start_f <= max_ms and end_f <= max_ms:
            return int(start_f), int(end_f)
        raise ValueError(
            f"Unrecognized timing units: start={start_f}, end={end_f}, "
            f"audio_duration_ms={audio_duration_ms}"
        )

    # Conservative fallback when audio duration is unknown.
    if end_f <= 24 * 3600:
        return int(start_f * 1000), int(end_f * 1000)
    return int(start_f), int(end_f)


def _normalize_words_timing(
    words: list[dict],
    audio_duration_ms: int | None,
) -> list[dict]:
    normalized: list[dict] = []
    for word in words:
        if "startMs" in word and "endMs" in word:
            start_ms = int(word["startMs"])
            end_ms = int(word["endMs"])
        else:
            start_ms, end_ms = _to_ms(word.get("start"), word.get("end"), audio_duration_ms)
        normalized.append({**word, "startMs": start_ms, "endMs": end_ms})
    return normalized


def _validate_alignment_integrity(
    words: list[dict],
    audio_duration_ms: int | None,
) -> tuple[bool, str]:
    if not words:
        return False, "empty_words"

    prev_start = -1
    max_allowed_end = (audio_duration_ms + 5000) if audio_duration_ms is not None else None
    for idx, word in enumerate(words):
        start_ms = int(word.get("startMs", -1))
        end_ms = int(word.get("endMs", -1))
        if start_ms < 0 or end_ms < 0:
            return False, f"negative_timing_at_idx_{idx}"
        if end_ms < start_ms:
            return False, f"end_before_start_at_idx_{idx}"
        if start_ms < prev_start:
            return False, f"non_monotonic_start_at_idx_{idx}"
        if max_allowed_end is not None and end_ms > max_allowed_end:
            return False, f"end_exceeds_audio_duration_at_idx_{idx}"
        prev_start = start_ms
    return True, ""


def _compute_quality_metrics(result: dict) -> tuple[float, float]:
    words = result.get("words", [])
    if not words:
        return 0.0, 1.0
    confs = [float(w.get("confidence", 0.0)) for w in words]
    confidence_avg = sum(confs) / len(confs)
    low_conf_ratio = sum(1 for c in confs if c < KARAOKE_CTC_LOW_CONF_THRESHOLD) / len(confs)
    return confidence_avg, low_conf_ratio


def _passes_quality_gate(result: dict) -> tuple[bool, str]:
    confidence_avg, low_conf_ratio = _compute_quality_metrics(result)
    if confidence_avg < KARAOKE_CTC_MIN_CONFIDENCE_AVG:
        return False, f"confidence_avg_below_threshold:{confidence_avg:.3f}"
    if low_conf_ratio > KARAOKE_CTC_MAX_LOW_CONF_RATIO:
        return False, f"low_conf_ratio_above_threshold:{low_conf_ratio:.3f}"
    return True, ""


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


def _extract_words_and_lines(
    data: dict,
    lyrics_text: str | None = None,
    audio_duration_ms: int | None = None,
) -> dict:
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

            start_ms, end_ms = _to_ms(
                word_info.get("start", 0),
                word_info.get("end", 0),
                audio_duration_ms,
            )
            word_data = {
                "word": word_text,
                "startMs": start_ms,
                "endMs": end_ms,
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


class SharedWhisperAlignmentEngine:
    name = "shared_whisper"

    def align(
        self,
        vocals_path: str,
        language: str,
        lyrics_text: str | None = None,
        synced_lines: list[dict] | None = None,
    ) -> dict:
        _ = synced_lines
        data = _transcribe_via_shared_whisper(vocals_path, language, lyrics_text)
        audio_duration_ms = _get_audio_duration_ms(vocals_path)
        result = _extract_words_and_lines(
            data,
            lyrics_text=lyrics_text,
            audio_duration_ms=audio_duration_ms,
        )
        result["alignment_engine"] = self.name
        result["alignment_engine_version"] = KARAOKE_ALIGNMENT_ENGINE_VERSION
        return result


class GroqWhisperAlignmentEngine:
    name = "groq_whisper"

    def align(
        self,
        vocals_path: str,
        language: str,
        lyrics_text: str | None = None,
        synced_lines: list[dict] | None = None,
    ) -> dict:
        _ = synced_lines
        data = _transcribe_via_groq(vocals_path, language, lyrics_text)
        audio_duration_ms = _get_audio_duration_ms(vocals_path)
        result = _extract_words_and_lines(
            data,
            lyrics_text=lyrics_text,
            audio_duration_ms=audio_duration_ms,
        )
        result["model_version"] = "groq-whisper-large-v3-turbo"
        result["alignment_engine"] = self.name
        result["alignment_engine_version"] = KARAOKE_ALIGNMENT_ENGINE_VERSION
        return result


class MmsCtcAlignmentEngine:
    name = "mms_ctc"

    def align(
        self,
        vocals_path: str,
        language: str,
        lyrics_text: str | None = None,
        synced_lines: list[dict] | None = None,
    ) -> dict:
        _ = synced_lines
        if KARAOKE_ALIGNMENT_LICENSE_MODE == "commercial":
            raise RuntimeError("MMS CTC engine disabled in commercial mode (CC-BY-NC)")
        if not lyrics_text or len(lyrics_text.strip()) < 20:
            raise RuntimeError("MMS CTC engine requires known lyrics")

        from ctc_forced_aligner import (
            generate_emissions,
            get_alignments,
            get_spans,
            load_audio,
            postprocess_results,
            preprocess_text,
        )

        model, tokenizer = _get_ctc_align_model()
        audio_duration_ms = _get_audio_duration_ms(vocals_path)

        audio_waveform = load_audio(vocals_path, model.dtype, model.device)
        emissions, stride = generate_emissions(model, audio_waveform, batch_size=4)

        iso_lang = LANG_TO_ISO3.get(language, "fra")
        tokens_starred, text_starred = preprocess_text(
            lyrics_text,
            romanize=True,
            language=iso_lang,
        )
        segments, scores, blank_id = get_alignments(emissions, tokens_starred, tokenizer)
        spans = get_spans(tokens_starred, segments, blank_id)
        word_results = postprocess_results(text_starred, spans, stride, scores)

        words, confidence_avg = _extract_ctc_word_results(word_results, audio_duration_ms)
        lines = _build_lines_from_words(words)
        duration_ms = words[-1]["endMs"] if words else 0

        logger.info(
            "CTC alignment complete: words=%d confidence_avg=%.3f language=%s",
            len(words),
            confidence_avg,
            language,
        )

        return {
            "text": lyrics_text,
            "language": language,
            "words": words,
            "lines": lines,
            "word_count": len(words),
            "duration_ms": duration_ms,
            "confidence_avg": round(confidence_avg, 3),
            "model_version": "ctc-mms-300m-forced-aligned",
            "alignment_engine": self.name,
            "alignment_engine_version": KARAOKE_ALIGNMENT_ENGINE_VERSION,
        }


class TorchaudioCtcAlignmentEngine:
    """
    CTC forced alignment via torchaudio MMS_FA pipeline.
    Licence-compatible fallback (no CC-BY-NC restriction).
    Uses the same MMS acoustic model as ctc-forced-aligner but via torchaudio API.
    """
    name = "torchaudio_ctc"

    def align(
        self,
        vocals_path: str,
        language: str,
        lyrics_text: str | None = None,
        synced_lines: list[dict] | None = None,
    ) -> dict:
        _ = synced_lines
        if not lyrics_text or len(lyrics_text.strip()) < 20:
            raise RuntimeError("Torchaudio CTC engine requires known lyrics")

        import torch
        import torchaudio

        model, tokenizer, aligner = _get_torchaudio_fa_model()
        device = next(model.parameters()).device
        audio_duration_ms = _get_audio_duration_ms(vocals_path)
        sample_rate = torchaudio.pipelines.MMS_FA.sample_rate

        waveform, sr = torchaudio.load(vocals_path)
        if sr != sample_rate:
            waveform = torchaudio.functional.resample(waveform, sr, sample_rate)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        with torch.inference_mode():
            emission, _ = model(waveform.to(device))

        # Split lyrics into words, tokenize each word separately
        transcript = [w for w in lyrics_text.strip().split() if w.strip()]
        token_spans = aligner(emission[0], tokenizer(transcript))

        # Convert frame indices to ms
        num_frames = emission.size(1)
        ratio = waveform.size(1) / num_frames / sample_rate  # seconds per frame

        words = []
        for i, spans in enumerate(token_spans):
            if i >= len(transcript):
                break
            word_text = transcript[i]
            if not word_text or word_text in HALLUCINATION_WORDS:
                continue
            if not spans:
                continue

            start_frame = spans[0].start
            end_frame = spans[-1].end
            start_ms = int(start_frame * ratio * 1000)
            end_ms = int(end_frame * ratio * 1000)
            avg_score = sum(s.score for s in spans) / len(spans)

            words.append({
                "word": word_text,
                "startMs": start_ms,
                "endMs": end_ms,
                "confidence": round(avg_score, 3),
            })

        lines = _build_lines_from_words(words)
        duration_ms = words[-1]["endMs"] if words else 0
        confidence_avg = sum(w["confidence"] for w in words) / len(words) if words else 0.0

        logger.info(
            "Torchaudio CTC alignment: words=%d confidence_avg=%.3f language=%s",
            len(words), confidence_avg, language,
        )

        return {
            "text": lyrics_text,
            "language": language,
            "words": words,
            "lines": lines,
            "word_count": len(words),
            "duration_ms": duration_ms,
            "confidence_avg": round(confidence_avg, 3),
            "model_version": "torchaudio-mms-fa",
            "alignment_engine": self.name,
            "alignment_engine_version": KARAOKE_ALIGNMENT_ENGINE_VERSION,
        }


def _select_alignment_engines(
    lyrics_text: str | None,
) -> list[AlignmentEngine]:
    has_known_lyrics = bool(lyrics_text and len(lyrics_text.strip()) >= 20)
    if KARAOKE_ALIGNMENT_ENGINE == "auto":
        engines: list[AlignmentEngine] = []
        if has_known_lyrics:
            engines.append(TorchaudioCtcAlignmentEngine())
        engines.append(SharedWhisperAlignmentEngine())
        if GROQ_API_KEY:
            engines.append(GroqWhisperAlignmentEngine())
        return engines

    if KARAOKE_ALIGNMENT_ENGINE == "whisper":
        engines = [SharedWhisperAlignmentEngine()]
        if GROQ_API_KEY:
            engines.append(GroqWhisperAlignmentEngine())
        return engines

    if KARAOKE_ALIGNMENT_ENGINE == "mms_ctc":
        engines = [MmsCtcAlignmentEngine(), SharedWhisperAlignmentEngine()]
        if GROQ_API_KEY:
            engines.append(GroqWhisperAlignmentEngine())
        return engines

    if KARAOKE_ALIGNMENT_ENGINE == "torchaudio_ctc":
        engines = [TorchaudioCtcAlignmentEngine(), SharedWhisperAlignmentEngine()]
        if GROQ_API_KEY:
            engines.append(GroqWhisperAlignmentEngine())
        return engines

    logger.warning(
        "Unknown KARAOKE_ALIGNMENT_ENGINE=%s, falling back to whisper route",
        KARAOKE_ALIGNMENT_ENGINE,
    )
    engines = [SharedWhisperAlignmentEngine()]
    if GROQ_API_KEY:
        engines.append(GroqWhisperAlignmentEngine())
    return engines


def _apply_synced_regrouping_if_needed(
    result: dict,
    synced_lines: list[dict] | None,
) -> tuple[dict, int, float, str]:
    if not synced_lines:
        return result, 0, 0.0, "none"

    regrouped_lines, skipped_words, skipped_ratio = _regroup_words_by_synced_lines(
        result.get("words", []),
        synced_lines,
        KARAOKE_REGROUP_TOLERANCE_MS,
    )
    regroup_mode = "synced_hybrid"

    if skipped_ratio > KARAOKE_SYNCED_REGROUP_MAX_SKIPPED_RATIO:
        regrouped_lines = _build_lines_from_words(result.get("words", []))
        regroup_mode = "gap_fallback"
        logger.warning(
            "Synced regroup skipped ratio too high: %.3f > %.3f. Fallback to gap grouping.",
            skipped_ratio,
            KARAOKE_SYNCED_REGROUP_MAX_SKIPPED_RATIO,
        )

    updated = {**result, "lines": regrouped_lines}
    return updated, skipped_words, skipped_ratio, regroup_mode


def _refine_with_onsets(
    words: list[dict],
    vocals_path: str,
) -> list[dict]:
    """
    Snap word start boundaries to nearest vocal onset event.
    Improves precision by ~10-30ms on word starts.
    Only moves boundaries within KARAOKE_ONSET_SNAP_THRESHOLD_MS.
    """
    import librosa
    import numpy as np

    if not words:
        return words

    y, sr = librosa.load(vocals_path, sr=22050)
    onset_frames = librosa.onset.onset_detect(
        y=y.astype(np.float32), sr=sr, units='frames', backtrack=True,
    )
    onset_times_ms = (librosa.frames_to_time(onset_frames, sr=sr) * 1000).astype(int)

    if len(onset_times_ms) == 0:
        return words

    snap_threshold = KARAOKE_ONSET_SNAP_THRESHOLD_MS
    refined = []
    snapped_count = 0
    for word in words:
        diffs = np.abs(onset_times_ms - word["startMs"])
        closest_idx = np.argmin(diffs)
        if diffs[closest_idx] <= snap_threshold:
            refined.append({**word, "startMs": int(onset_times_ms[closest_idx])})
            snapped_count += 1
        else:
            refined.append(word)

    logger.info(
        "Onset refinement: snapped %d/%d word starts (threshold=%dms)",
        snapped_count, len(words), snap_threshold,
    )
    return refined


def _finalize_result(
    result: dict,
    vocals_path: str,
    spotify_track_id: str,
    youtube_video_id: str | None,
    artist_name: str | None,
    track_name: str | None,
    source: str,
) -> dict:
    output_dir = Path(vocals_path).parent
    timestamps_path = output_dir / "word_timestamps.json"

    output_data = {
        "spotify_track_id": spotify_track_id,
        "youtube_video_id": youtube_video_id,
        "source": source,
        "language": result.get("language", "fr"),
        "model_version": result.get("model_version", "unknown"),
        "alignment_engine": result.get("alignment_engine", source),
        "alignment_engine_version": result.get("alignment_engine_version", KARAOKE_ALIGNMENT_ENGINE_VERSION),
        "words": result["words"],
        "lines": result["lines"],
        "word_count": result.get("word_count", len(result["words"])),
        "duration_ms": result.get("duration_ms", 0),
        "confidence_avg": result.get("confidence_avg", 0),
        "artist_name": artist_name,
        "track_name": track_name,
    }

    with open(timestamps_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    logger.info(
        "Saved word timestamps to: %s (source=%s engine=%s engine_version=%s)",
        timestamps_path,
        source,
        output_data["alignment_engine"],
        output_data["alignment_engine_version"],
    )

    return {
        "status": "completed",
        **output_data,
        "timestamps_path": str(timestamps_path),
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
    Generate word timestamps via configurable alignment engines + quality gates.

    P0 behavior:
    - Engine abstraction is active
    - AUTO route remains Whisper -> Groq (safe default)
    - Time-integrity and quality gates enforce safe fallback behavior
    - Synced regrouping never drops words silently
    """
    engines = _select_alignment_engines(lyrics_text)
    audio_duration_ms = _get_audio_duration_ms(vocals_path)
    fallback_reasons: list[str] = []

    for idx, engine in enumerate(engines):
        is_last_engine = idx == (len(engines) - 1)
        try:
            candidate = engine.align(
                vocals_path=vocals_path,
                language=language,
                lyrics_text=lyrics_text,
                synced_lines=synced_lines,
            )
        except Exception as exc:
            reason = f"{engine.name}:engine_error:{exc}"
            fallback_reasons.append(reason)
            logger.warning("Alignment engine failed: %s", reason)
            continue

        try:
            normalized_words = _normalize_words_timing(candidate.get("words", []), audio_duration_ms)
        except Exception as exc:
            reason = f"{engine.name}:unit_validation_error:{exc}"
            fallback_reasons.append(reason)
            logger.warning("Alignment engine timing validation failed: %s", reason)
            continue

        candidate["words"] = normalized_words
        candidate["word_count"] = len(normalized_words)
        candidate["duration_ms"] = normalized_words[-1]["endMs"] if normalized_words else 0
        candidate["confidence_avg"], low_conf_ratio = _compute_quality_metrics(candidate)

        ok_integrity, integrity_reason = _validate_alignment_integrity(
            normalized_words,
            audio_duration_ms,
        )
        if not ok_integrity:
            reason = f"{engine.name}:integrity_gate_failed:{integrity_reason}"
            fallback_reasons.append(reason)
            logger.warning("Alignment integrity gate failed: %s", reason)
            continue

        candidate, skipped_words, skipped_ratio, regroup_mode = _apply_synced_regrouping_if_needed(
            candidate,
            synced_lines,
        )

        ok_quality, quality_reason = _passes_quality_gate(candidate)
        if not ok_quality:
            reason = f"{engine.name}:quality_gate_failed:{quality_reason}"
            fallback_reasons.append(reason)
            if not is_last_engine:
                logger.warning("Alignment quality gate failed: %s", reason)
                continue
            logger.warning(
                "Alignment quality gate failed on last engine, accepting degraded output: %s",
                reason,
            )

        # Onset refinement (optional, post quality-gate)
        if KARAOKE_ONSET_REFINE:
            try:
                candidate["words"] = _refine_with_onsets(candidate["words"], vocals_path)
                candidate, skipped_words, skipped_ratio, regroup_mode = (
                    _apply_synced_regrouping_if_needed(candidate, synced_lines)
                )
            except Exception as onset_err:
                logger.warning("Onset refinement failed (non-fatal): %s", onset_err)

        source = engine.name
        logger.info(
            "Word timestamps generated track_id=%s tier_used=%s model_version=%s "
            "word_count=%d confidence_avg=%.3f low_conf_ratio=%.3f regroup_mode=%s "
            "skipped_words=%d skipped_words_ratio=%.3f",
            spotify_track_id,
            source,
            candidate.get("model_version", "unknown"),
            candidate["word_count"],
            candidate["confidence_avg"],
            low_conf_ratio,
            regroup_mode,
            skipped_words,
            skipped_ratio,
        )

        return _finalize_result(
            result=candidate,
            vocals_path=vocals_path,
            spotify_track_id=spotify_track_id,
            youtube_video_id=youtube_video_id,
            artist_name=artist_name,
            track_name=track_name,
            source=source,
        )

    raise RuntimeError(
        "Word timestamp generation failed for all engines. "
        + "; ".join(fallback_reasons)
    )


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
    1. Unload Ollama Heavy from GPU 1 (if Demucs needed, keep_alive:0)
    2. Run Demucs separation (cuda:0 = GPU 1 RTX 3080, ~4 GB VRAM)
    3. Fetch lyrics for guided recognition
    4. Generate word timestamps via shared-whisper HTTP (GPU 3, zero GPU 1 usage)
    5. Cache results in PostgreSQL
    """
    import torch
    import torchaudio
    from demucs.apply import apply_model
    from tasks.audio_separation import get_demucs_model, convert_to_wav
    from tasks.pipeline import _unload_ollama_for_demucs

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

        # Unload Ollama Heavy from GPU 1 to free VRAM for Demucs
        _unload_ollama_for_demucs()

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
            alignment_engine_version=result.get("alignment_engine_version"),
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
