"""
Music feature extraction using MERT-v1-95M (music understanding model).

Sprint 2.3 — Extracts musical context from reference audio to enrich jury prompts.
GPU ~1 GB, lazy-loaded singleton. Non-fatal: returns None on failure.
Results cached in storage: cache/{youtube_id}/mert_features.json

Usage:
    from tasks.music_features import extract_music_features
    features = extract_music_features("/path/to/reference_vocals.wav")
    # {"energy_mean": 0.42, "energy_std": 0.18, "spectral_centroid_mean": 1234.5, ...}
"""
import os
import json
import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

MERT_ENABLED = os.getenv("MERT_ENABLED", "true").lower() in ("true", "1", "yes")
MERT_MODEL_NAME = "m-a-p/MERT-v1-95M"

_mert_model = None
_mert_processor = None


def _get_model():
    """Lazy-load MERT-v1-95M model + processor (singleton)."""
    global _mert_model, _mert_processor
    if _mert_model is None:
        import torch
        from transformers import Wav2Vec2FeatureExtractor, AutoModel

        logger.info("Loading MERT-v1-95M model...")
        _mert_processor = Wav2Vec2FeatureExtractor.from_pretrained(
            MERT_MODEL_NAME, trust_remote_code=True,
        )
        _mert_model = AutoModel.from_pretrained(
            MERT_MODEL_NAME, trust_remote_code=True,
        )
        if torch.cuda.is_available():
            _mert_model = _mert_model.cuda()
        _mert_model.eval()
        logger.info("MERT-v1-95M loaded (device=%s)", next(_mert_model.parameters()).device)
    return _mert_model, _mert_processor


def extract_music_features(audio_path: str) -> dict | None:
    """
    Extract musical features from an audio file using MERT-v1-95M.

    Extracts energy profile, spectral characteristics, and embedding statistics
    from the model's hidden states. These are injected into jury LLM prompts
    for musically-contextualized feedback.

    Args:
        audio_path: Path to audio WAV file (typically reference vocals).

    Returns:
        Dict with music features or None on failure/disabled.
    """
    if not MERT_ENABLED:
        logger.debug("MERT disabled (MERT_ENABLED=false)")
        return None

    try:
        import torch
        import torchaudio

        model, processor = _get_model()
        device = next(model.parameters()).device

        # Load and resample to 24kHz (MERT requirement)
        waveform, sr = torchaudio.load(audio_path)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)  # mono
        if sr != processor.sampling_rate:
            resampler = torchaudio.transforms.Resample(sr, processor.sampling_rate)
            waveform = resampler(waveform)

        # Truncate to 30s max to limit VRAM usage (~1 GB for 30s)
        max_samples = processor.sampling_rate * 30
        if waveform.shape[1] > max_samples:
            waveform = waveform[:, :max_samples]

        # Process through MERT
        inputs = processor(
            waveform.squeeze(0).numpy(),
            sampling_rate=processor.sampling_rate,
            return_tensors="pt",
        )
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = model(**inputs, output_hidden_states=True)

        # Extract features from hidden states
        # Use last layer for high-level features
        hidden = outputs.hidden_states[-1].squeeze(0)  # (T, 768)

        # Compute summary statistics
        hidden_np = hidden.cpu().float().numpy()

        # Energy profile (L2 norm per frame, normalized)
        frame_energy = np.linalg.norm(hidden_np, axis=1)
        energy_normalized = frame_energy / (frame_energy.max() + 1e-8)

        # Spectral-like features from embedding dimensions
        # Lower dims tend to capture low-level features, higher dims capture high-level
        low_band = hidden_np[:, :256].mean()
        mid_band = hidden_np[:, 256:512].mean()
        high_band = hidden_np[:, 512:].mean()

        # Temporal dynamics
        if len(energy_normalized) > 1:
            energy_diff = np.diff(energy_normalized)
            dynamics = float(np.std(energy_diff))
        else:
            dynamics = 0.0

        features = {
            "energy_mean": round(float(energy_normalized.mean()), 3),
            "energy_std": round(float(energy_normalized.std()), 3),
            "energy_max": round(float(energy_normalized.max()), 3),
            "dynamics": round(dynamics, 3),
            "low_band_mean": round(float(low_band), 3),
            "mid_band_mean": round(float(mid_band), 3),
            "high_band_mean": round(float(high_band), 3),
            "duration_analyzed_s": round(waveform.shape[1] / processor.sampling_rate, 1),
        }

        # Derive descriptive tags for jury prompt
        tags = []
        if energy_normalized.std() > 0.25:
            tags.append("dynamique")
        elif energy_normalized.std() < 0.10:
            tags.append("uniforme")

        if dynamics > 0.05:
            tags.append("rythmé")

        if high_band > mid_band and high_band > low_band:
            tags.append("aigu/brillant")
        elif low_band > mid_band and low_band > high_band:
            tags.append("grave/chaud")

        features["tags"] = tags

        logger.info(
            "MERT features: energy=%.2f±%.2f, dynamics=%.3f, tags=%s",
            features["energy_mean"], features["energy_std"], dynamics, tags,
        )
        return features

    except Exception as e:
        logger.warning("MERT feature extraction failed (non-fatal): %s", e, exc_info=True)
        return None


def extract_and_cache_features(
    audio_path: str,
    youtube_id: str,
    storage,
) -> dict | None:
    """
    Extract MERT features and cache them in storage.

    Args:
        audio_path: Path to reference vocals WAV.
        youtube_id: YouTube video ID for cache key.
        storage: Storage client instance.

    Returns:
        Dict with features or None.
    """
    cache_key = f"cache/{youtube_id}/mert_features.json"

    # Check cache first
    try:
        if storage.exists(cache_key):
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
                storage.download_to_file(cache_key, Path(tmp.name))
                with open(tmp.name, "r") as f:
                    cached = json.load(f)
                os.unlink(tmp.name)
                logger.info("MERT features cache HIT for %s", youtube_id)
                return cached
    except Exception as e:
        logger.warning("MERT cache read failed: %s", e)

    # Extract features
    features = extract_music_features(audio_path)
    if features is None:
        return None

    # Upload to cache
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False,
        ) as tmp:
            json.dump(features, tmp, ensure_ascii=False)
            tmp_path = tmp.name
        storage.upload_from_file(
            Path(tmp_path), cache_key, content_type="application/json",
        )
        os.unlink(tmp_path)
        logger.info("MERT features cached for %s", youtube_id)
    except Exception as e:
        logger.warning("MERT cache upload failed (non-fatal): %s", e)

    return features
