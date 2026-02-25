# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tu as un incroyable talent ?** - Application web type "Show TV" permettant d'evaluer le chant d'un utilisateur par rapport a une version originale (Spotify/YouTube), avec feedback genere par 3 Personas IA jury style "Incroyable Talent".

**Mobile-First**: 100% mobile-friendly. Layouts adaptatifs (portrait, landscape, desktop). Orientation detection pour split-view en paysage mobile.

## Commands

```bash
# === PRODUCTION (Coolify) ===
# Deploiement via Coolify Dashboard — docker-compose.coolify.yml
# Pas de `docker-compose up` manuel en prod

# === DEVELOPPEMENT LOCAL ===
# Frontend dev (hot reload)
cd frontend && npm run dev

# Backend dev (avec reload)
cd backend && uvicorn app.main:app --reload --port 8000

# Worker Celery dev (GPU requis pour Demucs/CREPE)
cd worker && celery -A tasks.celery_app worker --loglevel=info --pool=solo -Q gpu-heavy,gpu,default

# Build frontend prod
cd frontend && npm run build

# === TESTS ===
# Backend tests (pytest)
cd backend && pytest -v

# Frontend tests (vitest)
cd frontend && npm test

# Rebuild image Docker
docker-compose -f docker-compose.dev.yml build --no-cache <service>
```

## Stack Technique

- **Infrastructure**: Docker Compose (orchestre par Coolify) + NVIDIA CUDA + Traefik reverse proxy
- **Frontend**: React 18 + TypeScript 5.6 + Vite 6 + Zustand 5 + Tailwind 3 + Framer Motion 12 + Radix UI (shadcn)
- **Backend API**: Python 3.11 + FastAPI + Uvicorn + Pydantic 2 + SQLAlchemy 2 (async) + asyncpg
- **Backend Worker**: Python 3.11 + Celery 5 + Redis (GPU tasks) + Langfuse (tracing)
- **LLM**: LiteLLM Proxy -> Groq qwen3-32b (gratuit) + Ollama qwen3:4b (local GPU 0) + heuristique fallback
- **Storage**: PostgreSQL 16 (shared), Redis 7 DB2 (shared), Filesystem (audio temp)
- **Audio Processing**:
  - Demucs htdemucs - Source separation (vocals/instrumentals)
  - torchcrepe - Pitch detection (full/tiny models)
  - shared-whisper HTTP (Faster Whisper, GPU 4) + Groq Whisper API fallback
  - whisper-timestamped - Word-level alignment (forced alignment + DTW)
  - Librosa - Onset detection (rhythm)
  - fastdtw - Pitch comparison (Dynamic Time Warping)
  - jiwer - Word Error Rate (lyrics accuracy)

## Architecture

### Project Structure

