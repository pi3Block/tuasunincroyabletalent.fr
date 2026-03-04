# SOTA Models — Catalogue pour Kiaraoke

> Derniere mise a jour : 2026-03-04
> Usage : reference technique pour choisir et integrer les modeles IA.
> Chaque modele a un statut : 🔬 Recherche | 🧪 A tester | ✅ Valide | 🚀 En prod

---

## Table des matieres

1. [Separation de source](#1-separation-de-source)
2. [Detection de pitch](#2-detection-de-pitch)
3. [Qualite vocale (MOS)](#3-qualite-vocale-mos)
4. [Comprehension musicale](#4-comprehension-musicale)
5. [Detection d'erreurs de chant](#5-detection-derreurs-de-chant)
6. [Generation musicale](#6-generation-musicale)
7. [Voice conversion (SVC)](#7-voice-conversion-svc)
8. [Emotion vocale](#8-emotion-vocale)
9. [Audio-to-MIDI](#9-audio-to-midi)
10. [Matrice de compatibilite GPU](#10-matrice-de-compatibilite-gpu)

---

## 1. Separation de source

Objectif : extraire les vocals purs de la piste reference et user.

### Actuel : Demucs htdemucs 🚀

- **SDR** : ~8.5 dB (MUSDB18HQ)
- **VRAM** : ~4-5 GB
- **Temps** : ~25s pour 3 min (GPU)
- **Plus** : fiable, bien integre, de-bleeding Wiener masks
- **Moins** : depasse par les Transformers depuis 2023

### Cible : Mel-Band RoFormer 🧪

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
Recommandation : Mel-Band RoFormer via audio-separator
Raison : +52% SDR, meme VRAM, integration pip triviale
Fallback : garder Demucs htdemucs si RoFormer instable
Migration : remplacer audio_separation.py, meme interface in/out
```

### Ressources

- [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) — training + pretrained zoo
- [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer) — implementation reference

---

## 2. Detection de pitch

Objectif : extraire F0 (frequence fondamentale) des vocals pour comparaison DTW.

### Actuel : torchcrepe 🚀

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

### Alternative a surveiller

| Modele | Precision | Notes | Statut |
|--------|-----------|-------|--------|
| SwiftF0 | 90.2% harmonic-mean | Plus haute precision globale, peu documente | 🔬 |

### Decision

```
User vocals : RMVPE (meilleure precision sur chant, tolere residus)
Reference vocals : FCPE (vitesse, la ref est deja propre)
Real-time pendant enregistrement : FCPE (RTF 0.006 = temps reel)
Fallback : garder torchcrepe si integration problematique
```

---

## 3. Qualite vocale (MOS)

Objectif : scorer la qualite perceptuelle de la voix (au-dela du pitch/rythme).

### UTMOSv2 🧪

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
Deployer UTMOSv2 tel quel pour un score MOS de base.
Phase 2 : fine-tuner sur SingMOS-Pro pour score specifique chant.
Integration : nouveau champ "vocal_quality_mos" dans les resultats.
```

---

## 4. Comprehension musicale

Objectif : extraire le contexte musical de la reference pour enrichir le jury.

### MERT-v1-95M 🧪

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
Deployer MERT-v1-95M dans prepare_reference (une seule fois, cache).
Stocker les features dans storage: cache/{youtube_id}/mert_features.json
Injecter dans le prompt jury (scoring.py).
```

---

## 5. Detection d'erreurs de chant

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

## 6. Generation musicale

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

## 7. Voice conversion (SVC)

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

## 8. Emotion vocale

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

## 9. Audio-to-MIDI

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

## 10. Matrice de compatibilite GPU

### VRAM par modele (inference)

| Modele | VRAM | Lazy load | Coexistence |
|--------|------|-----------|-------------|
| Mel-Band RoFormer | ~4-6 GB | Oui | Seul sur 1 GPU (separation) |
| RMVPE | ~300 MB | Oui | Coexiste avec tout |
| FCPE | ~150 MB | Oui | Coexiste avec tout |
| UTMOSv2 | ~500 MB | Oui | Coexiste avec tout |
| MERT-v1-95M | ~1 GB | Oui | Coexiste avec tout |
| ACE-Step 1.5 | ~3-4 GB | Oui | Seul ou avec petits modeles |
| RVC v2 | ~2-4 GB | Oui | Seul sur 1 GPU |
| Whisper large-v3-turbo | 4.3 GB | Resident | GPU 0 dedie |

### Scenario d'allocation Kiaraoke SOTA

```
Pipeline analyse (Phase 1) :
  GPU libre (unload A3B) :
    1. RoFormer separation (~5 GB) → unload
    2. RMVPE + FCPE + UTMOSv2 + MERT (~2 GB total) → run parallele
    3. Whisper (GPU 0, resident) → transcription
  Total VRAM peak : ~5 GB sur 1 GPU + 4.3 GB Whisper
  → Tient sur 2 GPUs, 3 GPUs libres pour A3B

Features avancees (Phase 4) :
  ACE-Step : ~4 GB sur 1 GPU (a la demande)
  RVC : ~4 GB sur 1 GPU (a la demande)
  → Time-sharing, jamais tous en meme temps
```

---

## Historique des mises a jour

| Date | Changement |
|------|-----------|
| 2026-03-04 | Creation initiale — recherche SOTA complete |
