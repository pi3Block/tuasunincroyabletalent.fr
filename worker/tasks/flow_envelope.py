"""
Compute amplitude envelope of reference vocals for flow visualization.

Produces a compact time-series (20 Hz, ~50ms windows) of RMS energy values
normalized to 0-1. The frontend uses this to render a breathing waveform
that conveys the singer's dynamics in real time.

CPU-only (numpy + torchaudio resample), <1s for a 4-minute song.
Reuses the same envelope logic as sync.py (cross-correlation).
"""
import json
import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


def compute_flow_envelope(
    vocals_path: str,
    target_sr: int = 8000,
    window_ms: int = 50,
) -> dict:
    """
    Compute normalized RMS amplitude envelope from a vocals WAV/FLAC file.

    Args:
        vocals_path: Path to Demucs-separated vocals file.
        target_sr: Downsample rate (8 kHz is sufficient for envelope).
        window_ms: Window size in milliseconds for RMS computation.

    Returns:
        dict with sample_rate_hz, values (list[float] 0-1), duration_seconds.
    """
    import torchaudio

    wav, sr = torchaudio.load(vocals_path, backend="soundfile")

    # Downsample for speed
    if sr != target_sr:
        wav = torchaudio.transforms.Resample(sr, target_sr)(wav)

    # Mono
    mono = wav.mean(dim=0).numpy()

    # RMS envelope with moving average (same approach as sync.py)
    window_size = max(1, int(target_sr * window_ms / 1000))
    kernel = np.ones(window_size) / window_size
    envelope = np.convolve(np.abs(mono), kernel, mode="same")

    # Downsample envelope to target rate (one value per window)
    # target_sr / window_size = samples per second in output
    step = window_size
    downsampled = envelope[::step]

    # Normalize to 0-1
    peak = downsampled.max()
    if peak > 1e-8:
        downsampled = downsampled / peak
    else:
        logger.warning("Near-silent vocals in %s — envelope is flat", vocals_path)

    sample_rate_hz = target_sr // window_size  # 8000 / 400 = 20 Hz
    duration_seconds = round(len(mono) / target_sr, 2)

    values = [round(float(v), 4) for v in downsampled]

    logger.info(
        "Flow envelope computed: %d samples @ %d Hz, duration=%.1fs, peak=%.3f",
        len(values), sample_rate_hz, duration_seconds, float(peak),
    )

    return {
        "sample_rate_hz": sample_rate_hz,
        "values": values,
        "duration_seconds": duration_seconds,
    }


def compute_and_upload_envelope(
    vocals_path: str,
    youtube_id: str,
    storage,
) -> str | None:
    """
    Compute flow envelope and upload to storage as JSON.

    Returns the storage URL on success, None on failure.
    """
    try:
        envelope = compute_flow_envelope(vocals_path)
        json_bytes = json.dumps(envelope, separators=(",", ":")).encode("utf-8")
        relative_path = f"cache/{youtube_id}/flow_envelope.json"
        url = storage.upload(json_bytes, relative_path, content_type="application/json")
        logger.info("Flow envelope uploaded: %s (%d bytes)", relative_path, len(json_bytes))
        return url
    except Exception as e:
        logger.warning("Flow envelope compute/upload failed (non-fatal): %s", e)
        return None
