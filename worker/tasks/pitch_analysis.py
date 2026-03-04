"""
Pitch analysis using SwiftF0 (CPU-only, ONNX Runtime).
Extracts fundamental frequency (F0) from vocals.

SwiftF0 replaces torchcrepe (Sprint 1, 2026-03-04):
  - 95K params vs 22M (230x smaller)
  - 42x faster than CREPE on CPU
  - +12% precision (91.80% vs ~80% harmonic-mean)
  - CPU-only → frees cuda:1 for A3B
"""
import os
import logging
from pathlib import Path
from celery import shared_task
import numpy as np

logger = logging.getLogger(__name__)

# Lazy-loaded SwiftF0 detector (singleton, CPU-only)
_detector = None


def _get_detector():
    """Lazy load SwiftF0 detector (ONNX Runtime, ~95K params, instant load)."""
    global _detector
    if _detector is None:
        from swift_f0 import SwiftF0
        _detector = SwiftF0(
            fmin=50.0,       # Min pitch Hz (vocal range)
            fmax=1100.0,     # Max pitch Hz (soprano + harmonics)
            confidence_threshold=0.0,  # We filter confidence ourselves (match CREPE behavior)
        )
        logger.info("SwiftF0 detector loaded (CPU-only, ONNX Runtime)")
    return _detector


def do_extract_pitch(
    vocals_path: str, session_id: str, fast_mode: bool = False, device: str = None,
) -> dict:
    """
    Extract pitch from vocals using SwiftF0 (CPU-only).

    Args:
        vocals_path: Path to vocals audio file
        session_id: Session identifier
        fast_mode: Ignored (SwiftF0 has a single model, always fast + accurate)
        device: Ignored (SwiftF0 is CPU-only via ONNX Runtime)

    Returns:
        dict with pitch_path (NPZ), stats, status
    """
    detector = _get_detector()

    logger.info("Extracting pitch with SwiftF0 (CPU): %s", vocals_path)

    result = detector.detect_from_file(vocals_path)

    time = result.timestamps
    frequency = result.pitch_hz.copy()
    confidence = result.confidence

    # Filter low-confidence predictions (match CREPE behavior)
    frequency[confidence < 0.5] = 0

    # Save pitch data (same NPZ format as CREPE for backward compatibility)
    output_dir = Path(vocals_path).parent
    pitch_path = output_dir / f"pitch_data_{session_id}.npz"

    np.savez(
        pitch_path,
        time=time,
        frequency=frequency,
        confidence=confidence,
    )

    # Calculate basic statistics
    valid_freqs = frequency[frequency > 0]
    stats = {
        "mean_pitch": float(np.mean(valid_freqs)) if len(valid_freqs) > 0 else 0,
        "std_pitch": float(np.std(valid_freqs)) if len(valid_freqs) > 0 else 0,
        "pitch_range": float(np.ptp(valid_freqs)) if len(valid_freqs) > 0 else 0,
        "voiced_ratio": float(np.sum(frequency > 0) / len(frequency)) if len(frequency) > 0 else 0,
    }

    logger.info("SwiftF0 pitch extraction complete: %s (%d frames)", pitch_path, len(time))

    return {
        "session_id": session_id,
        "pitch_path": str(pitch_path),
        "stats": stats,
        "status": "completed",
    }


@shared_task(bind=True, name="tasks.pitch_analysis.extract_pitch")
def extract_pitch(self, vocals_path: str, session_id: str) -> dict:
    """Celery task wrapper for pitch extraction."""
    self.update_state(state="PROGRESS", meta={"step": "loading_vocals"})
    result = do_extract_pitch(vocals_path, session_id)
    return result