```
tuasunincroyabletalent.fr/
├── frontend/                      # React 18 + Vite
│   ├── Dockerfile.prod            # Multi-stage (builder + nginx)
│   ├── nginx.conf                 # SPA routing + API/WS proxy
│   └── src/
│       ├── stores/                # Zustand (sessionStore, audioStore)
│       ├── components/
│       │   ├── landing/           # LandingPage, Hero, HowItWorks, Footer
│       │   ├── lyrics/            # LyricsDisplayPro, KaraokeWord, LyricLine
│       │   ├── audio/             # StudioMode, TrackMixer, TransportBar
│       │   └── ui/                # shadcn components (button, card, slider...)
│       ├── hooks/                 # useAudioRecorder, usePitchDetection,
│       │                          # useWordTimestamps, useYouTubePlayer,
│       │                          # useLyricsSync, useLyricsScroll, useOrientation
│       ├── audio/                 # Multi-track player (AudioContext, TrackProcessor)
│       ├── api/                   # API client (fetch wrapper)
│       └── types/                 # TypeScript types (lyrics, youtube)
│
├── backend/                       # FastAPI
│   ├── Dockerfile                 # Python 3.11 + uv, port 8080
│   └── app/
│       ├── main.py                # Lifespan, CORS, router registration
│       ├── config.py              # Pydantic Settings
│       ├── routers/
│       │   ├── session.py         # /api/session/* (start, status, upload, analyze)
│       │   ├── search.py          # /api/search/* (Spotify search, recent)
│       │   ├── audio.py           # /api/audio/* (track streaming, HTTP Range)
│       │   ├── lyrics.py          # /api/lyrics/* (lyrics, word-timestamps, generate)
│       │   └── results.py         # /api/results/* (history)
│       ├── services/
│       │   ├── database.py        # SQLAlchemy async engine + session
│       │   ├── redis_client.py    # Redis async (sessions TTL 1h)
│       │   ├── spotify.py         # Spotify OAuth2 Client Credentials
│       │   ├── youtube.py         # yt-dlp (search, download, validate)
│       │   ├── youtube_cache.py   # Demucs result cache (Redis + disk)
│       │   ├── lyrics.py          # LRCLib -> Genius (hierarchical chain)
│       │   ├── lyrics_cache.py    # 2-tier cache (Redis 1h + PostgreSQL 90-365d)
│       │   ├── lyrics_offset.py   # User offset per track/video pair
│       │   ├── word_timestamps_cache.py  # 2-tier cache word timestamps
│       │   └── search_history.py  # Recent searches (Redis list, max 20)
│       └── models/                # SQLAlchemy models
│           ├── lyrics_cache.py    # LyricsCache table + Base
│           ├── lyrics_offset.py   # LyricsOffset table
│           ├── word_timestamps_cache.py  # WordTimestampsCache table
│           └── session_results.py # SessionResult table (persistent results)
│
├── worker/                        # Celery (GPU)
│   ├── Dockerfile.optimized       # gpu-worker-base shared image (~2min build)
│   ├── Dockerfile.prod            # pytorch/pytorch:2.5.1-cuda12.4
│   └── tasks/
│       ├── celery_app.py          # Config + 3 queues (gpu-heavy, gpu, default)
│       ├── pipeline.py            # Orchestrateur (analyze_performance, prepare_reference)
│       ├── audio_separation.py    # Demucs htdemucs (lazy loaded, GPU)
│       ├── pitch_analysis.py      # torchcrepe (full/tiny, GPU)
│       ├── transcription.py       # 3-tier: shared-whisper -> Groq -> local
│       ├── scoring.py             # DTW + WER + jury parallele (3 personas, 3 tiers)
│       ├── lyrics.py              # Genius API scraper
│       ├── word_timestamps.py     # whisper-timestamped (forced alignment)
│       ├── word_timestamps_db.py  # PostgreSQL direct (psycopg2)
│       ├── cleanup.py             # Celery beat: delete old session audio files (>2h)
│       └── tracing.py             # Langfuse integration (singleton + context managers)
│
├── docker-compose.coolify.yml     # PRODUCTION (Coolify) — 3 services + shared infra
├── docker-compose.dev.yml         # Developpement local (standalone)
├── docker-compose.yml             # Base compose
├── docker-compose.prod.yml        # Production override (GPU)
└── docs/
    └── UNIFIED_ARCHITECTURE.md    # Architecture multi-projets unifiee
```

### Pipeline Audio (7 etapes)

