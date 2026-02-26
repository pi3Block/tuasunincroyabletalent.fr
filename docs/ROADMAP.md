# Roadmap Implementation — Kiaraoke

> Source de verite unique pour l'etat d'avancement et les taches a implementer.
> Chaque session Claude doit lire ce fichier en premier.

Last updated: 2026-02-26

---

## Etat actuel (~100% implemente, migration Next.js terminee)

### Ce qui MARCHE — ne pas toucher sauf bug

| Composant | Statut | Fichiers cles |
|-----------|--------|---------------|
| Pipeline audio 7 etapes (Demucs → CREPE → Whisper → Genius → Scoring → Jury) | ✅ | `worker/tasks/pipeline.py` |
| Frontend UX complet (Landing SSG + App CSR, Next.js 15 App Router) | ✅ | `frontend-next/src/app/page.tsx`, `frontend-next/src/app/app/page.tsx` |
| Session management Redis (start, status polling, upload, analyze) | ✅ | `backend/app/routers/session.py` |
| Lyrics karaoke (LRCLib synced → Genius plain, word-timestamps via Whisper) | ✅ | `backend/app/routers/lyrics.py`, `worker/tasks/word_timestamps.py` |
| Caching 2-tier (Redis 1h + PostgreSQL 90-365j) pour lyrics et word-timestamps | ✅ | `backend/app/services/lyrics_cache.py`, `word_timestamps_cache.py` |
| 3-tier Whisper fallback (shared-whisper HTTP → Groq API → local PyTorch) | ✅ | `worker/tasks/transcription.py` |
| 3-tier Jury LLM fallback (LiteLLM/Groq → Ollama → heuristique) | ✅ | `worker/tasks/scoring.py` |
| Scoring DTW pitch + WER lyrics + onset rhythm | ✅ | `worker/tasks/scoring.py` |
| GPU time-sharing (unload Ollama avant Demucs) | ✅ | `worker/tasks/pipeline.py:92-125` |
| Langfuse tracing (pipeline + jury comments) | ✅ | `worker/tasks/tracing.py` |
| Audio track streaming HTTP Range (separated vocals/instrumentals) | ✅ | `backend/app/routers/audio.py` |
| Demucs cache par YouTube ID (evite re-separation) | ✅ | `backend/app/services/youtube_cache.py` |
| Mobile-first + orientation detection + landscape split-view | ✅ | `frontend-next/src/hooks/useOrientation.ts` |
| Real-time pitch detection locale (autocorrelation navigateur) | ✅ | `frontend-next/src/hooks/usePitchDetection.ts` |
| Health check complet (Redis + PostgreSQL) | ✅ | `backend/app/main.py:68-93` |
| Audio file cleanup (Celery beat, toutes les heures) | ✅ | `worker/tasks/cleanup.py`, `celery_app.py:114-119` |
| Redis session TTL (setex 3600s, rafraichi a chaque update) | ✅ | `backend/app/services/redis_client.py:35-42` |
| StudioMode UI (practice, analyzing, results) | ✅ | `frontend-next/src/audio/`, `app/app/page.tsx` |
| Persistent results (PostgreSQL + auto-save) | ✅ | `backend/app/models/session_results.py`, `routers/session.py:729-760` |
| Results history endpoint | ✅ | `backend/app/routers/results.py` → `GET /api/results/history` |
| Alembic migrations (initial schema, 4 tables) | ✅ | `backend/alembic/`, `alembic.ini` |
| Tests backend (pytest, 24 tests) | ✅ | `backend/tests/` (session, search, audio, health) |
| SEO complet (metadata, JSON-LD, robots.ts, sitemap.ts, llms.txt) | ✅ | `frontend-next/src/app/layout.tsx`, `robots.ts`, `sitemap.ts` |
| Next.js 15 migration (React 19, Tailwind 4, App Router) | ✅ | `frontend-next/` (54 fichiers TS/TSX) |
| Sentry error tracking (opt-in, backend + worker) | ✅ | `main.py`, `celery_app.py` |
| `.env.example` complet (12+ variables) | ✅ | `.env.example` |
| Dead code supprime (ancien results.py mock) | ✅ | Supprime, `results.py` recree pour history |

