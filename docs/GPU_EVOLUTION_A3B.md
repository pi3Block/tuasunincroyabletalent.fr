# Évolution GPU — Vers Qwen3.5-35B-A3B + Groq Whisper

> Statut : **A3B déployé sur 4 GPUs** (2026-03-03) — Kiaraoke en mode dégradé, optimisations en cours
>
> Voir aussi : [KIARAOKE_IMPROVEMENTS_2026.md](KIARAOKE_IMPROVEMENTS_2026.md) — Plan d'améliorations SOTA pipeline audio + GPU sharing

## État réel du serveur (2026-03-03)

> **ATTENTION :** Les indices GPU ont changé suite à l'installation de la RTX 3080 (ex-3060 Ti).
> Les sections "Architecture cible" et "Mapping GPU final" ci-dessous sont **OBSOLÈTES**.

### GPU Layout actuel

| GPU | Carte | VRAM | Bus PCIe | UUID | Rôle actuel |
|-----|-------|------|----------|------|-------------|
| 0 | RTX 3070 | 8 GB | 01:00.0 (PHB) | `GPU-85c38fae...` | shared-whisper (4.3 GB) |
| 1 | RTX 3070 | 8 GB | 05:00.0 (PIX) | `GPU-c99d136d...` | A3B shard (6.7 GB) |
| 2 | RTX 3070 | 8 GB | 06:00.0 (PIX) | `GPU-b57ff866...` | A3B shard (6.2 GB) |
| 3 | RTX 3080 | 10 GB | 07:00.0 (PIX) | `GPU-6d7f5c63...` | A3B shard (8.0 GB) |
| 4 | RTX 3080 | 10 GB | 08:00.0 (PIX) | `GPU-bdb1f5e4...` | A3B shard (7.9 GB) + Kiaraoke worker (1.9 GB) |

### Ollama instances

| Service | Port | Statut | GPUs |
|---------|------|--------|------|
| `ollama.service` (main) | 11434 | ACTIVE (0 modèles) | aucun |
| `ollama@a3b` | 11439 | ACTIVE | 1,2,3,4 (CUDA_VISIBLE_DEVICES) |
| `ollama@heavy` | 11434 | **DEAD** (port bloqué par main) | GPU 2 (configuré) |
| `ollama@light` | 11435 | **DEAD** | GPU 0 |
| `ollama@reasoning` | 11438 | **DEAD** | GPU 2 |
| `ollama@vision` | 11436 | **DEAD** | GPU 4 |

### Impact sur Kiaraoke

Le worker-heavy utilise GPU 4 (RTX 3080, Demucs cuda:0) et GPU 1 (RTX 3070, CREPE cuda:1) par UUID.
A3B occupe ces deux GPUs → **contention VRAM sévère** :

- CREPE : 47s au lieu de ~2s (A3B 6.7/8 GB sur GPU 1)
- De-bleeding : OOM GPU → fallback CPU (+10s)
- CTC alignment : crash (`CTC_ALIGN_DEVICE=cuda:3` mais container voit 2 GPUs)
- Pipeline `prepare_reference` : 187s au lieu de ~40s

### Corrections urgentes

- [ ] `CTC_ALIGN_DEVICE=cuda:1` (pas cuda:3) dans Coolify env
- [ ] `GROQ_API_KEY` à configurer (actuellement vide)
- [ ] `ollama.service` (main) à stopper ou `ollama@heavy` à migrer sur un autre port

---

## Benchmark A3B — Résultats réels (2026-03-02)

Modèle testé : `aratan/qwen3.5-a3b-abliterated:35b` (Q4_K_M, 23 GB)
Matériel : GPU 0 (RTX 3070) + GPU 1 (RTX 3080) + GPU 2 (RTX 3070) + GPU 4 (RTX 3060 Ti) = ~28 GB VRAM

| Test | A3B (4 GPUs) | qwen3:8b (prod) | qwen3:4b (prod) |
|------|-------------|-----------------|-----------------|
| short_gen (50 tokens) | 53.4 t/s | 80.8 t/s | 103.9 t/s |
| medium_gen (200 tokens) | 52.9 t/s | — | — |
| prefill (~1200 tokens) | **1536 t/s** | — | — |
| coding / analysis | 38-46 t/s | — | — |
| reasoning /think | 45.2 t/s | — | — |
| classification | 28.3 t/s | — | 103.9 t/s |

