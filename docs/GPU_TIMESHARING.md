# GPU Time-Sharing — Strategie d'allocation dynamique

> Derniere mise a jour : 2026-03-04
> Statut : DESIGN — Pas encore implemente

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

## Etat actuel

Le worker Kiaraoke utilise `keep_alive:0` pour decharger Ollama Light avant Demucs.
Mais c'est partiel :
- Ne decharge que Ollama Light (port 11435, souvent deja dead)
- A3B (port 11439, GPUs 1-4) n'est jamais decharge → conflit VRAM
- CREPE prend 47s au lieu de 5s a cause de la contention memoire GPU

---

## Design propose : Time-sharing auto complet

### Principe

```
Etat repos :
  GPU 0 : Whisper (resident)
  GPU 1-4 : A3B 35B (28 GB, ~53 t/s)

Pipeline Kiaraoke demarre :
  1. HTTP POST keep_alive:0 → ollama@a3b (port 11439)
     → A3B decharge ses 28 GB de VRAM
     → Attendre confirmation (poll VRAM libre)
  2. Charger modeles Kiaraoke :
     - RoFormer sur GPU 4 (~5 GB)
     - RMVPE + FCPE + UTMOSv2 + MERT sur GPU 1 (~2 GB total)
  3. Executer pipeline analyse
  4. Decharger modeles Kiaraoke (ou garder en cache si VRAM suffisante)
  5. A3B se recharge au prochain appel Ollama (~3-5s cold start)

Etat repos (retour) :
  GPU 0 : Whisper (jamais touche)
  GPU 1-4 : A3B rechargeable a la demande
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

### Allocation VRAM par phase

#### Phase 1 — Analyse SOTA

```
GPU 0 : Whisper 4.3 GB (resident, jamais touche)
GPU 4 : RoFormer ~5 GB (separation vocale)
GPU 1 : RMVPE ~0.3 GB + FCPE ~0.2 GB + UTMOSv2 ~0.5 GB + MERT ~1 GB = ~2 GB
GPU 2-3 : libres
Total : ~11.3 GB / 44 GB disponibles
```

#### Phase 4 — Features avancees (a la demande)

```
GPU 0 : Whisper 4.3 GB (resident)
GPU 4 : RoFormer ~5 GB OU ACE-Step ~4 GB (jamais ensemble)
GPU 1 : petits modeles ~2 GB
GPU 3 : RVC ~4 GB (si voice conversion demandee)
GPU 2 : libre
Total peak : ~15.3 GB / 44 GB
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
