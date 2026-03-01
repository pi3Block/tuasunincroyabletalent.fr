# Spec: Karaoke V2 — Forced Alignment avec Paroles Connues

## Contexte

Le mode karaoke mot-par-mot actuel utilise **Whisper large-v3-turbo** (`word_timestamps=true`) pour generer les timestamps de chaque mot. Whisper est un modele de **transcription vocale (ASR)**, pas un modele d'**alignement** — les word timestamps sont un sous-produit approximatif de ses poids d'attention cross-attention.

**Probleme constate** : La synchronisation mot-par-mot est devenue "grotesque" — decalages visibles, mots en avance/retard, progression du clip-path desynchronisee du chant.

**Cause racine** : Whisper est entraine sur de la parole, pas du chant. Les voyelles tenues, les melismes, le vibrato, les elisions francaises (l', d', qu') et le bleeding residuel post-Demucs degradent fortement la precision des timestamps.

**Precision actuelle** : ±200-400ms par mot (mesure estimee sur chant francais post-Demucs).
**Precision cible** : ±50-150ms par mot (seuil perceptif acceptable pour le karaoke mot-par-mot).

---

## Statut d'implementation (2026-03-01)

### Core — Implemente

| # | Etape | Fichier | Notes |
|---|-------|---------|-------|
| 1 | Dependance `ctc-forced-aligner` | `worker/requirements-project.txt` | `>=0.2.0` |
| 2 | Lazy-loading modele CTC (MMS-300M) | `worker/tasks/word_timestamps.py` | `_get_ctc_align_model()`, fp16 sur `CTC_ALIGN_DEVICE` |
| 3 | `MmsCtcAlignmentEngine` | `worker/tasks/word_timestamps.py` | CTC forced alignment, CC-BY-NC, 1130 langues |
| 4 | Regroupement synced hybride | `worker/tasks/word_timestamps.py` | Temporel + fuzzy text, jamais de perte silencieuse |
| 5 | `do_generate_word_timestamps()` 3-tier | `worker/tasks/word_timestamps.py` | Engine chain + quality gates + fallback |
| 6 | Onset refinement (`_refine_with_onsets`) | `worker/tasks/word_timestamps.py` | Optionnel (`KARAOKE_ONSET_REFINE=true`), snap ±80ms |
| 7 | `AlignmentEngine` Protocol | `worker/tasks/word_timestamps.py` | 4 engines : SharedWhisper, Groq, MmsCtc, TorchaudioCtc |
| 8 | `_validate_alignment_integrity()` | `worker/tasks/word_timestamps.py` | Monotonie, bornes, timing validation |
| 9 | `_passes_quality_gate()` | `worker/tasks/word_timestamps.py` | `confidence_avg` + `low_conf_ratio` |
| 10 | `TorchaudioCtcAlignmentEngine` | `worker/tasks/word_timestamps.py` | Fallback licence-compatible (torchaudio MMS_FA) |
| 11 | Cache key versioning | `worker/tasks/word_timestamps_db.py` | `alignment_engine_version` stocke + verifie |

### Ops — Implemente

| # | Item | Fichier |
|---|------|---------|
| 12 | Env vars Docker | `docker-compose.coolify.yml` |
| 13 | Env vars Python (12 variables) | `worker/tasks/word_timestamps.py` |
| 14 | Source priority CTC dans SQLAlchemy | `backend/app/models/word_timestamps_cache.py` |

### Non-negociables V2 — Statut

| # | Exigence | Statut |
|---|----------|--------|
| 1 | Abstraction moteur (`AlignmentEngine` Protocol) | OK — 4 implementations |
| 2 | Contrat unites temporelles | OK — `_to_ms()` + `_normalize_words_timing()` |
| 3 | Regroupement synced robuste | OK — hybride temporel+fuzzy, `skipped_ratio` trace |
| 4 | `HALLUCINATION_WORDS` defini | OK — constante centralisee |
| 5 | Eviter double lecture audio | N/A — onset refinement charge independamment a 22050Hz |
| 6 | Quality gate CTC + fallback | OK — `_passes_quality_gate()` + fallback engine chain |
| 7 | Validation chunking/batch | A valider sur >6min |
| 8 | Garde-fous ops | Partiel — logs structures OK, circuit breaker absent |

### Hors scope (futur)

- Golden set benchmark scripts (`benchmarks/karaoke_alignment_v2/`)
- Circuit breaker / feature flag runtime toggle
- Observabilite Langfuse par tier
- Beat-aware quantization (snap grille rythmique)
- Segment-level fallback (CTC + Whisper hybride par segment)
- Fine-tuning MMS sur chant francais

---

## Diagnostic technique

### Pipeline actuel (V1)

```
Lyrics (LRCLib/Genius) ← utilises UNIQUEMENT comme initial_prompt (hint)
    +
Vocals separees (Demucs) → Whisper large-v3-turbo (ASR + word_timestamps)
                              ↓
                     Timestamps mot-par-mot (±200-400ms)
```

Fichier : `worker/tasks/word_timestamps.py`

### Pourquoi Whisper est inadapte au chant

| Probleme | Impact sur timestamps |
|----------|---------------------|
| Entraine sur parole, pas chant | Les voyelles tenues (3-5x plus longues qu'en parole) ne sont pas modelisees |
| Resolution frames ~20ms | Jitter ±50-100ms sur chaque frontiere de mot |
| Pas de notion de tempo musical | Les timestamps derivent au fil de la chanson |
| Francais chante (elisions l', d', qu') | Mauvais decoupage des mots courts |
| Demucs bleeding residuel | Le modele "entend" des instrumentaux fantomes |
| Cross-attention heuristique | Les word timestamps sont un best-effort, pas la fonction principale du modele |

### Erreur architecturale

On fait faire a Whisper **deux taches** :
1. **Reconnaitre** ce qui est dit (ASR) — inutile car on a DEJA les paroles
2. **Localiser temporellement** chaque mot — c'est la seule chose dont on a besoin

Le forced alignment ne fait QUE la tache 2 : etant donne un texte connu, trouver OU chaque mot se situe dans l'audio. C'est une tache fondamentalement plus simple et plus precise.

---

## Architecture cible (V2)

```
PIPELINE V2 — Forced Alignment avec paroles connues

Tier 1 : CTC Forced Alignment (MMS-300M, 1130 langues)
         → Paroles connues (LRCLib/Genius) + vocals Demucs → alignement force CTC/Viterbi
         → Precision : ±20-50ms (parole) / ±80-200ms (chant post-Demucs)
         → Couverture : 100% (fonctionne des qu'on a les paroles + audio)
         → GPU : ~800 Mo VRAM (fp16) — coexiste avec CREPE sur GPU 2
         → TTL cache : 90 jours
         → Source : ctc-forced-aligner (MahmoudAshraf97/ctc-forced-aligner)

Tier 2 : Whisper brut (fallback, si pas de paroles connues)
         → Pipeline V1 inchange (shared-whisper HTTP → Groq fallback)
         → Precision : ±200-400ms
         → Utilise uniquement quand aucune parole n'est disponible
         → TTL cache : 90 jours

Tier 3 : Groq Whisper API (fallback si shared-whisper down)
         → Pipeline V1 inchange
         → TTL cache : 90 jours
```

### Flow V2 detaille

```
1. Verifier cache (Redis 1h → PostgreSQL 90-365j)
   ↓ cache miss
2. Recuperer paroles connues
   ├── LRCLib synced (line-level, ~65% couverture)
   ├── Genius plain text (~90% couverture)
   └── Aucune parole trouvee → Tier 2 (Whisper brut)
   ↓ paroles trouvees
3. Recuperer vocals separees
   ├── Cache Demucs (cache/{youtube_id}/vocals.wav)
   └── Demucs separation si pas en cache
   ↓
4. CTC Forced alignment : paroles connues + vocals → timestamps mot-par-mot
   ↓
5. Post-traitement
   ├── Onset refinement (snap frontieres sur les attaques vocales)
   ├── Filtrage score alignment < seuil → fallback Whisper pour ces segments
   └── Regroupement caracteres → mots → lignes
   ↓
6. Cache (Redis 1h + PostgreSQL 90j)
```

---

## Recherche — Solutions evaluees

### REJETEES

#### stable-ts — ❌ Rejete pour l'architecture V2 (pas pour absence de feature)

**Mise a jour importante** : stable-ts propose maintenant des fonctions d'alignement (`align`) avec texte connu.

**Raison du rejet maintenue** :
- Reste fortement lie a l'ecosysteme Whisper (pipeline transcription-first dans la pratique)
- N'apporte pas un vrai decouplage "texte connu -> alignement CTC dedie" comme V2
- Le comportement sur chant + musique residuelle reste variable selon les morceaux

Conclusion : outil utile pour raffiner Whisper, mais moins adapte qu'un forced alignment CTC natif comme Tier 1.

#### WhisperX — ❌ Conflit de dependances torch

**Raison du rejet** : WhisperX pin `torch ~2.8.0` et `torchaudio ~2.8.0`. Le worker Docker utilise PyTorch 2.5.1 (CUDA 12.4). Installer WhisperX forcerait un upgrade PyTorch qui casserait Demucs, CREPE et whisper-timestamped.

Note : `whisperx.align()` peut techniquement prendre des segments pre-existants (pas besoin de re-transcrire), et le modele d'alignement seul est leger (~400 Mo). Si le conflit torch est resolu a l'avenir, WhisperX redevient interessant.

#### Montreal Forced Aligner (MFA) — ❌ Conda-only, pas Docker-compatible

Installation conda uniquement, dependance Kaldi massive, concu pour la parole pas le chant.

#### NUS AutoLyrixAlign — ❌ Abandonne, non-maintenu

MIREX 2019 winner mais 7 commits total, code heberge sur Google Drive, pas de package pip, anglais uniquement.

#### aeneas — ❌ Explicitement inadapte au chant

Documentation : "Audio is assumed to be spoken: not suitable for song captioning."

### EVALUEES POSITIVEMENT

#### Option A : CTC Forced Aligner (RECOMMANDEE) ✅

**Package** : `MahmoudAshraf97/ctc-forced-aligner`
**Modele** : Meta MMS-300M (`MahmoudAshraf/mms-300m-1130-forced-aligner`)
**Licence** : CC-BY-NC-4.0 (modele), code MIT-like

**Pourquoi c'est le meilleur choix** :
1. **Concu exactement pour notre use-case** — "aligner du texte connu sur de l'audio", pas de transcription
2. **1130 langues dont le francais** (`fra` ISO 639-3) — pas besoin de modele supplementaire
3. **Leger** — ~800 Mo VRAM fp16 (vs ~3-4 Go pour Whisper)
4. **Pas de conflit torch** — fonctionne avec PyTorch 2.5.1 (dependances : torch + transformers seulement)
5. **Backend C++** pour l'alignement Viterbi — rapide (~1-3s pour 3 minutes)
6. **Precision** : ±20-50ms sur parole, ±80-200ms estimee sur chant post-Demucs
7. **Zero hallucination** — le texte est fixe, le modele cherche uniquement QUAND chaque mot est dit

**Architecture du modele** :
- Meta MMS (Massively Multilingual Speech) — wav2vec2 architecture, 300M params
- Entraine CTC specifiquement pour l'alignement force (pas juste ASR)
- 1130 langues pre-entrainees
- Sortie : probabilites frame-par-frame par token → alignement Viterbi → frontieres temporelles

**Limitation honnete** :
Le modele MMS-300M est entraine sur de la **parole**, pas du chant. Les performances se degradent sur le chant (~30-50% d'erreur supplementaire sur les voyelles tenues et le vibrato). Cependant, combine avec la separation Demucs (vocals propres), la precision reste bien superieure a Whisper cross-attention car :
- Pas d'erreurs ASR (texte connu)
- Alignement Viterbi global (pas de derive cumulative)
- Resolution frame-level (20ms) exploitee au maximum

#### Option B : torchaudio.functional.forced_align (alternative zero-dep) ✅

**Deja installe** dans le Docker worker (torchaudio fait partie de l'image PyTorch).

**Principe** : Meme approche CTC/Viterbi que le CTC Forced Aligner, mais API plus bas niveau. Necessite d'ecrire manuellement le code de tokenisation, trellis, backtracking et merge en mots (~100-150 lignes).

**Modele francais** : `torchaudio.pipelines.VOXPOPULI_ASR_BASE_10K_FR` (95M params, ~400 Mo fp32)

**Avantage** : Zero dependance supplementaire
**Inconvenient** : Modele plus petit (95M vs 300M), potentiellement moins robuste. API bas niveau = plus de code.
**Risque long terme** : API torchaudio forced alignment marquee depreciee dans les versions recentes; a eviter comme pilier principal sans plan de migration explicite.

---

## Tableau comparatif final

| Critere | CTC Forced Aligner (A) | torchaudio (B) | WhisperX | Whisper actuel |
|---------|:---------------------:|:--------------:|:--------:|:--------------:|
| Aligne texte connu | ✅ (API dediee) | ✅ (bas niveau) | ⚠️ (segments) | ❌ (hint) |
| Precision chant FR | ±80-200ms | ±100-250ms | ±80-150ms | ±200-400ms |
| VRAM | ~800 Mo fp16 | ~400 Mo fp32 | ~4.5 Go | 0 (HTTP) |
| Conflit deps | ❌ aucun | ❌ aucun | ❌ **torch 2.8** | ❌ aucun |
| Francais natif | ✅ 1130 langues | ✅ VoxPopuli FR | ✅ | ✅ |
| Vitesse (~3min) | ~1-3s | ~1-2s | ~8-15s | ~3s (HTTP) |
| Complexite | ~80 lignes | ~150 lignes | ~60 lignes | Actuel |
| Backend natif | C++ Viterbi | C++ Viterbi | Python | HTTP |

---

## Recommandation : CTC Forced Aligner (Option A)

### Pourquoi le CTC Forced Aligner

1. **API purpose-built** — Concu pour "aligner ce texte sur cet audio". Pas un hack sur un ASR.

2. **MMS-300M > VoxPopuli-95M** — 3x plus de parametres, entraine sur 1130 langues, meilleur baseline pour le francais que le petit modele torchaudio.

3. **Leger et rapide** — ~800 Mo fp16 vs ~3 Go pour Whisper. Coexiste facilement avec CREPE sur GPU 2 (RTX 3070, 8 Go).

4. **Pas de conflit deps** — Dependances : torch, transformers, ffmpeg. Tout deja present dans le Docker worker.

5. **Approche par phonemes** — Le CTC Forced Aligner decompose le texte en caracteres/phonemes et les aligne individuellement. Meilleure granularite que Whisper qui aligne des tokens BPE entiers.

### Compromis a accepter

- **Licence CC-BY-NC-4.0** sur le modele MMS : non-commercial. Kiaraoke est un projet non-commercial actuellement → OK. Si commercialisation future, basculer vers torchaudio (Option B) qui utilise des modeles MIT/Apache.
- **Speech-trained** : Le modele n'est pas entraine sur du chant. Les voyelles tenues et le vibrato degradent la precision. Mitigation : Demucs fournit des vocals propres + onset refinement en post-traitement.
- **Romanisation** : Le CTC Forced Aligner utilise `uroman` pour convertir le texte en caracteres latins. Pour le francais c'est transparent (deja latin), mais les accents (e, a, u) sont normalises. Pas de probleme pratique.

---

## Plan d'implementation (8 etapes core + 3 etapes ops)

### Etape 1 — Dependances

**Fichier** : `worker/requirements-project.txt`

```
ctc-forced-aligner>=0.2.0
```

Installation reelle (dans le Dockerfile, le `pip install` existant couvrira) :
```bash
pip install ctc-forced-aligner
# Tire : torch (deja), transformers (deja), numpy (deja), ffmpeg-python
```

Le modele MMS-300M (~1.2 Go fp32, ~600 Mo fp16) est telecharge au premier appel et cache dans `~/.cache/huggingface/`.

---

### Etape 2 — Lazy-loading du modele CTC

**Fichier** : `worker/tasks/word_timestamps.py`

Pattern identique au lazy-loading Demucs/CREPE du projet :

```python
import os

CTC_ALIGN_DEVICE = os.getenv("CTC_ALIGN_DEVICE", "cuda:1")  # GPU 2 (RTX 3070)

_ctc_model = None
_ctc_tokenizer = None

def get_ctc_align_model():
    """Lazy-load CTC forced aligner model (MMS-300M, ~800 Mo fp16)."""
    global _ctc_model, _ctc_tokenizer
    if _ctc_model is None:
        import torch
        from ctc_forced_aligner import load_alignment_model

        dtype = torch.float16 if "cuda" in CTC_ALIGN_DEVICE else torch.float32
        _ctc_model, _ctc_tokenizer = load_alignment_model(
            CTC_ALIGN_DEVICE,
            dtype=dtype,
        )
        logger.info("CTC aligner loaded on %s (dtype=%s)", CTC_ALIGN_DEVICE, dtype)
    return _ctc_model, _ctc_tokenizer
```

---

### Etape 3 — Fonction d'alignement force CTC

**Fichier** : `worker/tasks/word_timestamps.py`

```python
def _align_with_ctc(
    vocals_path: str,
    lyrics_text: str,
    language: str = "fr",
) -> dict:
    """
    CTC forced alignment: aligns known lyrics text to Demucs-separated vocals.

    Uses Meta MMS-300M model (wav2vec2, 1130 languages) with Viterbi decoding.
    No ASR step — text is fixed, only temporal localization is computed.
    """
    from ctc_forced_aligner import (
        load_audio,
        generate_emissions,
        preprocess_text,
        get_alignments,
        get_spans,
        postprocess_results,
    )

    model, tokenizer = get_ctc_align_model()

    # Load and encode audio
    audio_waveform = load_audio(vocals_path, model.dtype, model.device)

    # Generate frame-level CTC emissions (log probabilities per token per frame)
    emissions, stride = generate_emissions(model, audio_waveform, batch_size=4)

    # Map language to ISO 639-3 for uroman romanization
    lang_map = {"fr": "fra", "en": "eng", "es": "spa", "de": "deu", "it": "ita", "pt": "por"}
    iso_lang = lang_map.get(language, "fra")

    # Preprocess text (romanize + tokenize)
    tokens_starred, text_starred = preprocess_text(
        lyrics_text,
        romanize=True,
        language=iso_lang,
    )

    # CTC forced alignment via Viterbi decoding
    segments, scores, blank_id = get_alignments(emissions, tokens_starred, tokenizer)

    # Convert frame indices to time spans
    spans = get_spans(tokens_starred, segments, blank_id)

    # Merge characters into words with timestamps
    word_results = postprocess_results(text_starred, spans, stride, scores)

    # Convert to our format
    words = []
    lines = []
    current_line_words = []
    line_gap_threshold_ms = 1500  # New line if gap > 1.5s

    for wr in word_results:
        word_text = wr["text"].strip()
        if not word_text or word_text in HALLUCINATION_WORDS:
            continue

        word_data = {
            "word": word_text,
            "startMs": int(wr["start"] * 1000),
            "endMs": int(wr["end"] * 1000),
            "confidence": round(wr.get("score", 0.9), 3),
        }
        words.append(word_data)

        # Line grouping: split on gaps > threshold
        if current_line_words:
            gap = word_data["startMs"] - current_line_words[-1]["endMs"]
            if gap > line_gap_threshold_ms:
                lines.append(_build_line(current_line_words))
                current_line_words = []

        current_line_words.append(word_data)

    if current_line_words:
        lines.append(_build_line(current_line_words))

    # If we have synced lyrics from LRCLib, re-group words by original lines
    # (better than gap-based splitting for songs with known line structure)

    confidence_avg = sum(w["confidence"] for w in words) / len(words) if words else 0
    duration_ms = words[-1]["endMs"] if words else 0

    logger.info(
        "CTC forced alignment: %d words, %d lines, avg score: %.3f",
        len(words), len(lines), confidence_avg,
    )

    return {
        "text": lyrics_text,
        "language": language,
        "words": words,
        "lines": lines,
        "word_count": len(words),
        "duration_ms": duration_ms,
        "confidence_avg": round(confidence_avg, 3),
        "model_version": "ctc-mms-300m-forced-aligned",
    }


def _build_line(line_words: list[dict]) -> dict:
    """Build a line dict from a list of word dicts."""
    return {
        "startMs": line_words[0]["startMs"],
        "endMs": line_words[-1]["endMs"],
        "words": line_words,
        "text": " ".join(w["word"] for w in line_words),
    }
```

---

### Etape 4 — Regroupement intelligent des mots en lignes (si lyrics synced)

**Fichier** : `worker/tasks/word_timestamps.py`

Quand les paroles viennent de LRCLib (synced, avec timestamps ligne-par-ligne), on peut regrouper les mots alignes selon la structure de lignes originale plutot que par detection de gaps :

```python
def _regroup_words_by_synced_lines(
    words: list[dict],
    synced_lines: list[dict],
) -> list[dict]:
    """
    Re-group CTC-aligned words into lines matching the original LRCLib line structure.

    synced_lines format: [{"text": "...", "startMs": N, "endMs": N}, ...]
    words format: [{"word": "...", "startMs": N, "endMs": N, "confidence": F}, ...]
    """
    if not synced_lines or not words:
        return []

    lines = []
    word_idx = 0

    for sline in synced_lines:
        line_text_lower = sline["text"].strip().lower()
        if not line_text_lower:
            continue

        # Collect words whose startMs falls within this line's time range
        # Use the original line's timing as a guide, but trust the CTC word timestamps
        line_start = sline["startMs"]
        line_end = sline.get("endMs", line_start + 10000)

        line_words = []
        while word_idx < len(words):
            w = words[word_idx]
            # Word starts within this line's time window (with 500ms tolerance)
            if w["startMs"] >= line_start - 500 and w["startMs"] < line_end + 500:
                line_words.append(w)
                word_idx += 1
            elif w["startMs"] >= line_end + 500:
                break  # This word belongs to a later line
            else:
                word_idx += 1  # Skip word before this line

        if line_words:
            lines.append(_build_line(line_words))

    # Remaining words go into a final line
    if word_idx < len(words):
        lines.append(_build_line(words[word_idx:]))

    return lines
```

---

### Etape 5 — Restructurer `do_generate_word_timestamps` (3-tier)

**Fichier** : `worker/tasks/word_timestamps.py`

```python
def do_generate_word_timestamps(
    vocals_path: str,
    spotify_track_id: str,
    youtube_video_id: str | None = None,
    language: str = "fr",
    artist_name: str | None = None,
    track_name: str | None = None,
    lyrics_text: str | None = None,
    synced_lines: list[dict] | None = None,
) -> dict:

    # ===== Tier 1: CTC Forced Alignment (si paroles connues, >= 20 chars) =====
    if lyrics_text and len(lyrics_text.strip()) > 20:
        try:
            result = _align_with_ctc(vocals_path, lyrics_text, language)

            # Re-group by original synced lines if available
            if synced_lines and len(synced_lines) > 1:
                regrouped = _regroup_words_by_synced_lines(result["words"], synced_lines)
                if regrouped:
                    result["lines"] = regrouped

            # Optional: onset refinement
            if os.getenv("KARAOKE_ONSET_REFINE", "").lower() == "true":
                result["words"] = _refine_with_onsets(result["words"], vocals_path)

            return _finalize_result(
                result, vocals_path, spotify_track_id,
                youtube_video_id, artist_name, track_name,
                source="ctc_forced_aligned",
            )
        except Exception as e:
            logger.warning("CTC forced alignment failed: %s — falling back to Whisper", e)

    # ===== Tier 2: shared-whisper HTTP (pipeline V1 inchange) =====
    data = None
    source = "shared_whisper"
    try:
        data = _transcribe_via_shared_whisper(vocals_path, language, lyrics_text)
    except Exception as e:
        logger.warning("shared-whisper failed: %s", e)

        # ===== Tier 3: Groq Whisper API =====
        if GROQ_API_KEY:
            try:
                data = _transcribe_via_groq(vocals_path, language, lyrics_text)
                source = "groq_whisper"
            except Exception as groq_err:
                logger.warning("Groq fallback failed: %s", groq_err)

    if data is None:
        raise RuntimeError("All word timestamp tiers failed")

    result = _extract_words_and_lines(data, lyrics_text)
    if source == "groq_whisper":
        result["model_version"] = "groq-whisper-large-v3-turbo"

    return _finalize_result(
        result, vocals_path, spotify_track_id,
        youtube_video_id, artist_name, track_name,
        source=source,
    )


def _finalize_result(
    result: dict,
    vocals_path: str,
    spotify_track_id: str,
    youtube_video_id: str | None,
    artist_name: str | None,
    track_name: str | None,
    source: str,
) -> dict:
    """Save timestamps to file and return standardized result dict."""
    output_dir = Path(vocals_path).parent
    timestamps_path = output_dir / "word_timestamps.json"

    output_data = {
        "spotify_track_id": spotify_track_id,
        "youtube_video_id": youtube_video_id,
        "source": source,
        "language": result.get("language", "fr"),
        "model_version": result.get("model_version", "unknown"),
        "words": result["words"],
        "lines": result["lines"],
        "word_count": result.get("word_count", len(result["words"])),
        "duration_ms": result.get("duration_ms", 0),
        "confidence_avg": result.get("confidence_avg", 0),
        "artist_name": artist_name,
        "track_name": track_name,
    }

    with open(timestamps_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    logger.info("Saved word timestamps to: %s (source: %s)", timestamps_path, source)

    return {
        "status": "completed",
        **output_data,
        "timestamps_path": str(timestamps_path),
    }
```

---

### Etape 6 — Post-traitement : onset refinement (optionnel)

**Fichier** : `worker/tasks/word_timestamps.py`

Snap les frontieres de mots sur les attaques vocales (librosa, deja utilise dans le projet) :

```python
def _refine_with_onsets(words: list[dict], vocals_path: str) -> list[dict]:
    """
    Snap word start boundaries to vocal onset events (energy attacks).
    Improves precision by ~10-30ms on word starts.
    Only moves boundaries within SNAP_THRESHOLD_MS to avoid misalignment.
    """
    import librosa
    import numpy as np

    y, sr = librosa.load(vocals_path, sr=22050)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units='frames')
    onset_times_ms = (librosa.frames_to_time(onset_frames, sr=sr) * 1000).astype(int)

    if len(onset_times_ms) == 0:
        return words

    SNAP_THRESHOLD_MS = 80  # Ne snap que si onset est a moins de 80ms

    refined = []
    for word in words:
        diffs = np.abs(onset_times_ms - word["startMs"])
        closest_idx = np.argmin(diffs)
        if diffs[closest_idx] <= SNAP_THRESHOLD_MS:
            word = {**word, "startMs": int(onset_times_ms[closest_idx])}
        refined.append(word)

    return refined
```

Active via `KARAOKE_ONSET_REFINE=true` (desactive par defaut, a valider apres benchmark).

---

### Etape 7 — Configuration GPU et variables d'environnement

**Variables Coolify a ajouter** :
```env
CTC_ALIGN_DEVICE=cuda:1          # GPU 2 (RTX 3070, coexiste avec CREPE)
KARAOKE_ONSET_REFINE=false       # Onset refinement (optionnel)
```

**Memoire GPU estimee** :

| Composant | GPU | VRAM | Notes |
|-----------|-----|------|-------|
| CTC MMS-300M (fp16) | cuda:1 (GPU 2) | ~800 Mo | Lazy-loaded, reste en memoire |
| CREPE (pitch) | cuda:1 (GPU 2) | ~1 Go | Sequentiel, pas simultane |
| **Total peak** | **GPU 2** | **~1.8 Go** | **< 8 Go RTX 3070** ✅ |

Avantage vs stable-ts/WhisperX : ~800 Mo au lieu de ~3-4.5 Go. Marge confortable sur GPU 2.

---

### Etape 8 — Invalidation du cache existant

Les timestamps V1 sont caches en PostgreSQL avec `source='whisper_timestamped'` et TTL 90 jours.

**Option A : Invalidation progressive (recommandee)**
- Les anciens caches expirent naturellement (90j TTL)
- Les nouveaux appels generent des timestamps V2
- Le bouton "Regenerer" (frontend) force la regeneration immediate

**Option B : Invalidation immediate**
```sql
-- Si la qualite V1 est vraiment mauvaise et qu'on veut tout regenerer
UPDATE word_timestamps_cache
SET expires_at = NOW()
WHERE source = 'whisper_timestamped';
```

**Pas de migration de schema necessaire** — le champ `source` accepte des valeurs libres. La nouvelle valeur `ctc_forced_aligned` est automatiquement supportee.

---

## Ameliorations futures (hors scope V2)

### Fine-tuning MMS sur chant francais

Le modele MMS-300M est entraine sur de la parole. Fine-tuner sur 20-50h de chant francais aligne (dataset DALI + corrections manuelles) pourrait ameliorer la precision de ±80-200ms a ±30-100ms. Effort significatif mais ROI eleve.

### Beat-aware quantization

Snap les frontieres de mots sur la grille rythmique (beat tracking librosa) pour les mots qui tombent sur un temps fort. Amelioration subjective de la "groove" du karaoke. ~30 lignes de code supplementaires.

### Musixmatch Enhanced LRC (Tier 0)

Acces non-officiel aux timestamps Musixmatch professionnels (±10ms, humainement verifies) via `mxlrc` ou `syncedlyrics enhanced=True`. Couverture ~15-25% hits (surtout anglais), ~5-10% francais. Risque legal TOS — a evaluer separement.

L'architecture cache est deja prete (`musixmatch_word` comme source avec TTL 365j).

### Correction utilisateur (drag & drop timeline)

Permettre aux utilisateurs de corriger manuellement les timestamps de mots individuels. Sauvegarder avec `source='user_corrected'` (TTL permanent, priorite max dans le cache). Necessite un nouveau composant frontend (timeline editor).

### WhisperX quand torch >= 2.8

Si le worker migre vers PyTorch >= 2.8 (probable avec les futures mises a jour Demucs/CREPE), WhisperX redevient viable. Son API `whisperx.align()` accepte des segments pre-existants avec texte connu + le modele d'alignement wav2vec2 est tres leger (~400 Mo). A re-evaluer lors de la prochaine maj PyTorch.

### Hybride CTC + onset refinement + beat quantization

Pipeline complet : CTC alignment → onset snap → beat snap. Triple passe pour precision maximale. Temps supplementaire ~1-2s (librosa onset + beat tracking). A activer par defaut apres validation sur 10+ chansons.

---

## Cas limites

| Scenario | Comportement V2 |
|----------|-----------------|
| Paroles disponibles (LRCLib/Genius) | Tier 1 : CTC forced alignment (MMS-300M) |
| Aucune parole trouvee | Tier 2 : Whisper brut (pipeline V1 inchange) |
| CTC alignment echoue (OOM, erreur) | Fallback Tier 2 automatique (try/except) |
| Chanson instrumentale (pas de paroles) | Pas de karaoke — comportement actuel |
| Paroles partiellement incorrectes (Genius) | CTC tolerant aux erreurs mineures, score degrade sur les passages errones |
| Chanson avec melange de langues | MMS-300M supporte 1130 langues, gere nativement |
| Demucs pas encore en cache | Pipeline complet : Demucs → CTC alignment (sequentiel) |
| CREPE en cours sur meme GPU | Sequentiel — CTC attend CREPE (1.8 Go total < 8 Go, pourrait coexister) |
| Paroles LRCLib synced disponibles | Re-groupement mots par lignes originales (meilleur que gap detection) |
| Tres longues chansons (>6 min) | `batch_size=4` dans `generate_emissions` gere le chunking automatiquement |

---

## Validation et verification

### Protocole d'evaluation (obligatoire avant rollout)

Objectif : remplacer les estimations par des mesures reproductibles et comparables dans le temps.

### Dataset de reference (golden set)

- 20 a 50 extraits FR chantes (30-60s chacun), couvrant: voix solo/duo/choeurs, tempos lents/rapides, elisions (l', d', qu'), melismes et voyelles tenues
- Annotations manuelles word-level sur un sous-ensemble (minimum 10 extraits)
- Versionner ce dataset dans un dossier dedie benchmark (`benchmarks/karaoke_alignment_v2/`)

### Metriques de qualite

- `AAE_ms` (Average Absolute Error) word-level
- `P50_ms`, `P95_ms` erreur absolue
- `Hit@100ms` : % de mots avec erreur <= 100ms
- `Hit@150ms` : % de mots avec erreur <= 150ms
- Metrique perceptive ligne-level: `line_sync_ok_rate` = % de lignes jugees "visuellement synchrones" en review rapide

### Seuils go/no-go proposes

- `AAE_ms < 150`
- `P95_ms < 280`
- `Hit@150ms >= 80%`
- Gain relatif vs V1 >= 30% sur `AAE_ms`
- Aucun segment catastrophique (>800ms) sur plus de 2% des mots

### Regles de benchmark

- Meme audio source, meme vocals Demucs, meme lyrics input pour V1 vs V2
- Mesures executees 3 fois puis moyennee (stabilite)
- Export CSV/JSON des resultats dans `benchmarks/results/`

### Garde-fous production

#### Versionning et cache safety

- Inclure dans la cle cache: `alignment_engine`, `alignment_engine_version`, `model_id`, `model_revision`, `postprocess_flags`
- Ne jamais reutiliser un cache genere avec une autre combinaison de version.

#### SLO, observabilite, alerting

Tracer par tier: latence `p50/p95`, taux de succes Tier 1, taux de fallback Tier 2/3, `confidence_avg`, taux d'erreurs OOM/timeout

Logs structures recommandes: `track_id`, `tier_used`, `model_version`, `duration_ms`, `word_count`, `confidence_avg`, `fallback_reason`

#### Rollback et circuit breaker

- Circuit breaker Tier 1 si OOM repetes, timeout repetes, ou baisse brutale de `Hit@150ms` en canary
- En cas de breaker ouvert: fallback automatique Tier 2, alerte ops, desactivation du feature flag CTC en runtime

#### Fallback partiel (segment-level)

Au lieu de fallback chanson entiere: detecter les segments faibles (`score < seuil`), realigner uniquement ces segments via Whisper fallback, puis fusionner le resultat final (CTC majoritaire, fallback local).

### Conformite et licences (a valider avant toute commercialisation)

- Modele MMS-300M utilise par le Tier 1 : licence `CC-BY-NC-4.0` (non commercial)
- Implication: usage commercial bloque tant que Tier 1 repose sur ce modele
- Plan de mitigation: Option B (torchaudio + modele permissif) ou autre modele alignment avec licence compatible business, puis revue legale formelle avant monetisation

Ajouter une variable de garde:
- `KARAOKE_ALIGNMENT_LICENSE_MODE=non_commercial` (defaut)
- check au demarrage si environnement declare `commercial` -> refuser Tier 1 NC

### Tests fonctionnels

1. **Test qualite alignement** : Comparer visuellement les timestamps V1 (Whisper brut) vs V2 (CTC) sur 3 chansons francaises connues → verifier que le clip-path karaoke est mieux synchronise
2. **Test fallback** : Simuler echec CTC (env `CTC_ALIGN_DEVICE=cpu_invalid`) → verifier que le Tier 2 (Whisper brut) prend le relais
3. **Test sans paroles** : Tester une chanson sans paroles LRCLib/Genius → verifier que le Tier 2 est utilise
4. **Test cache** : Generer V2, verifier `source='ctc_forced_aligned'` dans PostgreSQL
5. **Test regeneration** : Regenerer une chanson avec timestamps V1 caches → verifier que V2 remplace
6. **Test regroupement** : Chanson avec LRCLib synced → verifier que les lignes correspondent a la structure originale

### Tests techniques

7. **Test GPU** : Verifier que MMS-300M charge sur `cuda:1` pas `cuda:0` (pas de conflit Demucs)
8. **Test VRAM** : `nvidia-smi` pendant l'alignement → confirmer < 1 Go sur GPU 2
9. **Test build** : `docker build` du worker avec `ctc-forced-aligner` dans requirements
10. **Test concurrent** : Pipeline analyse (Demucs GPU 1) + word timestamps CTC (GPU 2) → pas de conflit

### Benchmark

11. **Mesure precision** : Sur 5 chansons de reference, mesurer l'Average Absolute Error (AAE) en ms. Cible : AAE < 150ms (V2) vs AAE > 250ms (V1).
12. **Mesure vitesse** : Temps de generation CTC vs Whisper brut. Cible : < 5s pour 3 minutes d'audio.

---

## Estimation

| Etape | Lignes | Effort |
|-------|--------|--------|
| Etape 1 (dependances) | ~2 lignes | Faible |
| Etape 2 (lazy-loading CTC) | ~20 lignes | Faible |
| Etape 3 (alignement force CTC) | ~80 lignes | Moyen |
| Etape 4 (regroupement par lignes synced) | ~40 lignes | Moyen |
| Etape 5 (restructurer do_generate 3-tier) | ~50 lignes | Moyen |
| Etape 6 (onset refinement optionnel) | ~25 lignes | Faible |
| Etape 7 (config GPU + env) | ~5 lignes | Faible |
| Etape 8 (invalidation cache) | ~0-5 lignes | Faible |
| Etape 9 (baseline benchmark + golden set scripts) | ~40 lignes | Moyen |
| Etape 10 (observabilite + logs structures) | ~30 lignes | Moyen |
| Etape 11 (feature flag + circuit breaker hooks) | ~25 lignes | Moyen |
| **Total** | **~320 lignes** | |

---

## Ordre d'implementation

```
Phase 0 — Baseline & instrumentation
  1. Definir le golden set + script de benchmark
  2. Ajouter logs structures et metriques p50/p95, fallback rate
  → Permet de comparer V1/V2 objectivement

Phase 1 — Core (Tier 1 CTC)
  1. Etape 1  (dependances)
  2. Etape 2  (lazy-loading modele)
  3. Etape 3  (fonction alignement CTC)
  4. Etape 5  (restructurer do_generate 3-tier)
  → Testable immediatement: V2 fonctionnel avec fallback V1

Phase 2 — Qualite
  5. Etape 4  (regroupement lignes synced)
  6. Etape 6  (onset refinement optionnel)
  → Amelioration de la structure des lignes et des frontieres

Phase 3 — Deploiement
  7. Etape 7  (config GPU Coolify)
  8. Etape 8  (invalidation cache si necessaire)
  → Deploiement canary

Phase 4 — Rollout controle
  9. Activer feature flag CTC sur un sous-ensemble de tracks
  10. Verifier les seuils go/no-go (`AAE`, `P95`, `Hit@150ms`)
  11. Generaliser le rollout puis monitorer le circuit breaker
  → Deploiement production stable
```

## Checklist release V2

- [ ] Golden set versionne et rejouable localement
- [ ] Benchmark V1 vs V2 exporte (`benchmarks/results/`)
- [ ] Seuils go/no-go atteints (`AAE`, `P95`, `Hit@150ms`)
- [ ] Cle cache versionnee (engine + model + flags)
- [ ] Fallback Tier 2/3 valide en test d'echec
- [ ] Circuit breaker et alerting actifs
- [ ] Validation licence terminee (usage non-commercial confirme)

---

## Non-negociables V2 (a ajouter a la spec d'implementation)

### 1) Abstraction moteur d'alignement (anti lock-in licence)

Definir une interface unique pour pouvoir remplacer facilement le moteur NC (MMS) si passage en usage commercial.

```python
class AlignmentEngine(Protocol):
    def align(
        self,
        vocals_path: str,
        lyrics_text: str,
        language: str,
        *,
        synced_lines: list[dict] | None = None,
    ) -> dict: ...
```

Implementations minimales:
- `MmsCtcAlignmentEngine` (Tier 1 actuel, NC)
- `TorchaudioAlignmentEngine` (fallback licence-compatible futur)
- `WhisperAlignmentEngine` (Tier 2/3 existant)

Selection via env:
- `KARAOKE_ALIGNMENT_ENGINE=auto|mms_ctc|torchaudio_ctc|whisper`

Contrainte:
- Aucune logique metier ne doit dependre d'un moteur concret en dehors du routeur de tiers.

### 2) Contrat explicite des unites temporelles

Le code suppose `wr["start"]` et `wr["end"]` en secondes float. Ce contrat doit etre verifie et teste.

Regles:
- Normaliser vers un format interne unique: `start_ms` / `end_ms` (int)
- Ajouter un validateur runtime:
  - `0 <= start_ms <= end_ms`
  - `end_ms <= audio_duration_ms + tolerance`
  - monotonie globale des mots (pas de retour en arriere)
- En cas de violation: log structure + fallback Tier 2.

Tests obligatoires:
- Cas source en secondes (attendu)
- Cas source en millisecondes (doit detecter et refuser/convertir explicitement)
- Cas source en frames (doit refuser sans mapping explicite)

### 3) Regroupement synced robuste (pas de perte silencieuse)

Le regroupement par fenetre temporelle seule (`+-500ms`) est insuffisant.

Exigences:
- Interdire toute perte silencieuse:
  - compter `skipped_words`
  - logguer `skipped_words_ratio`
- Ajouter un mode hybride:
  - fenetre temporelle + matching textuel fuzzy (normalise accents/punctuation)
- Fallback automatique:
  - si `skipped_words_ratio > threshold` alors utiliser regroupement par gaps.

Metriques:
- `regroup_mode_used`
- `skipped_words`
- `skipped_words_ratio`

### 4) Variables implicites et constantes obligatoires

`HALLUCINATION_WORDS` est reference mais non defini dans cette spec.

Action:
- Soit le definir explicitement (source unique de verite), soit le retirer pour le chemin CTC si non pertinent.
- Centraliser les seuils en config:
  - `KARAOKE_REGROUP_TOLERANCE_MS`
  - `KARAOKE_ONSET_SNAP_THRESHOLD_MS`
  - `KARAOKE_CTC_MIN_CONFIDENCE_AVG`
  - `KARAOKE_CTC_MAX_LOW_CONF_RATIO`

### 5) Eviter la double lecture audio (perf)

`_refine_with_onsets()` ne doit pas recharger le fichier si le waveform est deja disponible.

Refactor cible:
- `_align_with_ctc()` charge une seule fois audio/waveform
- `onset refinement` recoit `(waveform, sr)` ou une representation derivee partagee
- `librosa.load(vocals_path)` reserve au chemin fallback uniquement.

### 6) Quality gate CTC + fallback explicite

Le flow mentionne un filtrage par score, il doit etre implemente.

Gate minimal:
- `confidence_avg >= min_avg`
- `% mots avec score < low_thresh <= max_low_conf_ratio`
- integrite temporelle valide

Si gate KO:
- fallback chanson entiere vers Whisper, ou
- fallback segment-level (si active) puis fusion.

Logs structures obligatoires:
- `tier_used`, `confidence_avg`, `low_conf_ratio`, `fallback_reason`

### 7) Validation chunking/batch continuity

`generate_emissions(..., batch_size=4)` doit etre valide sur longues pistes.

Tests techniques:
- >6 min audio: verifier absence de discontinuites aux frontieres de chunks
- verifier monotonie timestamps apres merge
- verifier absence de trous/anomalies > threshold.

### 8) Garde-fous ops a formaliser

Ajouter explicitement a la spec prod:
- warmup modele HF au demarrage (optionnel mais recommande)
- retries/timeouts par tier
- cache HF persistant entre redeploiements
- version de cle cache inclut:
  - `alignment_engine`
  - `alignment_engine_version`
  - `model_id`
  - `model_revision`
  - `postprocess_flags`
- lock GPU/concurrence pour eviter collisions CTC/CREPE.

### Definition de done (go/no-go technique)

V2 n'est "done" que si:
- Aucun mot perdu silencieusement dans le regroupement synced
- Quality gate CTC actif avec fallback prouve en test
- Contrat d'unites temporelles couvert par tests automatises
- Abstraction moteur en place (`mms_ctc` remplaçable sans refactor metier)
- Observabilite ajoutee (logs + metriques citees ci-dessus)

---

## References

- [ctc-forced-aligner GitHub](https://github.com/MahmoudAshraf97/ctc-forced-aligner) — CTC forced alignment avec MMS-300M
- [Meta MMS](https://ai.meta.com/blog/multilingual-model-speech-recognition/) — Massively Multilingual Speech (1130 langues)
- [torchaudio forced alignment tutorial](https://pytorch.org/audio/stable/tutorials/forced_alignment_tutorial.html) — Alternative zero-dep
- [WhisperX GitHub](https://github.com/m-bain/whisperX) — Whisper + wav2vec2 (bloque par conflit torch)
- [DALI Dataset](https://github.com/gMusic/DALI) — Dataset de reference alignement paroles chantees
- [LeBenchmark wav2vec2 FR](https://huggingface.co/LeBenchmark) — Modeles wav2vec2 francais (pour fine-tuning futur)
- MIREX Lyrics Alignment — Benchmarks academiques (SOTA: ~150ms AAE post-Demucs)