**Conclusion :** A3B 2x plus lent en génération courte, prefill exceptionnel (MoE).
Qualité 35B justifie l'usage pour le jury kiaraoke. Groq reste obligatoire pour classification.

Voir détails : `../app.augmenter.pro/benchmark/README.md`

---

## Contexte

Augmenter.PRO envisage d'adopter **Qwen3.5-35B-A3B** (MoE 35B/3B actifs) comme modèle jury principal.
Ce modèle nécessite ~22-24 GB VRAM en multi-GPU, incompatible avec le time-sharing actuel sur GPU 1.

## Architecture cible

```
GPU 3 (RTX 3070, 8 GB) ── Whisper + Reranker          [dédié, inchangé]
GPU 2 (RTX 3070, 8 GB) ── qwen3:8b + Demucs + CREPE   [time-share, coordination Redis]
GPU 0 (RTX 3070, 8 GB) ── A3B shard 1                  [8 GB]
GPU 1 (RTX 3080, 10 GB) ─ A3B shard 2                  [10 GB]
GPU 4 (RTX 3080, 10 GB) ─ A3B shard 3  ← remplace 3060 Ti [10 GB]
```

**A3B total : 8 + 10 + 10 = 28 GB** — Q4_K_M (22.2 GB) tient largement.
**t/s estimés avec 2x RTX 3080 : ~60-70 t/s** (vs 51 t/s actuels avec 3060 Ti).

### GPU 2 — Time-share RTX 3070 (8 GB)

| Charge | VRAM | Moment |
|--------|------|--------|
| qwen3:8b seul | 5.2 GB | En dehors des analyses kiaraoke |
| Demucs + CREPE | 5.5 + 1 = **6.5 GB** | Pendant analyse kiaraoke |
| qwen3:8b + Demucs | 5.2 + 5.5 = 10.7 GB | **IMPOSSIBLE** → doit time-sharer |

Contrainte : qwen3:8b **doit être déchargé** avant que Demucs démarre.
La coordination Redis existante (`gpu:heavy:pipeline_active`) reste nécessaire et suffisante.

Demucs + CREPE simultanés : 6.5 GB < 8 GB ✓ — pas de problème.

### Changement principal vs architecture actuelle

| | Avant | Après |
|--|-------|-------|
| qwen3:8b (heavy) | GPU 1 (RTX **3080**) | GPU 2 (RTX **3070**) |
| Demucs | GPU 1 (RTX 3080, time-share) | GPU 2 (RTX 3070, time-share) |
| CREPE | GPU 2 (RTX 3070, dédié) | GPU 2 (RTX 3070, avec Demucs) |
| A3B | — | GPU 0 + GPU 1 + GPU 4 |

GPU 1 (RTX 3080) est **libéré pour A3B** en déplaçant heavy+Demucs+CREPE sur GPU 2.

## Problème actuel — Time-sharing fragile sur GPU 1

```
GPU 1 (RTX 3080, 10 GB) :
  ├─ qwen3:8b augmenter     → 5.2 GB (permanent, KEEP_ALIVE=-1)
  └─ Demucs kiaraoke        → 5.5 GB peak (~30s par analyse)

Coordination : Redis key gpu:heavy:pipeline_active (TTL 5min)
```

Avec A3B nécessitant 28 GB sur 3 GPUs incluant GPU 1, ce time-sharing devient impossible.
→ Solution : déplacer heavy+Demucs+CREPE sur GPU 2 (RTX 3070).

## Modifications nécessaires

### augmenter.PRO — `/etc/ollama/heavy.env`

```bash
# Avant
CUDA_VISIBLE_DEVICES=1   # RTX 3080

# Après
CUDA_VISIBLE_DEVICES=2   # RTX 3070
```

### augmenter.PRO — instance A3B `/etc/ollama/a3b.env`

```bash
OLLAMA_HOST=0.0.0.0:11439
OLLAMA_MODELS=/usr/share/ollama/.ollama/models
OLLAMA_KEEP_ALIVE=-1
OLLAMA_NUM_PARALLEL=1
OLLAMA_LOAD_TIMEOUT=15m
CUDA_VISIBLE_DEVICES=0,1,4   # RTX 3070 + RTX 3080 + RTX 3080 (nouveau)
```

### kiaraoke — `docker-compose.coolify.yml`

