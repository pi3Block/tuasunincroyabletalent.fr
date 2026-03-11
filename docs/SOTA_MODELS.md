# SOTA Models — Catalogue pour Kiaraoke

> Derniere mise a jour : 2026-03-04 (brainstorm session)
> Usage : reference technique pour choisir et integrer les modeles IA.
> Chaque modele a un statut : 🔬 Recherche | 🧪 A tester | ✅ Valide | 🚀 En prod
> Priorite sprint : infra GPU → SOTA modeles → coaching → social

---

## Table des matieres

1. [Separation de source](#1-separation-de-source)
2. [Detection de pitch](#2-detection-de-pitch)
3. [Enhancement audio](#3-enhancement-audio) ← **NOUVEAU**
4. [Analyse technique vocale unifiee](#4-analyse-technique-vocale-unifiee) ← **NOUVEAU**
5. [Qualite vocale (MOS)](#5-qualite-vocale-mos)
6. [Comprehension musicale](#6-comprehension-musicale)
7. [Detection d'erreurs de chant](#7-detection-derreurs-de-chant)
8. [LLM Jury — alternatives locales](#8-llm-jury-alternatives-locales) ← **NOUVEAU**
9. [Generation musicale](#9-generation-musicale)
10. [Voice conversion (SVC)](#10-voice-conversion-svc)
11. [Emotion vocale](#11-emotion-vocale)
12. [Audio-to-MIDI](#12-audio-to-midi)
13. [Restauration audio reference](#13-restauration-audio-reference) ← **NOUVEAU**
14. [Matrice de compatibilite GPU](#14-matrice-de-compatibilite-gpu)

---

## 1. Separation de source

Objectif : extraire les vocals purs de la piste reference et user.

### Actuel : Demucs htdemucs 🚀

- **SDR** : ~8.5 dB (MUSDB18HQ)
- **VRAM** : ~4-5 GB
- **Temps** : ~25s pour 3 min (GPU)
- **Plus** : fiable, bien integre, de-bleeding Wiener masks
- **Moins** : depasse par les Transformers depuis 2023

### Cible : BS-RoFormer ✅ ← **Deploye Sprint 2.2 (2026-03-04)**

- **SDR** : **12.97 dB** vocals (modele Viperx-1297), soit +52% vs Demucs
- **Architecture** : Band-split + RoPE Transformer, bandes mel-scale
- **VRAM** : ~4-6 GB inference (chunks 8s)
- **Temps** : comparable a Demucs (~20-30s)
- **Integration** : via `audio-separator` (pip) — drop-in replacement
- **Modele** : `BS-Roformer-Viperx-1297` (meilleur pretrained)
- **Repo** : [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
- **Paper** : [arxiv.org/abs/2310.01809](https://arxiv.org/html/2310.01809v1)

### Alternatives

| Modele | SDR | VRAM | Notes | Statut |
|--------|-----|------|-------|--------|
| BS-RoFormer (original) | ~9.8 dB avg | ~6 GB | 1er SDX23 | 🔬 |
| SCNet (Sparse Compression) | ~comparable | ~3 GB | **2x moins de params**, ideal si VRAM tight | 🧪 |
| Moises-Light | ~comparable | ~2-3 GB | **13x moins de params**, edge-friendly | 🔬 |
| Banquet (query-based) | variable | ~4 GB | Separation au-dela de 4 stems (dialogue, fx) | 🔬 |

### Decision

```
DEPLOYE Sprint 2.2 (2026-03-04) :
  audio_separation.py — SEPARATION_ENGINE=roformer (defaut) ou demucs (fallback)
  Modele : model_bs_roformer_ep_317_sdr_12.9755.ckpt (SDR 12.97)
  Lazy-load singleton, fallback auto Demucs si RoFormer crash
  De-bleeding Wiener toujours actif (sur fichiers WAV post-separation)
  Env vars : SEPARATION_ENGINE, AUDIO_SEP_MODEL
```

### Ressources

- [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) — training + pretrained zoo
- [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer) — implementation reference

---

## 2. Detection de pitch

Objectif : extraire F0 (frequence fondamentale) des vocals pour comparaison DTW.

### Ancien : torchcrepe (remplace par SwiftF0 Sprint 1)

- **Precision** : ~80% RPA sur chant
- **VRAM** : ~1 GB (full), ~200 MB (tiny)
- **Temps** : ~4s full, ~1.5s tiny pour 3 min
- **Plus** : stable, bien connu
- **Moins** : pas optimise pour le chant polyphonique, lent vs alternatives

### Cible user : RMVPE 🧪

- **Precision** : **87.2% harmonic-mean** sur 8 datasets, **best sur chant** (Vocadito, MIR-1K)
- **Architecture** : Deep U-Net, concu pour pitch vocal en musique polyphonique
- **VRAM** : ~200-400 MB
- **Temps** : plus rapide que CREPE full
- **Avantage cle** : tolere l'accompagnement residuel (polyphonic-aware)
- **Utilise par** : RVC (standard de facto pour SVC)
- **Paper** : [arxiv.org/abs/2306.15412](https://ar5iv.labs.arxiv.org/html/2306.15412)
- **Benchmark** : [lars76/pitch-benchmark](https://github.com/lars76/pitch-benchmark)

### Cible reference : FCPE 🧪

- **Precision** : **96.79% RPA** sur MIR-1K
- **Architecture** : Lynx-Net, depthwise separable convolutions sur mel spectrograms
- **VRAM** : ultra-leger (~100-200 MB)
- **Temps** : RTF 0.0062 — **77x plus rapide que CREPE, 5.3x plus rapide que RMVPE**
- **PyPI** : `torchfcpe` (drop-in)
- **Paper** : [arxiv.org/abs/2509.15140](https://arxiv.org/abs/2509.15140) (septembre 2025)
- **Repo** : [CNChTu/FCPE](https://github.com/CNChTu/FCPE)

### NOUVEAU : SwiftF0 ✅ ← **Deploye Sprint 1 (2026-03-04)**

- **Precision** : **91.80% harmonic-mean** a 10 dB SNR — **meilleur que CREPE de +12 points**
- **Params** : 95,842 (vs CREPE 22M = **230x plus petit**)
- **Vitesse** : **42x plus rapide que CREPE sur CPU**
- **VRAM** : **~0 (CPU-only)** — libere completement le GPU du pitch
- **Architecture** : Modele ultra-leger, optimise pour precision + vitesse
- **Paper** : [arxiv.org/abs/2508.18440](https://arxiv.org/abs/2508.18440) (aout 2025)
- **Repo** : [lars76/swift-f0](https://github.com/lars76/swift-f0)
- **Adoption** : UltraSinger (karaoke open-source) a remplace CREPE par SwiftF0 comme defaut
- **Benchmark** : [lars76/pitch-benchmark](https://github.com/lars76/pitch-benchmark)

**Impact majeur pour Kiaraoke** : SwiftF0 rend CREPE, RMVPE et FCPE **obsoletes** pour notre use case.
- Plus precis que CREPE full (+12 pts)
- Plus rapide que FCPE (CPU-only, zero GPU)
- Libere cuda:1 (RTX 3070 8 GB) entierement → disponible pour RoFormer ou autre
- Simplifie le pipeline : plus besoin de 2 modeles pitch (full/tiny), un seul suffit

### Alternatives conservees (reference)

| Modele | Precision | VRAM | Vitesse | Notes | Statut |
|--------|-----------|------|---------|-------|--------|
| RMVPE | 87.2% harmonic-mean | ~300 MB GPU | rapide | Polyphonic-aware, standard RVC | 🧪 backup |
| FCPE | 96.79% RPA MIR-1K | ~150 MB GPU | RTF 0.006 | Tres rapide, bon pour real-time | 🧪 backup |
| SwiftF0 | 91.80% harmonic-mean | **~0 (CPU)** | **42x CREPE** | **SOTA**, CPU-only | ✅ **deploye** |

### Decision (MISE A JOUR 2026-03-04)

```
NOUVEAU — SwiftF0 remplace CREPE pour tout :
  User vocals : SwiftF0 (meilleure precision, CPU-only)
  Reference vocals : SwiftF0 (meme modele, zero GPU)
  Real-time pendant enregistrement : SwiftF0 ou FCPE (les deux sont temps-reel)
  Fallback : RMVPE si separation imparfaite (polyphonic-aware)

Consequence GPU : cuda:1 (RTX 3070) liberee du pitch
→ Disponible pour RoFormer separation OU petits modeles IA
→ Simplifie enormement le time-sharing A3B
```

---

## 3. Enhancement audio

> **NOUVEAU** — Decouvert lors du brainstorm 2026-03-04.
> Pre-traiter l'audio user AVANT pitch + transcription = meilleur WER + meilleure precision pitch.

Objectif : debruiter et ameliorer les enregistrements mobiles (micro mediocre, bruit ambiant, reverb piece).

### DeepFilterNet3 ✅ ← **Deploye Sprint 2.1 (2026-03-04)**

- **Quoi** : debruitage audio SOTA (suppression bruit, reverb, echo)
- **Performance** : PESQ 3.5-4.0+, STOI >0.95
- **VRAM** : **~0 (CPU-only)**, temps reel capable
- **Latence** : <10ms par frame, adapte streaming
- **Repo** : [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet)
- **Pip** : `deepfilternet`
- **Benchmark** : [noisereducerai.com/deepfilternet](https://noisereducerai.com/deepfilternet-ai-noise-reduction/)

### Usage pour Kiaraoke

```
Pipeline actuel :
  user_recording.webm → Demucs (separation) → CREPE (pitch) + Whisper (transcription)

Pipeline ameliore :
  user_recording.webm → DeepFilterNet3 (denoise, CPU, <1s) → Demucs → SwiftF0 + Whisper

Impact attendu :
  - WER Whisper : -10-20% d'erreurs sur enregistrements bruites
  - Precision pitch : +5-10% sur micros mobiles bas de gamme
  - Zero VRAM, zero GPU, ~1s CPU pour 3 min d'audio
```

### Decision

```
DEPLOYE Sprint 2.1 (2026-03-04) :
  worker/tasks/audio_enhancement.py — lazy load, singleton, CPU-only
  pipeline.py : maybe_denoise() entre download et Demucs
  Env vars : DENOISE_ENABLED=true, DENOISE_ATTEN_LIMIT_DB= (vide = max)
  Output 48kHz WAV → Demucs resample a 44100Hz automatiquement
```

### Alternatives

| Solution | Type | CPU/GPU | Notes | Statut |
|----------|------|---------|-------|--------|
| DeepFilterNet3 | Denoiser | CPU | SOTA, temps reel, open source | ✅ **deploye** |
| Resemble Enhance | Denoiser + enhancer | GPU ~1 GB | Singing-aware, MIT license | 🔬 |
| ClearerVoice-Studio | Super-resolution 16→48 kHz | GPU | ModelScope, bandwidth extension | 🔬 |

---

## 4. Analyse technique vocale unifiee

> **NOUVEAU** — Decouvert lors du brainstorm 2026-03-04.
> STARS remplace potentiellement whisper-timestamped + ajoute technique vocale.

Objectif : aligner les mots ET detecter les techniques vocales en un seul pass.

### STARS (ACL 2025) 🧪

- **Quoi** : framework unifie pour analyse de chant — alignment + transcription notes + techniques vocales
- **Capacites** :
  - Alignment phoneme-audio (remplace whisper-timestamped)
  - Transcription de notes (pitch → notation musicale)
  - Detection techniques vocales : **vibrato, falsetto, breathy, mixed voice, belt**
  - Analyse style global : emotion, pace
- **Architecture** : Pre-trained sur HuggingFace
- **VRAM** : ~2-3 GB (estimation)
- **Paper** : [arxiv.org/abs/2507.06670](https://arxiv.org/abs/2507.06670) (ACL 2025)
- **Repo** : [gwx314/STARS](https://github.com/gwx314/STARS)

### Usage pour Kiaraoke

```
Actuel (2 outils separes) :
  whisper-timestamped → word alignment (forced alignment + DTW)
  Post-traitement pitch → vibrato, breath (a implementer)

Avec STARS (1 outil unifie) :
  STARS → word alignment + vibrato + falsetto + breathy + mixed + belt + emotion
  → Injecte techniques detectees dans prompt jury LLM
  → "Tu utilises du falsetto au refrain mais ton vibrato manque de regularite sur les aigus"
```

### Decision

```
Sprint 3 (coaching technique) : evaluer STARS comme remplacement whisper-timestamped
Risque : projet academique ACL 2025, maturite a verifier
Fallback : garder whisper-timestamped + post-traitement pitch manuel (vibrato/breath)
Approche incrementale recommandee :
  1. D'abord post-traitement SwiftF0 pour vibrato/breath (fiable, zero risque)
  2. Puis STARS si la qualite se confirme (remplacement whisper-timestamped + enrichissement)
```

### Ressources liees

- [UltraSinger](https://github.com/rakuri255/UltraSinger) — pipeline karaoke open-source (SwiftF0 + Whisper + separation), reference d'architecture
- [AllKaraoke](https://github.com/Asvarox/allkaraoke) — karaoke browser TypeScript avec pitch real-time, reference UI
- [Whisper + BS-RoFormer SOTA paper](https://arxiv.org/html/2506.15514v1) — confirme que separation → Whisper est SOTA pour lyrics transcription

---

## 5. Qualite vocale (MOS)

Objectif : scorer la qualite perceptuelle de la voix (au-dela du pitch/rythme).

### UTMOSv2 ✅ ← **Deploye Sprint 2.3 (2026-03-05)**

- **Quoi** : prediction Mean Opinion Score (qualite percue)
- **Classement** : 1er en 7/16, 2eme en 9/16 metriques VoiceMOS Challenge 2024
- **Architecture** : SSL features (self-supervised)
- **VRAM** : ~500 MB
- **PyPI** : `utmos`
- **Repo** : [sarulab-speech/UTMOSv2](https://github.com/sarulab-speech/UTMOSv2)

### SingMOS-Pro dataset 🧪

- **Quoi** : 7,981 clips de 41 modeles, annotes par pros (lyrics/melody/overall)
- **Usage** : fine-tuner UTMOSv2 specifiquement pour le chant
- **HuggingFace** : [TangRain/SingMOS-Pro](https://huggingface.co/datasets/TangRain/SingMOS-Pro)
- **Paper** : [arxiv.org/abs/2510.01812](https://arxiv.org/abs/2510.01812)

### Decision

```
DEPLOYE Sprint 2.3 (2026-03-05) :
  worker/tasks/vocal_quality.py — lazy load, singleton, GPU ~500 MB
  pipeline.py : Phase 3b, parallele avec MERT, non-fatal
  scoring.py : MOS injecte dans prompt jury (qualite vocale)
  Env vars : UTMOS_ENABLED=true
  Output : {"mos": float 1-5, "mos_100": int 0-100}
Phase suivante : fine-tuner sur SingMOS-Pro pour score specifique chant.
```

---

## 6. Comprehension musicale

Objectif : extraire le contexte musical de la reference pour enrichir le jury.

### MERT-v1-95M ✅ ← **Deploye Sprint 2.3 (2026-03-05)**

- **Quoi** : Transformer encoder (BERT-style) pour la musique
- **Taches** : pitch, beat, key, genre, emotion, instrument (14 taches MIR)
- **VRAM** : ~1 GB (95M params)
- **Variante** : MERT-v1-330M (~2-3 GB) si plus de precision necessaire
- **HuggingFace** : [m-a-p/MERT-v1-95M](https://huggingface.co/m-a-p/MERT-v1-95M)
- **Paper** : [arxiv.org/abs/2306.00107](https://arxiv.org/abs/2306.00107) (ICLR 2024)

### Usage pour Kiaraoke

```
Input : reference audio (original YouTube)
Output : {key: "Am", tempo: 120, energy_profile: [...], emotion: "melancholic", genre: "pop"}
→ Injecte dans le prompt jury LLM pour feedback contextualise
→ "Sur ce morceau melancolique en la mineur, ta voix manque de profondeur emotionnelle..."
```

### Decision

```
DEPLOYE Sprint 2.3 (2026-03-05) :
  worker/tasks/music_features.py — lazy load, singleton, GPU ~1 GB
  pipeline.py : Phase 3b, parallele avec UTMOSv2, non-fatal
  Cache : cache/{youtube_id}/mert_features.json (storage)
  scoring.py : tags musicaux injectes dans prompt jury
  Env vars : MERT_ENABLED=true
  Output : {energy_mean, energy_std, dynamics, tags: ["dynamique", "rythmé", ...]}
```

---

## 7. Detection d'erreurs de chant

Objectif : localiser precisement les erreurs par passage (pas juste un score global).

### Framework pedagogique (2025-2026) 🔬

- **Paper** : [arxiv.org/abs/2602.06917](https://arxiv.org/abs/2602.06917)
- **3 categories** :
  - Erreurs de frequence (pitch deviation du target)
  - Erreurs d'amplitude (volume/energie)
  - Erreurs de prononciation (articulation)
- **Methode** : comparaison synchronisee teacher-learner (= exactement notre use case)
- **DL > rule-based** confirme par les auteurs

### Analyse technique vocale (post-traitement pitch)

Implementable sans modele supplementaire, a partir du pitch RMVPE :

| Technique | Methode | Output |
|-----------|---------|--------|
| **Vibrato** | Oscillation periodique dans F0 (5-7 Hz, 50-100 cents) | rate Hz, extent cents, regularite % |
| **Breath support** | Variance pitch sur notes tenues (>0.5s) | stability score 0-1 |
| **Pitch accuracy par note** | Deviation en cents vs reference aligne | heatmap par passage |
| **Onset precision** | Decalage temporel vs reference par syllabe | ms d'avance/retard |

### Decision

```
Phase 1 : post-traitement pitch RMVPE pour vibrato + breath + accuracy par note
Phase 2 : implementer le framework DL (arxiv 2602.06917) si les donnees le permettent
```

---

## 8. LLM Jury — alternatives locales

> **NOUVEAU** — Decouvert lors du brainstorm 2026-03-04.
> Meilleurs modeles francais pour le jury IA local (Tier 2 fallback).

Objectif : ameliorer la qualite du francais dans les commentaires jury en local (quand Groq est indisponible).

### Actuel : Qwen3-4B Q4_K_M via Ollama 🚀

- **VRAM** : ~2.5-3 GB
- **Qualite francais** : correcte mais parfois generique
- **Role-play** : moyen (personas pas toujours distincts)

### Alternatives decouvertes

| Modele | VRAM (Q4) | Francais | Role-play | Notes | Statut |
|--------|-----------|----------|-----------|-------|--------|
| **Mistral Nemo 12B** | ~7.5 GB | **Excellent** (Mistral = FR) | Bon | Meilleur francais sub-8GB, joint Mistral+NVIDIA | 🧪 |
| **Qwen3-8B** | ~5.5 GB | Bon | Bon | Upgrade direct du 4B, tient dans 8 GB | 🧪 |
| Qwen3-Instruct-2507 | ~2.5-3 GB (4B) | Bon | **Meilleur** | Juillet 2025, meilleur role-play que Qwen3 original | 🧪 |
| Gemma 3 12B | ~7-8 GB | Bon | Moyen | Google, multilingual | 🔬 |
| Gemma 3 4B | ~2.5 GB | OK | Moyen | Leger, multilingual | 🔬 |

### Decision

```
Court terme (Sprint 1) : Qwen3-Instruct-2507 4B remplace Qwen3-4B (meme VRAM, meilleur role-play)
Moyen terme (Sprint 2) : Tester Mistral Nemo 12B Q4 si GPU libre (~7.5 GB)
  → Meilleur francais du marche en sub-8GB
  → Possible via LiteLLM → Ollama A3B instance (quand Kiaraoke n'utilise pas les GPUs)
Note : Le Tier 1 (Groq qwen3-32b) reste le meilleur — ces alternatives sont pour le fallback local
```

---

## 9. Generation musicale

Objectif : features "wow" — generer des backing tracks, instrumentales.

### ACE-Step 1.5 🧪

- **Quoi** : generation musicale open-source, rivale Suno/Udio
- **VRAM** : **<4 GB**
- **Temps** : <10s/chanson sur RTX 3090, ~30s sur RTX 3070
- **Mode "Complete"** : vocal input → genere backing instrumental (drums, bass, guitar, keys)
- **LoRA** : fine-tuner un style depuis quelques chansons
- **Important** : le mode accompaniment necessite le **base model** (pas turbo/SFT)
- **Repo** : [ace-step/ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5)
- **License** : open source

### Usage pour Kiaraoke

```
Scenario 1 : utilisateur chante a cappella → ACE-Step genere le backing track
Scenario 2 : generer une version instrumentale custom pour s'entrainer
Scenario 3 : "studio mode" — mixer vocals user + backing genere
```

### Decision

```
Phase 4 (feature avancee). Tester d'abord la qualite du mode Complete.
VRAM OK : <4 GB, coexiste facilement avec les autres modeles.
```

---

## 10. Voice conversion (SVC)

Objectif : entendre sa voix transformee "comme l'artiste".

### RVC v2 🧪

- **Quoi** : conversion voix chantee, preserve melodie et intonation
- **VRAM** : ~2-4 GB
- **Training** : 10 min de donnees vocales suffisent
- **f0 guidance** : preserve la melodie originale pendant conversion
- **Repo** : [RVC-Project/Retrieval-based-Voice-Conversion-WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)
- **Pitch extractors integres** : RMVPE (defaut), FCPE, CREPE

### Usage pour Kiaraoke

```
"Entends ta voix comme Stromae" :
1. Extraire les vocals user (RoFormer)
2. Appliquer RVC avec le modele vocal de l'artiste
3. Mixer avec le backing track
Feature virale / partage social.
```

### Decision

```
Phase 4. Necessite des modeles vocaux pre-entraines par artiste.
Potentiel viral enorme mais complexite juridique (droits voix).
A evaluer : RVC v3 quand disponible.
```

---

## 11. Emotion vocale

Objectif : detecter l'emotion et l'expression dans le chant.

### Options

| Solution | Type | Precision | VRAM | Notes |
|----------|------|-----------|------|-------|
| Hume AI | API cloud | 85-90% (6 emotions) | 0 (cloud) | Leader, payant |
| SER models (HuggingFace) | Self-hosted | Variable | ~1-2 GB | Communautaire |
| Post-traitement audio | Features manuelles | N/A | CPU | Energie, dynamique, timbre |

### Decision

```
Phase 4. Commencer par features manuelles (energie, dynamique range).
Evaluer SER open-source si besoin de labels emotion.
Hume AI en dernier recours (cloud dependency).
```

---

## 12. Audio-to-MIDI

Objectif : extraire la melodie en MIDI pour visualisation et comparaison.

### Basic Pitch (Spotify) 🧪

- **Quoi** : audio → MIDI, gere la voix et instruments
- **VRAM** : CPU (leger)
- **Avantage** : pitch bend detection, open source Spotify
- **Demo** : [basicpitch.spotify.com](https://basicpitch.spotify.com/)
- **Usage** : visualiser la melodie reference + user en notation musicale

### Decision

```
Phase 2-3. Utile pour visualisation coaching (notes sur portee).
CPU-only, zero conflit GPU.
```

---

## 13. Restauration audio reference

> **NOUVEAU** — Decouvert lors du brainstorm 2026-03-04.
> Ameliorer la qualite de la reference YouTube (souvent compresse MP3/AAC).

Objectif : restaurer la qualite audio des references telechargees depuis YouTube.

### Apollo 🔬

- **Quoi** : restauration audio — suppression artefacts MP3, extension bande passante
- **Usage** : reference YouTube (souvent 128-192 kbps) → qualite quasi-lossless
- **Repo** : [JusperLee/Apollo](https://github.com/JusperLee/Apollo)
- **VRAM** : ~2-3 GB GPU (estimation)
- **Impact** : meilleure separation RoFormer + meilleur pitch reference

### AudioSR / FlashSR 🔬

- **Quoi** : super-resolution audio vers 48 kHz
- **FlashSR** : 22x plus rapide que AudioSR via diffusion distillation
- **Repo** : [audioldm.github.io/audiosr](https://audioldm.github.io/audiosr/)

### Decision

```
Phase 3+ (nice-to-have). La reference YouTube est deja de qualite suffisante.
A tester si les scores de separation/pitch s'ameliorent significativement.
CPU si possible, sinon GPU time-sharing.
```

---

## 14. Matrice de compatibilite GPU

### VRAM par modele (inference) — MISE A JOUR 2026-03-04

| Modele | VRAM | CPU-capable | Lazy load | Coexistence |
|--------|------|-------------|-----------|-------------|
| **SwiftF0** | **~0 (CPU)** | **Oui** | Oui | Coexiste avec tout |
| **DeepFilterNet3** | **~0 (CPU)** | **Oui** | Oui | Coexiste avec tout | ✅ deploye |
| Mel-Band RoFormer | ~4-6 GB | Non | Oui | Seul sur 1 GPU (separation) |
| RMVPE (backup) | ~300 MB | Oui | Oui | Coexiste avec tout |
| FCPE (backup) | ~150 MB | Oui | Oui | Coexiste avec tout |
| UTMOSv2 | ~500 MB | Non | Oui | Coexiste avec tout | ✅ deploye |
| MERT-v1-95M | ~1 GB | Non | Oui | Coexiste avec tout | ✅ deploye |
| STARS | ~2-3 GB | Non | Oui | Coexiste avec petits modeles |
| Whisper large-v3-turbo | 4.3 GB | Non | Resident | GPU 0 dedie |
| ACE-Step 1.5 | ~3-4 GB | Non | Oui | Seul ou avec petits modeles |
| RVC v2 | ~2-4 GB | Non | Oui | Seul sur 1 GPU |

### Scenario d'allocation Kiaraoke SOTA (MISE A JOUR avec SwiftF0)

```
Impact majeur de SwiftF0 : pitch = CPU-only → libere 1 GPU entier

Pipeline analyse SOTA (Sprint 2) :
  CPU (zero GPU) :
    - DeepFilterNet3 denoise (~1s)
    - SwiftF0 pitch user + ref (~2s total)
    - Cross-correlation sync (~1s)
  GPU (unload A3B, 1 seul GPU suffit) :
    - RoFormer separation user + ref (~5 GB, ~25s+25s ou 0s si cache)
  GPU 0 (resident, jamais touche) :
    - Whisper transcription (~3s)
  Petits modeles GPU (coexistent avec RoFormer ou apres) :
    - UTMOSv2 ~0.5 GB + MERT ~1 GB = ~1.5 GB
  Total VRAM peak : ~5 GB sur 1 GPU + 4.3 GB Whisper + 1.5 GB petits
  → Tient sur 2 GPUs MAX, 3 GPUs restent pour A3B

Comparaison vs actuel :
  Actuel : Demucs (cuda:0) + CREPE (cuda:1) = 2 GPUs necessaires
  SOTA   : RoFormer (1 GPU) + SwiftF0 (CPU) = 1 GPU necessaire
  Gain   : 1 GPU libere, pipeline plus simple, plus rapide

Pipeline coaching (Sprint 3) :
  Ajout STARS sur 1 GPU (~2-3 GB) OU post-traitement CPU (vibrato/breath)
  → Toujours max 2 GPUs

Features avancees (Sprint 5+) :
  ACE-Step : ~4 GB sur 1 GPU (a la demande)
  RVC : ~4 GB sur 1 GPU (a la demande)
  → Time-sharing, jamais tous en meme temps
```

---

## Historique des mises a jour

| Date | Changement |
|------|-----------|
| 2026-03-04 | Creation initiale — recherche SOTA complete |
| 2026-03-04 | **Brainstorm** — Ajout SwiftF0 (pitch CPU-only, game changer), DeepFilterNet3 (denoise CPU), STARS (technique vocale unifiee ACL 2025), LLM jury alternatives (Mistral Nemo 12B, Qwen3-8B), Apollo (restauration audio). Reorganisation sections. Mise a jour matrice GPU avec impact SwiftF0 (1 GPU libere). |