### Ce qui reste (P4 — post-MVP)

| Composant | Statut | Detail |
|-----------|--------|--------|
| De-bleeding | Absent | Soustraction musique captee par le micro |
| Cross-correlation sync | Absent | Alignement auto user/reference avant scoring |
| WebSocket live streaming | Absent | Streaming audio temps reel pendant enregistrement |
| Fine-tuning Jury-LoRA | Absent | Modele specialise pour commentaires jury |

---

## P0 — Deploiement (30min, config seulement)

Pre-requis : le code est pret, seule la config serveur manque.

### P0.1 — Nettoyage disque serveur

```bash
ssh coolify
docker image prune -a -f --filter "until=168h"
df -h /  # Verifier > 20 Go libres
```

### P0.2 — Variables d'environnement Coolify

Dans Coolify Dashboard → Application → Environment Variables :

```env
# Copier depuis augmenter.pro
AUGMENTER_DB_PASSWORD=<depuis augmenter.pro>
AUGMENTER_REDIS_PASSWORD=<depuis augmenter.pro>
LANGFUSE_PUBLIC_KEY=<depuis augmenter.pro>
LANGFUSE_SECRET_KEY=<depuis augmenter.pro>
GROQ_API_KEY=<depuis augmenter.pro, commence par gsk_>

# Propres a voicejury
SPOTIFY_CLIENT_ID=<Spotify Developer Dashboard>
SPOTIFY_CLIENT_SECRET=<Spotify Developer Dashboard>
GENIUS_API_TOKEN=<Genius API>
SECRET_KEY=<openssl rand -hex 32>

# LiteLLM (creer virtual key, voir Last Idea.md etape 5)
LITELLM_API_KEY=<a creer>

# Optionnel — Sentry (creer projet sur sentry.io)
SENTRY_DSN=<depuis sentry.io>
VITE_SENTRY_DSN=<depuis sentry.io, peut etre le meme DSN>
```

### P0.3 — Verifier gpu-worker-base

```bash
docker pull ghcr.io/pi3block/gpu-worker-base:latest
# Si erreur 404 → modifier docker-compose.coolify.yml :
#   worker-heavy.build.dockerfile: Dockerfile  (au lieu de Dockerfile.optimized)
```

### P0.4 — Deployer

Coolify Dashboard → Deploy. Verifier :
```bash
curl -s https://api.kiaraoke.fr/health
# Attendu: {"status": "healthy", "version": "0.1.0", "services": {"api": true, "redis": true, "postgres": true}}
docker ps --filter "name=kiaraoke"
```

### P0.5 — Premiere analyse (Celery beat)

Le worker doit etre lance avec `-B` pour activer le scheduler Celery beat :
```bash
# docker-compose.coolify.yml → worker-heavy command :
celery -A tasks.celery_app worker --loglevel=info --pool=solo -Q gpu-heavy,gpu,default -B
```

Verifier que le cleanup tourne :
```bash
docker logs <worker-container> | grep "Cleanup complete"
```

---

## P1 — Quick fixes ✅ COMPLETE

| Tache | Statut | Detail |
|-------|--------|--------|
| P1.1 Supprimer dead code results.py | ✅ | Supprime, recree pour `GET /api/results/history` |
| P1.2 Health check complet | ✅ | Redis ping + PostgreSQL SELECT 1, retourne healthy/degraded |
| P1.3 Mettre a jour .env.example | ✅ | 12+ variables ajoutees, organisees par section |
| P1.4 Audio file cleanup | ✅ | `worker/tasks/cleanup.py` + Celery beat (1h), preserve `cache/` |
| P1.5 Redis session TTL | ✅ | Deja en place: `setex` 3600s dans `set_session()`, rafraichi par `update_session()` |

