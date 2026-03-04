# GPU Capabilities — Ce qui tourne sur nos 5 GPUs (mars 2026)

> Inventaire des modeles AI open-source exploitables sur le serveur SourceFast.
> Objectif : reference pour choisir quels services deployer et comment repartir les GPUs.

Last updated: 2026-03-03

---

## Table des Matieres

1. [Hardware GPU](#1-hardware-gpu)
2. [Configuration Actuelle (Production)](#2-configuration-actuelle-production)
3. [LLMs — Modeles Texte](#3-llms--modeles-texte)
4. [Generation d'Images](#4-generation-dimages)
5. [Generation Video](#5-generation-video)
6. [Audio — Musique & TTS & STT](#6-audio--musique--tts--stt)
7. [Vision / Multimodal](#7-vision--multimodal)
8. [Scenarios d'Allocation Multi-Service](#8-scenarios-dallocation-multi-service)
9. [Limites Hardware](#9-limites-hardware)
10. [References](#10-references)

---

## 1. Hardware GPU

| GPU | Carte | VRAM | Bus PCIe | Topologie |
|-----|-------|------|----------|-----------|
| 0 | RTX 3070 | 8 GB | x8 | PHB |
| 1 | RTX 3070 | 8 GB | x8 | **PIX** |
| 2 | RTX 3070 | 8 GB | x8 | **PIX** |
| 3 | RTX 3080 | 10 GB | x8 | **PIX** |
| 4 | RTX 3080 | 10 GB | x8 | **PIX** |
| **Total** | | **44 GB** | | |

- **PIX** = meme switch PCIe (meilleure bande passante inter-GPU)
- **PHB** = via host bridge (plus lent)
- CPU Celeron G4930 = 16 lanes PCIe 3.0, bifurcation x8 par slot
- GPUs 1-4 (PIX) : **36 GB** utilisables en tensor split Ollama ou multi-GPU

---

## 2. Configuration Actuelle (Production)

| GPU | Service | VRAM utilisee | Port | Systemd |
|-----|---------|--------------|------|---------|
| 0 | **Whisper** large-v3-turbo int8 | 4.3 GB | :9000 | `shared-whisper.service` |
| 1 | **A3B** (part 1/4) | 6.7 GB | :11439 | `ollama@a3b.service` |
| 2 | **A3B** (part 2/4) | 6.2 GB | :11439 | — |
| 3 | **A3B** (part 3/4) | 8.0 GB | :11439 | — |
| 4 | **A3B** (part 4/4) + **Reranker** | 7.9 GB + 1.5 GB | :11439 / :8001 | `reranker.service` |

**A3B = `aratan/qwen3.5-a3b-abliterated:35b`** — MoE 35B, Q4_K_M, 28 GB VRAM, 53 t/s generation.

---

## 3. LLMs — Modeles Texte

### 3.1 Via Ollama tensor split (GPUs 1-4 = 36 GB)

| Modele | Params | Quant | VRAM | Perf estimee | Viable ? |
|--------|--------|-------|------|-------------|----------|
| **A3B 35B** (actuel) | 35B MoE | Q4_K_M | 28 GB | **53 t/s** | ✅ Excellent |
| **Qwen3.5 32B** | 32B | Q4_K_M | ~20 GB | ~40+ t/s | ✅ **Sweet spot** |
| **Qwen3.5 32B** | 32B | Q5_K_M | ~25 GB | ~35 t/s | ✅ Meilleure qualite |
| **Mixtral 8x22B** | 141B MoE | Q4_K_M | ~28 GB | ~25-30 t/s | ✅ Bon multi-taches |
| **DeepSeek-R1 70B** | 70B | Q3_K_M | ~33 GB | ~12-15 t/s | ⚠️ Lent mais possible |
| **Qwen3 72B** | 72B | Q3_K_M | ~33 GB | ~15-20 t/s | ⚠️ Qualite Q3 degradee |
| **Llama 3.3 70B** | 70B | Q3_K_S | ~32 GB | ~12-18 t/s | ⚠️ Qualite Q3 acceptable |
| **Qwen3 72B** | 72B | Q4_K_M | ~42 GB | — | ❌ Spillover CPU |
| **Command-R+ 104B** | 104B | Q2_K | ~35 GB | ~8-12 t/s | ⚠️ Q2 = qualite faible |

**Recommandation LLM :** L'A3B 35B MoE actuel est le meilleur compromis qualite/vitesse. Pour monter, privilegier **Qwen3.5 32B Q5** (qualite superieure, 25 GB). Les 70B en Q3 sont possibles mais inferieurs a un bon 35B Q4.

### 3.2 Via Groq (cloud, gratuit)

| Modele | Latence | Limite | Usage actuel |
|--------|---------|--------|-------------|
| llama-3.1-8b-instant | ~100ms | 6K TPM | Scoring, classification (FastLlmService) |
| qwen3-32b | ~200ms | 6K TPM | Analyse complexe fallback |
| llama4-scout-17b | ~150ms | 6K TPM | Multi-taches |

---

## 4. Generation d'Images

Tous ces modeles tournent sur **1 seul GPU** (8-10 GB suffisent).

| Modele | Params | VRAM | Temps/image (3070) | Qualite | Notes |
|--------|--------|------|-------------------|---------|-------|
| **FLUX.2** | ~12B | ~8 GB (GGUF Q8) | 30-60s | SOTA 2026 | Meilleur rapport qualite |
| **Z-Image-Turbo** | 6B | ~6 GB | 3-5s | Proche FLUX | Ultra-rapide, distille |
| **SD 3.5 Large** | 8B | ~8 GB | 15-30s | Excellent | Meilleure typographie |
| **SDXL** + LoRAs | 6.6B | ~6 GB | 10-20s | Tres bon | Ecosysteme massif |
| **SD 3.5 Medium** | 2B | ~4 GB | 5-10s | Bon | Leger |

**Multi-GPU image :** Avec ComfyUI-MultiGPU, repartir UNet/CLIP/VAE sur GPUs differents pour du pipelining.

**Outils :**
- ComfyUI (workflow nodes)
- Automatic1111 / Forge (UI classique)
- Fooocus (simple, SDXL optimise)

---

## 5. Generation Video

### 5.1 Modeles compatibles

| Modele | Params | Quant | VRAM | Temps (3070) | Resolution | Duree |
|--------|--------|-------|------|-------------|------------|-------|
| **LTX-Video 2** | 19B | GGUF | ~8 GB | 3-5 min | 720p | 10s |
| **Wan2.2 TI2V-5B** | 5B | GGUF Q8 | ~8 GB | 5-10 min | 720p | 5s |
| **Wan2.2 A14B** | 27B MoE | GGUF Q4 | ~12 GB + offload | 15-30 min | 480p | 5s |
| **HunyuanVideo** | — | GGUF | ~10 GB | 10-20 min | 720p | — |

### 5.2 Wan2.2 A14B — Details

Le modele phare (Text-to-Video et Image-to-Video) avec architecture MoE :
- **Officiel :** 80 GB VRAM recommande (single GPU datacenter)
- **GGUF Q4 + block swap :** Tourne sur 8-10 GB avec offload RAM
- **Multi-GPU :** FSDP + DeepSpeed Ulysses (concu datacenter, pas optimal PCIe consumer)
- **Realiste sur notre setup :** 480p, 5s, ~15-30 min par video

### 5.3 Outils recommandes

| Outil | Approche | Lien |
|-------|----------|------|
| **Wan2GP** | Optimise GPU pauvres, block swap | github.com/deepbeepmeep/Wan2GP |
| **ComfyUI + WanVideoWrapper** | Multi-GPU, Virtual VRAM | github.com/pollockjj/ComfyUI-MultiGPU |
| **ComfyUI natif** | Workflow officiel Wan2.2 | docs.comfy.org |

**Workflow RTX 3070 valide :** github.com/blongsta/wan2.1-i2v-workflow (optimise 8 GB VRAM).

---

## 6. Audio — Musique & TTS & STT

### 6.1 STT (Speech-to-Text) — Deja en production

| Modele | VRAM | Latence | GPU | Status |
|--------|------|---------|-----|--------|
| **Whisper large-v3-turbo** int8 | 4.3 GB | Temps reel | GPU 0 | ✅ En prod |

### 6.2 TTS (Text-to-Speech) — Deployable

| Modele | Params | VRAM | Latence | Voice Cloning | Notes |
|--------|--------|------|---------|---------------|-------|
| **Kani-TTS-2** | 400M | **3 GB** | RTF 0.2 (2s→10s audio) | Oui (embedding) | Le plus efficient |
| **Qwen3-TTS 0.6B** | 0.6B | ~4 GB | 97ms streaming | Oui (3s sample) | Temps reel |
| **Qwen3-TTS 1.7B** | 1.7B | ~6 GB | ~200ms | Oui (3s sample) | Meilleure qualite |
| **XTTS-v2** | — | ~4 GB | <150ms streaming | Oui (6s sample) | Multilingue, mature |
| **CosyVoice2-0.5B** | 0.5B | ~4 GB | Streaming | Oui + emotions | Controle emotionnel |

**Tous deployables sur 1 GPU (3-6 GB).** Co-localisation possible avec Whisper sur GPU 0 (4.3 + 3-4 = 7-8 GB, dans les 8 GB de la 3070).

### 6.3 Musique — Deployable

| Modele | VRAM | Temps | Type | Notes |
|--------|------|-------|------|-------|
| **ACE-Step 1.5** | **<4 GB** | <10s/chanson (3090), ~30s (3070) | Full song | SOTA open-source 2026 |
| **MusicGen Medium** | ~8 GB | Temps reel | Instrumentale | Meta, solide |
| **MusicGen Large** | ~16 GB (2 GPUs) | Quasi-reel | Instrumentale | Meilleure qualite |
| **YuE AI** | ~8 GB (quantise) | Variable | Voix + instrumentale | Full songs, Suno-like |

---

## 7. Vision / Multimodal

| Modele | Quant | VRAM | Usage |
|--------|-------|------|-------|
| **A3B 35B** (actuel) | Q4_K_M | 28 GB (4 GPUs) | Vision + analyse images ✅ en prod |
| **InternVL2.5 26B** | Q4 | ~16 GB (2 GPUs) | OCR + document understanding |
| **LLaVA-1.6 34B** | Q4 | ~20 GB (3 GPUs) | Vision Q&A |
| **Qwen2.5-VL 72B** | Q3 | ~33 GB (4 GPUs) | Vision SOTA mais lent |
| **MiniCPM-V 2.6** | — | ~8 GB (1 GPU) | Vision legere, rapide |

---

## 8. Scenarios d'Allocation Multi-Service

### Scenario A — Production actuelle

| GPU | Service | VRAM |
|-----|---------|------|
| 0 | Whisper (4.3 GB) | 8 GB |
| 1-4 | A3B 35B (28 GB) + Reranker (1.5 GB) | 36 GB |

**Pour :** LLM puissant, transcription, reranking RAG.

### Scenario B — Studio creatif (image + video + audio)

| GPU | Service | VRAM |
|-----|---------|------|
| 0 | Whisper (4.3 GB) + Kani-TTS (3 GB) | ~7.3 / 8 GB |
| 1 | FLUX.2 GGUF image gen (8 GB) | 8 GB |
| 2 | LTX-Video 2 ou Wan2.2 5B (8 GB) | 8 GB |
| 3-4 | Qwen3.5 32B Q4 LLM (20 GB) | 20 GB |

**Pour :** Creation de contenu multimodale complete.

### Scenario C — Maximum intelligence LLM

| GPU | Service | VRAM |
|-----|---------|------|
| 0 | Whisper (4.3 GB) + Reranker (1.5 GB) | ~5.8 / 8 GB |
| 1-4 | 70B Q3_K_M (~33 GB) | 36 GB |

**Pour :** Raisonnement complexe, analyse longue. Lent (~15 t/s).

### Scenario D — Multi-service equilibre

| GPU | Service | VRAM |
|-----|---------|------|
| 0 | Whisper (4.3 GB) | 8 GB |
| 1 | ACE-Step musique (4 GB) + Kani-TTS (3 GB) | ~7 / 8 GB |
| 2-4 | A3B 35B (28 GB — tight sur 3 GPUs) | 28 GB |

**Attention :** A3B sur 3 GPUs = spillover CPU (5 GB), perf degrade 10x (4 t/s vs 53 t/s). Non viable.

### Scenario E — Double LLM (analyse + scoring)

| GPU | Service | VRAM |
|-----|---------|------|
| 0 | Whisper (4.3 GB) | 8 GB |
| 1 | Qwen3.5 9B scoring rapide (6 GB) | 8 GB |
| 2-4 | Qwen3.5 32B Q4 analyse (20 GB sur 3 GPUs) | 28 GB |

**Pour :** Pipeline scoring local (remplace Groq) + analyse complexe.

---

## 9. Limites Hardware

### 9.1 Contraintes critiques

| Contrainte | Impact | Mitigation |
|------------|--------|------------|
| **Celeron 2c/2t** | CPU bottleneck sur offloading, preprocessing | Upgrade i7-9700K planifie |
| **12 GB RAM** | Limite block swap VRAM↔RAM | Upgrade 28 GB planifie |
| **PCIe 3.0 x8** | Bande passante 8 GB/s par GPU (vs 32 GB/s NVLink) | Topologie PIX aide |
| **Pas de NVLink** | Multi-GPU FSDP/DeepSpeed sous-optimal | Ollama tensor split OK |
| **8 GB min VRAM** | Les 3070 limitent les modeles single-GPU | Privilegier quantisation |

### 9.2 Regles de repartition

1. **A3B (35B MoE) = 4 GPUs minimum.** 3 GPUs = spillover CPU = 10x plus lent. Non negociable.
2. **Whisper = GPU dedie.** Partage possible uniquement avec des modeles <4 GB (TTS, Reranker).
3. **Video gen = patient.** 15-30 min pour 5s en 480p avec le A14B. Acceptable pour batch, pas temps reel.
4. **Image gen = 1 GPU suffit.** FLUX.2 GGUF Q8 tient dans 8 GB, pas besoin de multi-GPU.
5. **70B = sacrifice vitesse.** Q3 obligatoire, ~15 t/s max, qualite inferieure a un bon 35B Q4.

### 9.3 Ce qui ne tourne PAS

| Modele | Pourquoi |
|--------|----------|
| Wan2.2 A14B temps reel | 80 GB VRAM officiel, FSDP pas adapte PCIe consumer |
| Qwen3 72B Q4+ | 42+ GB, depasse les 36 GB disponibles |
| Llama 3.1 405B | 200+ GB minimum |
| Stable Video Diffusion HD | 20+ GB single GPU |
| Training / Fine-tuning >7B | RAM + VRAM insuffisants |

---

## 10. References

### Outils multi-GPU
- [ComfyUI-MultiGPU](https://github.com/pollockjj/ComfyUI-MultiGPU) — Virtual VRAM + WanVideoWrapper
- [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) — Video gen optimise GPU pauvres
- [Wan2.1 RTX 3070 workflow](https://github.com/blongsta/wan2.1-i2v-workflow) — Workflow valide 8 GB

### Modeles
- [Wan2.2](https://github.com/Wan-Video/Wan2.2) — SOTA video generation open-source
- [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) — Musique <4 GB VRAM
- [Kani-TTS-2](https://www.marktechpost.com/2026/02/15/meet-kani-tts-2/) — TTS 400M, 3 GB VRAM
- [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS) — Voice cloning temps reel
- [Z-Image-Turbo](https://huggingface.co/stabilityai/z-image-turbo) — Image gen sub-seconde

### Guides VRAM
- [Ollama VRAM Calculator](https://aleibovici.github.io/ollama-gpu-calculator/)
- [Ollama VRAM Requirements Guide](https://localllm.in/blog/ollama-vram-requirements-for-local-llms)
- [Best GPUs for AI 2026](https://www.bestgpusforai.com/blog/best-gpus-for-ai)
- [LTX-2 GGUF ComfyUI Guide](https://ltx-2.run/blog/how-to-install-ltx-2-gguf-models-comfyui/)

### Benchmarks internes
- [Benchmark A3B](../README.md) — 53 t/s gen, 1536 t/s prefill sur 4 GPUs
- [GPU Evolution A3B (kiaraoke)](../../tuasunincroyabletalent.fr/docs/GPU_EVOLUTION_A3B.md)
