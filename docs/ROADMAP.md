# Roadmap Implementation — Tu as un incroyable talent ?

> Source de verite unique pour l'etat d'avancement et les taches a implementer.
> Chaque session Claude doit lire ce fichier en premier.

Last updated: 2026-02-25

---

## Etat actuel (~75% implemente)

### Ce qui MARCHE — ne pas toucher sauf bug

| Composant | Statut | Fichiers cles |
|-----------|--------|---------------|
| Pipeline audio 7 etapes (Demucs → CREPE → Whisper → Genius → Scoring → Jury) | ✅ | `worker/tasks/pipeline.py` |
| Frontend UX complet (Landing → Search → Record → Analyze → Results) | ✅ | `frontend/src/App.tsx` |
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
| Mobile-first + orientation detection + landscape split-view | ✅ | `frontend/src/hooks/useOrientation.ts` |
| Real-time pitch detection locale (autocorrelation navigateur) | ✅ | `frontend/src/hooks/usePitchDetection.ts` |

### Ce qui NE MARCHE PAS ou est MANQUANT

| Composant | Statut | Detail |
|-----------|--------|--------|
| Results endpoint `/api/results/{id}` | Dead code | Mock dans `results.py`, le frontend utilise `/api/session/{id}/results` (qui marche) |
| Health check | Partiel | Retourne `{"api": true}` sans verifier Redis/Postgres/Whisper |
| `.env.example` | Obsolete | Manque 12+ variables pour Coolify production |
| Audio file cleanup | Absent | Fichiers jamais supprimes → fuite espace disque |
| Redis session TTL | Absent | Sessions jamais expirees → fuite memoire |
| StudioMode UI | Absent | API audio prete (`/api/audio/*`), pas de frontend mixer |
| Persistent results | Absent | Resultats stockes dans Redis seulement (perdus apres expiration) |
| Tests | Absent | 0 tests (pas de pytest, pas de vitest, pas de CI) |
| De-bleeding | Absent | Pas de soustraction musique captee par le micro |
| Cross-correlation sync | Absent | Pas d'alignement auto user/reference |
| WebSocket live streaming | Absent | Frontend enregistre puis upload, pas de streaming live |
| Fine-tuning Jury-LoRA | Absent | Utilise qwen3-32b generique, pas de modele specialise |
| Alembic migrations | Absent | Tables creees par `create_all()` au demarrage |

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
curl -s https://api.tuasunincroyabletalent.fr/health
docker ps --filter "name=tuasun"
```

---

## P1 — Quick fixes (1-2h)

### P1.1 — Supprimer dead code results.py

**Fichiers :**
- SUPPRIMER `backend/app/routers/results.py`
- MODIFIER `backend/app/main.py` : retirer `from app.routers import ... results` et `app.include_router(results.router, ...)`

**Pourquoi :** Le frontend utilise `/api/session/{id}/results` (session.py:471-508) qui retourne les vrais resultats depuis Redis. Le fichier results.py retourne du mock et n'est jamais appele.

**Validation :** `grep -r "/api/results/" frontend/` → 0 resultats

### P1.2 — Health check complet

**Fichier :** `backend/app/main.py` — remplacer le endpoint `/health`

```python
@app.get("/health")
async def health():
    checks = {"api": True}

    # Redis
    try:
        client = await redis_client.get_client()
        await client.ping()
        checks["redis"] = True
    except Exception:
        checks["redis"] = False

    # PostgreSQL
    try:
        from app.services.database import get_db
        async with get_db() as db:
            await db.execute(text("SELECT 1"))
        checks["postgres"] = True
    except Exception:
        checks["postgres"] = False

    status = "healthy" if all(checks.values()) else "degraded"
    return {"status": status, "version": "0.1.0", "services": checks}
```

**Validation :** `curl https://api.tuasunincroyabletalent.fr/health` → `{"services": {"api": true, "redis": true, "postgres": true}}`

### P1.3 — Mettre a jour .env.example

**Fichier :** `.env.example` — ajouter toutes les variables de docker-compose.coolify.yml

Voir section P0.2 + variables worker (SHARED_WHISPER_URL, WHISPER_LOCAL_FALLBACK, LITELLM_HOST, etc.)

### P1.4 — Audio file cleanup

**Option A — Celery beat (recommandee) :**

Ajouter dans `worker/tasks/celery_app.py` :
```python
celery_app.conf.beat_schedule = {
    "cleanup-old-sessions": {
        "task": "tasks.cleanup.cleanup_session_files",
        "schedule": 3600.0,  # Toutes les heures
    },
}
```

Creer `worker/tasks/cleanup.py` :
```python
@shared_task(name="tasks.cleanup.cleanup_session_files")
def cleanup_session_files():
    """Delete session audio files older than 2 hours."""
    audio_dir = Path(os.getenv("AUDIO_OUTPUT_DIR", "/app/audio_files"))
    cutoff = time.time() - 7200  # 2h
    for session_dir in audio_dir.iterdir():
        if session_dir.is_dir() and session_dir.name != "cache":
            if session_dir.stat().st_mtime < cutoff:
                shutil.rmtree(session_dir)
```

