# Infrastructure Unifiee Multi-Projets SourceFast — V3

> Architecture serveur Coolify unique pour **4 projets SourceFast** (augmenter.PRO, renov-bati, coach-credit, voicejury) avec services partages (PostgreSQL, Redis, LiteLLM Proxy, GPU Ollama, Langfuse, shared-whisper).

Last updated: 2026-02-26

---

## Table des Matieres

1. [Hardware — Etat Actuel et Upgrade Planifie](#1-hardware--etat-actuel-et-upgrade-planifie)
2. [Architecture Containers (34 running + 5 GPU systemd)](#2-architecture-containers-34-running--5-gpu-systemd)
3. [LLM Gateway — LiteLLM Proxy](#3-llm-gateway--litellm-proxy)
4. [GPU — Allocation & Isolation](#4-gpu--allocation--isolation)
5. [Base de Donnees — PostgreSQL Consolide](#5-base-de-donnees--postgresql-consolide)
6. [Cache — Redis Consolide](#6-cache--redis-consolide)
7. [Voicejury — Architecture Specifique](#7-voicejury--architecture-specifique)
8. [Renov-Bati — Architecture Specifique](#8-renov-bati--architecture-specifique)
9. [Coach-Credit — Architecture Specifique](#9-coach-credit--architecture-specifique)
10. [Monitoring & Dashboards](#10-monitoring--dashboards)
11. [Coolify — Deploiement & Optimisations](#11-coolify--deploiement--optimisations)
12. [Migration / Checklist](#12-migration--checklist)
13. [References](#13-references)

---

## 1. Hardware — Etat Actuel et Upgrade Planifie

### 1.1 Etat Actuel (SSH verified 2026-02-25)

```
CPU :  Intel Celeron G4930 (2c/2t @ 3.20 GHz)
RAM :  12 Go DDR4 (9.3 Go used, 2.3 Go available)
Disk : 229 Go SSD, 95% used (13 Go free — CRITICAL)
GPU :  5 cartes, 42 Go VRAM total
zram : 5.8 Go + swap 24 Go
Docker : 34 containers running
GPU systemd : 5 Ollama instances + shared-whisper
```

**Alertes disk :** 13 Go libres. Nettoyage hebdomadaire Docker (`docker system prune`) et rotation backups indispensables.

### 1.2 Upgrade Planifie (FUTUR, non confirme)

Upgrade hardware envisage mais **non confirme** :

```
CPU :  Intel i7-9700K (8c/8t @ 3.6-4.9 GHz)    <- 4x les cores, compatible Z390
RAM :  28 Go DDR4-2400 (12 existant + 16 neuf)   <- +133% capacite
GPU :  5 GPUs = 42 Go VRAM (inchange)
SSD :  229 Go (nettoyer -> ~180 Go utilisables)
zram : 14 Go effectifs (50% de 28 Go, lz4)       <- RAM effective ~42 Go
Carte mere : MSI MPG Z390 GAMING PLUS (4 DIMM, max 64 Go)
```

### 1.3 Impact Upgrade

| Metrique | Celeron G4930 (2c/2t) | i7-9700K (8c/8t) | Gain |
|----------|----------------------|-------------------|------|
| Workers paralleles | 1-2 max sans throttle | 6-8 confortablement | 4x |
| Ollama NUM_PARALLEL | 3 (heavy), 6 (light) | 6 (heavy), 12 (light) | 2x |
| Celery concurrency total | ~7 (tous workers) | ~16 sans contention | 2.3x |
| Docker containers | 34 (sature) | 45-50 (confortable) | +16 slots |
| Build time (CI) | ~5-8 min | ~2-3 min | 2.5x |

### 1.4 GPU Inventory (inchange)

| GPU | Bus PCIe | UUID | Modele | VRAM |
|-----|----------|------|--------|------|
| 0 | 01:00.0 | GPU-85c38fae | RTX 3070 | 8 Go |
| 1 | 03:00.0 | GPU-bdb1f5e4 | RTX 3080 | 10 Go |
| 2 | 06:00.0 | GPU-c99d136d | RTX 3070 | 8 Go |
| 3 | 07:00.0 | GPU-b57ff866 | RTX 3070 | 8 Go |
| 4 | 08:00.0 | GPU-d4fb9c68 | RTX 3060 Ti | 8 Go |

**Total VRAM : 42 Go.**

---

## 2. Architecture Containers (34 running + 5 GPU systemd)

### 2.1 Vue d'ensemble

```
+-----------------------------------------------------------------------------+
|  COOLIFY SERVER -- Celeron G4930 (2c/2t) -- 12 Go RAM (+5.8 Go zram) -- 5 GPUs
|                                                                               |
|  =================== SERVICES PARTAGES (12 containers) ===================  |
|                                                                               |
|  +----------+ +----------+ +----------+ +----------+ +--------------+        |
|  |shared-   | |shared-   | | LiteLLM  | |PgBouncer | |  Crawl4AI    |        |
|  |postgres  | |redis     | | Proxy    | |  :6432   | |  :11235      |        |
|  |PG16+pgvec| |7  :6379  | |  :4000   | |          | |  (Chromium)  |        |
|  | 512M     | | 256M     | |  512M    | |  64M     | |  1.5G        |        |
|  +----------+ +----------+ +----------+ +----------+ +--------------+        |
|                                                                               |
|  +----------+ +----------+ +----------+ +----------+                          |
|  |Langfuse  | |Langfuse  | |ClickHouse| |  MinIO   |                          |
|  |web :3000 | |worker    | |  :8123   | |  :9000   |  Langfuse stack :        |
|  | 512M     | | 384M     | |  512M    | |  128M    |  traces LLM pour         |
|  +----------+ +----------+ +----------+ +----------+  TOUS les projets        |
|                                                                               |
|  +----------+ +----------+ +--------------+                                   |
|  |Bull Board| | Flower   | | Uptime Kuma  |  Monitoring : queues Bull +       |
|  |  :3100   | |  :5555   | |              |  Celery + healthchecks pour       |
|  |  128M    | |  128M    | |  128M        |  TOUS les projets                 |
|  +----------+ +----------+ +--------------+                                   |
|                                                                               |
|  ====================== GPU (systemd, hors Docker) ======================== |
|                                                                               |
|  Ollama Heavy :11434 (GPU 1)  |  Ollama Light :11435 (GPU 0)                |
|  Ollama Vision :11436 (GPU 2) |  Ollama Reasoning :11438 (GPU 3)            |
|  Ollama Twitch :11437 (GPU 4) |  shared-whisper :9000 (GPU 4)               |
|                                                                               |
|  ============================ PROJETS ===================================== |
|                                                                               |
|  +---------------------------------------------------------------------+     |
|  | augmenter.PRO (11 containers)                                        |     |
|  | backend 512M | frontend 384M | worker 512M | scoring-w 768M         |     |
|  | curation-w 768M | crewai-w 1.5G | nango 384M | postiz 1G           |     |
|  | temporal 256M | temporal-pg 96M | temporal-es 512M                   |     |
|  +---------------------------------------------------------------------+     |
|                                                                               |
|  +--------------------------+  +--------------------------------------+       |
|  | coach-credit (3 cont.)   |  | renov-bati (5 containers)            |       |
|  | backend 384M             |  | backend 512M | frontend 384M         |       |
|  | frontend 256M            |  | etl-worker 512M (Python Celery)      |       |
|  | worker 256M (BullMQ)     |  | crawler-worker 384M (Celery)         |       |
|  +--------------------------+  | scoring-worker 384M (Groq)           |       |
|                                 +--------------------------------------+       |
|                                                                               |
|  +--------------------------+                                                 |
|  | voicejury (2 containers) |  PRET A DEPLOYER (nettoyage disque requis)      |
|  | api | worker-heavy        |  Frontend migre sur Hostinger (kiaraoke.fr)     |
|  +--------------------------+                                                 |
+-------------------------------------------------------------------------------+
```

**Note :** Les 34 containers actuels n'incluent pas voicejury (2 containers prets a deployer, frontend sur Hostinger). Le total cible est 36 containers. Deploiement bloque par l'espace disque (13 Go libres, minimum ~10 Go requis pour build).

### 2.2 Budget RAM Detaille

```
SERVICES PARTAGES :                                    RAM
  shared-postgres (PG16 + pgvector, 7 DBs)            512M
  PgBouncer 1.21+ (pool 200 clients)                   64M
  shared-redis (volatile-lru, 10 DB indexes)           256M
  LiteLLM Proxy (routing + cache + cost tracking)      512M
  Langfuse web + worker                                896M  (512+384)
  ClickHouse (OLAP traces)                             512M
  MinIO (S3 blob storage)                              128M
  Crawl4AI (Chrome headless)                          1536M
  Bull Board (queue UI)                                128M
  Flower (monitoring Celery, tous projets)             128M
  Uptime Kuma (healthchecks centralises)               128M
                                                    -------
  Sous-total services partages                       4800M  (~4.7 Go)

AUGMENTER.PRO :
  backend (NestJS)                                     512M
  frontend (Next.js 15)                                384M
  worker (Celery default+doc+voice)                    512M
  scoring-worker (Celery, Groq, conc=4)                768M
  curation-worker (Celery, Groq+Langfuse, conc=2)     768M
  crewai-worker (CrewAI multi-agent)                  1536M
  nango (OAuth proxy)                                  384M
  postiz (social publishing)                          1024M
  temporal + temporal-pg + temporal-es                  864M  (256+96+512)
                                                    -------
  Sous-total augmenter.PRO                           6752M  (~6.6 Go)

COACH-CREDIT :
  backend (NestJS)                                     384M
  frontend (Next.js)                                   256M
  worker (BullMQ in-process)                           256M
                                                    -------
  Sous-total coach-credit                              896M  (~0.9 Go)

RENOV-BATI :
  backend (NestJS)                                     512M
  frontend (Next.js, pSEO ISR)                         384M
  etl-worker (Python Celery : ADEME/DVF/INSEE)         512M
  crawler-worker (Celery : Firecrawl/Crawl4AI)         384M
  scoring-worker (Celery : Groq scoring leads)         384M
                                                    -------
  Sous-total renov-bati                               2176M  (~2.1 Go)

VOICEJURY (pret a deployer, 2 containers, frontend sur Hostinger) :
  api (512M) + worker-heavy (~1G CPU + GPU VRAM)      1536M  (~1.5 Go)

SYSTEME :
  OS + Docker engine + Coolify                        2000M  (~2.0 Go)
  Ollama CPU buffers (5 instances)                     500M
                                                    =======
  TOTAL (avec voicejury)                             18660M  (~18.2 Go)

  Etat actuel (12 Go physique + 5.8 Go zram) :
    RAM physique disponible :                          2.3 Go
    Disque swap supplementaire :                      24 Go
    -> SATURE, voicejury ne peut pas demarrer sans cleanup/upgrade

  Post-upgrade (28 Go physique + 14 Go zram) :
    Marge disponible sur 28 Go physique :              9.5 Go
    + zram (50% x 28 Go, lz4) :                      +14 Go effectifs
    RAM effective totale :                             ~42 Go
    Marge effective :                                  ~23.5 Go  CONFORTABLE
```

### 2.3 Temporal/Elasticsearch

Temporal + Elasticsearch occupent ~860M pour Postiz uniquement. Avec l'i7-9700K :
- **Garder tel quel** (le CPU peut absorber Elasticsearch)
- Alternative future : remplacer par Temporal-SQLite ou Postiz v3 (pas de Temporal)

### 2.4 Workers augmenter.PRO — Partageabilite

| Worker | Partage | Raison |
|--------|---------|--------|
| **worker** (default+doc+voice) | Partageable | Taches generiques (transcription, document triage, email parsing). |
| **scoring-worker** | Partageable | Scoring Groq generique. renov-bati a son propre scoring mais pourrait mutualiser. |
| **curation-worker** | Specifique augmenter | Pipeline curation (scrape->score->filter) trop couple au module C. |
| **crewai-worker** | Specifique augmenter | CrewAI Market Intelligence (agents, tools, prompt chains) specifique MI. |

**Flower** et **Langfuse** sont deja en Shared Infrastructure car ils monitorent/tracent TOUS les projets.

> **Strategie retenue :** Chaque projet garde ses propres workers. Le partage sera envisage quand un besoin concret emerge. Les workers partages necessiteraient un systeme de routing par `project_id` dans les taches Celery.

---

## 3. LLM Gateway — LiteLLM Proxy

> **Statut : DEPLOYE** — LiteLLM Proxy tourne sur port 4000 depuis le 2026-02-19. Config V3 (2026-02-25) avec 5 modeles locaux + Groq (dont qwen3-32b et llama4-scout) + OpenAI fallback. TODO: virtual keys par projet pas encore configurees.

### 3.1 Deploiement

```yaml
# deploy/litellm/docker-compose.coolify.yml
services:
  litellm:
    image: ghcr.io/berriai/litellm:v1.63.2
    container_name: litellm-proxy
    ports:
      - "4000:4000"
    volumes:
      - ./litellm-config.yaml:/app/config.yaml:ro
    environment:
      - LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
      - LITELLM_SALT_KEY=${LITELLM_SALT_KEY}
      - LITELLM_DATABASE_URL=postgresql://litellm_user:${PG_LITELLM_PASSWORD}@shared-postgres:5432/litellm
      - GROQ_API_KEY=${GROQ_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}
      - LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    command: ["--config", "/app/config.yaml", "--port", "4000", "--num_workers", "8"]
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 3.2 Virtual Keys (cost tracking par projet)

```
sk-augmenter      -> team augmenter-pro    budget $50/mois
sk-coach-credit   -> team coach-credit     budget $20/mois
sk-renov-bati     -> team renov-bati       budget $30/mois
sk-voice-jury     -> team voice-jury       budget $10/mois
```

> **TODO :** Virtual keys non encore creees. Les projets utilisent Ollama direct ou la master key.

### 3.3 Routing & Fallback Chains (UPDATED 2026-02-25)

```yaml
# unified-infrastructure/litellm/litellm-config.yaml (source of truth)
model_list:
  # --- MODELES LOCAUX (Ollama, stream: true) ---

  - model_name: qwen3-heavy           # GPU 1 (RTX 3080) -- analysis, persona, enrichment
    litellm_params:
      model: ollama/qwen3:8b
      api_base: http://host.docker.internal:11434
      rpm: 20, tpm: 80000, timeout: 60, stream: true

  - model_name: qwen3-light           # GPU 0 (RTX 3070) -- scoring, classification
    litellm_params:
      model: ollama/qwen3:4b
      api_base: http://host.docker.internal:11435
      rpm: 40, tpm: 60000, timeout: 30, stream: true

  - model_name: qwen2.5vl-vision      # GPU 2 (RTX 3070) -- OCR, image analysis, VLM
    litellm_params:
      model: ollama/qwen2.5vl:7b
      api_base: http://host.docker.internal:11436
      rpm: 10, tpm: 30000, timeout: 90

  - model_name: deepseek-reasoning    # GPU 3 (RTX 3070) -- complex reasoning, CoT
    litellm_params:
      model: ollama/deepseek-r1:7b
      api_base: http://host.docker.internal:11438
      rpm: 15, tpm: 50000, timeout: 120, stream: true

  - model_name: llama3.1-twitch       # GPU 4 (RTX 3060 Ti) -- twitch chatbot
    litellm_params:
      model: ollama/llama3.1:8b
      api_base: http://host.docker.internal:11437
      rpm: 20, tpm: 40000, timeout: 30, stream: true

  # --- MODELES CLOUD GROQ (gratuit) ---

  - model_name: groq-fast
    litellm_params:
      model: groq/llama-3.1-8b-instant
      api_key: os.environ/GROQ_API_KEY
      rpm: 30, tpm: 6000, timeout: 10

  - model_name: groq-analysis
    litellm_params:
      model: groq/llama-3.1-70b-versatile
      api_key: os.environ/GROQ_API_KEY
      rpm: 10, tpm: 6000, timeout: 30

  - model_name: groq-qwen3-32b        # Best French creative (2026-02-25)
    litellm_params:
      model: groq/qwen/qwen3-32b
      api_key: os.environ/GROQ_API_KEY
      rpm: 60, tpm: 6000, timeout: 30

  - model_name: groq-llama4-scout      # MoE multimodal (2026-02-25)
    litellm_params:
      model: groq/meta-llama/llama-4-scout-17b-16e-instruct
      api_key: os.environ/GROQ_API_KEY
      rpm: 30, tpm: 30000, timeout: 20

  # --- MODELES CLOUD OPENAI (payant, fallback ultime) ---

  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
      rpm: 60, tpm: 150000, timeout: 30

  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
      rpm: 100, tpm: 200000, timeout: 15

  # --- EMBEDDINGS ---

  - model_name: text-embedding-3-small
    litellm_params:
      model: openai/text-embedding-3-small
      api_key: os.environ/OPENAI_API_KEY
      rpm: 100, timeout: 15

router_settings:
  routing_strategy: "least-busy"
  num_retries: 2
  allowed_fails: 3
  cooldown_time: 120
  retry_after: 5
  fallbacks:
    - qwen3-heavy: [deepseek-reasoning, groq-analysis, gpt-4o]
    - qwen3-light: [groq-fast, gpt-4o-mini]
    - qwen2.5vl-vision: [gpt-4o]
    - deepseek-reasoning: [qwen3-heavy, groq-analysis, gpt-4o]
    - groq-fast: [qwen3-light, gpt-4o-mini]
    - groq-analysis: [qwen3-heavy, gpt-4o]
    - groq-qwen3-32b: [groq-llama4-scout, groq-fast, qwen3-light]
    - groq-llama4-scout: [groq-qwen3-32b, groq-fast]
  model_group_alias:
    "default": "qwen3-heavy"
    "fast": "groq-fast"
    "vision": "qwen2.5vl-vision"
    "cheap": "qwen3-light"
    "reasoning": "deepseek-reasoning"
    "embedding": "text-embedding-3-small"
    "jury-comment": "groq-qwen3-32b"
    # Backward-compatible (augmenter.PRO legacy)
    "mistral-nemo": "qwen3-heavy"
    "llama3.2": "qwen3-light"
    "llama3.2-vision": "qwen2.5vl-vision"

litellm_settings:
  cache: true
  cache_params:
    type: redis
    host: shared-redis
    port: 6379
    password: os.environ/REDIS_PASSWORD
    db: 1
    ttl: 3600
    namespace: "litellm-cache"
  success_callback: ["langfuse"]
  failure_callback: ["langfuse"]
  drop_params: true
  turn_off_message_logging: true
```


### 3.4 Fallback en 3 Couches

```
+-------------------------------------------------------------+
|  COUCHE 1 -- Applicative (dans chaque projet, AVANT LiteLLM) |
|  LlmService.chatCompletion()                                  |
|    |-- ollamaChatCompletion()     <- Ollama direct (gratuit)  |
|    +-- groqChatCompletion()      <- Groq 70B (fallback direct)|
|  Avantage: fonctionne meme si LiteLLM est down               |
+-------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------+
|  COUCHE 2 -- LiteLLM Proxy (routing + fallback automatique)  |
|  qwen3-heavy -> groq-qwen3-32b -> groq-analysis -> gpt-4o    |
|  + least-busy routing + RPM limits + cooldown 120s            |
|  + cache Redis (scoring) + Langfuse tracing                   |
+-------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------+
|  COUCHE 3 -- Circuit Breaker (dans chaque service)            |
|  CircuitBreaker(threshold=3, resetTimeout=120s)               |
|  CLOSED -> OPEN (3 echecs) -> HALF_OPEN (120s)                |
+-------------------------------------------------------------+
```

### 3.5 Queues LLM Intelligentes — Strategie par Priorite

LiteLLM gere le routing mais pas la priorisation. La priorisation se fait **avant** l'appel LiteLLM :

```
PRIORITE 1 -- TEMPS REEL (user attend)
  - Audit vision renov-bati (Gemini Flash via LiteLLM)
  - Chat coach-credit
  - Commandes /ia analyse augmenter.PRO
  -> LiteLLM model: qwen3-heavy ou gpt-4o-mini
  -> Pas de queue, appel direct depuis le backend NestJS
  -> Timeout: 30s max

PRIORITE 2 -- NEAR REAL-TIME (user attend indirectement)
  - Scoring articles curation (augmenter)
  - Classification leads (renov-bati)
  - Traduction (coach-credit)
  - Jury voicejury (commentaires IA)
  -> LiteLLM model: groq-qwen3-32b (~200ms) ou qwen3-light
  -> Queue Bull avec priority: 1, concurrency: 4-8
  -> Timeout: 10s

PRIORITE 3 -- BATCH (background, personne n'attend)
  - ETL ADEME/DVF enrichment (renov-bati)
  - CrewAI Market Intelligence (augmenter)
  - Crawler technique PDF extraction (renov-bati)
  - Batch email parsing (augmenter)
  -> LiteLLM model: qwen3-heavy ou qwen3-light
  -> Queue Celery avec concurrency: 1-2, backoff exponentiel
  -> Timeout: 120s, retry: 3
```

**Pattern NestJS :**

```typescript
// Priorite basse pour batch
await this.llmQueue.add('batch-enrich', payload, {
  priority: 10,  // plus haut = moins prioritaire
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
});

// Priorite haute pour user-facing
await this.llmQueue.add('user-chat', payload, {
  priority: 1,  // traite en premier
  attempts: 2,
  backoff: { type: 'fixed', delay: 2000 },
});
```

### 3.6 Caching

| Type | Backend | Use Case | TTL |
|------|---------|----------|-----|
| **Exact cache** | Redis (DB 1) | Scoring curation (meme article = meme score) | 10 min |
| **Exact cache** | Redis (DB 1) | Classification (meme texte = meme categorie) | 1h |
| **Pas de cache** | - | Persona generation (unique par user) | - |
| **Pas de cache** | - | Jury voicejury (unique par session) | - |
| **Pas de cache** | - | Enrichment contenu (dynamique) | - |

### 3.7 Cost Tracking

```bash
# Creer les teams
curl -X POST http://litellm:4000/team/new \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -d '{ "team_alias": "augmenter-pro", "max_budget": 50.0, "budget_duration": "30d" }'

# Generer les virtual keys
curl -X POST http://litellm:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -d '{ "team_id": "<team-id>", "key_alias": "sk-augmenter" }'

# Consulter les couts par team
curl http://litellm:4000/global/spend/report?group_by=team \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"
```

Admin UI : `http://litellm:4000/ui` (login avec master key).

### 3.8 Plan de Rollback (bypass LiteLLM)

```env
# Mode normal (via LiteLLM)
LLM_PROVIDER=litellm
LITELLM_URL=http://litellm-proxy:4000
LITELLM_API_KEY=sk-augmenter

# Mode degrade (bypass LiteLLM -> Ollama direct + fallback Groq)
LLM_PROVIDER=ollama
OLLAMA_HOST=http://host.docker.internal:11434
GROQ_API_KEY=gsk_...
```

> **Important :** Ne jamais supprimer le code de connexion directe Ollama/Groq. Le garder comme chemin alternatif.

---

## 4. GPU — Allocation & Isolation

### 4.1 Current GPU Allocation (SSH verified 2026-02-25)

| GPU | UUID | Carte | VRAM Used/Total | Allocation |
|-----|------|-------|-----------------|------------|
| 0 | GPU-85c38fae | RTX 3070 | 4115/8192 MiB | Ollama Light :11435, qwen3:4b |
| 1 | GPU-bdb1f5e4 | RTX 3080 | 5843/10240 MiB | Ollama Heavy :11434, qwen3:8b |
| 2 | GPU-c99d136d | RTX 3070 | 6029/8192 MiB | Ollama Vision :11436, qwen2.5vl:7b |
| 3 | GPU-b57ff866 | RTX 3070 | 4983/8192 MiB | Ollama Reasoning :11438, deepseek-r1:7b |
| 4 | GPU-d4fb9c68 | RTX 3060 Ti | 5483/8192 MiB | Ollama Twitch :11437, llama3.1:8b + Whisper |

**Principe :** 1 GPU = 1 categorie de modele. Les modeles restent residents en VRAM (`OLLAMA_KEEP_ALIVE=-1`). Les projets envoient des requetes aux services partages (Ollama, shared-whisper), jamais de duplication.

**CRITIQUE :** Toujours utiliser les **UUID GPU** (pas les indices). Les indices peuvent changer apres un reboot du serveur.

### 4.2 Voicejury GPU Time-Sharing (GPU 0)

GPU 0 (RTX 3070, 8 Go) est partage entre **Ollama Light** et le **worker voicejury** (Demucs + CREPE) :

```
Etat normal :
  Ollama Light (qwen3:4b) resident -> ~4.1 Go VRAM

Quand voicejury pipeline demarre :
  1. pipeline.py envoie keep_alive:0 a Ollama Light
     POST http://host.docker.internal:11435/api/generate
     {"model":"qwen3:4b","keep_alive":0}
  2. Ollama decharge le modele -> ~4.1 Go VRAM liberes
  3. Demucs s'execute (~4 Go VRAM)
  4. CREPE s'execute (~1 Go VRAM supplementaire)
  5. Apres pipeline, Ollama Light recharge auto au prochain appel
     (~2-3s cold start)
```

**Isolation dans docker-compose :**

```yaml
# docker-compose.coolify.yml -- worker-heavy
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          device_ids: ['GPU-85c38fae-1bcf-d15b-4f36-e1f581acd76e']
          capabilities: [gpu]
    limits:
      memory: 6G
```

### 4.3 VRAM Budget

```
GPU 0 (RTX 3070, 8 Go) -- LLM Light + Audio ML (time-sharing) :
  Ollama Light qwen3:4b (Q4, resident)                4.1 Go
  OU Demucs htdemucs + CREPE full (voicejury)         5.0 Go
  Marge: 3.0 Go (en mode Ollama) / 3.0 Go (en mode Demucs)

GPU 1 (RTX 3080, 10 Go) -- LLM Heavy :
  qwen3:8b (Q4)                                       5.2 Go
  Marge: 4.8 Go    Modele critique 24/7, RESIDENT

GPU 2 (RTX 3070, 8 Go) -- Vision :
  qwen2.5vl:7b                                        5.9 Go
  Marge: 2.1 Go    RESIDENT

GPU 3 (RTX 3070, 8 Go) -- Reasoning :
  deepseek-r1:7b                                      4.7 Go
  Marge: 3.3 Go    RESIDENT

GPU 4 (RTX 3060 Ti, 8 Go) -- Audio STT + Twitch :
  Ollama Twitch llama3.1:8b                           4.9 Go
  + shared-whisper (Faster Whisper, model medium)     ~0.5 Go
  Marge: 2.6 Go    Co-resident

TOTAL VRAM utilise : ~25.4 Go / 42 Go (marge 16.6 Go)
```

### 4.4 Ollama Systemd Template

```bash
# /etc/systemd/system/ollama@.service
[Unit]
Description=Ollama LLM Instance (%i)
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
EnvironmentFile=/etc/ollama/%i.env

[Install]
WantedBy=default.target
```

**Fichier env -- Heavy (GPU 1, port 11434) :**

```bash
# /etc/ollama/heavy.env
OLLAMA_HOST=0.0.0.0:11434
CUDA_DEVICE_ORDER=PCI_BUS_ID
CUDA_VISIBLE_DEVICES=GPU-bdb1f5e4
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_GPU_OVERHEAD=536870912
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=3            # Celeron: 3 (post-upgrade: 6)
OLLAMA_MAX_QUEUE=64
```

**Fichier env -- Light (GPU 0, port 11435) :**

```bash
# /etc/ollama/light.env
OLLAMA_HOST=0.0.0.0:11435
CUDA_DEVICE_ORDER=PCI_BUS_ID
CUDA_VISIBLE_DEVICES=GPU-85c38fae
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_GPU_OVERHEAD=536870912
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=6            # Celeron: 6 (post-upgrade: 12)
OLLAMA_MAX_QUEUE=128
```

**Fichier env -- Vision (GPU 2, port 11436) :**

```bash
# /etc/ollama/vision.env
OLLAMA_HOST=0.0.0.0:11436
CUDA_DEVICE_ORDER=PCI_BUS_ID
CUDA_VISIBLE_DEVICES=GPU-c99d136d
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_GPU_OVERHEAD=536870912
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_QUEUE=32
```

**Fichier env -- Reasoning (GPU 3, port 11438) :**

```bash
# /etc/ollama/reasoning.env
OLLAMA_HOST=0.0.0.0:11438
CUDA_DEVICE_ORDER=PCI_BUS_ID
CUDA_VISIBLE_DEVICES=GPU-b57ff866
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_GPU_OVERHEAD=536870912
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=2
OLLAMA_MAX_QUEUE=32
```

**Fichier env -- Twitch (GPU 4, port 11437) :**

```bash
# /etc/ollama/twitch.env
OLLAMA_HOST=0.0.0.0:11437
CUDA_DEVICE_ORDER=PCI_BUS_ID
CUDA_VISIBLE_DEVICES=GPU-d4fb9c68
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_GPU_OVERHEAD=536870912
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=2
OLLAMA_MAX_QUEUE=32
```

**Warmup :** Service oneshot `ollama-warmup.service` charge les modeles apres demarrage. `ExecStartPost` ne convient pas (Qwen3 thinking mode bloque systemd).

**Maintenance :** Cron restart quotidien 4h (`/etc/cron.d/ollama-maintenance`), GPU watchdog 5min (`/opt/scripts/gpu-watchdog.sh`).

### 4.5 Shared Whisper — Faster Whisper HTTP (GPU 4)

Microservice HTTP unique au lieu d'un worker par projet.

```bash
# /etc/systemd/system/shared-whisper.service
[Unit]
Description=Shared Whisper ASR (Faster Whisper HTTP on GPU-d4fb9c68)
After=docker.service nvidia-persistenced.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10

ExecStartPre=-/usr/bin/docker volume create whisper-cache
ExecStartPre=-/usr/bin/docker rm -f shared-whisper

ExecStart=/usr/bin/docker run --rm \
  --name shared-whisper \
  --gpus '"device=GPU-d4fb9c68-2b3c-a854-97ed-c82b3c580122"' \
  --memory 4g \
  --network coolify \
  -p 9000:9000 \
  -v whisper-cache:/root/.cache/whisper \
  -e ASR_ENGINE=faster_whisper \
  -e ASR_MODEL=large-v3-turbo \
  -e ASR_MODEL_PATH=/root/.cache/whisper \
  -e COMPUTE_TYPE=int8 \
  --label keep=true \
  onerahmet/openai-whisper-asr-webservice:latest-gpu

ExecStop=/usr/bin/docker stop shared-whisper

[Install]
WantedBy=multi-user.target
```

**NOTE (2026-02-25) :** La config systemd specifie `ASR_MODEL=large-v3-turbo` mais SSH montre que le modele actuellement charge en memoire est **medium**. Cela peut resulter d'un televersement incomplet ou d'un fallback automatique. Verifier avec `docker logs shared-whisper`.

**Endpoints :** `/asr` (transcription), `/detect-language`. Pas de `/health` — utiliser `/docs` (200 OK).

**Acces reseau :** `http://shared-whisper:9000` (conteneurs sur reseau `coolify`).

> **NEVER use `large-v3`** on RTX 3060 Ti : 7.6 Go VRAM -> CUDA OOM. `distil-large-v3` bug : ignore `language=fr` sur audio court -> outputs English. Solution : `large-v3-turbo` int8.

---

## 5. Base de Donnees — PostgreSQL Consolide

### 5.1 Databases Logiques (1 instance, 7+ DBs)

```sql
-- shared-postgres (postgis/postgis:16-3.4-alpine)
-- Inclut pgvector + PostGIS

CREATE DATABASE augmenter;        -- augmenter.PRO (Prisma + pgvector)
CREATE DATABASE voicejury_db;     -- voicejury (user: augmenter) -- 3 tables (lyrics_cache, lyrics_offsets, word_timestamps_cache)
CREATE DATABASE coach_credit;     -- coach-credit (Prisma)
CREATE DATABASE renov_bati;       -- renov-bati (Prisma + pgvector + PostGIS)
CREATE DATABASE litellm;          -- LiteLLM cost tracking
CREATE DATABASE langfuse;         -- Langfuse transactional
-- nango, postiz : dans shared-postgres aussi
```

**PostGIS obligatoire pour renov-bati** : coordonnees GPS, parcelles cadastrales, zones IRIS.

### 5.2 Voicejury Tables (auto-creees par SQLAlchemy au demarrage API)

```sql
-- Database voicejury_db — Tables creees automatiquement par init_db() dans main.py

-- lyrics_cache : Cache paroles LRCLib/Genius (synced/unsynced, JSONB lines)
--   PK: id SERIAL
--   UK: spotify_track_id
--   TTL: expires_at (synced=365j, unsynced=90j, not_found=7j)
--   Colonnes: lyrics_text, synced_lines JSONB, sync_type, source, source_url

-- lyrics_offsets : Offset utilisateur par paire (track, video)
--   PK: id SERIAL
--   UK: (spotify_track_id, youtube_video_id)
--   Colonnes: offset_seconds Numeric(5,2) [-300, +300]

-- word_timestamps_cache : Cache Whisper word timestamps (JSONB)
--   PK: id SERIAL
--   UK: (spotify_track_id, youtube_video_id)
--   TTL: expires_at (whisper=90j, musixmatch=365j, user_corrected=permanent)
--   Colonnes: words JSONB, lines JSONB, source, language, confidence_avg

-- Sessions stockees dans Redis (TTL 1h), pas en PostgreSQL
-- Search history stocke dans Redis list (max 20 entrees)
```

> **pg_authid corruption (voicejury) :** `CREATE USER voicejury` echoue avec "duplicate key" mais `\du` ne montre pas le role. Workaround : nom DB `voicejury_db` + user `augmenter`. **NEVER run `REINDEX SYSTEM`** sur production (bloque toutes connexions).

### 5.3 PgBouncer

```ini
; deploy/pgbouncer/pgbouncer.ini
[databases]
augmenter = host=shared-postgres port=5432 dbname=augmenter
voicejury_db = host=shared-postgres port=5432 dbname=voicejury_db
coach_credit = host=shared-postgres port=5432 dbname=coach_credit
renov_bati = host=shared-postgres port=5432 dbname=renov_bati
litellm = host=shared-postgres port=5432 dbname=litellm

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
auth_type = md5
pool_mode = transaction
max_client_conn = 300
default_pool_size = 20
max_db_connections = 30          ; par DB
max_prepared_statements = 100    ; PgBouncer 1.21+ : prepared statements natifs
```

**PgBouncer 1.21+ :** Plus besoin de `?pgbouncer=true` dans les URLs Prisma.

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")       // PgBouncer :6432 (runtime)
  directUrl = env("DIRECT_DATABASE_URL") // PostgreSQL :5432 (migrations DDL)
}
```

### 5.4 pgvector (remplace Qdrant — FAIT 2026-02-11)

Migration complete : 3 services Qdrant reecrits en pgvector. Container Qdrant supprime. Gain : **-1 container, -1 Go RAM, -2 deps npm**.

| Table | Remplace | Colonnes cles |
|-------|----------|---------------|
| `DocumentChunk` | Collection Qdrant `documents` | `documentId`, `chunkIndex`, `text`, `embedding vector(1536)` |
| `SnapshotChunk` | Collection Qdrant `market_intelligence` | `snapshotId`, `entityId`, `chunkIndex`, `text`, `embedding vector(1536)` |
| `Widget.embedding` | Collection Qdrant `augmenter_widgets` | Colonne `Unsupported("vector(1536)")` |

**Index HNSW :** `m=16, ef_construction=128, vector_cosine_ops` sur les 3 tables.

**Helper :** `backend/src/common/utils/pgvector.ts` -- `vectorSearch()`, `deleteByFilter()`, `formatVector()`.

### 5.5 Backup Strategy

**Deploye 2026-02-10.** Scripts en production, cron actif.

```bash
# /opt/scripts/backup-databases.sh -- cron quotidien 3h00
PG_CONTAINER="shared-postgres"
for DB in augmenter langfuse nango postiz voicejury_db; do
  docker exec "$PG_CONTAINER" pg_dump -U augmenter -d $DB | gzip > "${BACKUP_DIR}/${DB}_${TIMESTAMP}.sql.gz"
done

# ClickHouse (Langfuse traces) -- cron quotidien 3h30
# /opt/scripts/backup-clickhouse.sh -- tables: traces, observations, scores

# Test restauration automatise -- cron dimanche 5h00
# /opt/scripts/backup-restore-test.sh -- restore + verify + alert Telegram
```

**Retention :** 7 jours. Alertes Telegram si backup echoue ou < 5 tables restaurees.

> **Lecon incident 2026-02-16 :** Un rename de container sans mise a jour du script backup = catastrophe silencieuse. Toujours verifier `/opt/backups/postgres/` apres un rename. **NEVER** "Force Rebuild" Coolify sans backup manuel.

---

## 6. Cache — Redis Consolide

### 6.1 Allocation DB Indexes

| DB | Service | Usage |
|----|---------|-------|
| 0 | augmenter.PRO | BullMQ queues + cache |
| 1 | LiteLLM Proxy | LLM cache + RPM/TPM tracking |
| 2 | voicejury | Celery broker + sessions |
| 3 | nango | Sessions |
| 4 | Langfuse | Queue + cache |
| 5 | renov-bati | BullMQ queues + ETL cache |
| 6 | coach-credit | BullMQ queues + cache |
| 7 | Celery results (augmenter + voicejury) | Task results backend |
| 8 | Postiz | Social scheduler |
| 9 | renov-bati Celery | ETL/crawler results |

### 6.2 Configuration

```yaml
# redis.conf
maxmemory 256mb
maxmemory-policy volatile-lru    # Evicte UNIQUEMENT les cles avec TTL
lazyfree-lazy-eviction yes       # Eviction asynchrone
lazyfree-lazy-expire yes
lazyfree-lazy-server-del yes
appendonly yes
appendfsync everysec
requirepass ${REDIS_PASSWORD}
```

### 6.3 Risque : Domaine de Panne Partage

Redis n'a pas de quotas memoire par database. `volatile-lru` protege les cles permanentes (BullMQ queues, sessions). Toutes les cles cache **doivent** avoir un TTL explicite.

Monitoring proactif : `INFO memory` toutes les 5 min, alerte si > 80% (deploye 2026-02-11).

**Acces voicejury :** `redis://:${REDIS_PASSWORD}@shared-redis:6379/2`

---

## 7. Voicejury — Architecture Specifique

### 7.1 Containers (2 en prod + 1 optionnel)

| Container | Image | Memory | Role |
|-----------|-------|--------|------|
| `api` | Dockerfile (python:3.11-slim) | 512M | FastAPI REST, Traefik -> api.tuasunincroyabletalent.fr / api.kiaraoke.fr |
| `worker-heavy` | Dockerfile.optimized (gpu-worker-base) | 6G limit | Celery GPU (Demucs, CREPE, Whisper), GPU-85c38fae |
| `worker-pool` | Dockerfile.optimized | 512M | Optionnel (profile: multi-gpu), queue `gpu` uniquement |

> **Frontend :** Migre vers Next.js sur Hostinger (https://kiaraoke.fr). Repo : https://github.com/pi3Block/frontend.kiaraoke.fr. Le frontend n'est plus dans ce docker-compose.

**Statut :** Code et docker-compose.coolify.yml prets a deployer. Le deploiement necessite un nettoyage disque prealable (etape 0 du guide Last Idea.md) car le serveur est a 95% d'utilisation disque.

### 7.2 Pipeline 6 Etapes

```
analyze_performance (shared_task, gpu-heavy queue)
|
|-- Step 0: Unload Ollama Light (keep_alive:0, libere ~4 Go VRAM GPU 0)
|-- Step 1: Demucs -- Separation voix utilisateur          [GPU, ~25s]
|-- Step 2: Demucs -- Separation voix reference (cache)    [GPU, ~25s ou 0s si cache]
|-- Step 3: CREPE -- Pitch user (full) + ref (tiny)        [GPU, ~4s + ~1.5s]
|-- Step 4: Whisper -- Transcription utilisateur           [HTTP shared-whisper, ~2-3s avec VAD]
|-- Step 5: Genius -- Paroles originales                   [HTTP API, ~1s]
+-- Step 6: Scoring + Jury LLM (parallele x3)             [HTTP LiteLLM/Ollama, ~3s]
```

**Total** : ~40-65s (premiere analyse) ou ~15-25s (reference en cache).

### 7.3 Worker Files

```
worker/tasks/
|-- __init__.py
|-- celery_app.py              # App Celery + logging config + shutdown cleanup
|-- pipeline.py                # Orchestrateur (analyze_performance task)
|-- audio_separation.py        # Demucs htdemucs (lazy-loaded)
|-- pitch_analysis.py          # torchcrepe (full/tiny)
|-- transcription.py           # Whisper via shared-whisper HTTP + fallback Groq + fallback local
|-- scoring.py                 # DTW scoring + jury parallele async + fallback LLM
|-- lyrics.py                  # Genius API scraper
|-- word_timestamps.py         # Whisper-timestamped (forced alignment)
|-- word_timestamps_db.py      # PostgreSQL cache word timestamps
+-- tracing.py                 # Langfuse integration (singleton + context managers)
```

### 7.4 LLM Jury Generation — Fallback Chain (UPDATED 2026-02-25)

Le jury genere 3 commentaires IA (Le Cassant, L'Encourageant, Le Technique) avec un pipeline 3-tier :

```
                    +-----------------------------+
                    |     asyncio.gather (x3)      |
                    +------+------+------+---------+
                           |      |      |
                    +------v--+ +-v----+ +v-------+
                    |Cassant  | |Encour| |Techni. |
                    +------+--+ +-+----+ ++-------+
                           |      |       |
              +------------v------v-------v------------+
              |         Per-persona fallback:            |
              |  Tier 1: LiteLLM -> Groq qwen3-32b      |
              |          (free, 32B, best French)        |
              |  Tier 2: Ollama qwen3:4b (GPU 0, local)  |
              |  Tier 3: Heuristic (commentaire generic) |
              +--------------------------------------------+
```

**Tier 1 — LiteLLM Proxy -> Groq qwen3-32b (NOUVEAU 2026-02-25)**

```python
# Tier 1: LiteLLM proxy → Groq qwen3-32b (httpx async, pas de SDK litellm)
headers = {
    "Authorization": f"Bearer {LITELLM_API_KEY}",
    "Content-Type": "application/json",
}
response = await client.post(
    f"{LITELLM_HOST}/chat/completions",
    headers=headers,
    json={
        "model": LITELLM_JURY_MODEL,  # alias "jury-comment" -> groq-qwen3-32b
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.8,
    },
    timeout=15.0,
)
```

> **Note :** Le SDK `litellm` Python a ete supprime (lourd ~200 Mo, synchrone). Les appels passent par `httpx.AsyncClient` en HTTP direct vers le proxy LiteLLM (format OpenAI `/chat/completions`).

**Tier 2 — Ollama Light (GPU 0)**

```python
# Tier 2: Ollama qwen3:4b sur GPU 0 (RTX 3070)
POST http://host.docker.internal:11435/api/generate
{
    "model": "qwen3:4b",
    "prompt": "...",
    "stream": false,
    "options": {"temperature": 0.8, "top_p": 0.9, "num_predict": 300}
}
# Timeout: 20s
```

L'instance Ollama Light est pre-configuree avec `OLLAMA_KEEP_ALIVE=-1` (modele resident en VRAM, pas de cold start — sauf si voicejury l'a decharge pour GPU time-sharing).

**Tier 3 — Heuristic fallback**

Si LiteLLM ET Ollama echouent, un commentaire generique est genere en fonction du score et de la persona :

```python
# Tier 3: Aucune API, commentaire pre-ecrit
"Le Cassant" + score < 50 -> "Aie... il y a du travail. La justesse n'y est pas..."
"L'Encourageant" + score >= 80 -> "Magnifique ! Tu as une vraie sensibilite musicale..."
```

**Performance :**

| Mode | Latency (3 jurys) | Disponibilite |
|------|-------------------|---------------|
| Sequentiel (avant) | 3-15s | 0 fallback |
| **Parallele (apres)** | **1-5s** | **3 tiers** |

Gain : **~3x plus rapide** grace a `asyncio.gather()` + `httpx.AsyncClient`.

**3 Personas :**
- **Le Cassant** — Critique severe, exigeant, humour mordant
- **L'Encourageant** — Bienveillant, positif, encourage la progression
- **Le Technique** — Analyse objectif, precision technique, vocabulaire musical

Chaque persona vote independamment (OUI/NON/PEUT-ETRE). Le verdict final est la majorite.

### 7.5 Langfuse Tracing

#### Configuration

```
Langfuse UI:   https://langfuse.augmenter.pro
Container:     langfuse:3000
```

Voicejury utilise les memes credentials Langfuse que augmenter.pro (meme instance self-hosted).

#### Traces generees

Chaque analyse vocale cree un trace parent avec des spans enfants :

```
voicejury.analyze_performance          <- trace parent
|-- [metadata] session_id, song_title, artist, youtube_id, has_gpu
|-- jury-comment-le-cassant            <- generation (LLM)
|   |-- model: groq/qwen3-32b (ou qwen3:4b, ou heuristic)
|   |-- latency_ms: 1200
|   +-- output: "Aie... Il y a du travail..."
|-- jury-comment-l-encourageant        <- generation (LLM)
|   +-- ...
+-- jury-comment-le-technique          <- generation (LLM)
    +-- ...
```

#### Code pattern

```python
from .tracing import trace_pipeline, trace_jury_comment, flush_traces

# Dans pipeline.py
with trace_pipeline(session_id=session_id, song_title=song_title) as pipeline_span:
    # ... steps audio ...
    results = do_generate_feedback(..., pipeline_span=pipeline_span)

flush_traces()

# Dans scoring.py (appele par do_generate_feedback)
with trace_jury_comment(pipeline_span, persona_name="Le Cassant", model="groq/qwen3-32b") as gen:
    comment = await call_llm(...)
    gen.update(output=comment, model=model_used)
```

#### Module tracing.py

| Fonction | Role |
|----------|------|
| `get_langfuse_client()` | Singleton thread-safe (avec lock) |
| `flush_traces()` | Flush en fin de task Celery |
| `TracingSpan` | Wrapper `.span()`, `.generation()`, `.update()`, `.end()` |
| `trace_pipeline()` | Context manager -- trace parent pipeline |
| `trace_jury_comment()` | Context manager -- generation LLM par persona |

Toutes les operations Langfuse sont wrappees en try/except — si Langfuse n'est pas configure, un `TracingSpan()` dummy est retourne (zero overhead).

### 7.6 Transcription — 3-Tier Fallback (UPDATED 2026-02-25)

```
Tier 1: shared-whisper HTTP
  - GPU 4 (RTX 3060 Ti), modele actuellement charge: medium
  - Endpoint: http://shared-whisper:9000/asr
  - Latence: ~2-3s pour 3 min d'audio
  - Fallback automatique si HTTP 5xx ou timeout 120s (SHARED_WHISPER_TIMEOUT)

Tier 2: Groq Whisper API (NOUVEAU 2026-02-25)
  - Modele: whisper-large-v3-turbo
  - Gratuit, 20 RPM
  - Endpoint: https://api.groq.com/openai/v1/audio/transcriptions
  - Fallback si shared-whisper down

Tier 3: Local PyTorch Whisper
  - Desactive par defaut (WHISPER_LOCAL_FALLBACK=false)
  - Si active: charge le modele sur le meme GPU que le worker
  - Consomme ~2 Go VRAM supplementaires
  - Active uniquement via env var WHISPER_LOCAL_FALLBACK=true
```

### 7.7 Environment Variables

```env
# Database (shared-postgres)
DATABASE_URL=postgresql://augmenter:${PG_PASSWORD}@shared-postgres:5432/voicejury_db

# Redis (shared-redis, DB index 2)
REDIS_URL=redis://:${REDIS_PASSWORD}@shared-redis:6379/2

# Ollama Light (host, systemd)
OLLAMA_HOST=http://host.docker.internal:11435
OLLAMA_MODEL=qwen3:4b

# LiteLLM Proxy (host, pour jury LLM)
LITELLM_HOST=http://host.docker.internal:4000
LITELLM_API_KEY=${LITELLM_API_KEY}
LITELLM_JURY_MODEL=jury-comment

# Groq (fallback direct, sans LiteLLM)
GROQ_API_KEY=${GROQ_API_KEY}

# Shared Whisper (systemd, coolify network)
SHARED_WHISPER_URL=http://shared-whisper:9000

# Langfuse (augmenter.pro stack)
LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}
LANGFUSE_BASE_URL=http://langfuse:3000

# Spotify
SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID}
SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET}

# Genius (lyrics)
GENIUS_API_TOKEN=${GENIUS_API_TOKEN}

# Audio
WHISPER_MODEL=turbo
AUDIO_OUTPUT_DIR=/app/audio_files
WHISPER_LOCAL_FALLBACK=false
```

### 7.8 Reseau Docker

```
+-----------------------------------------------------------+
|                     coolify network                         |
|                                                             |
|  +----------+  +------------------------+                  |
|  |   api    |  |     worker-heavy       |                  |
|  |  :8080   |  |  (GPU-85c38fae)        |                  |
|  +----------+  +------------------------+                  |
|                                         |                   |
|  +--------------+  +--------------+     |                   |
|  |shared-postgres|  |shared-redis  |     |                   |
|  |   :5432      |  |   :6379      |     |                   |
|  +--------------+  +--------------+     |                   |
|                                         |                   |
|  +--------------+  +--------------+     |                   |
|  |   langfuse   |  |shared-whisper|     |                   |
|  |   :3000      |  |   :9000      |<----+                   |
|  +--------------+  +--------------+                         |
+-----------------------------------------------------------+
                          |
          host.docker.internal (host-gateway)
                          |
        +-----------------+------------------+
        |                 |                  |
   +----v-----+    +-----v----+      +-----v----+
   | Ollama   |    | Ollama   |      | LiteLLM  |
   | Light    |    | Heavy    |      | Proxy    |
   | :11435   |    | :11434   |      | :4000    |
   | GPU 0    |    | GPU 1    |      |          |
   +----------+    +----------+      +----------+
```

**Acces** :
- Services sur `coolify` network : DNS Docker direct (`shared-postgres`, `shared-redis`, `shared-whisper`)
- Services sur host : `host.docker.internal` via `extra_hosts: ["host.docker.internal:host-gateway"]`

### 7.9 Diagramme d'Architecture Complet

```
+----------------------------------------------------------------+
|                        UTILISATEUR                                |
|                     (smartphone/desktop)                           |
+---------------------------+--------------------------------------+
                            | HTTPS
                            v
+----------------------------------------------------------------+
|                      TRAEFIK (Coolify)                            |
|  api.tuasunincroyabletalent.fr -> api:8080                       |
|  api.kiaraoke.fr -> api:8080                                     |
+---------------------------+------------------------------------+
                            |
      +---------------------+---------------------+
      |                                           |
+-------------------+               +----------------------+
| Frontend (externe)|               |     Backend API       |
| Next.js Hostinger |<--- HTTPS --->|     FastAPI + Uvicorn |
| kiaraoke.fr       |   REST API    |     Pydantic v2       |
+-------------------+               +----------+-----------+
                                          | Celery task
                                          v
                               +----------------------+
                               |   Worker Heavy (GPU)  |
                               |   RTX 3070 (8 Go)     |
                               |                       |
                               | +-------------------+ |
                               | | Pipeline 7 steps  | |
                               | | Demucs -> CREPE ->  | |
                               | | Whisper -> Genius -> | |
                               | | Scoring -> Jury x3 | |
                               | +-------------------+ |
                               +------+----+----+------+
                      +---------------+    |    +--------------+
                      v                    v                   v
           +------------------+  +--------------+  +------------------+
           | shared-whisper   |  | Ollama Light  |  | LiteLLM Proxy    |
           | :9000 (GPU 4)   |  | :11435 (GPU 0)|  | :4000 -> Groq    |
           | medium (actual)  |  | qwen3:4b      |  | qwen3-32b (jury) |
           +------------------+  +--------------+  +------------------+
                                          |
                                          v
                                 +------------------+
                                 | Langfuse          |
                                 | :3000             |
                                 | Traces + Metrics  |
                                 +------------------+
                      +---------------+  +------------------+
                      | shared-postgres|  | shared-redis      |
                      | PostgreSQL 16 |  | Redis 7           |
                      | voicejury_db  |  | DB 2 (broker)     |
                      +---------------+  +------------------+
```

---

## 8. Renov-Bati — Architecture Specifique

### 8.1 Containers (5)

| Container | Image | Memory | Role |
|-----------|-------|--------|------|
| `renov-backend` | NestJS custom | 512M | API REST + MCP Server |
| `renov-frontend` | Next.js custom | 384M | pSEO ISR + Audit Vision UI |
| `renov-etl-worker` | Python Celery | 512M | ADEME/DVF/INSEE/Cadastre ingestion |
| `renov-crawler-worker` | Python Celery | 384M | Firecrawl -> Gemini -> pgvector |
| `renov-scoring-worker` | Python Celery | 384M | Lead scoring via LiteLLM (Groq) |

### 8.2 Database (dans shared-postgres)

```sql
-- Database renov_bati avec PostGIS + pgvector

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Module A : Cibles geospatiales
CREATE TABLE target_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_id VARCHAR UNIQUE,
  address TEXT NOT NULL,
  coordinates GEOGRAPHY(POINT, 4326),  -- PostGIS
  parcel_ref VARCHAR,
  energy_class CHAR(1) CHECK (energy_class IN ('A','B','C','D','E','F','G')),
  dpe_ref VARCHAR,
  construction_year INTEGER,
  surface_m2 NUMERIC,
  last_transaction_date DATE,
  transaction_price INTEGER,
  roof_solar_potential VARCHAR,
  income_bracket VARCHAR,
  dju_heating INTEGER,
  score_priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_target_coords ON target_properties USING GIST (coordinates);
CREATE INDEX idx_target_energy ON target_properties (energy_class);
CREATE INDEX idx_target_score ON target_properties (score_priority DESC);

-- Module C : Produits techniques
CREATE TABLE technical_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand VARCHAR NOT NULL,
  model_ref VARCHAR UNIQUE,
  category VARCHAR CHECK (category IN (
    'PAC_AIR_EAU','PAC_AIR_AIR','ISOLATION_COMBLES',
    'ISOLATION_MURS','CHAUFFE_EAU_THERMO','SOLAIRE_THERMIQUE','SOLAIRE_PV'
  )),
  performance_metrics JSONB,
  certifications TEXT[],
  eligible_aid_codes TEXT[],
  is_subvention_eligible BOOLEAN DEFAULT FALSE,
  source_url TEXT,
  pdf_url TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_product_embedding ON technical_products
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=128);
CREATE INDEX idx_product_category ON technical_products (category);

-- Module D : Artisans & reputation
CREATE TABLE artisans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siret VARCHAR(14) UNIQUE,
  name VARCHAR NOT NULL,
  location GEOGRAPHY(POINT, 4326),
  rge_certified BOOLEAN DEFAULT FALSE,
  rge_domains TEXT[],
  rge_expiry DATE,
  trust_score NUMERIC(3,1),
  review_count INTEGER DEFAULT 0,
  review_summary TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_artisan_location ON artisans USING GIST (location);
CREATE INDEX idx_artisan_rge ON artisans (rge_certified);

-- Module B : Baremes aides (MPR/CEE)
CREATE TABLE aid_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  work_type VARCHAR NOT NULL,
  income_bracket VARCHAR NOT NULL,
  region VARCHAR DEFAULT 'metropole',
  amount_euros INTEGER NOT NULL,
  source VARCHAR DEFAULT 'ANAH',
  valid_from DATE,
  valid_until DATE,
  UNIQUE(year, work_type, income_bracket, region)
);
```

### 8.3 Workers Python (Celery)

```
renov-bati/worker/
|-- celery_app.py           # Celery config (broker: Redis DB 5, results: DB 9)
|-- tasks/
|   |-- etl/
|   |   |-- ademe_dpe.py    # Ingestion DPE open data
|   |   |-- dvf.py          # Transactions foncieres
|   |   |-- insee_iris.py   # Revenus par quartier
|   |   +-- ban_geocoder.py # Normalisation adresses BAN API
|   |-- crawler/
|   |   |-- product_crawler.py   # Firecrawl -> PDF -> Gemini -> pgvector
|   |   +-- artisan_scraper.py   # Google Places API -> sentiment
|   +-- scoring/
|       +-- lead_scorer.py       # Score priorite via LiteLLM (Groq)
|-- Dockerfile
+-- requirements.txt
```

---

## 9. Coach-Credit — Architecture Specifique

### 9.1 Containers (3)

| Container | Image | Memory | Role |
|-----------|-------|--------|------|
| `coach-backend` | NestJS custom | 384M | API + chat IA |
| `coach-frontend` | Next.js custom | 256M | Dashboard client |
| `coach-worker` | NestJS (BullMQ in-process) | 256M | Traduction batch |

**Pas de worker Celery Python** — 100% TypeScript/NestJS.

### 9.2 Database

```sql
CREATE DATABASE coach_credit;
-- Schema Prisma standard, pas de pgvector/PostGIS necessaire
```

### 9.3 LLM Usage

Tous les appels LLM passent par LiteLLM Proxy :

```typescript
const response = await fetch('http://litellm:4000/chat/completions', {
  headers: {
    'Authorization': 'Bearer sk-coach-credit',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: text.length > 2000 ? 'qwen3-heavy' : 'groq-fast',
    messages,
    metadata: { tags: ['project:coach-credit', 'task:translation'] },
  }),
});
```

---

## 10. Monitoring & Dashboards

### 10.1 Stack Monitoring Unifiee

```
+-----------------------------------------------------+
|                DASHBOARDS                             |
|                                                       |
|  Langfuse          -> LLM traces, couts, latence     |
|  langfuse.augmenter.pro                               |
|  Filtrage par tag : project:augmenter,                |
|    project:coach-credit, project:renov-bati,          |
|    project:voicejury                                  |
|                                                       |
|  LiteLLM UI        -> Routing, virtual keys, spend   |
|  litellm.augmenter.pro/ui                             |
|  Cost par team, RPM/TPM usage, fallback rate          |
|                                                       |
|  Bull Board        -> Queues NestJS (3 projets)      |
|  bullboard.augmenter.pro                              |
|  Queue depth, failed jobs, latence par job type       |
|                                                       |
|  Flower            -> Queues Celery (Python workers)  |
|  flower.augmenter.pro (DB 0: augmenter, renov-bati)   |
|  flower-voicejury.augmenter.pro (DB 2: voicejury)     |
|  Task history, worker health, concurrency             |
|                                                       |
|  Uptime Kuma       -> Healthchecks 60s               |
|  uptime.augmenter.pro                                 |
|  HTTP checks tous services + GPU watchdog             |
+-----------------------------------------------------+
```

### 10.2 Bull Board

**Option B (recommandee) :** integrer `@bull-board/nestjs` dans le backend augmenter. Expose `/admin/queues` avec guard ADMIN. Connecte aux 3 DB indexes (0=augmenter, 5=renov, 6=coach).

### 10.3 Uptime Kuma

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    volumes:
      - uptime-kuma-data:/app/data
    deploy:
      resources:
        limits:
          memory: 128M
```

Healthchecks configures :
- `http://langfuse:3000/api/public/health`
- `http://litellm:4000/health`
- `http://backend:3001/api/health` (augmenter)
- `http://renov-backend:3001/api/health` (renov-bati)
- `http://coach-backend:3001/api/health` (coach-credit)
- `http://shared-whisper:9000/docs`
- `http://host.docker.internal:11434/api/tags` (ollama-heavy)
- `http://host.docker.internal:11435/api/tags` (ollama-light)
- `http://host.docker.internal:11436/api/tags` (ollama-vision)
- `http://host.docker.internal:11437/api/tags` (ollama-twitch)
- `http://host.docker.internal:11438/api/tags` (ollama-reasoning)
- Redis PING
- PostgreSQL pg_isready

### 10.4 Metriques Cles

| Metrique | Seuil Alerte | Outil |
|----------|-------------|-------|
| Ollama latence P95 | > 30s | Langfuse |
| Fallback rate (% cloud) | > 20% | LiteLLM logs |
| PostgreSQL connexions | > 80% max | PgBouncer `SHOW POOLS` |
| Redis memoire | > 80% maxmemory | `INFO memory` |
| GPU VRAM | > 90% | `nvidia-smi` (GPU watchdog 5min) |
| LiteLLM spend mensuel | > budget team | LiteLLM UI |
| Celery queue depth | > 50 tasks | Flower |
| Backup size | < 100K (augmenter) | Cron alerte |
| Disk usage | > 95% (CRITICAL) | `df -h` |

---

## 11. Coolify — Deploiement & Optimisations

### 11.1 Coolify Apps Organization

```
Coolify Dashboard
|-- [SHARED] Shared Infrastructure (12 containers)
|   |-- shared-postgres (postgis:16-alpine + pgvector)
|   |-- shared-redis (redis:7-alpine)
|   |-- litellm-proxy
|   |-- pgbouncer
|   |-- crawl4ai
|   |-- langfuse stack (web + worker + clickhouse + minio)
|   |-- flower (monitoring Celery tous projets)
|   |-- bull-board (monitoring Bull tous projets)
|   +-- uptime-kuma (healthchecks centralises)
|
|-- [AUG] augmenter.PRO (docker-compose, 11 containers)
|   |-- backend + frontend + 4 workers (worker, scoring, curation, crewai)
|   +-- nango + postiz + temporal stack (temporal + pg + es)
|
|-- [CC] coach-credit (docker-compose, 3 containers)
|   +-- backend + frontend + worker
|
|-- [RB] renov-bati (docker-compose, 5 containers)
|   +-- backend + frontend + 3 workers Python (etl, crawler, scoring)
|
+-- [VJ] voicejury (docker-compose, 2 containers) -- PRET A DEPLOYER
    +-- api + worker-heavy (frontend sur Hostinger)
```

### 11.2 Predefined Network

Tous les services sur le reseau `coolify` (Coolify "Connect To Predefined Network").

```env
# URLs internes
POSTGRES_HOST=shared-postgres
REDIS_HOST=shared-redis
LANGFUSE_HOST=http://langfuse:3000

# Ollama (systemd sur l'hote, acces via host.docker.internal)
OLLAMA_HEAVY_URL=http://host.docker.internal:11434
OLLAMA_LIGHT_URL=http://host.docker.internal:11435
OLLAMA_VISION_URL=http://host.docker.internal:11436
OLLAMA_REASONING_URL=http://host.docker.internal:11438
OLLAMA_TWITCH_URL=http://host.docker.internal:11437

# Whisper
WHISPER_URL=http://shared-whisper:9000
```

> **`extra_hosts` requis :** Chaque docker-compose qui accede a Ollama doit inclure `extra_hosts: ["host.docker.internal:host-gateway"]`.

### 11.3 GHCR Registry Partage

```dockerfile
# Base image commune (build une fois, utilisee par 3 projets NestJS)
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM ghcr.io/pi3block/sourcefast-node-base:latest AS builder
COPY package*.json ./
RUN npm ci --only=production
```

### 11.4 zram

```bash
# /etc/default/zramswap (etat actuel: 12 Go RAM)
ALGO=lz4
PERCENT=50        # 50% de 12 Go = ~5.8 Go zram (actuel)
PRIORITY=100

# Post-upgrade: 50% de 28 Go = 14 Go zram
# vm.swappiness=150 (agressif, car le "swap" est en RAM compressee)
vm.swappiness=150
```

### 11.5 Docker Daemon

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "storage-driver": "overlay2",
  "default-shm-size": "32M",
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "5GB" } }
}
```

**Nettoyage periodique :**

```bash
# /etc/cron.d/docker-cleanup
0 3 * * 0 root docker system prune -f --filter "until=168h"
0 4 * * 0 root docker volume prune -f
```

### 11.6 Securite Reseau Docker

| Mitigation | Statut |
|------------|--------|
| Firewall Coolify (iptables, seuls 80/443 exposes) | FAIT |
| PostgreSQL users par projet | FAIT |
| Redis password (`requirepass`) | FAIT |
| Ollama non expose publiquement | FAIT |
| Redis ACL par projet | A FAIRE (Phase 4) |

---

## 12. Migration / Checklist

### Etat Actuel (sprints termines)

| Element | Statut | Date |
|---------|--------|------|
| zram activation | FAIT | 2026-02-10 |
| Docker volume prune + memory limits | FAIT | 2026-02-10 |
| Ollama systemd template (3 instances) | FAIT | 2026-02-10 |
| Migration modeles Qwen3 | FAIT | 2026-02-10 |
| GPU isolation (UUID-based) | FAIT | 2026-02-10 |
| Faster Whisper HTTP (large-v3-turbo) | FAIT | 2026-02-10 |
| Backup cron PostgreSQL + ClickHouse | FAIT | 2026-02-10 |
| pgvector (Qdrant -> pgvector) | FAIT | 2026-02-11 |
| Voicejury DB/Redis consolidation | FAIT | 2026-02-11 |
| Test restauration automatise | FAIT | 2026-02-11 |
| Shared Whisper HTTP systemd | FAIT | 2026-02-10 |
| GPU swap: GPU 0 -> Ollama Light, GPU 1 -> Heavy | FAIT | 2026-02-11 |
| Jury parallele (asyncio.gather, 3x faster) | FAIT | 2026-02-11 |
| LLM fallback chain: Ollama -> LiteLLM/Groq -> heuristic | FAIT | 2026-02-11 |
| Langfuse tracing integre (pipeline + jury generations) | FAIT | 2026-02-11 |
| Structured logging (zero print(), logging module) | FAIT | 2026-02-11 |
| LiteLLM Proxy deploy (port 4000) | FAIT | 2026-02-19 |
| Ollama V3 : 5 instances (heavy, light, vision, reasoning, twitch) | FAIT | 2026-02-24 |
| PostgreSQL migration augmenter-db -> shared-postgres | FAIT | 2026-02-24 |
| Redis migration augmenter-redis -> shared-redis | FAIT | 2026-02-24 |
| LiteLLM config: ajout qwen2.5vl-vision + deepseek-reasoning | FAIT | 2026-02-24 |
| Documentation fusion V3 | FAIT | 2026-02-25 |
| LLM jury: Groq qwen3-32b via LiteLLM (zero cost) | FAIT | 2026-02-25 |
| LiteLLM config: ajout groq-qwen3-32b + groq-llama4-scout | FAIT | 2026-02-25 |

### Phase 0 — Hardware Upgrade (2h, downtime planifie)

1. [ ] Acheter i7-9700K (~90 EUR occasion) + DDR4 16 Go (~30 EUR)
2. [ ] Backup complet (`/opt/scripts/backup-databases.sh` + backup ClickHouse)
3. [ ] Arreter tous les services (`docker stop $(docker ps -q)`)
4. [ ] Installer CPU + RAM
5. [ ] Boot -> verifier 28 Go RAM (`free -h`) + 8 cores (`nproc`)
6. [ ] Reconfigurer zram : `PERCENT=50` -> 14 Go effectifs
7. [ ] Mettre a jour Ollama `NUM_PARALLEL` (heavy: 6, light: 12)
8. [ ] Redemarrer tous services + warmup Ollama

### Phase 1 — LiteLLM Proxy (DONE 2026-02-19)

1. [x] Creer `deploy/litellm/litellm-config.yaml` (section 3.3)
2. [x] Creer `deploy/litellm/docker-compose.coolify.yml`
3. [x] `CREATE DATABASE litellm` + user sur shared-postgres
4. [x] Deployer sur Coolify (standalone docker-compose)
5. [ ] Creer 4 teams + 4 virtual keys (curl commands) — **TODO: LITELLM_API_KEY vide sur augmenter**
6. [x] Configurer Traefik : `litellm.augmenter.pro`
7. [x] Tester routing : health, models, fallback, Langfuse traces

### Phase 2 — Migrer augmenter.PRO (DONE 2026-02-24)

1. [x] Migrer PostgreSQL : dump augmenter-db -> shared-postgres (3 DBs: augmenter, nango, postiz)
2. [x] Migrer Redis : BullMQ queues auto-reconstruit, pas de migration necessaire
3. [x] Supprimer services dupliques du compose (augmenter-db, augmenter-redis, langfuse, flower, etc.)
4. [x] Fix `${VAR:?msg}` -> `${VAR}` dans docker-compose.coolify.yml (Coolify cree des env vars parasites)
5. [x] Fix Nango migration locks (copier `_nango_auth_migrations` + nettoyer lock table)
6. [x] Verifier : dashboard OK, 3 users, 126 widgets, 59 tables
7. [x] Reconfigurer Ollama V3 : 5 instances independantes (heavy, light, vision, reasoning, twitch)
8. [x] Mettre a jour LiteLLM config : ajout `qwen2.5vl-vision` + `deepseek-reasoning`
9. [ ] Env var `LITELLM_API_KEY` vide — **backend utilise Ollama direct, pas encore LiteLLM gateway**
10. [ ] Nettoyer env vars parasites dans Coolify UI + orphan containers

### Phase 3 — PgBouncer + Monitoring (2h)

1. [ ] Deployer PgBouncer 1.21+ (section 5.3)
2. [ ] Deployer Bull Board (option B : integre dans augmenter backend, route `/admin/queues`)
3. [ ] Deployer Uptime Kuma + configurer healthchecks
4. [ ] Configurer alertes Telegram

### Phase 4 — Provisionner renov-bati (1 jour)

1. [ ] Creer database `renov_bati` + extensions PostGIS + pgvector
2. [ ] Scaffolder le projet NestJS (backend + frontend + 3 workers)
3. [ ] Redis DB index 5 + 9
4. [ ] LiteLLM virtual key `sk-renov-bati`
5. [ ] Docker-compose + Coolify app
6. [ ] Commencer Module A (ETL ADEME/DVF) + Module C (crawler)

### Phase 5 — Provisionner coach-credit (4h)

1. [ ] Creer database `coach_credit`
2. [ ] Scaffolder le projet NestJS
3. [ ] Redis DB index 6
4. [ ] LiteLLM virtual key `sk-coach-credit`
5. [ ] Docker-compose + Coolify app

### Phase 6 — Deployer voicejury (4h)

1. [ ] Verifier RAM disponible (necessaire: ~1.8 Go supplementaires)
2. [ ] Creer tables dans voicejury_db (sessions, word_timestamps_cache, lyrics_cache, search_history)
3. [ ] Configurer env vars dans Coolify (section 7.7)
4. [ ] Deployer docker-compose voicejury (api, frontend, worker-heavy, worker-pool)
5. [ ] Tester pipeline complet (upload audio -> analyse -> jury LLM -> resultats)
6. [x] Verifier Langfuse traces + Flower visibility (flower-voicejury.augmenter.pro, Redis DB 2)
7. [ ] Verifier GPU time-sharing (Ollama Light <-> Demucs)

### Fichiers a Creer/Modifier

**Nouveaux fichiers :**
- `deploy/litellm/litellm-config.yaml` — Config routing LLM
- `deploy/litellm/docker-compose.coolify.yml` — Container LiteLLM
- `deploy/pgbouncer/pgbouncer.ini` — Config connection pooler
- `deploy/pgbouncer/docker-compose.coolify.yml` — Container PgBouncer
- `deploy/uptime-kuma/docker-compose.coolify.yml` — Healthchecks

**Fichiers existants a modifier :**
- `backend/src/common/services/llm.service.ts` — Ajouter provider `litellm`
- `backend/src/config/llm.config.ts` — Ajouter `litellm.url`, `litellm.apiKey`
- `worker/crewai_app.py` — Pointer vers LiteLLM au lieu d'Ollama direct
- `worker/tasks/curation_scoring/scoring.py` — Pointer vers LiteLLM
- `/etc/ollama/heavy.env` — `NUM_PARALLEL=6` (post i7-9700K)
- `/etc/ollama/light.env` — `NUM_PARALLEL=12`
- `/etc/default/zramswap` — `PERCENT=50` (recalculer pour 28 Go)
- `docker-compose.coolify.yml` — Ajuster memory limits

### Verification Finale

```bash
curl http://litellm:4000/health                          # -> healthy
curl http://litellm:4000/global/spend/report?group_by=team  # -> couts par projet
nvidia-smi                                               # -> 5 GPUs, 0 conflit
free -h                                                  # -> 12 Go (actuel) ou 28 Go (post-upgrade)
nproc                                                    # -> 2 (actuel) ou 8 (post-upgrade)
df -h /                                                  # -> 95% used (CRITICAL)
```

---

## 13. References

### LiteLLM
- [Documentation](https://docs.litellm.ai/)
- [Docker Deployment](https://docs.litellm.ai/docs/proxy/deploy)
- [Fallbacks & Reliability](https://docs.litellm.ai/docs/proxy/reliability)
- [Langfuse Integration](https://docs.litellm.ai/docs/observability/langfuse_integration)
- [Cost Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)

### Groq
- [API Documentation](https://console.groq.com/docs)
- [Models & Rate Limits](https://console.groq.com/docs/models)
- [Whisper Audio API](https://console.groq.com/docs/speech-text)

### Ollama
- [Environment Variables](https://github.com/ollama/ollama/blob/main/docs/faq.md)
- [GPU Selection](https://github.com/ollama/ollama/blob/main/docs/gpu.md)
- [Flash Attention](https://github.com/ollama/ollama/issues/5765)
- [KV Cache Quantization](https://github.com/ollama/ollama/issues/7051)
- [VRAM Fragmentation Bug](https://github.com/ollama/ollama/issues/9410)

### Whisper / STT
- [Faster Whisper](https://github.com/SYSTRAN/faster-whisper)
- [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice)

### Audio Processing (voicejury)
- [Demucs GitHub](https://github.com/facebookresearch/demucs)
- [CREPE GitHub](https://github.com/marl/crepe)
- [Whisper GitHub](https://github.com/openai/whisper)

### PostgreSQL
- [pgvector](https://github.com/pgvector/pgvector)
- [PgBouncer 1.21 Prepared Statements](https://www.pgbouncer.org/changelog.html)
- [pgBackRest](https://pgbackrest.org/)

### Redis
- [Eviction Policies](https://redis.io/docs/manual/eviction/)
- [Lazy Freeing](https://redis.io/docs/manual/memory-optimization/)

### Docker & System
- [Docker Memory Limits](https://docs.docker.com/config/containers/resource_constraints/)
- [zram](https://www.kernel.org/doc/html/latest/admin-guide/blockdev/zram.html)

### Frameworks (voicejury)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [Celery Docs](https://docs.celeryq.dev/)
- [Zustand Docs](https://zustand.docs.pmnd.rs/)

### Project Internal
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture augmenter.PRO
- [DECISIONS.md](./DECISIONS.md) — ADRs
- [DEPLOYMENT_COOLIFY.md](./DEPLOYMENT_COOLIFY.md) — Deployment guide

---

## Changelog

| Date | Changement |
|------|------------|
| **2026-02-25** | **Documentation fusion V3** (merge UNIFIED_ARCHITECTURE + UNIFIED_INFRA_last) |
| **2026-02-25** | **LLM jury: Groq qwen3-32b via LiteLLM** (zero cost, meilleur francais) |
| **2026-02-25** | **LiteLLM config: groq-qwen3-32b + groq-llama4-scout** ajout modeles Groq |
| **2026-02-25** | **GPU time-sharing** Ollama Light <-> Voicejury worker sur GPU 0 |
| **2026-02-25** | **Groq Whisper** cloud fallback (Tier 2 transcription) |
| **2026-02-25** | **Container names migration** (shared-postgres, shared-redis) |
| **2026-02-25** | **model_group_alias "jury-comment"** -> groq-qwen3-32b |
| 2026-02-24 | Augmenter.PRO migration complete (shared-postgres, shared-redis) |
| 2026-02-24 | Ollama V3 : 5 instances systemd (heavy, light, vision, reasoning, twitch) |
| 2026-02-24 | LiteLLM config: ajout qwen2.5vl-vision + deepseek-reasoning |
| 2026-02-19 | LiteLLM Proxy deploye (port 4000, Traefik litellm.augmenter.pro) |
| 2026-02-16 | Incident backup silencieux (rename container sans update script) |
| 2026-02-11 | DB/Redis consolides (voicejury_db + DB index 2) |
| 2026-02-11 | GPU swap: GPU 0 -> Ollama Light, GPU 1 -> Ollama Heavy |
| 2026-02-11 | Jury parallele (asyncio.gather, 3x faster) |
| 2026-02-11 | LLM fallback chain: Ollama -> LiteLLM/Groq -> heuristic |
| 2026-02-11 | Langfuse tracing integre (pipeline + jury generations) |
| 2026-02-11 | Structured logging (zero print(), logging module) |
| 2026-02-11 | pgvector migration (Qdrant supprime, -1 container, -1 Go RAM) |
| 2026-02-10 | Shared Whisper HTTP (systemd, GPU 4) |
| 2026-02-10 | GPU isolation par UUID (docker-compose device_ids) |
| 2026-02-10 | zram activation + Docker cleanup |
| 2026-02-10 | Ollama systemd template (3 instances initiales) |
| 2026-02-10 | Backup cron PostgreSQL + ClickHouse |
