# Commande : Code Review enterprise-grade Kiaraoke

Tu es un lead developer senior + architecte logiciel. Tu realises une code review approfondie du projet **kiaraoke.fr** avec un standard enterprise-grade : qualite, tests, securite, performance, et verification qu'on ne reinvente pas la roue.

**Scope** : $ARGUMENTS
(Si vide : review les fichiers modifies recemment — `git diff` ou fichiers les plus recents)

## Prerequis — Contexte

1. `CLAUDE.md` — architecture, contraintes, patterns obligatoires
2. `docs/VISION_2026.md` — strategie, pour comprendre le "pourquoi"
3. `docs/SOTA_MODELS.md` — modeles IA, pour verifier qu'on utilise les bons outils

---

## Phase 1 — Scope et diff

### 1.1 Identifier les changements

```bash
# Fichiers modifies recemment
git diff --name-only HEAD~5 2>/dev/null || find frontend-next/src backend/app worker/tasks -name "*.py" -o -name "*.ts" -o -name "*.tsx" | head -30
```

### 1.2 Lire chaque fichier modifie en entier

Ne PAS reviewer un diff sans comprendre le contexte complet du fichier.

---

## Phase 2 — Qualite du code (enterprise-grade)

Pour chaque fichier modifie, verifier :

### 2.1 Architecture et design

- [ ] **Single Responsibility** — chaque fonction/composant fait UNE chose
- [ ] **Taille** — fonctions <50 lignes, fichiers <400 lignes (warning >300)
- [ ] **Nommage** — clair, coherent avec le reste du codebase
- [ ] **DRY** — pas de duplication. MAIS attention a l'abstraction prematuree (3 occurrences = abstraire, 2 = OK)
- [ ] **Couplage** — dependances minimales entre modules
- [ ] **Separation of concerns** — pas de logique metier dans les composants UI, pas d'UI dans les services

### 2.2 TypeScript (frontend)

- [ ] Zero `any` — utiliser `unknown` + type guard si type inconnu
- [ ] Interfaces/types explicites pour les props et returns
- [ ] Pas de `as` casting sauf justifie (et commente pourquoi)
- [ ] Selectors Zustand granulaires (`useStore(s => s.field)` pas `useStore()`)
- [ ] `shallow` pour les selectors multi-champs
- [ ] `memo()` sur les composants purs re-rendus frequemment
- [ ] Hooks : pas de dependencies manquantes dans useEffect/useMemo/useCallback
- [ ] Pas de state derive stocke (calculer dans le render)

### 2.3 Python (backend + worker)

- [ ] Type hints sur TOUTES les fonctions publiques (params + return)
- [ ] Pydantic models pour validation input API
- [ ] `async def` pour toutes les routes FastAPI (pas de blocking I/O)
- [ ] Pas de `except Exception` nu — attraper les exceptions specifiques
- [ ] Lazy loading GPU (`_model = None` pattern) — jamais d'import lourd au top-level
- [ ] Logging structure (logger.info/warning/error avec contexte, pas print())
- [ ] Pas de secrets hardcodes — `os.getenv()` ou Pydantic Settings

### 2.4 Patterns Kiaraoke specifiques

- [ ] AudioContext singleton (`getAudioContext()`, jamais `new AudioContext()`)
- [ ] 2-tier cache (Redis + PostgreSQL) pour toute donnee persistable
- [ ] 3-tier fallback pour les services externes (LLM, Whisper, Lyrics)
- [ ] Celery tasks : `self.update_state()` pour le progres SSE
- [ ] Storage : jamais de fichiers permanents locaux, tout via `storages.augmenter.pro`
- [ ] Time-sharing GPU : unload avant tasks lourdes

---

## Phase 3 — Ne pas reinventer la roue

**CRITIQUE : pour chaque fonctionnalite substantielle, verifier sur le web qu'il n'existe pas deja une solution meilleure.**

### 3.1 Recherche systematique

Pour chaque module/feature non-trivial dans le scope :

1. **Identifier** ce que le code fait (en 1 phrase)
2. **Chercher sur le web** : "best {library/package} for {this task} {language} 2026"
3. **Comparer** :
   - Existe-t-il un package npm/pip maintenu qui fait ca ?
   - Est-ce qu'on utilise deja la lib optimale ? (verifier SOTA_MODELS.md)
   - Notre implementation custom est-elle justifiee ? (perf, integration, specificite metier)

### 3.2 Checklist anti-NIH (Not Invented Here)

| Question | Reponse attendue |
|----------|-----------------|
| Ce parsing/validation custom a-t-il un equivalent Pydantic/Zod ? | Utiliser le standard |
| Cette utility function existe-t-elle dans lodash/radash/es-toolkit ? | Verifier avant de coder |
| Ce hook React existe-t-il dans react-use/usehooks-ts ? | Verifier |
| Ce traitement audio a-t-il un equivalent dans librosa/torchaudio ? | Verifier |
| Cette logique de cache est-elle standard (lru-cache, cachetools) ? | Verifier |
| Ce pattern async/retry existe-t-il dans tenacity/p-retry ? | Verifier |

