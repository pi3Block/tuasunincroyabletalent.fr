"""
Pitch analysis using torchcrepe (PyTorch-based CREPE).
Extracts fundamental frequency (F0) from vocals.
"""
from pathlib import Path
from celery import shared_task
import numpy as np


def do_extract_pitch(vocals_path: str, session_id: str) -> dict:
    """
    Core logic: Extract pitch information from vocals using torchcrepe.

    Args:
        vocals_path: Path to vocals audio file
        session_id: Session identifier

    Returns:
        dict with pitch data
    """
    import torch
    import torchcrepe
    import torchaudio

    print(f"[CREPE] Loading vocals: {vocals_path}")

    # Load audio with torchaudio
    audio, sample_rate = torchaudio.load(vocals_path)

    # Convert stereo to mono if needed
    if audio.shape[0] > 1:
        audio = audio.mean(dim=0, keepdim=True)

    # Resample to 16kHz if needed (torchcrepe expects 16kHz)
    if sample_rate != 16000:
        resampler = torchaudio.transforms.Resample(sample_rate, 16000)
        audio = resampler(audio)
        sample_rate = 16000

    print(f"[CREPE] Extracting pitch...")

    # Select device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    audio = audio.to(device)

    # Extract pitch with torchcrepe
    # Model: 'tiny' (fast) or 'full' (accurate) - torchcrepe only supports these two
    hop_length = 160  # 10ms at 16kHz
    frequency, confidence = torchcrepe.predict(
        audio,
        sample_rate,
        hop_length=hop_length,
        model="full",  # Best accuracy (use "tiny" for faster but less accurate)
        decoder=torchcrepe.decode.viterbi,  # Smooth pitch curve
        device=device,
        batch_size=512,
        return_periodicity=True,
    )

    # Move to CPU and convert to numpy
    frequency = frequency.squeeze().cpu().numpy()
    confidence = confidence.squeeze().cpu().numpy()

    # Generate time array (10ms steps)
    time = np.arange(len(frequency)) * (hop_length / sample_rate)

    # Filter low-confidence predictions
    frequency[confidence < 0.5] = 0

    # Save pitch data
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
        "voiced_ratio": float(np.sum(frequency > 0) / len(frequency)),
    }

    print(f"[CREPE] Pitch extraction complete: {pitch_path}")

    return {
        "session_id": session_id,
        "pitch_path": str(pitch_path),
        "stats": stats,
        "status": "completed",
    }


@shared_task(bind=True, name="tasks.pitch_analysis.extract_pitch")
def extract_pitch(self, vocals_path: str, session_id: str) -> dict:
    """
    Celery task wrapper for pitch extraction.
    """
    self.update_state(state="PROGRESS", meta={"step": "loading_vocals"})
    result = do_extract_pitch(vocals_path, session_id)
    return result
