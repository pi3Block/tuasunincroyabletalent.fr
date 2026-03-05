"""
Audio source separation — RoFormer (default) or Demucs (fallback).
Separates vocals from instrumentals with optional spectral de-bleeding.

Sprint 2.2 (2026-03-04):
  - BS-Roformer via audio-separator (SDR 12.97, +52% vs Demucs 8.5)
  - Env var SEPARATION_ENGINE=roformer|demucs (default: roformer)
  - Same interface do_separate_audio() for pipeline.py
  - De-bleeding still available (Wiener soft masking)
"""
import os
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from celery import shared_task

logger = logging.getLogger(__name__)

# Engine selection: "roformer" (default, +52% SDR) or "demucs" (fallback)
SEPARATION_ENGINE = os.getenv("SEPARATION_ENGINE", "roformer").lower()
DEBLEED_ENABLED = os.getenv("DEBLEED_ENABLED", "true").lower() in ("true", "1", "yes")

# RoFormer config
ROFORMER_MODEL = os.getenv(
    "AUDIO_SEP_MODEL",
    "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
)
MODEL_FILE_DIR = os.getenv("AUDIO_SEP_MODEL_DIR", "/root/.cache/audio-separator/")

# Lazy-loaded models (singletons)
_roformer_separator = None
_demucs_model = None


# ═══════════════════════════════════════════════════════════
# SHARED UTILITIES
# ═══════════════════════════════════════════════════════════

def convert_to_wav(input_path: Path, output_path: Path) -> Path:
    """Convert audio file to 44100Hz stereo WAV via ffmpeg."""
    logger.info("Converting %s to WAV...", input_path.suffix)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-ar", "44100",
        "-ac", "2",
        "-c:a", "pcm_s16le",
        str(output_path),
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
        vocals: (2, samples) tensor
        instrumentals: (2, samples) tensor
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


def _apply_debleeding_on_files(vocals_path: Path, instrumentals_path: Path) -> None:
    """Load stem WAV files, apply Wiener de-bleeding, save back."""
    import torch
    import torchaudio

    try:
        logger.info("Applying spectral de-bleeding...")
        vocals, sr = torchaudio.load(str(vocals_path), backend="soundfile")
        instru, _ = torchaudio.load(str(instrumentals_path), backend="soundfile")

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        vocals_db, instru_db = apply_debleeding(vocals.to(device), instru.to(device))

        torchaudio.save(str(vocals_path), vocals_db.cpu(), sr)
        torchaudio.save(str(instrumentals_path), instru_db.cpu(), sr)
        logger.info("De-bleeding complete")
    except RuntimeError as e:
        if "CUDA out of memory" in str(e):
            logger.warning("De-bleeding OOM on GPU, retrying on CPU...")
            import torch
            torch.cuda.empty_cache()
            vocals_db, instru_db = apply_debleeding(vocals.cpu(), instru.cpu())
            torchaudio.save(str(vocals_path), vocals_db, sr)
            torchaudio.save(str(instrumentals_path), instru_db, sr)
            logger.info("De-bleeding complete (CPU fallback)")
        else:
            logger.warning("De-bleeding failed (using raw stems): %s", e)
    except Exception as e:
        logger.warning("De-bleeding failed (using raw stems): %s", e)


# ═══════════════════════════════════════════════════════════
# ROFORMER ENGINE (via audio-separator)
# ═══════════════════════════════════════════════════════════

def _get_roformer():
    """Lazy load BS-Roformer via audio-separator (singleton)."""
    global _roformer_separator
    if _roformer_separator is None:
        import torch
        from audio_separator.separator import Separator

        use_cuda = torch.cuda.is_available()
        Path(MODEL_FILE_DIR).mkdir(parents=True, exist_ok=True)

        logger.info(
            "Initializing BS-Roformer (model=%s, gpu=%s)",
            ROFORMER_MODEL, use_cuda,
        )
        _roformer_separator = Separator(
            log_level=logging.WARNING,
            model_file_dir=MODEL_FILE_DIR,
            output_format="WAV",
            sample_rate=44100,
            normalization_threshold=0.9,
            use_autocast=use_cuda,
            mdxc_params={
                "segment_size": 256,
                "batch_size": 1,
                "overlap": 8,
            },
        )
        _roformer_separator.load_model(model_filename=ROFORMER_MODEL)
        logger.info("BS-Roformer loaded: %s", ROFORMER_MODEL)
    return _roformer_separator


def _do_separate_roformer(audio_path: str, session_id: str) -> dict:
    """Separate using BS-Roformer via audio-separator."""
    import torch

    audio_path = Path(audio_path)

    # Convert non-WAV formats to WAV
    if audio_path.suffix.lower() in (".webm", ".opus", ".ogg", ".mp3", ".m4a", ".flac"):
        wav_path = audio_path.with_suffix(".wav")
        convert_to_wav(audio_path, wav_path)
        audio_path = wav_path

    output_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/tmp/kiaraoke")) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # audio-separator writes to a temp dir, then we rename to canonical names
    with tempfile.TemporaryDirectory(prefix="roformer_") as tmp_out:
        separator = _get_roformer()
        separator.output_dir = tmp_out

        logger.info(
            "RoFormer separating %s on %s...",
            audio_path.name,
            "GPU" if torch.cuda.is_available() else "CPU",
        )
        output_files = separator.separate(str(audio_path))

        # Find vocals and instrumental stems by suffix
        vocals_src = next(
            (Path(f) for f in output_files if "(Vocals)" in f), None,
        )
        instru_src = next(
            (Path(f) for f in output_files
             if "(Instrumental)" in f or "(Instruments)" in f),
            None,
        )

        if vocals_src is None or instru_src is None:
            raise RuntimeError(
                f"RoFormer did not produce expected stems. Got: {output_files}"
            )

        vocals_path = output_dir / "vocals.wav"
        instrumentals_path = output_dir / "instrumentals.wav"
        shutil.move(str(vocals_src), str(vocals_path))
        shutil.move(str(instru_src), str(instrumentals_path))

    # De-bleeding on saved files (optional)
    if DEBLEED_ENABLED:
        _apply_debleeding_on_files(vocals_path, instrumentals_path)

    # Free GPU cache
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    logger.info("RoFormer separation complete: %s", vocals_path)
    return {
        "session_id": session_id,
        "vocals_path": str(vocals_path),
        "instrumentals_path": str(instrumentals_path),
        "status": "completed",
    }


