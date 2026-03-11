# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kiaraoke** (anciennement "Tu as un incroyable talent ?") — Application web d'analyse vocale par IA avec jury personnalise. Evalue le chant d'un utilisateur par rapport a une version originale (Spotify/YouTube), avec feedback genere par 3 Personas IA jury.

- **Domaine**: kiaraoke.fr / api.kiaraoke.fr
- **Mobile-First**: 100% mobile-friendly. Layouts adaptatifs (portrait, landscape, desktop). Orientation detection pour split-view en paysage mobile.

## Commands

```bash
# === PRODUCTION (Coolify) ===
# Deploiement via Coolify Dashboard — docker-compose.coolify.yml
# Pas de `docker-compose up` manuel en prod

# === DEVELOPPEMENT LOCAL ===
# Frontend dev (hot reload + Turbopack)
cd frontend-next && npm run dev

# Backend dev (avec reload)
cd backend && uvicorn app.main:app --reload --port 8000

# Worker Celery dev (GPU requis pour Demucs/CREPE)
cd worker && celery -A tasks.celery_app worker --loglevel=info --pool=solo -Q gpu-heavy,gpu,default

# Build frontend prod (Next.js standalone)
cd frontend-next && npm run build

# === TESTS ===
# Backend tests (pytest)
cd backend && pytest -v

# Frontend lint
cd frontend-next && npm run lint

# Rebuild image Docker
docker-compose -f docker-compose.dev.yml build --no-cache <service>
```

## Stack Technique

