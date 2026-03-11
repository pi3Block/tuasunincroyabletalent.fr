"""
Vocal quality scoring using UTMOSv2 (Mean Opinion Score prediction).

Sprint 2.3 — Predicts perceptual vocal quality on a 1-5 MOS scale.
GPU ~500 MB, lazy-loaded singleton. Non-fatal: returns None on failure.

Usage:
    from tasks.vocal_quality import score_vocal_quality
    result = score_vocal_quality("/path/to/vocals.wav")
    # {"mos": 3.42, "mos_100": 68}
"""
import os
import logging

logger = logging.getLogger(__name__)

UTMOS_ENABLED = os.getenv("UTMOS_ENABLED", "true").lower() in ("true", "1", "yes")

_utmos_model = None


def _get_model():
    """Lazy-load UTMOSv2 model (singleton, GPU if available)."""
    global _utmos_model
    if _utmos_model is None:
        import utmosv2
        import torch
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        logger.info("Loading UTMOSv2 model (device=%s)...", device)
        _utmos_model = utmosv2.create_model(pretrained=True, device=device)
        logger.info("UTMOSv2 model loaded")
    return _utmos_model


def score_vocal_quality(vocals_path: str) -> dict | None:
    """
    Score vocal quality using UTMOSv2.

    Args:
        vocals_path: Path to separated vocals WAV file.

    Returns:
        {"mos": float (1-5), "mos_100": int (0-100)} or None on failure/disabled.
    """
    if not UTMOS_ENABLED:
        logger.debug("UTMOSv2 disabled (UTMOS_ENABLED=false)")
        return None

    try:
        import torch
        model = _get_model()
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        mos = model.predict(
            input_path=vocals_path,
            device=device,
            num_workers=0,  # safe for Celery/Docker
        )

        # predict() returns a float for single file
        mos_value = float(mos)
        # Clamp to valid MOS range
        mos_value = max(1.0, min(5.0, mos_value))
        # Convert to 0-100 scale: (mos - 1) / 4 * 100
        mos_100 = int(round((mos_value - 1.0) / 4.0 * 100))

        logger.info("UTMOSv2 score: MOS=%.2f, MOS_100=%d", mos_value, mos_100)
        return {"mos": round(mos_value, 2), "mos_100": mos_100}

    except Exception as e:
        logger.warning("UTMOSv2 scoring failed (non-fatal): %s", e, exc_info=True)
        return None
