# Commande : Audit documentation Kiaraoke

Tu es un expert en documentation technique. Tu audites la documentation du projet **kiaraoke.fr** pour verifier completude, coherence et mise a jour.

## Contexte projet

- **Projet** : Application web d'analyse vocale par IA (kiaraoke.fr / api.kiaraoke.fr)
- **Stack** : Next.js 15 / FastAPI / Celery / PostgreSQL 16 / Redis 7 / Docker (Coolify)
- **Deploiement** : Coolify (3 services : frontend, api, worker-heavy)

## Phase 1 — Inventaire

Lister et lire tous les fichiers de documentation :

```
CLAUDE.md                              → Instructions Claude Code (architecture complete)
docs/VISION_2026.md                    → Strategie, roadmap, positionnement
docs/SOTA_MODELS.md                    → Catalogue modeles IA (statuts, specs, decisions)
docs/GPU_TIMESHARING.md                → Strategie allocation GPU dynamique
docs/ROADMAP.md                        → Roadmap implementation (a comparer avec VISION)
docs/UNIFIED_ARCHITECTURE.md           → Architecture multi-projets
docs/GPU_CAPABILITIES_2026.md          → Inventaire hardware GPU
docs/GPU_EVOLUTION_A3B.md              → Historique migration A3B
docs/KIARAOKE_IMPROVEMENTS_2026.md     → Fixes post-A3B (v1)
docs/KIARAOKE_IMPROVEMENTS_2026_v2.md  → Fixes post-A3B (v2)
docs/evolution/module-karaokeV2.md     → Spec karaoke V2
docs/evolution/module-mixer.md         → Spec mixer audio
.env.example                           → Variables d'environnement
docker-compose.coolify.yml             → Production Coolify
docker-compose.dev.yml                 → Developpement local
frontend-next/public/llms.txt          → Description LLM-friendly
frontend-next/src/app/robots.ts        → robots.txt dynamique
frontend-next/src/app/sitemap.ts       → sitemap.xml dynamique
.claude/commands/*.md                  → Commandes Claude personnalisees
```

## Phase 2 — Coherence croisee

### 2.1 CLAUDE.md vs code reel

- [ ] Versions stack (package.json, requirements.txt) correspondent
- [ ] Tous les services docker-compose existent
- [ ] Endpoints API listes correspondent aux routers FastAPI reels
- [ ] Pipeline audio (9 etapes) correspond a `worker/tasks/pipeline.py`
- [ ] Queues Celery correspondent a `celery_app.py`
- [ ] Section "Critical Don'ts" toujours pertinente

### 2.2 VISION_2026.md vs realite

- [ ] Phases roadmap coherentes avec l'etat du code
- [ ] Concurrents encore pertinents (chercher sur le web si necessaire)
- [ ] Metriques de succes realistes vs metriques actuelles

### 2.3 SOTA_MODELS.md vs code

- [ ] Statuts modeles (🧪/✅/🚀) correspondent au code deploye
- [ ] VRAM requirements toujours corrects
- [ ] Liens GitHub/HuggingFace encore valides
- [ ] Pas de nouveau modele SOTA ignore (lancer `/sota-check` si doute)

### 2.4 GPU_TIMESHARING.md vs infra reelle

- [ ] Allocation GPU correspond a nvidia-smi reel
- [ ] Services systemd (ollama@*) statuts corrects
- [ ] Container worker-heavy a les bons GPU UUIDs

### 2.5 Variables d'environnement

- [ ] `.env.example` contient TOUTES les variables utilisees dans le code
- [ ] CLAUDE.md section env complete
- [ ] docker-compose.coolify.yml coherent avec .env.example

### 2.6 Commandes Claude (`.claude/commands/`)

Pour chaque commande :
- [ ] Contexte technique a jour (stack, versions)
- [ ] Chemins de fichiers existent
- [ ] References aux docs (VISION, SOTA, etc.) correctes
- [ ] Pas de duplication entre commandes

### 2.7 SEO / llms.txt / sitemap

- [ ] URLs correctes (kiaraoke.fr, api.kiaraoke.fr)
- [ ] Fonctionnalites a jour dans llms.txt
- [ ] Sitemap liste toutes les pages publiques
- [ ] robots.ts coherent

## Phase 3 — Obsolescence

Identifier les docs potentiellement obsoletes :

- [ ] `docs/KIARAOKE_IMPROVEMENTS_2026.md` — supersede par VISION_2026 ?
- [ ] `docs/KIARAOKE_IMPROVEMENTS_2026_v2.md` — idem ?
- [ ] `docs/GPU_EVOLUTION_A3B.md` — historique, encore utile ?
- [ ] `docs/ROADMAP.md` — remplace par VISION_2026.md section 4 ?

Recommander : archiver, fusionner, ou supprimer.

## Phase 4 — Completude

Documentation manquante :
- [ ] Guide setup dev local (comment lancer en local, prereqs)
- [ ] Troubleshooting (GPU OOM, Celery stuck, Redis connection, CUDA errors)
- [ ] Changelog / historique des versions
- [ ] Guide deploiement Coolify (step by step)
- [ ] API documentation (OpenAPI/Swagger auto ou manuelle)

## Phase 5 — Rapport

```markdown
# Audit Documentation — kiaraoke.fr — {date}

## Score coherence : X/100

## Desynchronisations detectees
| Document | Section | Attendu | Reel | Action |
|----------|---------|---------|------|--------|

## Documents obsoletes
| Document | Raison | Recommandation |
|----------|--------|---------------|

## Documentation manquante
| Document | Priorite | Effort | Impact |
|----------|----------|--------|--------|

## Commandes Claude
| Commande | Statut | Problemes |
|----------|--------|-----------|

## Plan d'action
1. ...
```

## Regles
- Ne modifie aucun fichier sans approbation du user
- Si tu detectes des incoherences, propose les corrections precises
- Privilegie la fusion/nettoyage plutot que l'ajout de nouveaux docs
