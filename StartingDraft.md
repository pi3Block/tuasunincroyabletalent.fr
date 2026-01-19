C'est un excellent pivot stratégique. Passer de "consommateur de modèles" à "créateur/fine-tuneur de modèles" change la dimension du projet : tu crées de la propriété intellectuelle (IP).

Voici comment intégrer ces deux nouvelles dimensions : **l'Entraînement de Modèles (Fine-tuning)** et la **Gestion de Source Manuelle**.

---

### 1. Entraîner nos propres "Cerveaux" (Fine-Tuning)

Ne réinventons pas la roue (ne créons pas un LLM de zéro), mais **spécialisons** des modèles existants. C'est beaucoup plus efficace et moins coûteux.

#### A. Fine-Tuner le "Jury" (LLM Textuel)

Les modèles génériques (Llama 3, Mistral) sont trop "polis". Pour avoir un jury type *Incroyable Talent*, il faut du piquant.

* **La Dataset :** On crée un fichier JSONL contenant des milliers de paires "Contexte technique" -> "Réponse Jury".
* *Exemple Data :* `{ "input": "Justesse 40%, Rythme bon", "output": "Tu as le rythme dans la peau, mais tes oreilles sont restées au vestiaire. C'est faux du début à la fin !" }`


* **La Technique :** **QLoRA** (Quantized Low-Rank Adaptation). Cela permet d'entraîner une "surcouche" sur Llama 3 8B sans avoir besoin d'un supercalculateur.
* **L'objectif :** Avoir un modèle `Jury-V1.gguf` ultra-rapide et ultra-spécifique qui tourne dans ton Ollama, capable de générer des punchlines uniques.

#### B. Entraîner le "Juge Audio" (Classification/Régression)

Au lieu de coder des règles strictes en Python (`if pitch_error > 10% then score = 50`), on entraîne un petit modèle de Machine Learning (Scikit-Learn ou petit Réseau de Neurones).

* **Pourquoi ?** La musique n'est pas linéaire. Une note fausse "avec style" (jazz) est meilleure qu'une note juste mais robotique.
* **Entraînement :** On lui donne des vecteurs de caractéristiques (vibrato, écart type du pitch, énergie) et on lui apprend à prédire une "Note Humaine".

---

### 2. Le Fallback "Source Audio" (Lien Youtube)

L'algorithme de recherche automatique peut échouer (ex: l'utilisateur veut chanter sur une version "Live à Bercy" et Spotify joue la version "Studio"). L'utilisateur doit avoir le contrôle.

#### Le Workflow UX "Source Manuelle" :

1. **Auto-Search :** Le backend cherche le titre Spotify sur YouTube.
2. **Confiance Score :** On compare la durée. (Spotify: 3:45 / Youtube: 3:42 -> OK. Youtube: 12:00 -> KO).
3. **Intervention User :** Si le score de confiance est bas ou si l'utilisateur coche "Version Spéciale", une modal apparaît :
> *"Le Jury ne trouve pas ta version de référence. Colle un lien YouTube (Karaoké ou Original) pour qu'on puisse te juger équitablement !"*


4. **Téléchargement Hot-Swap :** Le backend télécharge immédiatement ce lien via `yt-dlp`, l'analyse, et l'utilise comme nouvelle "Vérité Terrain" pour la synchronisation.

---

### 3. Documentation Technico-Fonctionnelle (Mise à jour)

Voici la structure de la documentation finale intégrant tout cela. C'est la base de travail pour tes développeurs (ou pour toi).

---

# 📘 The AI Voice Jury - Documentation Technique V1.0

## 1. Vue d'ensemble

Application web type "Show TV" permettant d'évaluer le chant d'un utilisateur en temps réel par rapport à une version originale (Spotify/YouTube), avec un feedback généré par des Personas IA.

## 2. Stack Technique

* **Infrastructure :** Docker Compose (Orchestré par Coolify).
* **Frontend :** React + TypeScript + Vite + Zustand (State) + Tailwind.
* **Backend API :** Node.js (NestJS) ou Python (FastAPI) - *Recommandation Python pour simplifier la stack IA.*
* **Backend Worker (AI/DSP) :** Python + Celery/Redis.
* **LLM Engine :** Ollama (Local) avec modèle Fine-tuné `Jury-LoRA`.
* **Storage :** PostgreSQL (Users/Scores), Redis (Cache/Queue), Filesystem (Audio temp).

## 3. Architecture des Données Audio (Pipeline)

Le système repose sur le principe de **"Informed Source Separation"**.

