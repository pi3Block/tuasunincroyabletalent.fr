# Commande : Rapport de dette technique Kiaraoke

Tu es un architecte logiciel senior. Tu analyses la dette technique du projet **kiaraoke.fr**, une application full-stack d'analyse vocale par IA.

## Contexte projet

- **Frontend** : Next.js 15 (App Router, Turbopack) + React 19 + TypeScript 5.7 + Zustand 5 + Tailwind 4 + Framer Motion 12 + Radix UI (shadcn)
- **Backend** : FastAPI + Python 3.11 + Celery 5 + SQLAlchemy 2 (async) + asyncpg
- **Worker GPU** : Demucs/RoFormer, CREPE/RMVPE/FCPE, Whisper, LLM jury (LiteLLM/Groq/Ollama)
- **Infrastructure** : Docker Compose (Coolify) + NVIDIA CUDA + PostgreSQL 16 + Redis 7

## Prerequis — Lire avant d'auditer

1. `CLAUDE.md` — architecture, contraintes, patterns
2. `docs/VISION_2026.md` — strategie et roadmap
3. `docs/SOTA_MODELS.md` — modeles IA actuels vs cibles

## Phase 1 — Architecture

### 1.1 Frontend (`frontend-next/src/`)

Verifier :
- [ ] Taille des fichiers critiques (page.tsx, stores, hooks) — >500 lignes = refactoring
- [ ] Zustand stores — nombre de champs, granularite des selectors, usage `shallow`
- [ ] Error boundaries en place ?
- [ ] Code splitting / lazy loading des routes lourdes
- [ ] Performance mobile — animations Framer Motion (CPU impact), `usePrefersReducedMotion`
- [ ] Singleton AudioContext respecte (grep `new AudioContext` — doit etre 0)
- [ ] Types — grep `any` injustifies dans `src/`

### 1.2 Backend (`backend/app/`)

Verifier :
- [ ] Taille `session.py` et `main.py` — refactoring ?
- [ ] `Base` SQLAlchemy — import propre depuis un fichier dedie ?
- [ ] Mix BackgroundTasks FastAPI + Celery — coherent ?
- [ ] Fallback chains (LLM, Whisper, Lyrics) — gestion erreurs homogene ?
- [ ] Async/await partout dans les routes (pas de blocking I/O) ?
- [ ] Type hints sur toutes les fonctions publiques ?

### 1.3 Worker (`worker/tasks/`)

Verifier :
- [ ] Lazy loading GPU — aucun import lourd au top-level ?
- [ ] `_model = None` pattern — thread safety (pool=solo OK, prefork non)
- [ ] Pipeline parallelisme — threads pour CREPE+Whisper en parallele ?
- [ ] Time-sharing GPU — unload A3B avant tasks lourdes ?
- [ ] Modeles SOTA vs actuels (comparer avec SOTA_MODELS.md)

## Phase 2 — Qualite du code

```bash
cd frontend-next && npm run lint 2>&1
cd frontend-next && npm run build 2>&1 | tail -20
cd backend && pytest -v --tb=short 2>&1
```

- [ ] TypeScript strict mode (`tsconfig.json` → `strict: true`)
- [ ] ESLint propre (zero warnings)
- [ ] Python type hints coverage
- [ ] `try/except Exception` trop larges (catch-all) ?
- [ ] Couverture tests frontend
- [ ] Couverture tests backend (pytest --cov)
- [ ] Tests e2e ?

## Phase 3 — Dependances et build

```bash
cd frontend-next && npm outdated 2>&1 && npm audit 2>&1
cd backend && pip list --outdated 2>&1 | head -20
cd worker && pip list --outdated 2>&1 | head -20
```

- [ ] Packages obsoletes (major versions en retard)
- [ ] Vulnerabilites npm/pip
- [ ] Taille bundle frontend
- [ ] Build time Docker images

## Phase 4 — Infrastructure

- [ ] docker-compose files — coherence coolify/dev/prod
- [ ] Cache Redis TTL + PostgreSQL TTL — donnees fantomes ?
- [ ] CI/CD — `.github/workflows/` ?
- [ ] Monitoring — Langfuse + Sentry operationnels ?
- [ ] GPU allocation — conflits VRAM ? (voir GPU_TIMESHARING.md)
- [ ] `.env.example` complet vs variables dans le code ?

## Phase 5 — Dette SOTA

Comparer code actuel avec cibles SOTA_MODELS.md :

| Composant | Dans le code (grep) | Cible SOTA | Ecart |
|-----------|-------------------|-----------|-------|
| Separation | demucs / roformer / audio-separator | Mel-Band RoFormer | ? |
| Pitch | crepe / rmvpe / fcpe | RMVPE + FCPE | ? |
| Qualite vocale | utmos | UTMOSv2 | ? |
| Contexte musical | mert | MERT-v1-95M | ? |

## Phase 6 — Rapport

```markdown
# Rapport dette technique — kiaraoke.fr — {date}

## Score de sante : X/100

## Dette critique
| Probleme | Severite | Fichier(s) | Effort | Impact |
|----------|----------|-----------|--------|--------|

## Dette moderee
| Probleme | Severite | Fichier(s) | Effort | Impact |
|----------|----------|-----------|--------|--------|

## Dette SOTA
| Composant | Actuel | Cible | Effort migration |
|-----------|--------|-------|-----------------|

## Metriques
- Fichier le plus gros : X lignes (fichier)
- Couverture tests frontend : X%
- Couverture tests backend : X%
- Vulnerabilites npm : X
- Bundle size : X Ko
- `any` TypeScript : X occurrences
- Catch-all exceptions : X

## Plan d'action
1. Urgent (cette semaine) : ...
2. Court terme (2 semaines) : ...
3. Moyen terme (1 mois) : ...

## Documentation a mettre a jour
- [ ] VISION_2026.md
- [ ] SOTA_MODELS.md
- [ ] CLAUDE.md
```