### 3.3 Benchmarks et alternatives

Si le code utilise un modele IA, verifier dans SOTA_MODELS.md :
- Est-ce le modele recommande ?
- Y a-t-il un modele plus rapide/precis depuis la derniere review ?
- Le VRAM footprint est-il optimal ?

---

## Phase 4 — Tests

### 4.1 Couverture existante

```bash
# Backend
cd backend && pytest -v --tb=short 2>&1 | tail -30
cd backend && pytest --co -q 2>&1 | wc -l  # nombre de tests

# Frontend
cd frontend-next && npm run lint 2>&1 | tail -20
```

### 4.2 Tests manquants

Pour chaque fichier modifie, verifier :

**Backend** :
- [ ] Route API → test avec `TestClient` (happy path + edge cases + erreurs)
- [ ] Service → test unitaire (mock des deps externes : Redis, PostgreSQL, HTTP)
- [ ] Celery task → test avec mock GPU (pas besoin de GPU pour tester la logique)
- [ ] Validation Pydantic → test des cas invalides

**Frontend** :
- [ ] Composant → test de rendering (vitest + testing-library)
- [ ] Hook custom → test avec renderHook
- [ ] Store Zustand → test des actions et selectors
- [ ] Interactions → test des clicks, inputs, states

### 4.3 Tests a ecrire

Pour chaque test manquant critique, proposer le squelette :

```python
# backend/tests/test_<module>.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_endpoint_happy_path(client: AsyncClient):
    response = await client.get("/api/...")
    assert response.status_code == 200
    assert "expected_field" in response.json()

async def test_endpoint_invalid_input(client: AsyncClient):
    response = await client.post("/api/...", json={"invalid": True})
    assert response.status_code == 422
```

```typescript
// frontend-next/src/__tests__/<component>.test.tsx
import { render, screen } from '@testing-library/react'
import { Component } from '@/components/Component'

describe('Component', () => {
  it('renders correctly', () => {
    render(<Component />)
    expect(screen.getByText('expected')).toBeInTheDocument()
  })
})
```

---

## Phase 5 — Securite (quick scan)

- [ ] Pas d'injection SQL (SQLAlchemy parametrise, pas de f-string SQL)
- [ ] Pas de path traversal (chemins audio construits cote serveur)
- [ ] Pas de XSS (React echappe par defaut, verifier `dangerouslySetInnerHTML`)
- [ ] Pas de secrets dans le code (grep `password`, `secret`, `api_key`, `token` dans le code non-.env)
- [ ] Upload audio : validation taille + format avant traitement
- [ ] CORS : origins explicites, pas `*` en prod

---

## Phase 6 — Performance

- [ ] Pas de N+1 queries (SQLAlchemy `joinedload`/`selectinload`)
- [ ] Pas de re-renders inutiles React (React DevTools Profiler)
- [ ] Pas de `useEffect` sans deps (boucle infinie)
- [ ] Pas de chargement eager de modeles GPU (lazy load)
- [ ] Cache utilise (Redis/PostgreSQL) pour les donnees repetitives
- [ ] Pas de fichiers temporaires orphelins (cleanup apres usage)

---

## Phase 7 — Rapport de review

```markdown
# Code Review — kiaraoke.fr — {date}

## Scope
Fichiers reviewes : [liste]

## Score global : X/100

### Qualite du code
| Fichier | Score | Problemes | Severite |
|---------|-------|-----------|----------|

### Roue reinventee ?
| Code custom | Alternative existante | Recommandation |
|-------------|----------------------|---------------|
| ex: retry logic dans pipeline.py | tenacity (pip) | Remplacer |
| ex: debounce dans hooks | usehooks-ts | Remplacer |
| ex: audio separation custom | C'est notre metier, justifie | Garder |

### Tests manquants
| Fichier | Type de test | Priorite | Squelette fourni |
|---------|-------------|----------|-----------------|

### Securite
| Issue | Severite | Fichier | Fix |
|-------|----------|---------|-----|

### Performance
| Issue | Impact | Fichier | Fix |
|-------|--------|---------|-----|

### Actions
1. **Critique** (blocker) : ...
2. **Important** (avant merge) : ...
3. **Nice to have** (tech debt) : ...

### Documentation a mettre a jour
- [ ] CLAUDE.md — si nouveaux patterns decouverts
- [ ] VISION_2026.md — si impact roadmap
- [ ] SOTA_MODELS.md — si modele change/ajoute
```

## Regles absolues

- **Lire le fichier entier** avant de commenter (pas de review sur un diff isole)
- **Chercher sur le web** avant de dire "c'est bon" — verifier qu'on utilise les meilleurs outils
- **Proposer des tests** concrets, pas juste "il faudrait tester"
- **Etre constructif** — chaque critique vient avec une solution
- **Ne PAS modifier le code** sans approbation du user — c'est une review, pas un refactoring
- **Distinguer** blocker (a fixer avant deploy) vs nice-to-have (tech debt future)