# ═══════════════════════════════════════════════════════════
# DEMUCS ENGINE (legacy fallback)
# ═══════════════════════════════════════════════════════════

def _get_demucs_model(device: str = "cuda:0"):
    """Lazy load Demucs model on the specified device."""
    global _demucs_model
    import torch

    if _demucs_model is None:
        from demucs.pretrained import get_model
        _demucs_model = get_model("htdemucs")

    target = torch.device(device if torch.cuda.is_available() else "cpu")
    if next(_demucs_model.parameters()).device != target:
        _demucs_model = _demucs_model.to(target)

    return _demucs_model


def _do_separate_demucs(audio_path: str, session_id: str, device: str = "cuda:0") -> dict:
    """Separate using Demucs htdemucs (legacy)."""
    import torch
    import torchaudio
    from demucs.apply import apply_model

    logger.info("Demucs separating: %s", audio_path)

    audio_path = Path(audio_path)

    if audio_path.suffix.lower() in (".webm", ".opus", ".ogg"):
        wav_path = audio_path.with_suffix(".wav")
        convert_to_wav(audio_path, wav_path)
        audio_path = wav_path

    waveform, sample_rate = torchaudio.load(audio_path, backend="soundfile")

    if sample_rate != 44100:
        resampler = torchaudio.transforms.Resample(sample_rate, 44100)
        waveform = resampler(waveform)

    if waveform.shape[0] == 1:
        waveform = waveform.repeat(2, 1)

    waveform = waveform.unsqueeze(0)
    target_device = torch.device(device if torch.cuda.is_available() else "cpu")
    waveform = waveform.to(target_device)

    model = _get_demucs_model(device)
    with torch.no_grad():
        sources = apply_model(model, waveform, device=target_device)

    vocals = sources[0, 3]
    instrumentals = sources[0, :3].sum(dim=0)

    global _demucs_model
    del sources
    if _demucs_model is not None:
        _demucs_model = _demucs_model.cpu()
    torch.cuda.empty_cache()

    # De-bleeding on tensors (Demucs produces tensors directly)
    if DEBLEED_ENABLED:
        try:
            logger.info("Applying spectral de-bleeding...")
            vocals, instrumentals = apply_debleeding(vocals, instrumentals)
            logger.info("De-bleeding complete")
        except RuntimeError as e:
            if "CUDA out of memory" in str(e):
                logger.warning("De-bleeding OOM on GPU, retrying on CPU...")
                torch.cuda.empty_cache()
                vocals, instrumentals = apply_debleeding(vocals.cpu(), instrumentals.cpu())
                logger.info("De-bleeding complete (CPU fallback)")
            else:
                logger.warning("De-bleeding failed (using raw stems): %s", e)
        except Exception as e:
            logger.warning("De-bleeding failed (using raw stems): %s", e)

    output_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/tmp/kiaraoke")) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    vocals_path = output_dir / "vocals.wav"
    instrumentals_path = output_dir / "instrumentals.wav"

    torchaudio.save(str(vocals_path), vocals.cpu(), 44100)
    torchaudio.save(str(instrumentals_path), instrumentals.cpu(), 44100)

    logger.info("Demucs separation complete: %s", vocals_path)
    return {
        "session_id": session_id,
        "vocals_path": str(vocals_path),
        "instrumentals_path": str(instrumentals_path),
        "status": "completed",
    }


# ═══════════════════════════════════════════════════════════
# PUBLIC API (engine router)
# ═══════════════════════════════════════════════════════════

def do_separate_audio(audio_path: str, session_id: str, device: str = "cuda:0") -> dict:
    """
    Separate audio into vocals and instrumentals.

    Routes to RoFormer (default, +52% SDR) or Demucs (fallback) based on
    SEPARATION_ENGINE env var.

    Args:
        audio_path: Path to input audio file
        session_id: Session identifier
        device: CUDA device (used by Demucs only; RoFormer uses CUDA_VISIBLE_DEVICES)

    Returns:
        dict with vocals_path, instrumentals_path, status
    """
    if SEPARATION_ENGINE == "roformer":
        try:
            return _do_separate_roformer(audio_path, session_id)
        except Exception as e:
            logger.error(
                "RoFormer separation failed, falling back to Demucs: %s", e,
                exc_info=True,
            )
            return _do_separate_demucs(audio_path, session_id, device)
    else:
        return _do_separate_demucs(audio_path, session_id, device)


@shared_task(bind=True, name="tasks.audio_separation.separate_audio")
def separate_audio(self, audio_path: str, session_id: str) -> dict:
    """Celery task wrapper for audio separation."""
    self.update_state(state="PROGRESS", meta={"step": "loading_audio"})
    return do_separate_audio(audio_path, session_id)
