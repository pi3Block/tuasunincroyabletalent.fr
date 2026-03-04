# GPU Time-Sharing — Strategie d'allocation dynamique

> Derniere mise a jour : 2026-03-04 (brainstorm — impact SwiftF0 CPU-only)
> Statut : Sprint 0 COMPLETE — A3B unload implemente dans pipeline.py, systemd fixe
> Impact SwiftF0 : **pitch = CPU → 1 seul GPU necessaire au lieu de 2**

---

## Contexte

Le serveur SourceFast heberge plusieurs services GPU (A3B, Whisper, Kiaraoke worker).
A3B (35B MoE, 28 GB sur 4 GPUs) est rarement utilise en meme temps que Kiaraoke.
Objectif : decharger A3B automatiquement quand Kiaraoke a besoin des GPUs, recharger apres.

## Hardware

| GPU | Carte | VRAM | Role par defaut |
|-----|-------|------|-----------------|
| 0 | RTX 3070 | 8 GB | Whisper (resident, 4.3 GB) |
| 1 | RTX 3070 | 8 GB | A3B shard (6.7 GB) |
| 2 | RTX 3070 | 8 GB | A3B shard (6.2 GB) |
| 3 | RTX 3080 | 10 GB | A3B shard (8.0 GB) |
| 4 | RTX 3080 | 10 GB | A3B shard (7.9 GB) + Kiaraoke worker |

GPUs 1-4 : topologie **PIX** (meme switch PCIe) → tensor split efficace.

---

## Etat actuel (pre-Sprint 1)

Le worker Kiaraoke utilise `keep_alive:0` pour decharger Ollama Light avant Demucs.
Mais c'est partiel :
- Ne decharge que Ollama Light (port 11435, souvent deja dead)
- A3B (port 11439, GPUs 1-4) n'est jamais decharge → conflit VRAM
- CREPE prend 47s au lieu de 5s a cause de la contention memoire GPU
- Worker occupe 2 GPUs (cuda:0 Demucs + cuda:1 CREPE) alors que CREPE pourrait etre CPU

### Problemes systemd Ollama — FIXE (Sprint 0, 2026-03-04)
- `ollama.service` (main zombie) : **SUPPRIME** — `systemctl stop && disable`
- `ollama@heavy` : port 11434, **ACTIVE** (0 modeles, charge a la demande)
- `ollama@light` : port 11435, **ACTIVE** (0 modeles)
- `ollama@a3b` : port 11439, **ACTIVE** (35B, ~29 GB sur GPUs 1-4)
- `ollama@reasoning` : port 11438, ACTIVE
- `ollama@vision` : port 11436, ACTIVE

---

## Design propose : Time-sharing auto complet

> **Mise a jour 2026-03-04** : SwiftF0 (CPU-only) remplace CREPE → 1 seul GPU necessaire pour Kiaraoke.
> Cela simplifie enormement le time-sharing : on ne touche qu'1 GPU d'A3B au lieu de 2.

### Principe (AVEC SwiftF0)

```
Etat repos :
  GPU 0 : Whisper (resident, 4.3 GB)
  GPU 1-4 : A3B 35B (28 GB sur 4 GPUs, ~53 t/s)

Pipeline Kiaraoke demarre :
  1. HTTP POST keep_alive:0 → ollama@a3b (port 11439)
     → A3B decharge ses 28 GB de VRAM (GPUs 1-4 libres)
     → Attendre confirmation (poll VRAM libre, timeout 60s)
  2. Etapes CPU (zero GPU, en parallele) :
     - DeepFilterNet3 denoise user recording (~1s CPU)
     - SwiftF0 pitch user + reference (~2s CPU total)
     - Cross-correlation sync (~1s CPU)
  3. Etape GPU (1 seul GPU suffit) :
     - RoFormer separation user + ref sur GPU 4 (~5 GB, ~25s par fichier)
     - OU Demucs htdemucs (fallback, meme GPU)
  4. Etapes GPU legeres (coexistent ou apres RoFormer) :
     - UTMOSv2 (~0.5 GB) + MERT (~1 GB) = ~1.5 GB sur meme GPU ou GPU 1
  5. Etape HTTP (zero GPU worker) :
     - Whisper transcription (GPU 0, resident, jamais touche)
     - Jury LLM via LiteLLM/Groq (HTTP, zero GPU)
  6. Decharger modeles Kiaraoke (model.cpu() + torch.cuda.empty_cache())
  7. A3B se recharge au prochain appel Ollama (~3-5s cold start)

Etat repos (retour) :
  GPU 0 : Whisper (jamais touche)
  GPU 1-4 : A3B rechargeable a la demande
```

### Comparaison avant/apres SwiftF0

```
AVANT (actuel) :                          APRES (Sprint 1) :
  Worker = 2 GPUs                           Worker = 1 GPU
  cuda:0 → Demucs (RTX 3080)               cuda:0 → RoFormer (RTX 3080)
  cuda:1 → CREPE (RTX 3070)                CPU → SwiftF0, DeepFilterNet3
  A3B = 3 GPUs restantes                    A3B = 4 GPUs (retrouve 1 GPU)

  Conflit : A3B occupe cuda:1              Conflit : A3B occupe cuda:0 uniquement
  → CREPE 47s au lieu de 5s               → Unload A3B 1 shard, pas 2
  → Pipeline 40-67s                        → Pipeline <25s (1er run)
```

### Points de design

#### 1. Decharge A3B — Comment