### A. Phase d'Initialisation (Setup)

1. **Trigger :** User sélectionne un titre sur Spotify.
2. **Acquisition Référence :**
* *Auto :* Recherche YouTube via métadonnées Spotify (Artiste - Titre).
* *Manuel (Fallback) :* User fournit une URL YouTube.


3. **Pré-traitement Référence :**
* Download (`yt-dlp`).
* Separation (`Demucs`) -> Création de `reference_vocals.wav` et `reference_instr.wav`.
* Extraction Features : Pitch (`CREPE`), Tempo (`Librosa`), Structure Harmonique.



### B. Phase de Performance (Live)

1. **Frontend :** Stream Audio Micro (Websocket) + Stream Métadonnées de lecture Spotify (Timestamp).
2. **Backend (Light Processing) :** Détection d'activité vocale (VAD) pour ignorer les silences. Feedback visuel simple (Volume/Pitch approximatif).

### C. Phase d'Analyse (Post-Processing)

1. **Synchronisation (Cross-Correlation) :**
* Alignement du fichier `User_Recording.wav` sur `reference_instr.wav`.
* *Output :* Offset temporel (ex: +120ms).


2. **Nettoyage (De-bleeding) :**
* Soustraction adaptative de la musique (captée par le micro) en utilisant la `reference_instr.wav` alignée.
* *Output :* `Clean_User_Vocals.wav`.


3. **Comparaison (Scoring) :**
* **Pitch DTW :** Distance entre la courbe mélodique User et Reference.
* **Rhythm Check :** Analyse des transitoires (User est-il en avance/retard sur le beat ?).
* **Lyric Check :** Speech-to-text (`Whisper`) vs Paroles Officielles.



## 4. Le Cerveau du Jury (Ollama + Fine-Tuning)

### Modèle

* **Base :** Llama 3 (8B) ou Mistral.
* **Adapter (LoRA) :** Entraîné sur un dataset de critiques musicales (tv-show style).

### Prompt Engineering (Dynamic System Prompt)

Le worker Python construit le prompt final :

```text
SYSTEM: Tu es "Le Cassant", un jury impitoyable mais juste.
CONTEXTE:
- Chanson: "Bohemian Rhapsody"
- Score Technique: 45/100 (Médiocre)
- Problème majeur: Justesse (Trop bas), Rythme (En retard)
- Point positif: Puissance vocale
- Source Audio: Fournie par l'utilisateur (Lien Youtube)

TACHE: Écris un commentaire de 3 phrases pour l'utilisateur. Sois drôle et cinglant.

```

## 5. API Endpoints Clés

* `POST /api/session/start` : Initie la session, lance le download de la ref.
* `POST /api/session/fallback-source` : Accepte l'URL YouTube manuelle.
* `WS /stream/audio` : Websocket pour l'envoi des chunks audio.
* `GET /api/results/{sessionId}` : Récupère le JSON final + Commentaire IA.
* `GET /api/search/recent` : Retourne les derniers titres sélectionnés (historique).

---

## 6. État d'implémentation & Plan d'amélioration

### A. Fonctionnalités implémentées ✅

| Composant | Status | Détails |
|-----------|--------|---------|
| Sélection Spotify | ✅ | Recherche + métadonnées |
| Auto-search YouTube | ✅ | Comparaison durée pour confiance |
| Fallback URL manuelle | ✅ | Modal si confiance < 50% |
| Download yt-dlp | ✅ | Async avec progress |
| **Cache YouTube** | ✅ | Redis + filesystem (7 jours TTL) |
| **Historique recherches** | ✅ | 20 dernières sélections (Redis) |
| Demucs (séparation) | ✅ | htdemucs, GPU CUDA |
| CREPE (pitch) | ✅ | torchcrepe medium, viterbi |
| Whisper (transcription) | ✅ | turbo, word timestamps |
| Ollama Jury | ✅ | 3 personas (Cassant, Encourageant, Technique) |
| Progress feedback | ✅ | 12+ étapes avec emojis |

### B. Scoring actuel (à améliorer)

**Fichier :** `worker/tasks/scoring.py`

| Métrique | Implémentation actuelle | Problème |
|----------|------------------------|----------|
| **Pitch** | Comparaison cents directe | Pas d'alignement temporel (DTW) |
| **Rythme** | `return 75.0` (placeholder) | Non implémenté |
| **Paroles** | Word overlap (set intersection) | Pas de WER, paroles ref vides |