---

## P2 — Features MVP+ ✅ COMPLETE

| Tache | Statut | Detail |
|-------|--------|--------|
| P2.1 StudioMode UI | ✅ | Multi-track complet avec Web Audio API, volume/mute/solo, transport, download |
| P2.2 Persistent results | ✅ | `session_results` table (JSONB jury), auto-persist au SUCCESS, `GET /api/results/history?limit=20` |
| P2.3 Alembic migrations | ✅ | `backend/alembic/` + initial migration (4 tables), `init_db()` essaie Alembic puis fallback `create_all()` |
| P2.4 Migration Next.js 15 | ✅ | React 19, App Router, Tailwind 4, SSG landing + CSR app, SEO complet, rebranding Kiaraoke |

---

## P3 — Qualite ✅ COMPLETE

| Tache | Statut | Detail |
|-------|--------|--------|
| P3.1 Tests backend (pytest) | ✅ | 24 tests: session flow, search, audio HTTP Range, health check. Mock Redis in-memory, mock Spotify/YouTube/Celery |
| P3.2 Sentry error tracking | ✅ | Opt-in via `SENTRY_DSN`. API (FastAPI+SQLAlchemy), Worker (Celery) |

### Lancer les tests

```bash
# Backend
cd backend && pip install -r requirements.txt && pytest -v

# Frontend lint + build
cd frontend-next && npm run lint && npm run build
```

---

## P4 — Features avancees (post-MVP)

### P4.1 — De-bleeding (soustraction musique micro)

**Principe :** L'enregistrement utilisateur contient la musique de fond captee par le micro. Soustraire le signal `instrumentals` reference du signal utilisateur pour isoler uniquement la voix.

**Implementation :**
1. Aligner temporellement user_recording avec reference_instrumentals (cross-correlation)
2. Soustraire le signal aligne (spectral subtraction ou simple soustraction apres gain matching)
3. Appliquer un gate/limiter pour eviter les artefacts

**Fichier :** `worker/tasks/audio_separation.py` — ajouter fonction `debleed_user_audio()`
**Appel :** `worker/tasks/pipeline.py` — entre Demucs et CREPE

### P4.2 — Cross-correlation sync

**Principe :** Calculer le decalage temporel entre l'enregistrement utilisateur et la reference pour aligner avant scoring.

**Implementation :**
```python
from scipy.signal import correlate
offset_samples = np.argmax(correlate(user_audio, ref_audio)) - len(ref_audio)
offset_seconds = offset_samples / sample_rate
```

**Fichier :** `worker/tasks/pipeline.py` — nouvelle etape entre separation et pitch extraction

### P4.3 — WebSocket live streaming

**Principe :** Envoyer les chunks audio en temps reel pendant l'enregistrement pour feedback instantane.

**Backend :** `backend/app/routers/stream.py` — WebSocket endpoint
**Frontend :** Modifier `frontend-next/src/hooks/useAudioRecorder.ts` pour envoyer chunks via WebSocket
**Worker :** Pas de changement (traitement reste post-recording)

### P4.4 — Fine-tuning Jury-LoRA

**Principe :** Entrainer un adapteur LoRA sur un dataset de commentaires jury TV pour des reponses plus authentiques.

**Ref :** `StartingDraft.md` contient la strategie QLoRA detaillee
**Dataset :** ~500 exemples (score, contexte, commentaire) par persona
**Outil :** Unsloth + Llama 3 base
**Deploiement :** Ollama custom model sur GPU 0

---

## Architecture de reference

Voir ces fichiers pour comprendre l'architecture :
- `CLAUDE.md` — Guide developpeur complet (stack, patterns, endpoints, deployment)
- `docs/UNIFIED_ARCHITECTURE.md` — Infrastructure multi-projets (GPU, DB, Redis, LiteLLM, Langfuse)
- `docker-compose.coolify.yml` — Configuration production
- `Last Idea.md` — Guide deploiement Coolify etape par etape
