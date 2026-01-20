# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tu as un incroyable talent ?** - Application web type "Show TV" permettant d'évaluer le chant d'un utilisateur en temps réel par rapport à une version originale (Spotify/YouTube), avec feedback généré par des Personas IA (jury style "Incroyable Talent").

**Mobile-First**: L'application est conçue 100% mobile-friendly en priorité. Toutes les interfaces (sélection chanson, enregistrement, résultats) doivent être optimisées pour smartphones.

## Commands

```bash
# Démarrer tous les services (GPU CUDA requis)
docker-compose up -d

# Logs en temps réel
docker-compose logs -f api worker

# Frontend dev (hot reload)
cd frontend && npm run dev

# Backend dev (avec reload)
cd backend && uvicorn app.main:app --reload --port 8000

# Worker Celery dev
cd worker && celery -A tasks.celery_app worker --loglevel=info

# Rebuild après modification Dockerfile
docker-compose build --no-cache <service>

# Ollama - Télécharger modèle
docker-compose exec ollama ollama pull llama3.2
```

## Stack Technique

- **Infrastructure**: Docker Compose (orchestré par Coolify) + NVIDIA CUDA
- **Frontend**: React 18 + TypeScript + Vite 6 + Zustand 5 + Tailwind 3
- **Backend API**: Python 3.11 + FastAPI + Uvicorn + Pydantic 2
- **Backend Worker**: Python 3.11 + Celery 5 + Redis (GPU tasks)
- **LLM Engine**: Ollama (local) avec Llama 3.2 / modèle fine-tuné `Jury-LoRA`
- **Storage**: PostgreSQL 16, Redis 7, Filesystem (audio temp)
- **Audio Processing**:
  - Demucs (htdemucs) - Source separation
  - CREPE - Pitch detection
  - Whisper turbo - Speech-to-text
  - Librosa - Feature extraction

## Architecture

### Project Structure

```
├── frontend/                 # React + Vite
│   └── src/
│       ├── stores/          # Zustand stores
│       ├── components/ui/   # Mobile-first components
│       ├── hooks/           # Custom hooks (audio, etc.)
│       └── api/             # API client
│
├── backend/                  # FastAPI
│   └── app/
│       ├── routers/         # /api/session, /api/results
│       ├── services/        # YouTube, Spotify, Ollama clients
│       └── models/          # Pydantic schemas
│
├── worker/                   # Celery (GPU)
│   └── tasks/
│       ├── audio_separation.py  # Demucs
│       ├── pitch_analysis.py    # CREPE
│       ├── transcription.py     # Whisper
│       └── scoring.py           # Ollama jury
│
└── docker-compose.yml        # All services
```

### Pipeline Audio ("Informed Source Separation")

```
1. INIT (Setup)
   User sélectionne titre Spotify
   → Auto-search YouTube (ou fallback URL manuelle)
   → Download (yt-dlp)
   → Separation (Demucs htdemucs) → vocals.wav + instrumentals.wav
   → Feature extraction (CREPE, Librosa)

2. LIVE (Performance)
   Frontend: Stream micro (WebSocket) + Metadata Spotify (timestamp)
   Backend: VAD (Voice Activity Detection), feedback visuel temps réel

3. POST (Analyse)
   → Synchronisation (Cross-Correlation) → offset temporel
   → De-bleeding (soustraction musique captée par micro)
   → Scoring: Pitch DTW, Rhythm Check, Lyric Check (Whisper vs paroles)
   → Ollama: Génération commentaires jury
```

## Code Patterns

### FastAPI Async Pattern
```python
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class RequestModel(BaseModel):
    field: str

@router.post("/endpoint")
async def endpoint(request: RequestModel):
    # Async operations
    return {"status": "ok"}
```

### Zustand Store Pattern
```typescript
import { create } from 'zustand'

interface State {
  value: string
  setValue: (v: string) => void
}

export const useStore = create<State>((set) => ({
  value: '',
  setValue: (v) => set({ value: v }),
}))

// Usage with selector (prevents unnecessary re-renders)
const value = useStore((state) => state.value)
```

