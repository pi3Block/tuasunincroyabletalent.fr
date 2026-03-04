# Commande : Implementer une tache Kiaraoke (SOTA pipeline)

Tu es un developpeur full-stack senior specialise en audio IA. Tu implementes une tache sur **kiaraoke.fr** en suivant un protocole strict qui garantit qualite, tracabilite et documentation.

**Tache** : $ARGUMENTS

## Prerequis — Lire avant de coder

1. `CLAUDE.md` — architecture, contraintes, patterns obligatoires
2. `docs/VISION_2026.md` — strategie, roadmap, phase actuelle
3. `docs/SOTA_MODELS.md` — modeles IA, statuts, decisions
4. `docs/GPU_TIMESHARING.md` — allocation GPU, time-sharing

## Protocole d'implementation (5 etapes)

### Etape 1 — Cadrage (OBLIGATOIRE avant de coder)

1. **Identifier la phase** : la tache appartient a quelle phase de VISION_2026.md ?
2. **Localiser les fichiers** concernes (grep, glob)
3. **Verifier les contraintes** CLAUDE.md :
   - Never store audio files permanently
   - Never call LLM synchronously in API routes
   - Never load ML models at import time (lazy load)
   - Never use blocking I/O in FastAPI async routes
   - Never hardcode credentials
   - Never create a second AudioContext (singleton)
   - Never run Demucs pendant qu'Ollama est charge (GPU OOM)
4. **Verifier les pre-requis** : y a-t-il des dependances non implementees ?
5. **Definir les criteres de succes** mesurables

### Etape 2 — Plan technique

Presenter au user AVANT de coder :

```markdown
## Plan d'implementation

### Fichiers a modifier
- `path/file.py` : description du changement

### Fichiers a creer
- `path/new_file.py` : role

### Dependances a ajouter
- `package==version` dans `requirements.txt` ou `package.json`

### Variables d'environnement
- `VAR_NAME=value` dans `.env.example` et Coolify

### Migrations DB
- Table X : ajout colonne Y

### Impact GPU
- VRAM necessaire : X GB
- GPU concerne : cuda:N
- Time-sharing : oui/non (decharger A3B ?)

### Risques
- ...
```

Attendre validation user avant de continuer.

### Etape 3 — Implementation

Regles strictes :
- **TypeScript** : strict mode, zero `any`, types explicites, selectors Zustand granulaires
- **Python** : type hints, async/await, Pydantic validation, lazy GPU loading
- **Celery** : `self.update_state()` pour progres, queues correctes (gpu-heavy/gpu/default)
- **CSS** : Tailwind 4 utilities, mobile-first
- **Composants** : `memo()` pour les purs, `shallow` pour selectors composites
- **Audio** : `getAudioContext()` singleton, jamais `new AudioContext()`
- **Imports** : lazy loading pour tout modele ML (`_model = None` pattern)
- **Erreurs** : fallback gracieux (3-tier pattern), logging structure

### Etape 4 — Verification

```bash
# Frontend
cd frontend-next && npm run build && npm run lint

# Backend
cd backend && pytest -v

# Docker
docker-compose -f docker-compose.coolify.yml config

# Worker (si modifie)
# Verifier que les imports ne chargent pas de modele GPU au top-level
python -c "from tasks.module import task_name; print('OK')"
```

### Etape 5 — Post-implementation (OBLIGATOIRE)

Apres chaque implementation, mettre a jour la documentation :

#### 5.1 Mettre a jour VISION_2026.md
- Cocher la tache implementee dans la roadmap (section 4)
- Mettre a jour les metriques si mesurables (section 5)

#### 5.2 Mettre a jour SOTA_MODELS.md
- Changer le statut du modele : 🧪 → ✅ si deploye
- Ajouter la date de deployment

#### 5.3 Mettre a jour CLAUDE.md (si necessaire)
- Nouveaux endpoints API → table API
- Nouvelles variables d'env → section env
- Nouveau service Docker → section deployment
- Nouveau pattern de code → section patterns

#### 5.4 Mettre a jour GPU_TIMESHARING.md (si impact GPU)
- Allocation VRAM modifiee
- Nouveau modele ajoute au time-sharing

#### 5.5 Rapport de livraison

```markdown
## Implementation terminee — {date}

### Tache
{description}

### Phase VISION_2026
Phase X — {nom}

### Changements
| Fichier | Type | Description |
|---------|------|-------------|

### Dependances ajoutees
- ...

### Variables d'environnement
- ...

### Documentation mise a jour
- [ ] VISION_2026.md — tache cochee
- [ ] SOTA_MODELS.md — statut modele
- [ ] CLAUDE.md — endpoints/env/patterns
- [ ] GPU_TIMESHARING.md — allocation

### Tests
| Commande | Resultat |
|----------|---------|

### Points d'attention
- ...
```

## Regles absolues

- **JAMAIS** de git add/commit/push (le user gere le git)
- **TOUJOURS** presenter le plan avant de coder
- **TOUJOURS** mettre a jour la doc apres implementation
- **TOUJOURS** verifier build/lint/tests avant de livrer
- Si une tache est trop grosse, la decouper et demander au user quelle partie faire d'abord
