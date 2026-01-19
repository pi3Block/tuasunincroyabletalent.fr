"""
Audio source separation using Demucs.
Separates vocals from instrumentals.
"""
import os
from pathlib import Path
from celery import shared_task

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

    print(f"[Demucs] Loading audio: {audio_path}")

    # Load audio using soundfile backend (more compatible)
    audio_path = Path(audio_path)
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

    print(f"[Demucs] Separating audio...")

    # Apply Demucs model
    model = get_demucs_model()
    with torch.no_grad():
        sources = apply_model(model, waveform, device=waveform.device)

    # Demucs outputs: drums, bass, other, vocals (index 3)
    vocals = sources[0, 3]  # Shape: (2, samples)
    instrumentals = sources[0, :3].sum(dim=0)  # Mix drums + bass + other

    # Save separated stems
    output_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files")) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    vocals_path = output_dir / "vocals.wav"
    instrumentals_path = output_dir / "instrumentals.wav"

    torchaudio.save(str(vocals_path), vocals.cpu(), 44100)
    torchaudio.save(str(instrumentals_path), instrumentals.cpu(), 44100)

    print(f"[Demucs] Separation complete: {vocals_path}")

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