### Celery Task Pattern (GPU)
```python
from celery import shared_task

# Lazy load models to manage GPU memory
_model = None

def get_model():
    global _model
    if _model is None:
        import torch
        _model = load_model()
        if torch.cuda.is_available():
            _model = _model.cuda()
    return _model

@shared_task(bind=True, name="tasks.module.task_name")
def task_name(self, param: str) -> dict:
    self.update_state(state="PROGRESS", meta={"step": "loading"})
    model = get_model()
    # Process...
    return {"status": "completed"}
```

### Demucs Usage
```python
from demucs.pretrained import get_model
from demucs.apply import apply_model
import torch
import torchaudio

model = get_model("htdemucs")  # Best quality
waveform, sr = torchaudio.load("audio.wav")
# Resample to 44100Hz, convert to stereo, add batch dim
sources = apply_model(model, waveform.unsqueeze(0))
# sources shape: (1, 4, 2, samples) -> drums, bass, other, vocals
vocals = sources[0, 3]
```

### CREPE Usage
```python
import crepe
from scipy.io import wavfile

sr, audio = wavfile.read("vocals.wav")
time, frequency, confidence, activation = crepe.predict(
    audio, sr,
    model_capacity="medium",
    viterbi=True,  # Smooth pitch
    step_size=10,  # 10ms hop
)
```

### Whisper Usage
```python
import whisper

model = whisper.load_model("turbo")
result = model.transcribe(
    "vocals.wav",
    language="fr",
    word_timestamps=True,
)
# result["text"], result["segments"][i]["words"]
```

### Ollama API
```python
import httpx

response = httpx.post(
    "http://ollama:11434/api/generate",
    json={
        "model": "llama3.2",
        "prompt": "...",
        "stream": False,
        "options": {"temperature": 0.8},
    },
    timeout=30.0,
)
text = response.json()["response"]
```

## API Endpoints

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/session/start` | POST | Initie session, lance download référence |
| `/api/session/fallback-source` | POST | Accepte URL YouTube manuelle |
| `/api/session/{id}/status` | GET | Statut de la session |
| `/stream/audio` | WebSocket | Envoi chunks audio micro |
| `/api/results/{sessionId}` | GET | JSON final + Commentaire IA |
| `/health` | GET | Health check |

## Deployment (Coolify)

- **Plateforme**: Coolify (self-hosted PaaS)
- **Orchestration**: Docker Compose
- **GPU**: NVIDIA CUDA (nvidia-docker requis)
- **Services**:
  - `frontend` - React app (Vite dev / Nginx prod)
  - `api` - FastAPI (Uvicorn)
  - `worker` - Celery workers (GPU queue)
  - `ollama` - LLM engine (GPU)
  - `postgres` - PostgreSQL 16
  - `redis` - Redis 7

### Variables d'environnement
```env
DATABASE_URL=postgresql://voicejury:password@postgres:5432/voicejury
REDIS_URL=redis://redis:6379/0
OLLAMA_HOST=http://ollama:11434
SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx
SECRET_KEY=change-me-in-production
WHISPER_MODEL=turbo
```

## Critical Don'ts

- **Never** store audio files permanently (clean after session)
- **Never** call Ollama synchronously in API routes (use Celery)
- **Never** load ML models at import time (lazy load for GPU memory)
- **Never** use blocking I/O in FastAPI async routes
- **Never** hardcode credentials (use environment variables)

## Performance Guidelines

| Metric | Target |
|--------|--------|
| API Response | <200ms |
| Demucs Separation | <30s for 3min song (GPU) |
| Whisper Transcription | <10s for 3min (turbo, GPU) |
| CREPE Pitch | <5s for 3min (medium, GPU) |
| Total Analysis | <60s |

## Key Documentation

- [StartingDraft.md](StartingDraft.md) - Documentation technique complète V1.0
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [Celery Docs](https://docs.celeryq.dev/)
- [Zustand Docs](https://zustand.docs.pmnd.rs/)
- [Demucs GitHub](https://github.com/facebookresearch/demucs)
- [CREPE GitHub](https://github.com/marl/crepe)
- [Whisper GitHub](https://github.com/openai/whisper)