```python
# HTTP POST pour decharger A3B
import httpx

async def unload_a3b():
    """Decharge A3B via keep_alive:0 sur ollama@a3b."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Envoyer une requete minimale avec keep_alive:0
            resp = await client.post(
                "http://host.docker.internal:11439/api/generate",
                json={
                    "model": "aratan/qwen3.5-a3b-abliterated:35b",
                    "prompt": "",
                    "keep_alive": 0,
                },
            )
            # Verifier que la VRAM est liberee
            # nvidia-smi ou poll GPU memory
    except Exception:
        # Non-fatal : si A3B deja decharge ou injoignable, continuer
        pass
```

#### 2. Verification VRAM liberee

```bash
# Verifier que les GPUs 1-4 ont assez de VRAM libre
nvidia-smi --query-gpu=index,memory.free --format=csv,noheader
# Attendre que GPU 4 ait >= 6 GB libre (pour RoFormer)
```

#### 3. Chargement modeles Kiaraoke

Les modeles Kiaraoke utilisent le pattern lazy-load existant (`_model = None`).
Au premier appel apres unload A3B, ils se chargent sur les GPUs libres.

#### 4. Recharge A3B

Pas besoin d'action explicite. Ollama recharge le modele au prochain appel.
Cold start : ~3-5s pour A3B (28 GB depuis disk → GPU).

### Cas limites

| Scenario | Comportement |
|----------|-------------|
| A3B en cours de generation quand Kiaraoke demarre | Attendre fin generation (timeout 60s), puis unload |
| Deux analyses Kiaraoke simultanees | Sequentiel (Celery concurrency=1 sur gpu-heavy) |
| A3B injoignable (service dead) | Continuer — les GPUs sont probablement deja libres |
| Unload A3B echoue | Non-fatal — tenter l'analyse quand meme, risque OOM gere |
| Kiaraoke crash pendant analyse | Modeles restent en GPU, A3B se recharge au prochain appel |

### Allocation VRAM par sprint

#### Sprint 1 — SwiftF0 + A3B unload (MINIMAL)

```
GPU 0 : Whisper 4.3 GB (resident, jamais touche)
GPU 4 : Demucs/RoFormer ~5 GB (separation vocale) — seul GPU worker
CPU   : SwiftF0 (pitch), DeepFilterNet3 (denoise), cross-correlation (sync)
GPU 1-3 : libres → A3B utilise 4 GPUs (0 exclu, 1-4 dispo dont 4 time-shared)
Total worker GPU : ~5 GB sur 1 GPU
```

#### Sprint 2 — Analyse SOTA complete

```
GPU 0 : Whisper 4.3 GB (resident, jamais touche)
GPU 4 : RoFormer ~5 GB (separation) → puis UTMOSv2 ~0.5 GB + MERT ~1 GB
CPU   : SwiftF0 + DeepFilterNet3 + cross-correlation
GPU 1-3 : libres → A3B
Total worker GPU : ~5 GB peak sur 1 GPU (RoFormer), puis ~1.5 GB (petits modeles)
```

#### Sprint 3 — Coaching + STARS (si valide)

```
GPU 0 : Whisper 4.3 GB (resident)
GPU 4 : RoFormer ~5 GB → UTMOSv2+MERT ~1.5 GB → STARS ~2-3 GB
CPU   : SwiftF0 + DeepFilterNet3 + vocal technique post-traitement
Total worker GPU peak : ~5 GB (RoFormer, sequentiel avec STARS)
```

#### Sprint 5+ — Features avancees (a la demande)

```
GPU 0 : Whisper 4.3 GB (resident)
GPU 4 : RoFormer ~5 GB OU ACE-Step ~4 GB (jamais ensemble)
GPU 1 : RVC ~4 GB (si voice conversion demandee, time-shared avec A3B)
CPU   : SwiftF0 + DeepFilterNet3
GPU 2-3 : libres → A3B
Total peak : ~13.3 GB / 44 GB (le reste pour A3B)
```

### Docker GPU allocation evolution

```
Sprint 0 (actuel) :
  docker-compose.coolify.yml → worker-heavy :
    device_ids: ['GPU-bdb1f5e4...', 'GPU-c99d136d...']  # 2 GPUs (RTX 3080 + RTX 3070)

Sprint 1+ (apres SwiftF0) :
  docker-compose.coolify.yml → worker-heavy :
    device_ids: ['GPU-bdb1f5e4...']  # 1 GPU seulement (RTX 3080 10 GB)
  → GPU-c99d136d... (RTX 3070) rendu a A3B
```

---

## Monitoring

### Metriques a suivre

| Metrique | Outil | Seuil alerte |
|----------|-------|-------------|
| VRAM libre par GPU | nvidia-smi | < 1 GB = warning |
| Temps unload A3B | Langfuse span | > 30s = anomalie |
| Temps total pipeline | Langfuse trace | > 60s = regression |
| OOM events | dmesg + docker logs | > 0 = critique |
| Cold start A3B | Langfuse span | > 10s = anomalie |

---

## Historique des mises a jour

| Date | Changement |
|------|-----------|
| 2026-03-04 | Design initial |
| 2026-03-04 | **Brainstorm** — Impact SwiftF0 : pitch CPU-only → 1 GPU au lieu de 2. Ajout comparaison avant/apres. Ajout Docker GPU allocation par sprint. Ajout problemes systemd Ollama. Simplification majeure du time-sharing. |