```
analyze_performance (Celery task, gpu-heavy queue)
│
├─ Step 1: Unload Ollama Light (GPU 0, keep_alive:0, libere ~4 Go VRAM)
│
├─ Step 2: Demucs — Separation user audio → vocals.wav + instrumentals.wav
│           [GPU, ~25s pour 3min]
│
├─ Step 3: Demucs — Separation reference (CACHE par YouTube ID)
│           [0s si cache, ~25s sinon]
│
├─ Step 4: torchcrepe — Pitch extraction
│           User: full model (precision)
│           Reference: tiny model (vitesse, 3x plus rapide)
│           [GPU, ~4s + ~1.5s]
│
├─ Step 5: Whisper — Transcription user vocals (3-tier fallback)
│           Tier 1: shared-whisper HTTP (GPU 4, medium model, VAD)
│           Tier 2: Groq Whisper API (gratuit, whisper-large-v3-turbo)
│           Tier 3: Local PyTorch Whisper (desactive par defaut)
│           [~2-8s]
│
├─ Step 6: Genius API — Paroles reference
│           [~1s]
│
└─ Step 7: Scoring + Jury LLM (parallele x3 personas)
           Pitch: DTW cents distance (40% du score)
           Rhythm: Voice onset detection (30%)
           Lyrics: WER jiwer (30%)
           Jury: asyncio.gather() 3 personas
             Tier 1: LiteLLM -> Groq qwen3-32b
             Tier 2: Ollama qwen3:4b (GPU 0)
             Tier 3: Heuristique
           [~1-5s]

Total: ~40-65s (premiere analyse) ou ~15-25s (reference en cache)
```

## API Endpoints

### Session

| Endpoint | Methode | Description |
|----------|---------|-------------|
| `/api/session/start` | POST | Initie session, search YouTube, queue download |
| `/api/session/fallback-source` | POST | URL YouTube manuelle |
| `/api/session/{id}/status` | GET | Statut session + reference |
| `/api/session/{id}/upload-recording` | POST | Upload audio utilisateur (WAV/WebM) |
| `/api/session/{id}/analyze` | POST | Lance pipeline analyse (Celery) |
| `/api/session/{id}/analysis-status` | GET | Statut task Celery (poll) |
| `/api/session/{id}/results` | GET | Resultats finaux |
| `/api/session/{id}/lyrics` | GET | Paroles (LRCLib/Genius) |
| `/api/session/{id}/lyrics-offset` | GET/POST | Offset lyrics user-adjustable |

### Search

| Endpoint | Methode | Description |
|----------|---------|-------------|
| `/api/search/tracks?q=&limit=` | GET | Recherche Spotify (market FR) |
| `/api/search/tracks/{id}` | GET | Details track Spotify |
| `/api/search/recent` | GET | Historique recherches recentes |

### Audio

| Endpoint | Methode | Description |
|----------|---------|-------------|
| `/api/audio/{session_id}/tracks` | GET | Liste pistes disponibles |
| `/api/audio/{session_id}/{source}/{type}` | GET | Stream audio (HTTP Range) |

source: `user` | `ref` — type: `vocals` | `instrumentals` | `original`

### Lyrics & Word Timestamps

| Endpoint | Methode | Description |
|----------|---------|-------------|
| `/api/lyrics/track/{spotify_id}` | GET | Paroles (LRCLib synced -> Genius plain) |
| `/api/lyrics/word-timestamps/{spotify_id}` | GET | Word-level timestamps (cache) |
| `/api/lyrics/word-timestamps/generate` | POST | Generer word timestamps (Celery GPU) |
| `/api/lyrics/word-timestamps/task/{id}` | GET | Statut generation (poll) |

### Results

| Endpoint | Methode | Description |
|----------|---------|-------------|
| `/api/results/history` | GET | Dernières performances (limit=20, max 50) |

### Health

| Endpoint | Methode | Description |
|----------|---------|-------------|
| `/health` | GET | Health check (Redis + PostgreSQL), retourne healthy/degraded |
| `/` | GET | Status basique |

## Code Patterns

### Celery Task with GPU Lazy Loading
```python
from celery import shared_task

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

### 2-Tier Cache Pattern (Redis + PostgreSQL)
```python
# Toutes les caches lyrics/word-timestamps utilisent ce pattern
async def get(spotify_track_id: str) -> dict | None:
    # Tier 1: Redis (1h TTL, fast)
    cached = await get_from_redis(spotify_track_id)
    if cached:
        return cached
    # Tier 2: PostgreSQL (90-365 jours, persistent)
    cached = await get_from_postgres(spotify_track_id)
    if cached:
        await set_in_redis(spotify_track_id, cached)  # Repopulate Redis
        return cached
    return None
