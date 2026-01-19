# Worker Dockerfile - Celery + Audio Processing (Optimized with uv)
# Note: For GPU support, PyTorch will auto-detect CUDA if available
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies + uv
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh

# Add uv to PATH
ENV PATH="/root/.local/bin:$PATH"

# Layer 1: Heavy dependencies (PyTorch ecosystem) - changes rarely
# Using cache mount for faster rebuilds
COPY requirements-torch.txt .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-cache -r requirements-torch.txt

# Layer 2: Other dependencies - changes occasionally
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-cache -r requirements.txt

# Pre-download models (optional, can be done at runtime)
# RUN python -c "import whisper; whisper.load_model('turbo')"

# Copy source (changes frequently, so last)
COPY . .

# Run Celery worker - listen to both gpu and default queues
CMD ["celery", "-A", "tasks.celery_app", "worker", "--loglevel=info", "--concurrency=2", "-Q", "gpu,default"]
