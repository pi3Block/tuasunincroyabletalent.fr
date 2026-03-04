# Kiaraoke.fr - Plan d'ameliorations 2026 (v2, aligne code)

> Statut: baseline verifiee sur le repo local (snapshot du 2026-03-03)
> Auteur: Codex (revision technique de `KIARAOKE_IMPROVEMENTS_2026.md`)
> Portee: plan implementation cote code + points de config infra a valider en production

## 1. Resume executif

Le document v1 contient de bonnes orientations, mais plusieurs actions sont deja implementees ou ciblent des mauvais points d'entree du code.

Priorites corrigees:

1. Quick wins reels: `fastdtw -> dtw-python`, harmonisation du pitch reference CPU sans casser le contrat `frequency/time`.
2. Refonte moyenne: separation backend swappable (Demucs / MBR), rythme base audio (pas uniquement proxy pitch), enrichissement jury.
3. Resilience/UX: propagation explicite `tier_used`, `tier_reason`, `quality_level` de bout en bout (worker -> SSE -> frontend).

## 2. Etat reel verifie dans le code

### 2.1 Deja en place (ne pas re-planifier comme "a construire")

- Forced alignment CTC est deja implemente dans `worker/tasks/word_timestamps.py`:
  - `MmsCtcAlignmentEngine`
  - `TorchaudioCtcAlignmentEngine`
  - selection auto des engines via `KARAOKE_ALIGNMENT_ENGINE`
- Fallback transcription 3 tiers est deja en place dans `worker/tasks/transcription.py`.
- Fallback jury multi-tier via LiteLLM est deja en place dans `worker/tasks/scoring.py`.
- SSE existe deja dans `backend/app/routers/sse.py`.

### 2.2 Ecarts v1 -> code actuel

- La proposition `madmom` ne suffit pas seule: le rythme actuel utilise principalement `time/frequency` (proxy pitch), pas l'audio brut.
- Le snippet `pyin` du v1 retourne `f0/times`; le pipeline/scoring attend `frequency/time`.
- Le build Coolify worker installe `requirements-project.txt` via `worker/Dockerfile.optimized`, pas uniquement `requirements.txt`.
- La valeur par defaut `CTC_ALIGN_DEVICE` dans le compose versionne est deja `cuda:1`.

## 3. Contraintes de conception (a conserver)

- Contrat NPZ pitch stable: cles `frequency`, `time`, `confidence`.
- Degradation graceful: un composant lent/down ne doit pas faire tomber tout le pipeline.
- Changement incremental: features flags pour les changements de modele lourds.
- Compatibilite cache: ne pas invalider inutilement `cache/{youtube_id}/...`.

## 4. Plan d'implementation corrige

## Phase 0 - Reconciliation config + instrumentation (0.5-1 jour)

### Objectif

Fiabiliser la base avant les changements algorithmiques.

### Actions

1. Verifier les variables runtime sur Coolify (pas seulement le repo):
   - `GROQ_API_KEY`
   - `CTC_ALIGN_DEVICE`
   - `LITELLM_JURY_FALLBACK_MODEL`
2. Standardiser les logs de tier cote worker (format unique par step).
3. Etendre `update_progress()` dans `worker/tasks/pipeline.py` pour accepter des champs optionnels:
   - `tier_used`
   - `tier_reason`
   - `quality_level`
   - `estimated_remaining_s`
4. Propager ces champs via SSE (`backend/app/routers/sse.py`) dans l'evenement `analysis_progress`.

### Criteres d'acceptation

- Chaque step significative du pipeline emet `tier_used`.
- Le frontend peut afficher un etat degrade sans parser les logs serveur.

## Phase 1 - Quick wins reels (1-2 jours)

### 1.1 `fastdtw` -> `dtw-python`

Fichiers:

- `worker/tasks/scoring.py`
- `worker/requirements-project.txt`
- (optionnel) `worker/requirements.txt` pour coherence documentaire

Notes implementation:

- Remplacer l'appel `fastdtw(...)` par `dtw(...)` avec fenetre Sakoe-Chiba.
- Conserver la meme courbe de score finale pour limiter la derive produit.

Validation:

- Test unitaire sur `calculate_pitch_accuracy()` (cas nominal + cas peu voise).
- Verifier absence de regression sur scores historiques de reference.

### 1.2 Pitch reference CPU (sans casser le contrat)

Fichiers:

- `worker/tasks/pitch_analysis.py`
- `worker/tasks/pipeline.py`

Notes implementation:

- Ajouter une voie `pyin` dediee reference (CPU) ou un parametre explicite `method`.
- Le resultat doit rester:
  - `frequency` (pas `f0`)
  - `time` (pas `times`)
  - `confidence`
- Garder CREPE full pour `user`.

Validation:

- Les NPZ references existants restent lisibles.
- `do_generate_feedback()` fonctionne sans adaptation du format.

## Phase 2 - Qualite audio et scoring (4-7 jours)