```

### 3-Tier LLM Fallback (Jury)
```python
async def generate_comment(persona, prompt):
    # Tier 1: LiteLLM Proxy -> Groq qwen3-32b (gratuit, meilleur francais)
    try:
        response = await httpx_client.post(
            f"{LITELLM_HOST}/chat/completions",
            headers={"Authorization": f"Bearer {LITELLM_API_KEY}"},
            json={"model": LITELLM_JURY_MODEL, "messages": [...], "max_tokens": 300},
        )
        return response.json()["choices"][0]["message"]["content"]
    except:
        pass
    # Tier 2: Ollama qwen3:4b (local GPU 0)
    try:
        response = await httpx_client.post(
            f"{OLLAMA_HOST}/api/generate",
            json={"model": "qwen3:4b", "prompt": prompt, "stream": False},
        )
        return response.json()["response"]
    except:
        pass
    # Tier 3: Heuristique (commentaire pre-ecrit base sur score + persona)
    return heuristic_comment(persona, score)
```

### Zustand Store with Optimized Selectors
```typescript
import { create } from 'zustand'

// Fine-grained selectors pour eviter les re-renders
export const usePlaybackTime = () => useSessionStore(s => s.playbackTime)  // 60fps
export const useStatus = () => useSessionStore(s => s.status)              // rare
export const useLyricsState = () => useSessionStore(                       // shallow
  s => ({ lines: s.lyricsLines, syncType: s.lyricsSyncType }),
  shallow,
)
```

## Celery Task Routing

```python
# 3 queues par priorite GPU
task_routes = {
    "tasks.audio_separation.*": {"queue": "gpu-heavy"},   # Demucs ~4 Go VRAM
    "tasks.transcription.*":    {"queue": "gpu-heavy"},   # Whisper ~2-6 Go
    "tasks.pipeline.*":         {"queue": "gpu-heavy"},   # Orchestrateur
    "tasks.word_timestamps.*":  {"queue": "gpu-heavy"},   # Demucs + Whisper
    "tasks.pitch_analysis.*":   {"queue": "gpu"},         # CREPE ~1 Go
    "tasks.scoring.*":          {"queue": "default"},     # CPU only (HTTP calls)
    "tasks.lyrics.*":           {"queue": "default"},     # CPU only (API calls)
    "tasks.cleanup.*":          {"queue": "default"},     # CPU only (file cleanup)
}
```

## Deployment (Coolify)

### Production: `docker-compose.coolify.yml`

3 services propres + infrastructure partagee via reseau `coolify` :

| Service | Image | Role |
|---------|-------|------|
| `frontend` | Dockerfile.prod (nginx) | React SPA, Traefik -> tuasunincroyabletalent.fr |
| `api` | Dockerfile (python:3.11) | FastAPI, Traefik -> api.tuasunincroyabletalent.fr |
| `worker-heavy` | Dockerfile.optimized | Celery GPU (Demucs, CREPE, Whisper) |

### Infrastructure partagee (Coolify)

| Service | Port | Reseau | Utilisation voicejury |
|---------|------|--------|----------------------|
| shared-postgres | 5432 | coolify DNS | Base voicejury_db, user augmenter |
| shared-redis | 6379 | coolify DNS | DB index 2 (broker + sessions) |
| LiteLLM Proxy | 4000 | host.docker.internal | Jury LLM -> Groq qwen3-32b |
| Ollama Light | 11435 | host.docker.internal | qwen3:4b (GPU 0, fallback jury) |
| shared-whisper | 9000 | coolify DNS | Faster Whisper HTTP (GPU 4) |
| Langfuse | 3000 | coolify DNS | Tracing LLM |

### GPU Time-Sharing (GPU 0, RTX 3070, 8 Go)

```
Etat normal: Ollama Light qwen3:4b resident (~4.1 Go VRAM)

