# Commande : Audit de sécurité Kiaraoke (full-stack)

Tu es un expert en sécurité applicative. Tu audites le projet **kiaraoke.fr**, une application full-stack d'analyse vocale par IA.

## Contexte projet

- **Frontend** : React 18 + Vite (ou Next.js 15) — kiaraoke.fr
- **Backend API** : FastAPI + Python 3.11 — api.kiaraoke.fr
- **Worker GPU** : Celery 5 + Redis (Demucs, CREPE, Whisper, LLM)
- **Base de données** : PostgreSQL 16 (shared) + Redis 7 DB2 (shared)
- **Infrastructure** : Docker Compose orchestré par Coolify + NVIDIA GPU
- **Auth** : Aucune — sessions UUID éphémères (Redis TTL 1h)

## Phase 1 — Audit des dépendances

### Frontend
```bash
cd frontend && npm audit
```
- [ ] Aucune vulnérabilité critique ou haute
- [ ] Packages obsolètes identifiés

### Backend
```bash
cd backend && pip audit
```
- [ ] Vérifier fastapi, uvicorn, sqlalchemy, asyncpg, pydantic, httpx
- [ ] Pas de CVE sur les libs audio (librosa, soundfile)

## Phase 2 — Analyse du code source

### 2.1 FastAPI — Routes critiques

Auditer :
```
backend/app/routers/session.py    → Upload audio, sessions
backend/app/routers/audio.py      → Streaming HTTP Range
backend/app/routers/search.py     → Proxy Spotify
backend/app/routers/lyrics.py     → Paroles + word timestamps
backend/app/main.py               → CORS, middleware
```

- [ ] **Upload audio** : validation format (WAV/WebM), taille max, pas d'exécution de code
- [ ] **Session ID** : UUID v4 non prédictible, pas d'accès inter-sessions
- [ ] **HTTP Range** : pas de path traversal sur les fichiers audio
- [ ] **SQL** : SQLAlchemy async avec requêtes paramétrées
- [ ] **SSRF** : URLs YouTube/Spotify validées avant fetch
- [ ] **Input validation** : Pydantic sur tous les paramètres

### 2.2 CORS (backend/app/main.py)

- [ ] Origins explicites (pas de wildcard `*` en prod)
- [ ] kiaraoke.fr et www.kiaraoke.fr autorisés
- [ ] localhost uniquement si `DEBUG=true`

### 2.3 Worker Celery

```
worker/tasks/pipeline.py           → Orchestrateur
worker/tasks/audio_separation.py   → Demucs (file I/O)
worker/tasks/transcription.py      → Whisper (file I/O)
worker/tasks/scoring.py            → LLM calls (HTTP)
worker/tasks/cleanup.py            → Suppression fichiers
```

- [ ] Chemins audio construits sans user input
- [ ] Memory limit GPU (6G dans docker-compose)
- [ ] Task timeouts configurés
- [ ] Sérialisation JSON (pas pickle)
- [ ] Cleanup automatique (celery beat > 2h)

### 2.4 Frontend — Secrets

- [ ] Aucun secret dans les variables `VITE_*` (seule `VITE_API_URL` autorisée)
- [ ] Pas de clé API dans le code frontend

## Phase 3 — Headers de sécurité HTTP

### Frontend (nginx.conf ou next.config.ts)

- [ ] Strict-Transport-Security
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] Referrer-Policy
- [ ] Permissions-Policy (PAS microphone — requis par l'app)

## Phase 4 — OWASP Top 10

| # | Risque | Pertinence | Vérification |
|---|--------|-----------|--------------|
| A01 | Broken Access Control | Moyenne | Sessions UUID sans auth |
| A03 | Injection | Moyenne | Upload audio, SQLAlchemy paramétré |
| A05 | Security Misconfiguration | Haute | Headers, DEBUG, CORS |
| A06 | Vulnerable Components | Haute | npm audit + pip audit |
| A08 | Data Integrity | Moyenne | Sérialisation Celery |
| A10 | SSRF | Moyenne | YouTube/Spotify/LiteLLM/Ollama calls |

## Phase 5 — Infrastructure Docker

- [ ] Images versionnées (pas `:latest`)
- [ ] GPU device mapping restreint
- [ ] Réseaux séparés (interne + coolify externe)
- [ ] `.env` dans `.gitignore`
- [ ] `SECRET_KEY` aléatoire (pas la valeur par défaut)

## Phase 6 — RGPD

- [ ] Pas de cookies de tracking
- [ ] Audio supprimé après 2h
- [ ] Résultats PostgreSQL sans données personnelles
- [ ] Pas de collecte d'email

## Phase 7 — Rapport

```markdown
# Audit Sécurité — kiaraoke.fr — {date}

## Score : X/100

## Vulnérabilités critiques
| Vulnérabilité | Sévérité | Fichier | Remédiation |
|--------------|----------|---------|-------------|

## OWASP Top 10
| # | Statut | Commentaire |
|---|--------|-------------|

## Plan de remédiation
1. ...
```
