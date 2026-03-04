# ===========================================
# tuasunincroyabletalent.fr GPU Worker
# Uses shared base image for fast builds (~2min vs ~15min)
# Base: ghcr.io/pi3block/gpu-worker-base:latest
#   → python:3.11-slim + ffmpeg + uv + torch + torchaudio + whisper + librosa
# ===========================================

FROM ghcr.io/pi3block/gpu-worker-base:latest

WORKDIR /app

# ===========================================
# Project-Specific Python Dependencies
# (Base already has: torch, torchaudio, whisper, librosa, etc.)
# ===========================================
COPY requirements-project.txt .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -r requirements-project.txt

# Copy source (layer invalidated only when code changes, not deps)
COPY . .

# Create cache directories for models
RUN mkdir -p /root/.cache/whisper /root/.cache/torch/hub

# Health check — lightweight (don't import ML libs, each costs ~200-500 MB RAM)
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD celery -A tasks.celery_app inspect ping --timeout 5 2>/dev/null | grep -q "pong" || exit 1

# Run Celery worker
# gpu-heavy: Demucs, Whisper (resource-intensive)
# gpu: CREPE pitch analysis
# default: CPU-bound tasks
CMD ["celery", "-A", "tasks.celery_app", "worker", "--loglevel=info", "--concurrency=2", "-Q", "gpu-heavy,gpu,default"]