Pipeline voicejury demarre:
  1. POST keep_alive:0 → Ollama decharge modele (~4 Go liberes)
  2. Demucs s'execute (~4 Go VRAM)
  3. CREPE s'execute (~1 Go supplementaire)
  4. Pipeline termine → Ollama recharge au prochain appel (~2-3s cold start)
```

### Variables d'environnement

```env
# Database (shared-postgres, voicejury_db)
DATABASE_URL=postgresql://augmenter:${AUGMENTER_DB_PASSWORD}@shared-postgres:5432/voicejury_db

# Redis (shared-redis, DB index 2)
REDIS_URL=redis://:${AUGMENTER_REDIS_PASSWORD}@shared-redis:6379/2

# LLM — Jury generation
LITELLM_HOST=http://host.docker.internal:4000
LITELLM_API_KEY=sk-voice-jury
LITELLM_JURY_MODEL=jury-comment
OLLAMA_HOST=http://host.docker.internal:11435

# Whisper — Transcription
SHARED_WHISPER_URL=http://shared-whisper:9000
GROQ_API_KEY=gsk_...
WHISPER_LOCAL_FALLBACK=false

# Langfuse — Tracing
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://langfuse:3000

# Spotify
SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx

# Genius (lyrics)
GENIUS_API_TOKEN=xxx

# App
SECRET_KEY=xxx
DEBUG=false
AUDIO_OUTPUT_DIR=/app/audio_files
CUDA_VISIBLE_DEVICES=0

# Sentry (optionnel)
SENTRY_DSN=https://xxx@sentry.io/xxx
VITE_SENTRY_DSN=https://xxx@sentry.io/xxx
```

## Database Tables (PostgreSQL — voicejury_db)

| Table | Cle | TTL | Contenu |
|-------|-----|-----|---------|
| `lyrics_cache` | spotify_track_id (UNIQUE) | 90-365j selon source | Paroles synced/unsynced, source LRCLib/Genius |
| `lyrics_offsets` | (spotify_track_id, youtube_video_id) | permanent | Offset utilisateur en secondes |
| `word_timestamps_cache` | (spotify_track_id, youtube_video_id) | 90j | Word-level timestamps JSON, source whisper/musixmatch |
| `session_results` | session_id (UNIQUE) | permanent | Score, pitch/rhythm/lyrics accuracy, jury_comments JSONB |

Tables creees via Alembic migrations (`alembic upgrade head`), fallback `create_all()` si Alembic echoue.

## Critical Don'ts

- **Never** store audio files permanently (clean after session)
- **Never** call LLM synchronously in API routes (use Celery)
- **Never** load ML models at import time (lazy load for GPU memory)
- **Never** use blocking I/O in FastAPI async routes
- **Never** hardcode credentials (use environment variables)
- **Never** use `large-v3` Whisper on RTX 3060 Ti (CUDA OOM, 7.6 Go)
- **Never** run Demucs pendant qu'Ollama Light est charge (GPU OOM)
- **Never** `REINDEX SYSTEM` sur shared-postgres en production

## Performance Guidelines

| Metric | Target |
|--------|--------|
| API Response | <200ms |
| Demucs Separation | <30s for 3min song (GPU) |
| Whisper Transcription (shared-whisper) | <3s for 3min (VAD, GPU 4) |
| CREPE Pitch (full) | <5s for 3min (GPU) |
| Jury Generation (3 personas parallel) | <5s |
| Total Analysis (first time) | <65s |
| Total Analysis (cached reference) | <25s |

## Key Documentation

- [docs/ROADMAP.md](docs/ROADMAP.md) - **Roadmap implementation** (etat d'avancement, taches priorisees, specs techniques)
- [docs/UNIFIED_ARCHITECTURE.md](docs/UNIFIED_ARCHITECTURE.md) - Architecture multi-projets unifiee (GPU, DB, Redis, LiteLLM, Langfuse, shared-whisper)
- [Last Idea.md](Last%20Idea.md) - Guide deploiement Coolify voicejury etape par etape
- [StartingDraft.md](StartingDraft.md) - Documentation technique V1.0 (vision fine-tuning)