### 2.1 Separation backend swappable (Demucs par defaut, MBR en flag)

Fichiers:

- `worker/tasks/audio_separation.py`
- `worker/tasks/pipeline.py`
- `worker/requirements-project.txt`
- `worker/Dockerfile.optimized` (healthcheck selon backend actif)

Notes implementation:

- Introduire `SEPARATION_BACKEND=demucs|mbr` (defaut `demucs`).
- Garder `DEBLEED_ENABLED` actif uniquement pour backend Demucs.
- Eviter un cut-over brutal sans benchmark local.

Validation:

- Tests A/B sur 10 morceaux (latence + robustesse OOM + qualite percue).
- Aucun crash pipeline si backend secondaire indisponible.

### 2.2 Rythme base audio (madmom optionnel)

Fichiers:

- `worker/tasks/scoring.py`
- `worker/tasks/pipeline.py`

Notes implementation:

- Passer les chemins vocals user/ref jusqu'au scoring final.
- Introduire un calcul rythme audio-first (onsets), fallback vers methode pitch actuelle.
- `madmom` derriere flag (`RHYTHM_BACKEND=librosa|madmom`) au debut.

Validation:

- Si audio onsets echoue, fallback automatique vers score rythme actuel.
- Pas d'augmentation de taux d'echec du pipeline.

### 2.3 Metriques vocales pour jury (Parselmouth)

Fichiers:

- Nouveau `worker/tasks/voice_quality.py`
- `worker/tasks/scoring.py`

Notes implementation:

- Ajouter jitter/shimmer/HNR au contexte jury.
- Ne pas modifier d'emblee la formule du score global; enrichir d'abord le feedback texte.

Validation:

- Jury retourne un commentaire coherent meme si metriques indisponibles.

## Phase 3 - Resilience inter-apps + UX transparence (3-5 jours)

### 3.1 Signal minimal `pipeline_active` + ETA

Fichiers:

- `worker/tasks/pipeline.py`

Notes implementation:

- Commencer simple: une cle Redis TTL + metadonnees de step.
- Reporter `GPU registry` complet a une phase ulterieure si necessaire.

### 3.2 SSE enrichi + affichage frontend

Fichiers:

- `backend/app/routers/sse.py`
- `frontend-next/src/hooks/useSSE.ts`
- `frontend-next/src/components/app/` (indicateur discret)

Validation:

- L'utilisateur voit quand le service est en mode degrade et pourquoi.

## Phase 4 - Observabilite et tests de non-regression (2-3 jours)

### Actions

1. Ajouter un script benchmark reproductible:
   - latence par step
   - tier selectionne
   - taux fallback
2. Ajouter tests unitaires worker (au minimum):
   - scoring pitch/rhythm
   - selection engine word timestamps
   - format output pipeline
3. Ajouter un test d'integration SSE (schema `analysis_progress` enrichi).

## 5. Backlog ordonne (actionnable)

| Priorite | Action | Effort | Risque | Impact |
|---|---|---:|---:|---:|
| P0 | Etendre progress meta (`tier_*`, quality, ETA) + SSE pass-through | 0.5j | Faible | Fort |
| P1 | `fastdtw` -> `dtw-python` | 0.5j | Faible | Moyen |
| P1 | Pitch ref CPU compatible contrat (`frequency/time`) | 1j | Faible | Fort |
| P2 | Separation backend swappable avec feature flag | 2-3j | Moyen | Fort |
| P2 | Rythme audio-first + fallback pitch | 1-2j | Moyen | Fort |
| P2 | Parselmouth pour contexte jury | 0.5-1j | Faible | Moyen |
| P3 | Signal `pipeline_active` + ETA | 0.5j | Faible | Moyen |
| P3 | UI indicateur mode degrade | 0.5-1j | Faible | Moyen |
| P4 | Benchmark + tests non-regression | 2-3j | Faible | Fort |

## 6. Definition of done

Le plan est considere termine quand:

1. Le pipeline reste fonctionnel sur cache hit et cache miss.
2. Chaque etape cle expose `tier_used` et `quality_level` jusqu'au frontend.
3. Les quick wins (DTW + pitch ref CPU) sont deployes sans regression de format ni crash.
4. Les nouveaux backends (MBR, madmom) sont actives par feature flags, pas en remplacement force.
5. Les gains annonces reposent sur mesures scriptables, pas sur estimation narrative.

## 7. Notes de deploiement

- Mettre a jour les dependances du worker dans **`requirements-project.txt`** (source reelle pour `Dockerfile.optimized`).
- Garder `worker/requirements.txt` uniquement comme fichier de reference si non utilise en production.
- Toute bascule de modele lourd doit etre reversible via variable d'environnement.

## 8. Changements documentaires recommandes

1. Garder `docs/KIARAOKE_IMPROVEMENTS_2026.md` comme archive historique (v1).
2. Utiliser ce fichier v2 comme reference active.
3. Ajouter en tete du v1 un lien vers la v2 pour eviter les mauvaises interpretations.