**Poids actuels :**
```python
score = pitch * 0.4 + rhythm * 0.3 + lyrics * 0.3
```

---

## 7. Plan d'amélioration détaillé

### Phase 1 : Scoring avancé (Priorité haute)

#### 1.1 Pitch DTW (Dynamic Time Warping)

**Objectif :** Comparer les courbes mélodiques avec alignement temporel automatique.

**Implémentation :**
```python
# worker/tasks/scoring.py
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean

def calculate_pitch_accuracy_dtw(user_freq: np.ndarray, ref_freq: np.ndarray) -> float:
    """Calculate pitch accuracy using DTW alignment."""
    # Filtrer les silences (freq > 0)
    user_voiced = user_freq[user_freq > 0]
    ref_voiced = ref_freq[ref_freq > 0]

    if len(user_voiced) < 10 or len(ref_voiced) < 10:
        return 50.0

    # Convertir en cents (log scale)
    user_cents = 1200 * np.log2(user_voiced / 440)
    ref_cents = 1200 * np.log2(ref_voiced / 440)

    # DTW alignment
    distance, path = fastdtw(
        user_cents.reshape(-1, 1),
        ref_cents.reshape(-1, 1),
        dist=euclidean
    )

    # Normaliser par la longueur du chemin
    avg_distance = distance / len(path)

    # Score: 0 cents diff = 100, 200 cents diff = 0
    score = max(0, 100 - avg_distance / 2)
    return round(score, 1)
```

**Dépendance :** `pip install fastdtw`

#### 1.2 Détection de rythme (Onset Detection)

**Objectif :** Mesurer si l'utilisateur est en avance/retard sur le beat.

**Implémentation :**
```python
# worker/tasks/scoring.py
import librosa

def calculate_rhythm_accuracy(
    user_audio: np.ndarray,
    ref_audio: np.ndarray,
    sr: int = 16000
) -> float:
    """Calculate rhythm accuracy via onset alignment."""
    # Détecter les onsets (attaques de notes)
    user_onsets = librosa.onset.onset_detect(
        y=user_audio, sr=sr, units='time', backtrack=True
    )
    ref_onsets = librosa.onset.onset_detect(
        y=ref_audio, sr=sr, units='time', backtrack=True
    )

    if len(user_onsets) == 0 or len(ref_onsets) == 0:
        return 50.0

    # Pour chaque onset user, trouver le plus proche dans ref
    timing_errors = []
    for user_onset in user_onsets:
        closest_ref = ref_onsets[np.argmin(np.abs(ref_onsets - user_onset))]
        error_ms = abs(user_onset - closest_ref) * 1000
        timing_errors.append(error_ms)

    avg_error = np.mean(timing_errors)

    # Score: 0ms = 100, 200ms = 0
    score = max(0, 100 - avg_error / 2)
    return round(score, 1)
```

#### 1.3 Lyrics WER (Word Error Rate)

**Objectif :** Comparer les paroles transcrites avec les paroles officielles.

**Implémentation :**
```python
# worker/tasks/scoring.py
from jiwer import wer

def calculate_lyrics_accuracy_wer(user_lyrics: str, ref_lyrics: str) -> float:
    """Calculate lyrics accuracy using Word Error Rate."""
    if not ref_lyrics.strip():
        return 50.0  # Pas de référence

    # Normaliser
    user_clean = user_lyrics.lower().strip()
    ref_clean = ref_lyrics.lower().strip()

    if not user_clean:
        return 0.0

    # WER: 0 = parfait, 1 = tout faux
    error_rate = wer(ref_clean, user_clean)

    # Convertir en score (0-100)
    score = max(0, (1 - error_rate) * 100)
    return round(score, 1)
```

**Dépendance :** `pip install jiwer`

---

### Phase 2 : Récupération des paroles (Priorité haute)

#### 2.1 Service Lyrics (Genius/Musixmatch)

**Fichier :** `backend/app/services/lyrics.py`

```python
import lyricsgenius
from app.config import settings

class LyricsService:
    def __init__(self):
        self.genius = lyricsgenius.Genius(
            settings.genius_api_token,
            timeout=10,
            retries=2
        )

    async def get_lyrics(self, artist: str, title: str) -> str | None:
        """Fetch lyrics from Genius API."""
        try:
            song = self.genius.search_song(title, artist)
            if song:
                return song.lyrics
        except Exception as e:
            print(f"Lyrics fetch error: {e}")
        return None

lyrics_service = LyricsService()
```

**Variable d'environnement :** `GENIUS_API_TOKEN`

