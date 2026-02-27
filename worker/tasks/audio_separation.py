"""
Audio source separation using Demucs.
Separates vocals from instrumentals with optional spectral de-bleeding.
"""
import os
import logging
import subprocess
from pathlib import Path
from celery import shared_task

logger = logging.getLogger(__name__)

# Lazy imports for GPU memory management
_demucs_model = None


def get_demucs_model():
    """Lazy load Demucs model."""
    global _demucs_model
    if _demucs_model is None:
        import torch
        from demucs.pretrained import get_model

        # Use htdemucs for best quality
        _demucs_model = get_model("htdemucs")
        if torch.cuda.is_available():
            _demucs_model = _demucs_model.cuda()
    return _demucs_model


def convert_to_wav(input_path: Path, output_path: Path) -> Path:
    """
    Convert audio file to WAV format using ffmpeg.
    Required for WebM/Opus files that torchaudio cannot read directly.
    """
    logger.info("Converting %s to WAV...", input_path.suffix)
    cmd = [
        "ffmpeg", "-y",  # Overwrite output
        "-i", str(input_path),
        "-ar", "44100",  # Sample rate
        "-ac", "2",  # Stereo
        "-c:a", "pcm_s16le",  # 16-bit PCM
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg conversion failed: {result.stderr}")
    logger.info("Conversion complete: %s", output_path)
    return output_path


def apply_debleeding(
    vocals,
    instrumentals,
    n_fft: int = 2048,
    hop_length: int = 512,
    power: float = 2.0,
    eps: float = 1e-8,
):
    """
    Reduce cross-talk between separated stems using spectral soft masking.

    Computes Wiener-like masks in the frequency domain:
      mask_v = |S_vocals|^p / (|S_vocals|^p + |S_instru|^p + eps)
    Then applies each mask to the corresponding stem's STFT and reconstructs.

    Args:
        vocals: (2, samples) tensor on GPU
        instrumentals: (2, samples) tensor on GPU
        n_fft: FFT window size
        hop_length: Hop length for STFT
        power: Exponent controlling mask sharpness (2.0 = Wiener-like)
        eps: Numerical stability constant

    Returns:
        Tuple of (debleeded_vocals, debleeded_instrumentals) tensors
    """
    import torch

    window = torch.hann_window(n_fft, device=vocals.device)

    vocals_stft = torch.stft(
        vocals, n_fft, hop_length, window=window,
        return_complex=True, onesided=True,
    )
    instru_stft = torch.stft(
        instrumentals, n_fft, hop_length, window=window,
        return_complex=True, onesided=True,
    )

    vocals_mag = vocals_stft.abs().pow(power)
    instru_mag = instru_stft.abs().pow(power)
    total = vocals_mag + instru_mag + eps

    mask_vocals = vocals_mag / total
    mask_instru = instru_mag / total

    debleeded_vocals = torch.istft(
        vocals_stft * mask_vocals,
        n_fft, hop_length, window=window,
        length=vocals.shape[-1], onesided=True,
    )
    debleeded_instru = torch.istft(
        instru_stft * mask_instru,
        n_fft, hop_length, window=window,
        length=instrumentals.shape[-1], onesided=True,
    )

    return debleeded_vocals, debleeded_instru


def do_separate_audio(audio_path: str, session_id: str) -> dict:
    """
    Core logic: Separate audio into vocals and instrumentals using Demucs.

    Args:
        audio_path: Path to input audio file
        session_id: Session identifier

    Returns:
        dict with paths to separated stems
    """
    import torch
    import torchaudio
    from demucs.apply import apply_model

    logger.info("Loading audio: %s", audio_path)

    audio_path = Path(audio_path)

    # Convert WebM/Opus to WAV if needed (torchaudio doesn't support WebM well)
    if audio_path.suffix.lower() in [".webm", ".opus", ".ogg"]:
        wav_path = audio_path.with_suffix(".wav")
        convert_to_wav(audio_path, wav_path)
        audio_path = wav_path

    # Load audio using soundfile backend (more compatible)
    waveform, sample_rate = torchaudio.load(audio_path, backend="soundfile")

    # Resample to 44100Hz if needed (Demucs requirement)
    if sample_rate != 44100:
        resampler = torchaudio.transforms.Resample(sample_rate, 44100)
        waveform = resampler(waveform)

    # Convert to stereo if mono
    if waveform.shape[0] == 1:
        waveform = waveform.repeat(2, 1)

    # Add batch dimension
    waveform = waveform.unsqueeze(0)

    if torch.cuda.is_available():
        waveform = waveform.cuda()

    logger.info("Separating audio...")

    # Apply Demucs model
    model = get_demucs_model()
    with torch.no_grad():
        sources = apply_model(model, waveform, device=waveform.device)

    # Demucs outputs: drums, bass, other, vocals (index 3)
    vocals = sources[0, 3]  # Shape: (2, samples)
    instrumentals = sources[0, :3].sum(dim=0)  # Mix drums + bass + other

    # De-bleeding: reduce cross-talk via spectral soft masking
    debleed_enabled = os.getenv("DEBLEED_ENABLED", "true").lower() in ("true", "1", "yes")
    if debleed_enabled:
        try:
            logger.info("Applying spectral de-bleeding...")
            # Free cached GPU allocations before STFT (intermediate Demucs buffers)
            import torch as _torch
            if _torch.cuda.is_available():
                _torch.cuda.empty_cache()
            vocals, instrumentals = apply_debleeding(vocals, instrumentals)
            logger.info("De-bleeding complete")
        except Exception as e:
            logger.warning("De-bleeding failed (using raw stems): %s", e)

    # Save separated stems
    output_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    vocals_path = output_dir / "vocals.wav"
    instrumentals_path = output_dir / "instrumentals.wav"

    torchaudio.save(str(vocals_path), vocals.cpu(), 44100)
    torchaudio.save(str(instrumentals_path), instrumentals.cpu(), 44100)

    logger.info("Separation complete: %s", vocals_path)

    return {
        "session_id": session_id,
        "vocals_path": str(vocals_path),
        "instrumentals_path": str(instrumentals_path),
        "status": "completed",
    }


@shared_task(bind=True, name="tasks.audio_separation.separate_audio")
def separate_audio(self, audio_path: str, session_id: str) -> dict:
    """
    Celery task wrapper for audio separation.
    """
    self.update_state(state="PROGRESS", meta={"step": "loading_audio"})
    result = do_separate_audio(audio_path, session_id)
    return result
