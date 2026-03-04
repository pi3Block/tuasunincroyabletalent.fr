---
description: Ingere toute la documentation projet (architecture, audit UX, analyse concurrentielle, plan de redesign). A utiliser en debut de session pour avoir le contexte complet.
allowed-tools: Read, Glob, Grep
---

# Ingestion documentation Kiaraoke frontend-next

Tu dois lire et assimiler toute la documentation du projet pour etre parfaitement operationnel.

## Etape 1 — Documentation fondamentale

Lis ces fichiers dans l'ordre. Apres chaque fichier, retiens les points cles.

1. **CLAUDE.md** (racine du projet) — Stack, architecture, conventions, commandes
2. **CLAUDE.md** (parent monorepo `../CLAUDE.md`) — Architecture backend, pipeline audio, API endpoints, patterns Celery/Redis/LLM

## Etape 2 — Documentation de redesign

3. **docs/DESKTOP_UX_AUDIT.md** — 20 problemes UX desktop identifies, classes par severite (critique/haute/moyenne), avec fichier et ligne pour chacun
4. **docs/COMPETITIVE_ANALYSIS.md** — Analyse de 6 concurrents (Singa, KaraFun, Moises, Yousician, BandLab, LALAL.AI), patterns UI communs, tendances 2025
5. **docs/DESKTOP_REDESIGN_PLAN.md** — Plan d'implementation en 3 tiers (21 changements), maquettes ASCII, fichiers impactes

## Etape 3 — Etat du code actuel

Apres la lecture des docs, fais un scan rapide pour confirmer l'etat actuel :

6. Lis `package.json` — verifier les deps actuelles
7. Lis `src/app/globals.css` — verifier le theme (light/dark, palette)
8. Lis `src/app/layout.tsx` — verifier ThemeProvider, Toaster, viewport
9. Lis `components.json` — verifier la config shadcn
10. Liste les fichiers dans `src/components/ui/` — inventaire des composants shadcn installes

## Etape 4 — Synthese

Apres avoir tout lu, produis un resume structure :

### A retenir
- Stack et versions
- Etat d'avancement du redesign (quels tiers sont faits, lesquels restent)
- Problemes critiques encore ouverts
- Conventions de code a respecter

### Pret a travailler
Confirme que tu es pret en listant :
- Les 3 prochaines taches a faire selon le plan de redesign
- Les fichiers que tu devras modifier

Ne pose pas de questions. Lis tout, assimile, et fais ta synthese.
