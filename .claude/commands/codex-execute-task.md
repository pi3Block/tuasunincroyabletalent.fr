# Commande : Executer une tache technique Kiaraoke

Tu es un developpeur full-stack senior. Tu executes la tache technique demandee sur le projet **kiaraoke.fr**.

**Tache** : $ARGUMENTS

## Contexte projet

- **Frontend** : Next.js 15 (App Router) + React 19 + TypeScript 5.7 — `frontend-next/src/`
- **Backend** : FastAPI + Python 3.11 — `backend/app/`
- **Worker** : Celery 5 + GPU tasks — `worker/tasks/`
- **Infrastructure** : Docker Compose (Coolify) — `docker-compose.coolify.yml`
- **Base de donnees** : PostgreSQL 16 + Redis 7

## Prerequis

Lis `CLAUDE.md` pour les contraintes techniques.
Si la tache touche un modele IA, lis aussi `docs/SOTA_MODELS.md`.

## Etape 1 — Cadrage

1. Identifier le type : frontend / backend / worker / infra / multi-service
2. Localiser les fichiers concernes
3. Verifier les contraintes CLAUDE.md :
   - Never store audio files permanently
   - Never call LLM synchronously in API routes
   - Never load ML models at import time (lazy load)
   - Never use blocking I/O in FastAPI async routes
   - Never hardcode credentials
   - Never create a second AudioContext (singleton)
   - Never run Demucs pendant qu'Ollama est charge
4. Definir les criteres de succes

## Etape 2 — Plan

Presenter au user avant de coder :
- Fichiers a modifier/creer
- Migrations Alembic si changement schema
- Changements Docker si nouveau service
- Variables d'environnement a ajouter

## Etape 3 — Implementation

- TypeScript : strict mode, zero `any`, types explicites
- Python : type hints, async/await, Pydantic validation
- Celery : lazy loading GPU, `self.update_state()` pour le progres
- CSS : Tailwind 4 utilities, mobile-first
- Composants : `memo()` pour les purs, selectors Zustand granulaires + `shallow`
- Audio : `getAudioContext()` singleton uniquement

## Etape 4 — Verification

```bash
cd frontend-next && npm run build && npm run lint
cd backend && pytest -v
docker-compose -f docker-compose.coolify.yml config
```

## Etape 5 — Post-implementation

1. Mettre a jour la documentation si necessaire :
   - `docs/VISION_2026.md` — cocher la tache si dans la roadmap
   - `docs/SOTA_MODELS.md` — changer statut modele si applicable
   - `CLAUDE.md` — nouveaux endpoints, env vars, patterns
2. Livrer le rapport :

```markdown
## Changements
- [fichier] : description

## Documentation mise a jour
- [ ] VISION_2026.md
- [ ] SOTA_MODELS.md
- [ ] CLAUDE.md

## Tests
- [commande] : resultat

## Points d'attention
- ...
```

## Regles
- **JAMAIS** de git add/commit/push
- **TOUJOURS** presenter le plan avant de coder
- **TOUJOURS** mettre a jour la doc apres implementation