- **Infrastructure**: Docker Compose (orchestre par Coolify) + NVIDIA CUDA + Traefik reverse proxy
- **Frontend**: Next.js 15 (App Router, Turbopack) + React 19 + TypeScript 5.7 + Zustand 5 + Tailwind 4 + Framer Motion 12 + Radix UI (shadcn)
- **Backend API**: Python 3.11 + FastAPI + Uvicorn + Pydantic 2 + SQLAlchemy 2 (async) + asyncpg
- **Backend Worker**: Python 3.11 + Celery 5 + Redis (GPU tasks) + Langfuse (tracing)
- **LLM**: LiteLLM Proxy (https://litellm.augmenter.pro) -> alias jury-comment/groq-qwen3-32b (Groq qwen3-32b) + fast/groq-fast (llama-3.1-8b-instant fallback) + heuristique
- **Storage**: PostgreSQL 16 (shared), Redis 7 DB2 (shared), Filesystem (audio temp)
- **Audio Processing** (actuel → cible SOTA, voir docs/SOTA_MODELS.md) :
  - **BS-RoFormer** (separation, SDR 12.97, +52% vs Demucs) ✅ Sprint 2.2 + Demucs fallback + de-bleeding Wiener
  - torchcrepe → **SwiftF0** (pitch detection, CPU-only, 42x plus rapide, +12% precision)
  - **DeepFilterNet3** (denoise user recording, CPU-only) ✅ Sprint 2.1
  - scipy.signal.correlate - Cross-correlation sync (auto offset detection)
  - shared-whisper HTTP (Faster Whisper large-v3-turbo, GPU 3 RTX 3070) + Groq Whisper API fallback
  - whisper-timestamped - Word-level alignment (forced alignment + DTW)
  - **UTMOSv2** (score qualite vocale MOS, GPU ~500 MB) + **MERT-v1-95M** (features musicales, GPU ~1 GB) ✅ Sprint 2.3
  - Librosa - Onset detection (rhythm)
  - fastdtw - Pitch comparison (Dynamic Time Warping)
  - jiwer - Word Error Rate (lyrics accuracy)
  - Unsloth + QLoRA - Fine-tuning Qwen3:4b for jury personas

## Architecture

### Project Structure

```
tuasunincroyabletalent.fr/
├── frontend-next/                 # Next.js 15 App Router (standalone output)
│   ├── next.config.ts             # Standalone, API rewrites, security headers
│   ├── public/
│   │   ├── llms.txt               # LLM-friendly site description
│   │   └── favicon.svg
│   └── src/
│       ├── app/
│       │   ├── layout.tsx         # Root layout (metadata, JSON-LD, viewport)
│       │   ├── page.tsx           # Landing page SSG (Hero, HowItWorks, etc.)
│       │   ├── robots.ts          # robots.txt generation
│       │   ├── sitemap.ts         # sitemap.xml generation
│       │   ├── globals.css        # Tailwind 4 + karaoke animations
│       │   ├── app/
│       │   │   ├── layout.tsx     # /app layout (metadata "Studio")
│       │   │   └── page.tsx       # Interactive app (CSR, full flow)
│       │   └── results/
│       │       └── [sessionId]/page.tsx  # Results page (dynamic route)
│       ├── stores/                # Zustand (sessionStore, audioStore)
│       ├── components/
│       │   ├── app/               # TrackSearch, YouTubePlayer, PitchIndicator,
│       │   │                      # LandscapeRecordingLayout, LyricsDisplay
│       │   ├── lyrics/            # LyricsDisplayPro, KaraokeWord (Framer Motion energy glow),
│       │   │                      # LyricLine, FlowBar, LyricsControls, TimelineDebug
│       │   ├── sections/          # Hero, HowItWorks, RecentPerformances, TechStack
│       │   ├── layout/            # Footer
│       │   └── ui/                # shadcn (button, card, slider, badge, progress...)
│       ├── hooks/                 # useAudioRecorder, usePitchDetection,
│       │                          # useWordTimestamps, useYouTubePlayer,
│       │                          # useLyricsSync, useLyricsScroll, useOrientation,
│       │                          # useFlowEnvelope (getEnergyAtTime → karaoke glow),
│       │                          # usePrefersReducedMotion (delegates to Framer Motion),
│       │                          # useSSE (Server-Sent Events + polling fallback)
│       ├── audio/                 # Multi-track player (AudioContext, TrackProcessor,
│       │                          # StudioMode, TrackMixer, TransportBar)
│       ├── api/                   # API client (fetch wrapper)
│       ├── lib/                   # Utilities (cn, etc.)
│       └── types/                 # TypeScript types + animation config constants
│           └── lyrics.ts          # ENERGY_CONFIG, BLUR_CONFIG, SCROLL_SPRING_CONFIG,
│                                  # PERFORMANCE_CONFIG, DEFAULT_ANIMATION_CONFIG
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
│       │   ├── results.py         # /api/results/* (history)
│       │   └── sse.py             # /api/session/{id}/stream (SSE real-time updates)
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
│       ├── audio_separation.py    # Demucs htdemucs (lazy loaded, GPU) + de-bleeding
│       ├── sync.py                # Cross-correlation sync (auto offset detection)
│       ├── pitch_analysis.py      # torchcrepe (full/tiny, GPU)
│       ├── transcription.py       # 3-tier: shared-whisper -> Groq -> local
│       ├── scoring.py             # DTW + WER + jury parallele (3 personas, 3 tiers + LoRA)
│       ├── lyrics.py              # Genius API scraper
│       ├── word_timestamps.py     # whisper-timestamped (forced alignment)
│       ├── word_timestamps_db.py  # PostgreSQL direct (psycopg2)
│       ├── cleanup.py             # Celery beat: delete old session audio files (>2h)
│       └── tracing.py             # Langfuse integration (singleton + context managers)
│
├── fine-tuning/                   # LoRA fine-tuning infrastructure (Jury personas)
│   ├── requirements.txt           # unsloth, transformers, datasets, trl, peft, bitsandbytes
│   ├── export_dataset.py          # Langfuse API → JSONL per persona
│   ├── train.py                   # Unsloth QLoRA (Qwen3-4B, r=16, alpha=32, 4-bit)
│   ├── convert_to_gguf.py         # Merge LoRA → GGUF Q4_K_M via Unsloth
│   ├── Modelfile.le-cassant       # Ollama Modelfile (Le Cassant persona)
│   ├── Modelfile.l-encourageant   # Ollama Modelfile (L'Encourageant persona)
│   ├── Modelfile.le-technique     # Ollama Modelfile (Le Technique persona)
│   └── deploy.sh                  # ollama create × 3 + smoke test
│
├── docker-compose.coolify.yml     # PRODUCTION (Coolify) — 3 services + shared infra
├── docker-compose.dev.yml         # Developpement local (standalone)
├── docker-compose.yml             # Base compose
├── docker-compose.prod.yml        # Production override (GPU)
└── docs/
    └── UNIFIED_ARCHITECTURE.md    # Architecture multi-projets unifiee
```

### Pipeline Audio — Actuel (11 etapes)

```
analyze_performance (Celery task, gpu-heavy queue)
│
├─ Step 1: Unload Ollama Embed (keep_alive:0, libere ~3.9 GB VRAM sur GPU 4 pour RoFormer)
│           Embed (port 11438, gte-qwen2-1.5b-instruct-embed-f16, GPU 4)
│           llama-server (port 11440, GPUs 1-3) et Heavy (port 11434, GPU 0) = pas de conflit
│           [non-fatal si injoignable]
│
├─ Step 1.5: DeepFilterNet3 — Denoise user recording ← Sprint 2.1
│             CPU-only, ~1s pour 3min. Toggle: DENOISE_ENABLED=true
│             Reduit bruit/reverb des micros mobiles → meilleur WER + pitch
│
├─ Step 2: BS-RoFormer — Separation user audio → vocals.wav + instrumentals.wav
│           SDR 12.97 (+52% vs Demucs). Fallback: Demucs si RoFormer echoue.
│           + De-bleeding spectral (Wiener masks, env DEBLEED_ENABLED)
│           Env: SEPARATION_ENGINE=roformer|demucs
│           [GPU cuda:0, ~20-30s pour 3min]
│
├─ Step 3: RoFormer/Demucs — Separation reference (CACHE par YouTube ID)
│           + De-bleeding spectral
│           [0s si cache, ~20-30s sinon]
│
├─ Step 3.5: Cross-correlation sync — Auto offset detection
│             Downsample 8kHz → amplitude envelopes → scipy.signal.correlate
│             Applique offset au scoring si confidence > 0.3
│             [CPU, ~1s]
│
├─ Step 4: SwiftF0 — Pitch extraction (CPU-only, Sprint 1)
│           91.80% harmonic-mean, 42x plus rapide que CREPE, 0 GPU
│           [CPU ~2s total user + ref]
│
├─ Step 5: Whisper — Transcription user vocals (3-tier fallback)
│           Tier 1: shared-whisper HTTP (GPU 0 RTX 3070, large-v3-turbo int8, VAD)
│           Tier 2: Groq Whisper API (gratuit, whisper-large-v3-turbo)
│           Tier 3: Local PyTorch Whisper (desactive par defaut)
│           [~2-8s]
│
├─ Step 6: Genius API — Paroles reference
│           [~1s]
│
├─ Step 6.5: Enrichissement (parallele, Sprint 2.3)
│             UTMOSv2 — score qualite vocale MOS (GPU ~500 MB, ~1s)
│             MERT-v1-95M — features musicales (GPU ~1 GB, ~1s, cache youtube_id)
│             Env: UTMOS_ENABLED=true, MERT_ENABLED=true
│             [non-fatal si echoue]
│
└─ Step 7: Scoring + Jury LLM enrichi (parallele x3 personas)
           Pitch: DTW cents distance (40% du score), offset-aware
           Rhythm: Voice onset detection (30%), offset-aware
           Lyrics: WER jiwer (30%)
           Jury: asyncio.gather() 3 personas + MOS + music context
             Tier 1: LiteLLM -> Groq qwen3-32b
             Tier 2: LiteLLM -> fallback model
             Tier 3: Heuristique
           [~1-5s]

Total actuel: ~44-69s (1ere analyse) ou ~19-29s (reference en cache)
Cible Sprint 2: <25s (1ere) ou <8s (cache)
```

### Pipeline Audio — Cible SOTA (Sprint 2 COMPLETE)

```
analyze_performance (Celery task, gpu-heavy queue)
│
├─ Step 0: Unload Ollama Embed (port 11438, keep_alive:0, libere ~3.9 GB sur GPU 4)
│
├─ Step 1: DeepFilterNet3 — Denoise user recording [CPU, ~1s] ✅ Sprint 2.1
│
├─ Parallele CPU + GPU :
│   ├─ [CPU] SwiftF0 — Pitch user + ref (~2s total) ✅ Sprint 1
│   ├─ [CPU] Cross-correlation sync (~1s)
│   ├─ [GPU cuda:0] RoFormer — Separation user (~25s) ✅ Sprint 2.2
│   └─ [GPU cuda:0] RoFormer — Separation ref (0s cache, ~25s sinon)
│
├─ Parallele HTTP :
│   ├─ [GPU 0 resident] Whisper transcription (~3s)
│   └─ [HTTP] Genius lyrics (~1s)
│
├─ [GPU cuda:0] UTMOSv2 (~0.5 GB) + MERT (~1 GB) — qualite + contexte ✅ Sprint 2.3
│
└─ [HTTP] Scoring enrichi + Jury LLM 3 personas + MOS + music context (~1-5s)

Total cible: <25s (1ere) ou <8s (cache) — 1 seul GPU worker
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
| `/api/session/{id}/analysis-status` | GET | Statut task Celery (poll, fallback si SSE indispo) |
| `/api/session/{id}/stream` | GET | SSE real-time updates (session_status, analysis_progress, analysis_complete) |
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

### 3-Tier LLM Fallback (Jury) + LoRA Fine-tuning
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
    # Tier 2: Ollama — fine-tuned LoRA per persona (if USE_FINETUNED_JURY=true)
    #   "Le Cassant" → "kiaraoke-jury-cassant"
    #   "L'Encourageant" → "kiaraoke-jury-encourageant"
    #   "Le Technique" → "kiaraoke-jury-technique"
    #   Falls back to base qwen3:4b if fine-tuned model fails
    try:
        model = PERSONA_FINETUNED_MODELS.get(persona, "qwen3:4b") if USE_FINETUNED_JURY else "qwen3:4b"
        response = await httpx_client.post(
            f"{OLLAMA_HOST}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
        )
        return response.json()["response"]
    except:
        pass
    # Tier 3: Heuristique (commentaire pre-ecrit base sur score + persona)
    return heuristic_comment(persona, score)
```

### Singleton AudioContext (Playback + Microphone)
```typescript
// CRITICAL: All audio (playback, recording, pitch detection) MUST share a single
// AudioContext. Multiple contexts cause hardware contention → music stuttering/jitter.
import { getAudioContext } from '@/audio/core/AudioContext'

// In usePitchDetection — use the shared context, NOT new AudioContext()
const audioContext = getAudioContext()
const analyser = audioContext.createAnalyser()
const source = audioContext.createMediaStreamSource(micStream)
source.connect(analyser)

// On cleanup: disconnect source/analyser, but NEVER close the shared context
source.disconnect()
// audioContext.close()  ← NEVER do this, it kills playback
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

### Energy-Reactive Karaoke Words (Framer Motion)
```
Data flow: useFlowEnvelope(youtubeId) → getEnergyAtTime(t) → 0-1
Threading: page.tsx → LyricsDisplayPro → LyricLine → KaraokeWordGroup → KaraokeWord
Compute:   energy = getEnergyAtTime(adjustedTime)  // inside LyricsDisplayPro
Render:    motion.span with animate={{ textShadow, scale }} + spring physics
           clipPath stays in style (instant, GPU), energy effects in animate (spring)
Config:    All constants centralized in types/lyrics.ts:
           - ENERGY_CONFIG (threshold, glow multipliers, scale, spring physics)
           - BLUR_CONFIG (depth-of-field per distance)
           - SCROLL_SPRING_CONFIG (auto-scroll physics)
           - PERFORMANCE_CONFIG (render window, word tracking hysteresis, EMA smoothing)
           - DEFAULT_ANIMATION_CONFIG (line-level glow, scale, transition)
Glow:      LyricLine glow (textShadow) applies ONLY in 'line' mode.
           In karaoke/word modes, KaraokeWord handles glow via Framer Motion per-word.
           This avoids double glow (parent + child textShadow stacking).
CSS:       In karaoke/word modes, CSS transition excludes `transform` to avoid
           competing with Framer Motion spring on KaraokeWord children.
           Only opacity + filter are CSS-transitioned; scale is instant on container.
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
| `frontend` | Next.js standalone (Node.js) | SSR/SSG, kiaraoke.fr |
| `api` | Dockerfile (python:3.11) | FastAPI, api.kiaraoke.fr |
| `worker-heavy` | Dockerfile.optimized | Celery GPU (Demucs, CREPE, Whisper) |

### Infrastructure partagee (Coolify)

| Service | Port | Reseau | Utilisation voicejury |
|---------|------|--------|----------------------|
| shared-postgres | 5432 | coolify DNS | Base voicejury_db, user augmenter |
| shared-redis | 6379 | coolify DNS | DB index 2 (broker + sessions) |
| LiteLLM Proxy | https | litellm.augmenter.pro | Jury LLM — alias: jury-comment (Groq qwen3-32b), fast (llama-3.1-8b), default (qwen3.5:9b), reasoning (Hauhau 27B) |
| Ollama Heavy | 11434 | host.docker.internal | qwen3.5:9b (GPU 0 RTX 3070, ~6 GB) — alias LiteLLM: default |
| llama-server Hauhau | 11440 | host.docker.internal | Qwen3.5-27B Q5_K_M (GPUs 1-3) — alias LiteLLM: reasoning/vision/a3b |
| Ollama Embed | 11438 | host.docker.internal | gte-qwen2-1.5b-instruct-embed-f16 (GPU 4) — alias LiteLLM: embedding |
| shared-whisper | 9000 | host.docker.internal | Faster Whisper HTTP (GPU 4 RTX 3080, large-v3-turbo) |
| Langfuse | 3000 | coolify DNS | Tracing LLM |

### GPU Time-Sharing (GPU 4, RTX 3080, 10 Go) — Layout V5 (2026-03-11)

```
GPU 0 (RTX 3070): Ollama Heavy qwen3.5:9b (~6 GB) — pas de conflit avec kiaraoke
GPU 1-3 (RTX 3070/3080): llama-server Hauhau 27B (~21.5 GB) — pas de conflit
GPU 4 (RTX 3080, 10 GB): Ollama Embed (~3.9 GB) + Whisper (~4.4 GB) + kiaraoke

Pipeline kiaraoke demarre sur GPU 4:
  1. POST keep_alive:0 → Ollama Embed (port :11438) decharge (~3.9 GB liberes)
  2. Disponible: 10 - 4.4 (Whisper) = 5.6 GB → RoFormer s'execute (~4-5 GB)
  3. UTMOSv2 + MERT s'executent (~1.5 GB supplementaire)
  4. Pipeline termine → Embed recharge au prochain appel embedding
```

### Variables d'environnement

```env
# Database (shared-postgres, voicejury_db)
DATABASE_URL=postgresql://augmenter:${AUGMENTER_DB_PASSWORD}@shared-postgres:5432/voicejury_db

# Redis (shared-redis, DB index 2)
REDIS_URL=redis://:${AUGMENTER_REDIS_PASSWORD}@shared-redis:6379/2

# LLM — Jury generation (via LiteLLM proxy public)
LITELLM_HOST=https://litellm.augmenter.pro
LITELLM_API_KEY=sk-voice-jury
LITELLM_JURY_MODEL=jury-comment
LITELLM_JURY_FALLBACK_MODEL=fast
# Ollama Embed — unload GPU 4 avant RoFormer
OLLAMA_EMBED_HOST=http://host.docker.internal:11438
OLLAMA_EMBED_MODEL=rjmalagon/gte-qwen2-1.5b-instruct-embed-f16

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

# Audio processing (optionnel)
DENOISE_ENABLED=true             # DeepFilterNet3 denoise avant Demucs (CPU, Sprint 2.1)
DENOISE_ATTEN_LIMIT_DB=          # Limite attenuation dB (vide=max, 6.0=leger)
SEPARATION_ENGINE=roformer       # roformer (default, +52% SDR) ou demucs (fallback) — Sprint 2.2
AUDIO_SEP_MODEL=model_bs_roformer_ep_317_sdr_12.9755.ckpt  # Modele BS-Roformer
DEBLEED_ENABLED=true             # Spectral de-bleeding post-separation (Wiener masks)
UTMOS_ENABLED=true               # UTMOSv2 vocal quality MOS (GPU ~500 MB, Sprint 2.3)
MERT_ENABLED=true                # MERT-v1-95M music features (GPU ~1 GB, Sprint 2.3)

# Fine-tuning (optionnel)
USE_FINETUNED_JURY=false         # Use LoRA fine-tuned models for jury personas in Tier 2

# Sentry (optionnel)
SENTRY_DSN=https://xxx@sentry.io/xxx

# Frontend (Next.js)
NEXT_PUBLIC_API_URL=https://api.kiaraoke.fr
```

## Database Tables (PostgreSQL — voicejury_db)

| Table | Cle | TTL | Contenu |
|-------|-----|-----|---------|
| `lyrics_cache` | spotify_track_id (UNIQUE) | 90-365j selon source | Paroles synced/unsynced, source LRCLib/Genius |
| `lyrics_offsets` | (spotify_track_id, youtube_video_id) | permanent | Offset utilisateur en secondes |
| `word_timestamps_cache` | (spotify_track_id, youtube_video_id) | 90j | Word-level timestamps JSON, source whisper/musixmatch |
| `session_results` | session_id (UNIQUE) | permanent | Score, pitch/rhythm/lyrics accuracy, jury_comments JSONB |

Tables creees via Alembic migrations (`alembic upgrade head`), fallback `create_all()` si Alembic echoue.

## Git / Deploy Policy

- **NEVER** run git add, git commit, git push, or any git write command. The user handles all git operations and deployments himself.
- **NEVER** waste tokens on git status, git diff, git log or other git read commands unless explicitly asked.
- When done coding, just say what files were changed and stop. No commit, no push, no deploy steps.

## Critical Don'ts

- **Never** store audio files permanently (clean after session)
- **Never** call LLM synchronously in API routes (use Celery)
- **Never** load ML models at import time (lazy load for GPU memory)
- **Never** use blocking I/O in FastAPI async routes
- **Never** hardcode credentials (use environment variables)
- **Never** use `large-v3` Whisper (non-turbo) — 7.6 Go VRAM, CUDA OOM on 8GB GPUs
- **Never** run RoFormer pendant qu'Ollama Embed est charge sur GPU 4 (OOM — ~1.7 GB libre insuffisant)
- **Never** `REINDEX SYSTEM` sur shared-postgres en production
- **Never** create a second `new AudioContext()` — use `getAudioContext()` singleton (contention = stuttering)

## Performance Guidelines

| Metric | Actuel | Cible SOTA (Sprint 2) |
|--------|--------|----------------------|
| API Response | <200ms | <200ms |
| Source Separation (Demucs/RoFormer) | <30s (Demucs GPU) | <25s (RoFormer GPU) |
| Cross-correlation Sync | <1s (CPU) | <1s (CPU) |
| Whisper Transcription (shared-whisper) | <3s (GPU 3) | <3s (GPU 3) |
| Pitch Extraction | <5s CREPE (GPU) | **<1s SwiftF0 (CPU)** |
| DeepFilterNet3 Denoise | N/A | **<1s (CPU)** |
| UTMOSv2 + MERT | N/A | **<2s (GPU, apres separation)** |
| Jury Generation (3 personas parallel) | <5s | <5s |
| SSE Event Latency | <500ms | <500ms |
| Total Analysis (first time) | <67s | **<25s** |
| Total Analysis (cached reference) | <27s | **<8s** |
| GPUs worker | 2 | **1** |

## SEO & Web Standards

Le frontend Next.js inclut un SEO complet :

| Fichier | Role |
|---------|------|
| `frontend-next/src/app/layout.tsx` | Metadata, Open Graph, Twitter Card, JSON-LD (WebApp + FAQ) |
| `frontend-next/src/app/robots.ts` | robots.txt dynamique |
| `frontend-next/src/app/sitemap.ts` | sitemap.xml dynamique (/, /app) |
| `frontend-next/public/llms.txt` | Description LLM-friendly du site |
| `frontend-next/next.config.ts` | Security headers (HSTS, X-Frame-Options, Permissions-Policy) |

## Key Documentation

- [docs/VISION_2026.md](docs/VISION_2026.md) - **Strategie + Roadmap sprints** (Sprint 0-6, GPU-first, social last)
- [docs/SOTA_MODELS.md](docs/SOTA_MODELS.md) - **Catalogue modeles SOTA** (SwiftF0, RoFormer, DeepFilterNet3, STARS, UTMOSv2, MERT...)
- [docs/GPU_TIMESHARING.md](docs/GPU_TIMESHARING.md) - **Time-sharing A3B** (unload auto, allocation 1 GPU post-SwiftF0)
- [docs/ROADMAP.md](docs/ROADMAP.md) - Roadmap implementation detaillee (⚠️ a synchroniser avec VISION_2026.md)
- [docs/UNIFIED_ARCHITECTURE.md](docs/UNIFIED_ARCHITECTURE.md) - Architecture multi-projets unifiee (GPU, DB, Redis, LiteLLM, Langfuse, shared-whisper)
- [Last Idea.md](Last%20Idea.md) - Guide deploiement Coolify voicejury etape par etape
- [StartingDraft.md](StartingDraft.md) - Documentation technique V1.0 (vision fine-tuning)