**Ne PAS supprimer le dossier `cache/`** — il contient les Demucs separations reutilisables.

**Validation :** Creer un dossier test vieux de 3h dans audio_files/, lancer la task, verifier suppression.

### P1.5 — Redis session TTL

**Fichier :** `backend/app/services/redis_client.py`

Le TTL est deja prevu (parametre `ttl=3600` dans `set_session`) mais verifier que TOUTES les sessions passent par cette methode.

**Fichier :** `backend/app/routers/session.py` — verifier que `redis_client.set_session()` est appele avec TTL.

**Validation :** `redis-cli -n 2 TTL session:<id>` → retourne un nombre > 0

---

## P2 — Features MVP+ (1-2 semaines)

### P2.1 — StudioMode UI (frontend)

**Contexte :** L'API `/api/audio/{session_id}/tracks` retourne la liste des pistes separees et `/api/audio/{session_id}/{source}/{type}` sert le fichier avec HTTP Range. Le backend multi-track est PRET. Il manque l'UI.

**Composants existants (non connectes) :**
- `frontend/src/components/audio/StudioMode.tsx` — existe deja
- `frontend/src/components/audio/TrackMixer.tsx` — existe deja
- `frontend/src/components/audio/AudioTrack.tsx` — existe deja
- `frontend/src/components/audio/TransportBar.tsx` — existe deja
- `frontend/src/components/audio/VolumeSlider.tsx` — existe deja
- `frontend/src/stores/audioStore.ts` — Zustand store pour multi-track
- `frontend/src/audio/` — AudioContext, TrackProcessor, useMultiTrack hook

**Tache :** Verifier si StudioMode est deja affiche dans App.tsx (il semble l'etre dans certains etats). Si oui, tester et corriger les bugs. Si non, l'integrer dans les etats `ready`, `analyzing`, `results`.

**Validation :** Apres analyse, pouvoir ecouter vocals user vs vocals reference avec volume independant.

### P2.2 — Persistent results (PostgreSQL)

**Nouveau modele SQLAlchemy :** `backend/app/models/session_results.py`

```python
class SessionResult(Base):
    __tablename__ = "session_results"

    id = Column(Integer, primary_key=True)
    session_id = Column(String(64), unique=True, index=True, nullable=False)
    spotify_track_id = Column(String(64), nullable=False)
    youtube_video_id = Column(String(32))
    track_name = Column(String(255))
    artist_name = Column(String(255))
    score = Column(Integer)
    pitch_accuracy = Column(Numeric(5, 2))
    rhythm_accuracy = Column(Numeric(5, 2))
    lyrics_accuracy = Column(Numeric(5, 2))
    jury_comments = Column(JSONB)  # [{persona, comment, vote, model, latency_ms}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

**Modifier :** `backend/app/routers/session.py` — dans `get_analysis_status()` quand SUCCESS, persister en PostgreSQL en plus de Redis.

**Nouveau endpoint :** `GET /api/results/history?limit=20` — derniers resultats (pour landing page "Recent Performances").

**Validation :** Faire une analyse, verifier que `session_results` contient le row. Recharger la page → resultats toujours disponibles.

### P2.3 — Alembic migrations

**Setup :**
```bash
cd backend
pip install alembic
alembic init migrations
# Configurer alembic.ini avec DATABASE_URL
# Generer migration initiale depuis les modeles existants
alembic revision --autogenerate -m "initial schema"
```

**Modifier :** `backend/app/services/database.py` — remplacer `create_all()` par `alembic upgrade head` dans le startup.

**Validation :** `alembic current` affiche la revision. `alembic history` montre les migrations.

---

## P3 — Qualite (2-3 semaines)

### P3.1 — Tests backend (pytest)

**Setup :** `backend/tests/conftest.py` avec fixtures (test DB, test Redis mock, test client)

**Tests prioritaires :**
1. `test_session.py` — start session, upload, analyze flow
2. `test_search.py` — Spotify search (mock httpx)
3. `test_lyrics.py` — cache hierarchy (Redis → PG → API)
4. `test_audio.py` — HTTP Range requests

### P3.2 — Tests frontend (vitest)

**Setup :** `vitest.config.ts` + `frontend/src/__tests__/`

**Tests prioritaires :**
1. `sessionStore.test.ts` — state transitions
2. `client.test.ts` — API client (mock fetch)
3. `useLyricsSync.test.ts` — binary search timing

### P3.3 — Error tracking (Sentry)

**Backend :** `pip install sentry-sdk[fastapi]`, init dans main.py
**Frontend :** `npm install @sentry/react`, init dans main.tsx
**Worker :** `pip install sentry-sdk[celery]`, init dans celery_app.py

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
**Frontend :** Modifier `useAudioRecorder.ts` pour envoyer chunks via WebSocket
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