```yaml
worker-heavy:
  environment:
    - DEMUCS_DEVICE=cuda:0   # GPU 2 (RTX 3070) — inchangé côté CUDA index
    - CREPE_DEVICE=cuda:0    # GPU 2 aussi — CREPE rejoint Demucs sur même GPU
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            device_ids: ['GPU-<uuid-gpu2-rtx3070>']   # GPU 2 uniquement (était GPU1+GPU2)
            capabilities: [gpu]
```

> CREPE passe de `cuda:1` (GPU 2 dédié) à `cuda:0` (GPU 2 avec Demucs).
> Le service n'expose plus qu'un seul GPU au container kiaraoke.

## Mapping GPU final

| GPU | Carte | VRAM | Rôle |
|-----|-------|------|------|
| 0 | RTX 3070 | 8 GB | A3B shard 1 |
| 1 | RTX 3080 | 10 GB | A3B shard 2 |
| 2 | RTX 3070 | 8 GB | qwen3:8b + Demucs + CREPE (time-share) |
| 3 | RTX 3070 | 8 GB | Whisper (4.1 GB) + Reranker (1.5 GB) |
| 4 | RTX **3080** | 10 GB | A3B shard 3 ← remplace RTX 3060 Ti |

## Topologie PCIe

```
GPU 0 (RTX 3070) ←PHB→ CPU
GPU 1 (RTX 3080) ←PHB→ CPU
GPU 2 (RTX 3070) ←PIX→ switch
GPU 3 (RTX 3070) ←PIX→ switch
GPU 4 (RTX 3080) ←PIX→ switch
```

A3B sur GPU 0 (PHB) + GPU 1 (PHB) + GPU 4 (PIX) : config mixte.
Transferts GPU0↔GPU1 passent par CPU RC (PHB-PHB), GPU1↔GPU4 traverse CPU+switch.
Impact estimé < 10% vs tout-PIX — le gain GDDR6X des 3080 compense largement.

## Prérequis avant implémentation

- [x] Benchmark A3B complété — résultats validés (2026-03-02)
- [x] Ollama mis à jour ≥ 0.17.1 — version 0.17.5 installée
- [x] RTX 3080 installée (GPU 4, remplace RTX 3060 Ti) — **fait 2026-03-03**
- [x] A3B déployé sur 4 GPUs (1,2,3,4) via `ollama@a3b` port 11439 — **fait 2026-03-03**
- [ ] **URGENT** : Configurer `GROQ_API_KEY` dans Coolify (actuellement vide)
- [ ] **URGENT** : Fix `CTC_ALIGN_DEVICE=cuda:1` (actuellement cuda:3, crash)
- [ ] Résoudre conflit `ollama.service` (main) vs `ollama@heavy` sur port 11434
- [ ] Valider Groq Whisper free tier suffisant (7 200 s/jour ≈ 40 analyses)
- [ ] Tester system prompts A3B pour les 3 personas jury (qualité vs LoRA)
- [ ] Restaurer perf Kiaraoke : voir [KIARAOKE_IMPROVEMENTS_2026.md](KIARAOKE_IMPROVEMENTS_2026.md)

## Ce que cette évolution ne change PAS

- **Demucs reste sur GPU local** — pas d'API cloud pour la séparation de sources
- **CREPE reste sur GPU local** — idem
- **Pipeline audio kiaraoke inchangé** — seule la partie LLM et transcription évolue
- **Coordination Redis** `gpu:heavy:pipeline_active` — toujours nécessaire (contrainte plus stricte sur 3070)

## Fichiers à modifier si implémentation

| Fichier | Changement |
|---------|------------|
| `/etc/ollama/heavy.env` | `CUDA_VISIBLE_DEVICES=2` (RTX 3070) |
| `/etc/ollama/a3b.env` | `CUDA_VISIBLE_DEVICES=0,1,4` |
| `docker-compose.coolify.yml` (kiaraoke) | `device_ids` → GPU 2 seul, `CREPE_DEVICE=cuda:0` |
| `worker/tasks/transcription.py` | Tier 1 = Groq Whisper (optionnel, libère GPU 3) |
| `worker/tasks/scoring.py` | `generate_comment()` : A3B comme Tier 1 avant Groq |
| `worker/tasks/pipeline.py` | Adapter si coordination GPU change |
| `fine-tuning/` | Archiver (LoRA remplacé par system prompts A3B) |
