# Kiaraoke.fr — Plan d'améliorations SOTA 2026

> Statut : **Documentation initiale** (2026-03-03)
> Auteur : Claude Opus 4.6 + review humain
> Basé sur : audit serveur live + recherche état de l'art Mars 2026

## Table des matières

1. [Contexte et état actuel](#1-contexte-et-état-actuel)
2. [Axe A — Pipeline Audio](#2-axe-a--pipeline-audio)
3. [Axe B — LLM Jury](#3-axe-b--llm-jury)
4. [Axe C — Architecture GPU partagée](#4-axe-c--architecture-gpu-partagée)
5. [Phases d'implémentation](#5-phases-dimplémentation)
6. [Matrice de fallback complète](#6-matrice-de-fallback-complète)
7. [Métriques cibles](#7-métriques-cibles)

---

## 1. Contexte et état actuel

### Serveur GPU (état réel 2026-03-03)

| GPU | Carte | VRAM | Rôle actuel | Processus |
|-----|-------|------|-------------|-----------|
| 0 | RTX 3070 | 8 GB | shared-whisper (4.3 GB) | python (faster-whisper) |
| 1 | RTX 3070 | 8 GB | A3B shard (6.7 GB) | ollama@a3b |
| 2 | RTX 3070 | 8 GB | A3B shard (6.2 GB) | ollama@a3b |
| 3 | RTX 3080 | 10 GB | A3B shard (8.0 GB) | ollama@a3b |
| 4 | RTX 3080 | 10 GB | A3B shard (7.9 GB) + Kiaraoke worker (1.9 GB) | ollama@a3b + python |

**Hardware :** 3× RTX 3070 (8 GB) + 2× RTX 3080 (10 GB) = **44 GB VRAM total**

### Problèmes identifiés sur Kiaraoke

| Problème | Impact | Cause racine |
|----------|--------|-------------|
| CREPE 47s au lieu de ~2s | Pipeline 5x plus lent | A3B occupe 6.7/8 GB sur GPU du worker |
| De-bleeding OOM GPU | Fallback CPU (+10s) | A3B occupe 7.9/10 GB sur GPU Demucs |
| CTC alignment crash | Fallback shared-whisper (+15s) | `CTC_ALIGN_DEVICE=cuda:3` mais container voit 2 GPUs |
| Ollama Heavy 404 | Warning trompeur | `ollama.service` (main) bloque port 11434 |
| GROQ_API_KEY vide | Pas de fallback Groq | Variable non configurée dans Coolify |
| prepare_reference 187s | Très lent (était ~40s) | Cumul des problèmes ci-dessus |

### Pipeline actuel (9 étapes)

```
analyze_performance
├─ Step 1: Unload Ollama Light (keep_alive:0)
├─ Step 2: Demucs — Séparation user vocals ─────────── 5.5 GB VRAM, ~25s
├─ Step 3: Demucs — Séparation reference (cache) ──── 0s si cache
├─ Step 3.5: Cross-correlation sync ────────────────── CPU, ~1s
├─ Step 4: torchcrepe — Pitch extraction ───────────── 1 GB VRAM, ~4s (user full + ref tiny)
├─ Step 5: Whisper — Transcription user ────────────── shared-whisper HTTP, ~3s
├─ Step 6: Genius API — Paroles reference ──────────── HTTP, ~1s
└─ Step 7: Scoring + Jury LLM (3 personas ∥) ──────── CPU + Groq, ~3s
```

---

## 2. Axe A — Pipeline Audio

### A1. Mel-Band RoFormer remplace Demucs htdemucs

**Motivation :** Meilleure qualité de séparation, moins de VRAM, suppression possible du de-bleeding.

| | Demucs htdemucs (actuel) | Mel-Band RoFormer (cible) |
|--|--------------------------|---------------------------|
| **SDR vocals** | ~9.16 | **10.98** (+1.8 dB) |
| **VRAM inference** | ~5.5 GB | **~2-4 GB** |
| **De-bleeding nécessaire** | Oui (Wiener masks, OOM fréquent) | Probablement non |
| **Architecture** | Hybrid Transformer-Demucs | Transformer mel-band attention |
| **Repo** | `facebook/demucs` | `ZFTurbo/Music-Source-Separation-Training` |
| **Checkpoint** | `htdemucs` (PyTorch Hub) | `kim_mel_band_roformer_vocals.ckpt` |
| **Licence** | MIT | MIT |

**Fichiers à modifier :**

- `worker/tasks/audio_separation.py` — remplacer l'import Demucs par MBR
- `worker/Dockerfile` / `requirements.txt` — ajouter dépendance `music-source-separation-training`
- `worker/tasks/pipeline.py` — supprimer la logique de-bleeding si MBR suffisamment propre

**Code cible (schématique) :**

```python
# worker/tasks/audio_separation.py
from inference import separate_audio  # ZFTurbo repo

_model = None

def get_separator_model():
    global _model
    if _model is None:
        # Charge le modèle Mel-Band RoFormer (~2-4 GB VRAM)
        _model = load_model(
            model_type="mel_band_roformer",
            checkpoint="kim_mel_band_roformer_vocals.ckpt",
            device=DEMUCS_DEVICE,  # cuda:0 dans le container
        )
    return _model

def separate_vocals(input_path: str, output_dir: str) -> dict:
    model = get_separator_model()
    vocals, instrumentals = separate_audio(model, input_path)
    # Sauvegarder vocals.wav et instrumentals.wav
    return {"vocals": vocals_path, "instrumentals": instrumentals_path}
```

**Validation :** Comparer SDR sur 10 morceaux de test avant/après. Le de-bleeding peut être gardé en option (`DEBLEED_ENABLED=false` par défaut avec MBR).

**Gain :** ~2 GB VRAM libérés + meilleure qualité + suppression OOM de-bleeding.

---

### A2. `fastdtw` → `dtw-python` (quick win)

**Motivation :** fastdtw est démontré comme plus lent ET moins précis que le DTW exact (article Wu & Keogh 2020). `dtw-python` utilise du C accéléré avec support Sakoe-Chiba windowing.

**Fichier :** `worker/tasks/scoring.py`

```python
# AVANT
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
distance, path = fastdtw(user_pitch, ref_pitch, dist=euclidean)

# APRÈS
from dtw import dtw
alignment = dtw(
    user_pitch, ref_pitch,
    step_pattern='symmetric2',
    window_type='sakoechiba',
    window_args={'window_size': 100},  # Limiter la fenêtre de recherche
)
distance = alignment.normalizedDistance
path = list(zip(alignment.index1, alignment.index2))
```

**Dépendance :** `pip install dtw-python` (remplace `fastdtw` dans requirements.txt)

**Gain :** Résultat plus précis, potentiellement plus rapide. Zéro risque, même API concept.

---

### A3. `librosa.pyin` pour le pitch référence (CPU, 0 GPU)

**Motivation :** Le pitch de la référence est extrait sur des vocals propres (post-séparation). CREPE tiny utilise du GPU pour ~200 MB de VRAM et prend 47s actuellement (contention A3B). `librosa.pyin` est CPU-only et suffisant sur audio propre.

**Fichier :** `worker/tasks/pitch_analysis.py`

```python
import librosa
import numpy as np

def extract_pitch_pyin(audio_path: str, sr: int = 22050) -> dict:
    """Extraction pitch CPU-only via PYIN. Pour la référence uniquement."""
    y, sr = librosa.load(audio_path, sr=sr)
    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, fmin=65, fmax=2093, sr=sr,
        frame_length=2048, hop_length=512,
    )
    # Remplacer NaN par 0 pour les frames non-voisées
    f0 = np.nan_to_num(f0, nan=0.0)
    times = librosa.times_like(f0, sr=sr, hop_length=512)
    return {
        "f0": f0,
        "times": times,
        "voiced_flag": voiced_flag,
        "confidence": voiced_probs,
    }
```

**Stratégie :** CREPE full pour le pitch **user** (qualité max, le chant amateur est plus bruité), PYIN pour le pitch **référence** (audio propre, CPU suffit).

**Gain :** -47s sur le pipeline actuel, 0 GPU pour le pitch référence.

---

### A4. `madmom` remplace librosa pour le rythme

**Motivation :** Onset detection neuronale (RNN) vs spectral flux, +10% F-measure sur les benchmarks standards.

**Fichier :** `worker/tasks/scoring.py` (section rythme)

```python
from madmom.features.onsets import RNNOnsetProcessor, OnsetPeakPickingProcessor

_onset_processor = None

def get_onset_processor():
    global _onset_processor
    if _onset_processor is None:
        _onset_processor = RNNOnsetProcessor()
    return _onset_processor

def detect_onsets(audio_path: str) -> np.ndarray:
    """Onset detection neuronale via madmom. CPU-only."""
    proc = get_onset_processor()
    activations = proc(audio_path)
    onsets = OnsetPeakPickingProcessor()(activations)
    return onsets  # Array de timestamps en secondes
```

**Dépendance :** `pip install madmom`

**Bonus :** madmom fournit aussi `RNNBeatProcessor` + `DBNBeatTrackingProcessor` pour le beat tracking. On pourrait scorer le rythme en comparant les onsets user aux beats de la référence plutôt qu'aux onsets bruts (plus musical).

**Gain :** +10% précision rythme, CPU-only, lazy-loaded.

---

### A5. CTC Forced Alignment remplace whisper-timestamped

**Motivation :** Le karaoke a déjà les paroles (LRCLib/Genius). Aligner un texte connu sur l'audio est plus fiable que transcribe+align via Whisper attention DTW, surtout pour le chant.

**Avantages CTC vs whisper-timestamped :**

| | whisper-timestamped (actuel) | CTC Forced Alignment (MMS_FA) |
|--|------------------------------|-------------------------------|
| Méthode | DTW sur attention weights Whisper | CTC alignment sur texte connu |
| Précision speech | ~50-100ms | ~20-50ms |
| Précision chant | Médiocre (attention "smear" sur notes tenues) | **Meilleure** (CTC plus robuste) |
| Prérequis | Audio seul | Audio + texte (paroles connues) |
| VRAM | ~3-4 GB (Whisper model) | **~1 GB** (MMS_FA model) |
| CPU fallback | Lent (~30s) | **Rapide (~2s)** |

**Fichier :** `worker/tasks/word_timestamps.py`

```python
import torchaudio
from torchaudio.functional import forced_align

_mms_model = None
_mms_tokenizer = None

def get_mms_aligner():
    global _mms_model, _mms_tokenizer
    if _mms_model is None:
        bundle = torchaudio.pipelines.MMS_FA
        _mms_model = bundle.get_model()
        _mms_tokenizer = bundle.get_tokenizer()
        if torch.cuda.is_available():
            _mms_model = _mms_model.to(CTC_ALIGN_DEVICE)
    return _mms_model, _mms_tokenizer

def align_lyrics_ctc(vocals_path: str, lyrics_text: str, device: str = "cpu") -> list:
    """
    Aligne les paroles connues sur l'audio vocal via CTC forced alignment.
    Retourne une liste de {word, startMs, endMs, confidence}.
    """
    model, tokenizer = get_mms_aligner()
    waveform, sr = torchaudio.load(vocals_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)

    with torch.no_grad():
        emission, _ = model(waveform.to(device))

    tokens = tokenizer(lyrics_text)
    token_spans = forced_align(emission[0], tokens)

    # Convertir token spans en word timestamps
    words = []
    for span in token_spans:
        words.append({
            "word": span.text,
            "startMs": int(span.start * 1000 / 16000 * waveform.shape[1]),
            "endMs": int(span.end * 1000 / 16000 * waveform.shape[1]),
            "confidence": span.score,
        })
    return words
```

**Fallback :** Si CTC échoue (texte trop différent de l'audio), fallback sur shared-whisper word timestamps.

**Gain :** Meilleure précision karaoke word-by-word, surtout sur les notes tenues et mélismes.

---

### A6. Parselmouth — métriques vocales enrichies

**Motivation :** Ajouter des métriques de qualité vocale (jitter, shimmer, HNR) qui enrichissent le contexte donné au jury LLM. Le feedback passe de "pitch décalé" à "voix instable sur le refrain, souffle audible".

**Fichier :** nouveau `worker/tasks/voice_quality.py`

```python
import parselmouth
from parselmouth.praat import call

def analyze_voice_quality(vocals_path: str) -> dict:
    """
    Analyse la qualité vocale via Praat/Parselmouth.
    CPU-only, très rapide (~200ms pour 3min).
    """
    snd = parselmouth.Sound(vocals_path)

    # Pitch (f0 via autocorrélation Praat)
    pitch = snd.to_pitch(time_step=0.01)
    f0_mean = call(pitch, "Get mean", 0, 0, "Hertz")
    f0_std = call(pitch, "Get standard deviation", 0, 0, "Hertz")

    # Point process pour jitter/shimmer
    point_process = call(snd, "To PointProcess (periodic, cc)", 75, 600)

    # Jitter — variation cycle-à-cycle du pitch (stabilité)
    jitter_local = call(point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3)

    # Shimmer — variation cycle-à-cycle de l'amplitude (régularité)
    shimmer_local = call(
        [snd, point_process], "Get shimmer (local)",
        0, 0, 0.0001, 0.02, 1.3, 1.6
    )

    # HNR — Harmonics-to-Noise Ratio (clarté vocale vs souffle)
    harmonicity = snd.to_harmonicity()
    hnr_mean = call(harmonicity, "Get mean", 0, 0)

    return {
        "f0_mean_hz": f0_mean,
        "f0_std_hz": f0_std,
        "jitter_local": jitter_local,      # < 1.04% = normal, > 2% = instable
        "shimmer_local": shimmer_local,    # < 3.81% = normal, > 6% = irrégulier
        "hnr_db": hnr_mean,                # > 20 dB = propre, < 10 dB = soufflé
    }
```

**Intégration au jury :** Ces métriques sont ajoutées au prompt du jury LLM :

```python
# Dans scoring.py, enrichir le prompt jury
voice_quality = analyze_voice_quality(user_vocals_path)
prompt += f"""
Métriques vocales supplémentaires :
- Stabilité vocale (jitter) : {voice_quality['jitter_local']:.2%} {'(stable)' if voice_quality['jitter_local'] < 0.015 else '(instable)'}
- Régularité amplitude (shimmer) : {voice_quality['shimmer_local']:.2%}
- Clarté vocale (HNR) : {voice_quality['hnr_db']:.1f} dB {'(propre)' if voice_quality['hnr_db'] > 20 else '(soufflé)'}
"""
```

**Dépendance :** `pip install praat-parselmouth`

**Gain :** Feedback jury plus riche et actionnable, CPU-only, < 200ms.

---

### A7. Bonus — Chroma-based pitch comparison (complémentaire)

Au lieu de comparer uniquement les courbes f0 brutes (sensible aux erreurs d'octave, fréquentes chez les amateurs), ajouter une comparaison par chroma features (classe de notes, indépendante de l'octave) :

```python
import librosa

def compute_chroma_similarity(user_vocals: str, ref_vocals: str) -> float:
    """Score de similarité chromatique (robust aux erreurs d'octave)."""
    y_user, sr = librosa.load(user_vocals, sr=22050)
    y_ref, sr = librosa.load(ref_vocals, sr=22050)

    chroma_user = librosa.feature.chroma_cqt(y=y_user, sr=sr)
    chroma_ref = librosa.feature.chroma_cqt(y=y_ref, sr=sr)

    # DTW sur les 12 dimensions chroma
    from dtw import dtw
    alignment = dtw(chroma_user.T, chroma_ref.T, step_pattern='symmetric2')
    return 1.0 - min(alignment.normalizedDistance, 1.0)
```

**Usage :** Score complémentaire au DTW cents. Un amateur qui chante une octave trop bas/haut ne serait plus pénalisé sur le chroma score même si le cents score reste impacté.

---

## 3. Axe B — LLM Jury

### État de l'art Mars 2026

| Modèle | Params | Actifs (MoE) | VRAM Q4_K_M | Qualité français | Dispo Ollama |
|--------|--------|-------------|-------------|-----------------|-------------|
| **Groq qwen3-32b** | 32B | dense | Cloud (free) | Excellent | N/A (API) |
| **Qwen3.5-35B-A3B** | 35B | 3B | ~23 GB multi-GPU | Excellent (35B knowledge) | Déjà running (port 11439) |
| **Qwen3.5-9B** | 9B | dense | ~5-6 GB | Très bon (MMLU-Pro 82.5) | À vérifier (arch Gated DeltaNet) |
| **Qwen3.5-4B** | 4B | dense | ~2.5-3 GB | Bon (MMLU-Pro 79.1) | À vérifier |
| **Mistral Small 3** | 24B | dense | ~14 GB | Excellent (société FR) | Oui |
| qwen3:4b (actuel) | 4B | dense | ~2.5 GB | Moyen | Oui |

### Architecture jury cible

```
Jury (3 personas en parallèle × asyncio.gather)
│
├─ Tier 1 : LiteLLM → Groq qwen3-32b ────── Cloud free, ~2s, meilleur français
│   Si Groq down ou rate-limited :
│
├─ Tier 2 : LiteLLM → A3B local (port 11439) ── 35B quality, ~6s (53 t/s × 300 tokens)
│   Si A3B indisponible :
│
├─ Tier 3 : LiteLLM → Groq llama4-scout ──── Cloud free, fallback rapide
│   Si tout cloud down + A3B down :
│
└─ Tier 4 : Heuristique ──────────────────── Commentaire pré-écrit basé sur score + persona
```

### Config LiteLLM à modifier

```yaml
# Dans /app/config.yaml du container litellm

model_group_alias:
  # Kiaraoke jury — cascade de fallback
  "jury-comment": "groq-qwen3-32b"            # Tier 1 : Groq (inchangé)
  "jury-comment-fallback": "a3b-multimodal"    # Tier 2 : A3B 35B local (NOUVEAU)
  # "jury-comment-fallback" était "groq-fast" → maintenant A3B pour qualité 35B

# Fallback chain LiteLLM
router_settings:
  fallbacks:
    - groq-qwen3-32b: [a3b-multimodal, groq-llama4-scout, gpt-4o-mini]
    - a3b-multimodal: [groq-qwen3-32b, groq-analysis, gpt-4o]
```

### Enrichissement du prompt jury

Avec les nouvelles métriques (Parselmouth, chroma), le prompt jury devient plus riche :

```
Tu es {persona_name}, membre du jury de Kiaraoke.
Évalue cette performance de chant.

Scores techniques :
- Justesse (pitch DTW) : {pitch_score}/100
- Similarité chromatique : {chroma_score}/100 (robuste aux erreurs d'octave)
- Rythme (onset matching) : {rhythm_score}/100
- Paroles (WER) : {lyrics_score}/100

Qualité vocale :
- Stabilité (jitter) : {jitter}% — {jitter_interpretation}
- Régularité (shimmer) : {shimmer}% — {shimmer_interpretation}
- Clarté (HNR) : {hnr} dB — {hnr_interpretation}

Chanson : {track_name} par {artist_name}
Offset détecté : {offset_ms}ms

Donne un commentaire de 2-3 phrases dans ton style {persona_style}.
```

---

## 4. Axe C — Architecture GPU partagée

### Principe fondamental

> Kiaraoke et Augmenter.PRO partagent les GPUs. **Aucune app n'est jamais bloquée** — si le GPU est occupé, on passe en mode dégradé (cloud, CPU, modèle plus petit). On remonte toujours au user **quel tier est utilisé et pourquoi**.

### C1. Redis GPU Registry

Pas de nouvelle infrastructure — juste des clés Redis dans la DB partagée.

```python
# worker/tasks/gpu_registry.py (nouveau fichier)

import redis
import json
import time
import os

class GPURegistry:
    """
    Registre GPU partagé via Redis.
    Chaque app enregistre ses workloads GPU avec VRAM estimée et TTL.
    """

    PREFIX = "gpu"

    def __init__(self, redis_url: str):
        self.r = redis.from_url(redis_url)

    def register(self, gpu_id: str, app: str, task: str, vram_mb: int, ttl: int = 300):
        """Enregistre un workload GPU. TTL auto-expire si le process crash."""
        key = f"{self.PREFIX}:{gpu_id}:workloads"
        entry = json.dumps({
            "app": app,
            "task": task,
            "vram_mb": vram_mb,
            "started_at": time.time(),
            "pid": os.getpid(),
        })
        self.r.hset(key, f"{app}:{task}", entry)
        self.r.expire(key, ttl)

    def unregister(self, gpu_id: str, app: str, task: str):
        """Retire un workload terminé."""
        self.r.hdel(f"{self.PREFIX}:{gpu_id}:workloads", f"{app}:{task}")

    def get_used_vram(self, gpu_id: str) -> int:
        """VRAM totale utilisée (estimation basée sur les enregistrements)."""
        workloads = self.r.hgetall(f"{self.PREFIX}:{gpu_id}:workloads")
        return sum(json.loads(v)["vram_mb"] for v in workloads.values())

    def can_fit(self, gpu_id: str, total_vram_mb: int, required_mb: int) -> bool:
        """Vérifie si un workload peut tenir sur le GPU."""
        return (total_vram_mb - self.get_used_vram(gpu_id)) >= required_mb

    def wait_for_vram(self, gpu_id: str, total_vram_mb: int, required_mb: int,
                      timeout: int = 120, poll_interval: float = 2.0) -> bool:
        """Attend que la VRAM soit disponible ou timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.can_fit(gpu_id, total_vram_mb, required_mb):
                return True
            time.sleep(poll_interval)
        return False

    def get_all_workloads(self) -> dict:
        """Retourne tous les workloads GPU (pour monitoring)."""
        result = {}
        for key in self.r.scan_iter(f"{self.PREFIX}:*:workloads"):
            gpu_id = key.decode().split(":")[1]
            workloads = {
                k.decode(): json.loads(v)
                for k, v in self.r.hgetall(key).items()
            }
            result[gpu_id] = workloads
        return result
```

### C2. Signal pipeline_active avec ETA

```python
# worker/tasks/pipeline.py — au début de analyze_performance

def _signal_pipeline_start(session_id: str, estimated_duration_s: int = 45):
    """Signale aux autres apps que le pipeline Kiaraoke est actif."""
    redis_client.setex(
        "kiaraoke:pipeline_active",
        estimated_duration_s + 60,  # TTL = ETA + marge
        json.dumps({
            "session_id": session_id,
            "started_at": time.time(),
            "estimated_duration_s": estimated_duration_s,
            "steps_remaining": ["separation", "pitch", "transcription", "scoring"],
        })
    )

def _signal_pipeline_step(step_name: str, steps_remaining: list):
    """Met à jour la step courante (pour ETA dynamique)."""
    data = redis_client.get("kiaraoke:pipeline_active")
    if data:
        info = json.loads(data)
        info["current_step"] = step_name
        info["steps_remaining"] = steps_remaining
        info["step_started_at"] = time.time()
        redis_client.setex(
            "kiaraoke:pipeline_active",
            120,
            json.dumps(info)
        )

def _signal_pipeline_end():
    """Signale la fin du pipeline."""
    redis_client.delete("kiaraoke:pipeline_active")
```

### C3. Routing intelligent LLM (côté Augmenter.PRO)

Augmenter.PRO (ou tout consommateur LiteLLM) peut adapter son routing :

```python
# Pattern recommandé pour le routing LLM côté application

async def get_llm_response(prompt: str, model: str = "default"):
    pipeline_active = await redis.get("kiaraoke:pipeline_active")

    if pipeline_active:
        data = json.loads(pipeline_active)
        elapsed = time.time() - data["started_at"]
        remaining = data["estimated_duration_s"] - elapsed

        if remaining > 5:
            # Pipeline encore actif pour un moment → cloud
            logger.info(f"GPU busy (kiaraoke pipeline, ~{remaining:.0f}s remaining), routing to Groq")
            return await litellm_completion(prompt, model="groq-fast")
        # Presque fini → attendre
        await asyncio.sleep(remaining + 2)

    return await litellm_completion(prompt, model=model)
```

### C4. SSE enrichi — tier_used, reason, ETA

Le frontend reçoit déjà des événements SSE `analysis_progress`. Les enrichir :

```python
# backend/app/routers/sse.py — enrichir les événements

# Événement existant
{"type": "analysis_progress", "step": "separation", "progress": 30}

# Événement enrichi (nouveau format)
{
    "type": "analysis_progress",
    "step": "transcription",
    "progress": 65,
    "tier_used": "groq_api",
    "tier_reason": "shared-whisper occupé par word timestamps",
    "estimated_remaining_s": 12,
    "quality_level": "optimal"  # "optimal" | "degraded" | "fallback"
}
```

**Frontend :** Afficher un indicateur discret quand `quality_level != "optimal"` :

```
🎤 Analyse en cours... (cloud API — serveur GPU occupé, ~5s de plus)
```

### C5. Diagramme architecture cible

```
                         ┌──────────────────────────┐
                         │     LiteLLM Proxy :4000   │
                         │  + Redis GPU Registry     │
                         │  + Fallback chains        │
                         └──────────┬───────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
     ┌────────▼────────┐  ┌────────▼────────┐  ┌─────────▼────────┐
     │  Groq Cloud     │  │  A3B local      │  │  Ollama single   │
     │  qwen3-32b      │  │  port 11439     │  │  GPU (future)    │
     │  llama4-scout   │  │  4 GPUs         │  │  qwen3.5:9b      │
     │  (always avail) │  │  (si GPU dispo) │  │  (si GPU dispo)  │
     └─────────────────┘  └─────────────────┘  └──────────────────┘

     ┌─────────────────────────────────────────────────────────────┐
     │                    Kiaraoke Pipeline                        │
     │                                                             │
     │  ┌─────────┐   ┌──────────┐   ┌───────────┐   ┌────────┐  │
     │  │  MBR    │   │  CREPE / │   │ Whisper / │   │ Jury   │  │
     │  │  GPU    │   │  PYIN    │   │ Groq /    │   │ Groq / │  │
     │  │  ou CPU │   │  CPU     │   │ CTC       │   │ A3B /  │  │
     │  │         │   │          │   │           │   │ Heur.  │  │
     │  └────┬────┘   └────┬─────┘   └─────┬─────┘   └───┬────┘  │
     │       │             │               │              │       │
     │       └─────────────┴───────────────┴──────────────┘       │
     │            Chaque composant : 3 tiers de fallback          │
     │            Redis GPU Registry : coordination                │
     │            SSE enrichi : tier_used + reason + ETA           │
     └─────────────────────────────────────────────────────────────┘

     GPU Layout (partage Kiaraoke ↔ Augmenter.PRO) :

     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ GPU 0 (3070) │ │ GPU 1 (3070) │ │ GPU 2 (3070) │
     │ 8 GB         │ │ 8 GB         │ │ 8 GB         │
     │              │ │              │ │              │
     │ shared-      │ │ A3B shard    │ │ A3B shard    │
     │ whisper      │ │ OU Kiaraoke  │ │              │
     │ (dédié)      │ │ (time-share) │ │              │
     └──────────────┘ └──────────────┘ └──────────────┘

     ┌──────────────┐ ┌──────────────┐
     │ GPU 3 (3080) │ │ GPU 4 (3080) │
     │ 10 GB        │ │ 10 GB        │
     │              │ │              │
     │ A3B shard    │ │ A3B shard    │
     │              │ │ + Kiaraoke   │
     │              │ │ (time-share) │
     └──────────────┘ └──────────────┘
```

---

## 5. Phases d'implémentation

### Phase 1 — Quick wins (1-2 jours, 0 risque)

| # | Action | Fichier(s) | Effort | Impact |
|---|--------|-----------|--------|--------|
| 1.1 | `fastdtw` → `dtw-python` | `worker/tasks/scoring.py`, `worker/requirements*.txt` | 30 min | Précision + vitesse DTW |
| 1.2 | `librosa.pyin` pour pitch ref | `worker/tasks/pitch_analysis.py` | 1h | -47s pipeline, 0 GPU pour ref |
| 1.3 | Fix `CTC_ALIGN_DEVICE=cuda:1` | Coolify env panel | 5 min | CTC alignment ne crash plus |
| 1.4 | Fix `GROQ_API_KEY` | Coolify env panel | 5 min | Groq transcription + jury |
| 1.5 | `jury-comment-fallback` → `a3b-multimodal` | LiteLLM config.yaml in-container | 10 min | Tier 2 jury = A3B 35B |

**Résultat Phase 1 :** Pipeline ~60s (vs 187s) avec meilleur DTW et jury fallback A3B.

### Phase 2 — Pipeline audio amélioré (1 semaine)

| # | Action | Fichier(s) | Effort | Impact |
|---|--------|-----------|--------|--------|
| 2.1 | Mel-Band RoFormer remplace Demucs | `worker/tasks/audio_separation.py`, Dockerfile, requirements | 2-3 jours | -2 GB VRAM, +1.8 dB SDR |
| 2.2 | madmom onset detection | `worker/tasks/scoring.py` | 0.5 jour | +10% précision rythme |
| 2.3 | Parselmouth voice quality | nouveau `worker/tasks/voice_quality.py` | 0.5 jour | Métriques jitter/shimmer/HNR |
| 2.4 | CTC forced alignment (MMS_FA) | `worker/tasks/word_timestamps.py` | 1-2 jours | Meilleur karaoke word-by-word |
| 2.5 | Chroma pitch comparison | `worker/tasks/scoring.py` | 0.5 jour | Robuste aux erreurs d'octave |

**Résultat Phase 2 :** Qualité audio nettement supérieure, feedback jury enrichi, VRAM réduite.

### Phase 3 — Architecture partagée (1-2 semaines)

| # | Action | Fichier(s) | Effort | Impact |
|---|--------|-----------|--------|--------|
| 3.1 | Redis GPU Registry | nouveau `worker/tasks/gpu_registry.py` | 1 jour | Coordination inter-apps |
| 3.2 | Signal pipeline_active + ETA | `worker/tasks/pipeline.py` | 0.5 jour | Routing LLM intelligent |
| 3.3 | SSE enrichi (tier, reason, ETA) | `backend/app/routers/sse.py` | 1 jour | UX transparente |
| 3.4 | Frontend indicateur de tier | `frontend-next/src/components/app/` | 0.5 jour | User sait pourquoi c'est plus lent |
| 3.5 | Cascade fallback par composant | `worker/tasks/pipeline.py` | 2-3 jours | Résilience totale |
| 3.6 | Monitoring GPU → Redis | `scripts/gpu-monitor.sh` + systemd | 0.5 jour | Observabilité |

**Résultat Phase 3 :** Kiaraoke résilient, mode dégradé transparent, cohabitation GPU sans conflit.

---

## 6. Matrice de fallback complète

Chaque composant du pipeline a 3 tiers. On utilise le meilleur disponible, on log le tier utilisé.

| Composant | Tier 1 (GPU dispo) | Tier 2 (GPU occupé/lent) | Tier 3 (tout down) | Log |
|-----------|-------------------|-------------------------|--------------------|----|
| **Séparation** | MBR GPU (~15s, 2-4 GB) | MBR CPU (~60s) | Erreur + retry queue | `tier_used=mbr_gpu` |
| **Pitch user** | CREPE full GPU (~4s, 1 GB) | librosa.pyin CPU (~2s) | librosa.pyin CPU | `tier_used=crepe_gpu` |
| **Pitch ref** | librosa.pyin CPU (~0.5s) | idem | idem | `tier_used=pyin_cpu` |
| **Transcription** | shared-whisper GPU (~3s) | Groq Whisper API (~3s) | faster-whisper CPU (~30s) | `tier_used=shared_whisper` |
| **Word alignment** | CTC MMS_FA GPU (~1s) | CTC MMS_FA CPU (~2s) | shared-whisper word timestamps | `tier_used=ctc_gpu` |
| **Jury (×3)** | Groq qwen3-32b (~2s) | A3B local (~6s) | Heuristique | `tier_used=groq` |
| **Rythme** | madmom CPU (~1s) | idem | idem | `tier_used=madmom` |
| **Voice quality** | Parselmouth CPU (~0.2s) | idem | skip (optionnel) | `tier_used=parselmouth` |
| **Sync** | scipy xcorr CPU (~1s) | idem | skip (offset=0) | `tier_used=xcorr` |

### Logging standardisé

Chaque step du pipeline log dans le même format :

```python
# Pattern de logging standardisé
logger.info(
    "Pipeline step completed",
    extra={
        "step": "transcription",
        "tier_used": "groq_api",           # Quel tier a été utilisé
        "tier_reason": "shared-whisper timeout",  # Pourquoi pas tier 1
        "duration_s": 3.2,
        "session_id": session_id,
        "quality_level": "optimal",         # optimal | degraded | fallback
    }
)
```

---

## 7. Métriques cibles

### Performance pipeline (après toutes les phases)

| Scénario | Actuel | Phase 1 | Phase 2 | Phase 3 |
|----------|--------|---------|---------|---------|
| 1ère analyse (tout GPU dispo) | 187s | ~60s | ~35s | ~35s |
| 1ère analyse (GPU occupé A3B) | 187s | ~90s | ~70s | ~70s (fallback CPU) |
| 2ème session même vidéo (cache) | ~60s | ~15s | ~10s | ~10s |
| 3ème+ session (tout cache) | ~15s | ~10s | ~8s | ~8s |

### Qualité audio (après Phase 2)

| Métrique | Actuel | Cible | Amélioration |
|----------|--------|-------|-------------|
| SDR vocals (séparation) | ~9.16 dB | ~10.98 dB | +1.8 dB |
| Onset F-measure (rythme) | ~75-80% | ~87-90% | +10% |
| Word alignment accuracy | ~50-100ms | ~20-50ms | 2x meilleur |
| DTW pitch precision | Approximatif (fastdtw) | Exact (dtw-python) | Exact |

### Résilience (après Phase 3)

| Scénario de panne | Résultat actuel | Résultat cible |
|--------------------|--------------------|-------------------|
| A3B occupe tous les GPUs | Pipeline 5x plus lent, OOM | Fallback CPU transparent, SSE info |
| Groq API down | Jury cassé | A3B local ou heuristique |
| shared-whisper down | Transcription échoue | Groq Whisper ou CPU |
| Un GPU "Unknown Error" | Pipeline crash | Fallback auto + alerte |
| Kiaraoke + Augmenter simultanés | OOM, contention | GPU Registry, routing cloud |

---

## Annexe A — Nouvelles dépendances Python

```txt
# worker/requirements.txt — ajouts

# Phase 1
dtw-python>=1.3               # Remplace fastdtw

# Phase 2
madmom>=0.16                   # Onset detection neuronale
praat-parselmouth>=0.4         # Voice quality (jitter, shimmer, HNR)
# music-source-separation-training  # Mel-Band RoFormer (install from git)

# Phase 3
# Pas de nouvelles dépendances (Redis déjà présent)
```

```txt
# worker/requirements.txt — suppressions

# Phase 1
# fastdtw  # Remplacé par dtw-python
```

## Annexe B — Variables d'environnement à corriger (immédiat)

| Variable | Valeur actuelle | Valeur correcte | Où |
|----------|-----------------|-----------------|----|
| `CTC_ALIGN_DEVICE` | `cuda:3` | `cuda:1` (ou `cpu`) | Coolify env worker-heavy |
| `GROQ_API_KEY` | (vide) | `gsk_...` | Coolify env worker-heavy |
| `DEBLEED_ENABLED` | `true` | `false` (si MBR Phase 2) | Coolify env worker-heavy |

## Annexe C — Références et sources

| Technologie | Repo / Source |
|-------------|---------------|
| Mel-Band RoFormer | [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) |
| dtw-python | [PyPI dtw-python](https://pypi.org/project/dtw-python/) |
| madmom | [CPJKU/madmom](https://github.com/CPJKU/madmom) |
| Parselmouth | [YannickJadoul/Parselmouth](https://github.com/YannickJadoul/Parselmouth) |
| PENN/FCNF0++ | [interactiveaudiolab/penn](https://github.com/interactiveaudiolab/penn) |
| RMVPE | [RVC-Project](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) |
| Qwen3.5 models | [Qwen HuggingFace](https://huggingface.co/Qwen) |
| torchaudio MMS_FA | [PyTorch Audio](https://pytorch.org/audio/stable/tutorials/forced_alignment_for_multilingual_data_tutorial.html) |
| vLLM | [vllm-project/vllm](https://github.com/vllm-project/vllm) |
| fastdtw critique | Wu & Keogh 2020, "fastdtw is approximate and generally slower..." |