#### 2.2 Intégration dans le pipeline

**Fichier :** `worker/tasks/pipeline.py`

```python
# Dans analyze_performance(), après transcription
from app.services.lyrics import lyrics_service

# Récupérer les paroles officielles
ref_lyrics = await lyrics_service.get_lyrics(artist_name, track_name)
if not ref_lyrics:
    ref_lyrics = ""  # Fallback

# Passer au scoring
lyrics_score = calculate_lyrics_accuracy_wer(user_transcription, ref_lyrics)
```

---

### Phase 3 : Synchronisation temporelle (Priorité moyenne)

#### 3.1 Cross-Correlation

**Objectif :** Aligner l'enregistrement user sur la référence.

**Fichier :** `worker/tasks/sync.py`

```python
import numpy as np
from scipy import signal

def find_time_offset(
    user_audio: np.ndarray,
    ref_instrumental: np.ndarray,
    sr: int = 16000
) -> float:
    """
    Find temporal offset between user recording and reference.
    Uses cross-correlation on the instrumental bleed in user's mic.

    Returns: offset in seconds (positive = user is late)
    """
    # Downmix to mono if needed
    if user_audio.ndim > 1:
        user_audio = user_audio.mean(axis=0)
    if ref_instrumental.ndim > 1:
        ref_instrumental = ref_instrumental.mean(axis=0)

    # Cross-correlation
    correlation = signal.correlate(user_audio, ref_instrumental, mode='full')
    lags = signal.correlation_lags(len(user_audio), len(ref_instrumental), mode='full')

    # Find peak
    peak_idx = np.argmax(np.abs(correlation))
    lag_samples = lags[peak_idx]

    # Convert to seconds
    offset_seconds = lag_samples / sr

    return offset_seconds

def apply_offset(audio: np.ndarray, offset_samples: int) -> np.ndarray:
    """Shift audio by offset samples."""
    if offset_samples > 0:
        return np.pad(audio, (offset_samples, 0))[:len(audio)]
    elif offset_samples < 0:
        return np.pad(audio, (0, -offset_samples))[-offset_samples:]
    return audio
```

---

### Phase 4 : Fine-tuning Jury (Priorité basse)

#### 4.1 Dataset JSONL

**Fichier :** `training/jury_dataset.jsonl`

```jsonl
{"input": "Score: 85%, Pitch: excellent, Rythme: bon, Paroles: quelques erreurs", "output": "Wow ! Tu m'as scotché ! Ta voix est un instrument de précision. Juste quelques mots oubliés, mais franchement, c'était du très haut niveau !"}
{"input": "Score: 45%, Pitch: faux, Rythme: en retard, Paroles: approximatif", "output": "Mon ami, tu chantes comme si la mélodie était ton ennemi juré. C'était faux du début à la fin, et tu étais tellement en retard que la chanson était déjà finie quand tu as commencé !"}
{"input": "Score: 65%, Pitch: correct, Rythme: excellent, Paroles: bon", "output": "Tu as le groove, c'est indéniable ! Par contre, certaines notes m'ont fait grincer des dents. Travaille ta justesse et tu seras redoutable."}
```

#### 4.2 Script d'entraînement QLoRA

**Fichier :** `training/finetune_jury.py`

```python
# Utiliser unsloth pour fine-tuning rapide
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer

# Charger modèle base
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/llama-3-8b-bnb-4bit",
    max_seq_length=2048,
    load_in_4bit=True,
)

# Ajouter LoRA adapters
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_alpha=16,
    lora_dropout=0,
)

# Dataset
dataset = load_dataset("json", data_files="jury_dataset.jsonl")

# Training
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset["train"],
    dataset_text_field="text",
    max_seq_length=2048,
)

trainer.train()

# Export GGUF pour Ollama
model.save_pretrained_gguf("jury-lora", tokenizer, quantization_method="q4_k_m")
```

---

## 8. Prochaines étapes recommandées

| Priorité | Tâche | Impact | Effort |
|----------|-------|--------|--------|
| 🔴 1 | Implémenter Pitch DTW | Scoring précis | 2h |
| 🔴 2 | Implémenter Rhythm onset | Scoring complet | 2h |
| 🔴 3 | Intégrer Genius API | Paroles réelles | 3h |
| 🟡 4 | Synchronisation cross-corr | Alignement précis | 4h |
| 🟢 5 | Fine-tuning Jury | Punchlines uniques | 8h+ |
| 🟢 6 | WebSocket live feedback | UX temps réel | 8h+ |

---