"""
Cross-correlation based audio synchronization.

Computes temporal offset between user and reference vocals by correlating
their amplitude envelopes. This replaces manual offset guessing with an
automatic measurement that feeds into pitch/rhythm scoring and frontend display.

CPU-only (numpy/scipy), runs inline in the pipeline — no GPU needed.
"""
import logging

import numpy as np

logger = logging.getLogger(__name__)


def compute_sync_offset(
    user_vocals_path: str,
    ref_vocals_path: str,
    target_sr: int = 8000,
    max_offset_seconds: float = 30.0,
) -> dict:
    """
    Compute temporal offset between user and reference vocals
    using cross-correlation of amplitude envelopes.

    Args:
        user_vocals_path: Path to user separated vocals WAV
        ref_vocals_path: Path to reference separated vocals WAV
        target_sr: Downsample rate for envelope correlation (8kHz is sufficient)
        max_offset_seconds: Maximum lag to search (limits search window)

    Returns:
        dict with offset_seconds, confidence (0-1), method
    """
    import torchaudio
    from scipy.signal import correlate

    # Load both vocals
    user_wav, user_sr = torchaudio.load(user_vocals_path, backend="soundfile")
    ref_wav, ref_sr = torchaudio.load(ref_vocals_path, backend="soundfile")

    # Downsample to target_sr for speed (torchaudio polyphase filter is ~20x faster than scipy FFT)
    if user_sr != target_sr:
        user_wav = torchaudio.transforms.Resample(user_sr, target_sr)(user_wav)
    if ref_sr != target_sr:
        ref_wav = torchaudio.transforms.Resample(ref_sr, target_sr)(ref_wav)

    # Convert to mono numpy
    user_mono = user_wav.mean(dim=0).numpy()
    ref_mono = ref_wav.mean(dim=0).numpy()

    # Compute amplitude envelope (rectify + lowpass via moving average)
    window_size = max(1, int(target_sr * 0.05))  # 50ms window
    kernel = np.ones(window_size) / window_size
    user_env = np.convolve(np.abs(user_mono), kernel, mode="same")
    ref_env = np.convolve(np.abs(ref_mono), kernel, mode="same")

    # Normalize (zero-mean, unit-variance)
    user_std = user_env.std()
    ref_std = ref_env.std()
    if user_std < 1e-8 or ref_std < 1e-8:
        logger.warning("One of the signals is near-silent, cannot sync")
        return {
            "offset_seconds": 0.0,
            "confidence": 0.0,
            "method": "cross_correlation",
        }

    user_env = (user_env - user_env.mean()) / user_std
    ref_env = (ref_env - ref_env.mean()) / ref_std

    # Cross-correlation (full mode: output length = len(user) + len(ref) - 1)
    correlation = correlate(user_env, ref_env, mode="full")

    # Limit search to max_offset_seconds around zero lag
    max_lag_samples = int(max_offset_seconds * target_sr)
    center = len(ref_env) - 1  # Zero-lag index in 'full' mode
    search_start = max(0, center - max_lag_samples)
    search_end = min(len(correlation), center + max_lag_samples)

    search_region = correlation[search_start:search_end]
    peak_idx = int(np.argmax(search_region)) + search_start

    # Convert peak position to seconds
    lag_samples = peak_idx - center
    offset_seconds = lag_samples / target_sr

    # Confidence: peak-to-mean ratio in the search region
    peak_value = correlation[peak_idx]
    mean_abs = np.mean(np.abs(search_region))
    raw_confidence = float(peak_value / (mean_abs + 1e-8))

    # Normalize to 0-1 (empirical: ratio > 5 is very confident)
    confidence = min(1.0, max(0.0, (raw_confidence - 1.0) / 4.0))

    logger.info(
        "Cross-correlation sync: offset=%.3fs, confidence=%.2f (raw=%.1f)",
        offset_seconds,
        confidence,
        raw_confidence,
    )

    return {
        "offset_seconds": round(offset_seconds, 3),
        "confidence": round(confidence, 3),
        "method": "cross_correlation",
    }
