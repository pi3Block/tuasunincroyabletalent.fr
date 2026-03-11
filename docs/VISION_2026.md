# VISION 2026 — Kiaraoke, leader analyse vocale IA en France

> Derniere mise a jour : 2026-03-04 (brainstorm session — reorganisation sprints)
> Statut : Sprint 0+1 complete (2026-03-04), Sprint 2 a venir
> Priorite : **Infra GPU → SOTA modeles → Coaching → UX/Partage → Social**

---

## Table des matieres

1. [Positionnement](#1-positionnement)
2. [Analyse concurrentielle](#2-analyse-concurrentielle)
3. [Axes strategiques](#3-axes-strategiques)
4. [Roadmap par phases](#4-roadmap-par-phases)
5. [Metriques de succes](#5-metriques-de-succes)
6. [Decisions a prendre](#6-decisions-a-prendre)
7. [Liens documentation](#7-liens-documentation)

---

## 1. Positionnement

**Vision** : Kiaraoke est la premiere plateforme francaise d'analyse vocale par IA qui compare ta voix a l'artiste original, avec un jury IA personnalise et du coaching vocal technique.

**Marche** : Karaoke apps = ~8.3 Md$ mondial en 2026, Europe ~1 Md$ (13%), CAGR 11%.

**Creneau** : Aucun concurrent francais ne combine separation de source + comparaison pitch a l'original + jury IA + coaching. Le marche est ouvert.

**Differenciateurs uniques** (aucun concurrent ne fait tout ca) :
- Separation vocals user + reference (Demucs → RoFormer)
- Comparaison directe pitch/rhythm/lyrics a l'artiste original
- Jury IA a 3 personas avec feedback qualitatif LLM
- Pipeline GPU self-hosted (pas de cloud dependency)

---

## 2. Analyse concurrentielle

### 2.1 Concurrents directs

| App | Pays | Modele | Ce qu'ils font | Ce qu'ils ne font PAS |
|-----|------|--------|---------------|----------------------|
| **KaraFun** | FR (Lille) | Freemium | 400+ chansons/mois, vocal guides, Vocal Match | Zero analyse vocale IA |
| **MuSigPro** | US | Freemium | Contests IA, score /100, leaderboard | Pas de separation source, pas de comparaison original, scoring basique |
| **Singing Carrots** | US | Freemium | Coach IA 3-tier, pitch real-time, exercices | Pas de comparaison a l'original, pas de jury |
| **SingSharp** | ? | Freemium | Breath detection, Voice Mentor AI, exercices | Pas de comparaison, pas de separation |
| **Smule** | US | Freemium | Duets, effets vocaux, AI voice styles, social | Pas d'analyse vocale profonde |
| **ScreenApp** | ? | Gratuit | Score 1-10 rapide (15-30s), pitch ±5 cents | Pas de comparaison, pas de feedback qualitatif |
| **Moises** | BR | Freemium | Separation IA (30M+ users), pitch changer | Outil, pas d'analyse/scoring |

### 2.2 Matrice de positionnement

```
                    Karaoke/Fun          Analyse/Coaching
                    ───────────────────────────────────────
Social/Community  │ Smule, StarMaker   │ MuSigPro (contests)
                  │ Yokee, ChangBa     │
                  │                    │
Solo/Personal     │ KaraFun            │ ★ KIARAOKE ★
                  │ Moises (outil)     │ Singing Carrots
                  │ Youka              │ SingSharp, Vanido
                  ───────────────────────────────────────
                    Simple               Deep AI
```

**Trajectoire Kiaraoke** : Solo/Deep AI → Social/Deep AI (ajouter leaderboard + contests).

### 2.3 Ce que les concurrents font mieux (a rattraper)

| Feature | Leader | Priorite Kiaraoke |
|---------|--------|-------------------|
| Social/leaderboard | Smule, MuSigPro | **Haute** — viralit |
| Real-time pitch pendant l'enregistrement | Singing Carrots, SingSharp | Haute — deja le hook `usePitchDetection` |
| Gamification (niveaux, progression) | Yousician | Moyenne |
| Breath detection | SingSharp | Moyenne — faisable via analyse enveloppe |
| Catalogue chansons pro | KaraFun (400+/mois) | Basse — YouTube est plus flexible |
| Offline mode | KaraFun | Basse |

---

## 3. Axes strategiques

### Axe A — Qualite d'analyse SOTA (priorite #1)

Objectif : les resultats Kiaraoke sont les plus precis du marche.

| Composant | Actuel | Cible SOTA | Gain |
|-----------|--------|-----------|------|
| **Denoise user** | Aucun | DeepFilterNet3 (CPU) | **Nouveau** : -10-20% WER, +5-10% pitch sur mobile |
| Separation vocale | Demucs htdemucs (~8.5 dB SDR) | Mel-Band RoFormer (~12.9 dB SDR) | +52% SDR |
| **Pitch user + ref** | torchcrepe full/tiny (GPU) | **SwiftF0 (CPU-only)** | **+12% precision, 42x plus rapide, 0 GPU** |
| Score perceptuel | Aucun | UTMOSv2 fine-tune SingMOS-Pro | Nouveau : qualite vocale MOS |
| Contexte musical | Aucun | MERT-v1-95M | Nouveau : key, tempo, emotion |
| Detection erreurs | DTW+WER heuristique | Post-traitement SwiftF0 + STARS (ACL 2025) | Feedback par passage |
| Techniques vocales | Aucun | **STARS** (vibrato, falsetto, breathy, belt) ou post-traitement | Coaching technique |

> **Decouverte brainstorm 2026-03-04** : SwiftF0 (CPU-only, 230x plus petit que CREPE, +12% precision)
> remplace CREPE et libere 1 GPU entier. Change fondamentalement le time-sharing A3B :
> pipeline SOTA = 1 GPU (RoFormer) au lieu de 2 (Demucs + CREPE).
> DeepFilterNet3 (CPU) ameliore la qualite des enregistrements mobiles sans GPU.

Details techniques : voir [docs/SOTA_MODELS.md](SOTA_MODELS.md)

### Axe B — Social et competition

Objectif : rendre Kiaraoke viral en France.

| Feature | Description | Inspiration |
|---------|-------------|-------------|
| Leaderboard par chanson | Classement des meilleurs scores par track Spotify | MuSigPro |
| Contests hebdomadaires | Chanson de la semaine, vote communautaire + score IA | MuSigPro, The Voice |
| Partage resultats | Cards partageables (score + citations jury + avatar) | Instagram Stories |
| Profil utilisateur | Historique, progression, stats vocales, badges | Yousician |
| Duels | Comparer son score a un ami sur la meme chanson | Smule duets |

### Axe C — Jury + Coach vocal IA

Objectif : double valeur — divertissement (jury) + progression (coach).

**Jury (existant, a enrichir)** :
- 3 personas : Le Cassant, L'Encourageant, Le Technique
- Enrichir avec donnees MERT (contexte musical) + UTMOSv2 (qualite perceptuelle)
- Fine-tuning LoRA continu sur les feedbacks valides (Langfuse)

**Coach (nouveau)** :
- Feedback technique par passage (vibrato rate, breath stability, pitch deviation)
- Exercices cibles bases sur les faiblesses detectees
- Suivi de progression (graphes d'evolution par metrique)
- Mode entrainement : re-chanter le meme passage jusqu'a amelioration

### Axe D — Infrastructure GPU time-sharing

Objectif : exploiter les 5 GPUs (44 GB) sans conflit avec les autres services.

Details techniques : voir [docs/GPU_TIMESHARING.md](GPU_TIMESHARING.md)

---

## 4. Roadmap par sprints

> Reorganisee le 2026-03-04 (brainstorm session).
> Priorite : **Infra GPU first** → SOTA modeles → coaching → UX/partage → social.
> Chaque sprint = ~1 semaine. Executable via `/implement <tache>`.

---

### Sprint 0 — Quick fixes infra (1 jour) ✅ COMPLETE (2026-03-04)

> Objectif : debloquer le pipeline actuel, zero changement de modele

- [x] **Fix GROQ_API_KEY** vide dans env worker-heavy Coolify → restaure Whisper Tier 2 + alignment Groq
- [x] **Fix CTC_ALIGN_DEVICE** cuda:1 → cuda:0 dans Coolify env (cuda:1 = A3B shard, crash CTC)
- [x] **Fix ollama@heavy** — `systemctl stop ollama && systemctl disable ollama` (zombie 0 modeles, bloquait port 11434)
- [x] **Unload A3B** — pipeline.py cible maintenant ollama@a3b (port 11439, keep_alive:0) en plus d'Heavy
- [x] Verifier et documenter l'etat reel des 5 GPUs + services Ollama

**Critere de succes** : pipeline analyse fonctionne de bout en bout, jury Groq operationnel, logs propres.

---

### Sprint 1 — GPU time-sharing A3B + SwiftF0 (3-5 jours) ✅ COMPLETE (2026-03-04)

> Objectif : decharger A3B proprement, remplacer CREPE par SwiftF0 (CPU), liberer 1 GPU

#### 1.1 — Unload A3B automatique ✅ (fait en Sprint 0)
- [x] `_unload_ollama_for_demucs()` cible A3B (port 11439, keep_alive:0) + Heavy (port 11434)
- [x] Timeout 30s A3B, 10s Heavy, non-fatal si injoignable

#### 1.2 — SwiftF0 remplace CREPE (pitch CPU-only) ✅
- [x] `swift-f0` remplace `torchcrepe` dans requirements
- [x] `pitch_analysis.py` reecrit avec SwiftF0 (meme interface `do_extract_pitch()`)
- [x] Output identique : NPZ avec arrays `time`, `frequency`, `confidence`
- [x] `fast_mode` et `device` ignores (un seul modele, CPU-only)
- [x] `CREPE_DEVICE` supprime de docker-compose + pipeline.py
- [ ] Benchmark : a faire apres deploiement

#### 1.3 — Reallocation GPU Docker ✅
- [x] `docker-compose.coolify.yml` : 1 GPU (GPU-bdb1f5e4, RTX 3080 10 GB)
- [x] GPU-c99d136d (RTX 3070 8 GB) rendu a A3B
- [x] `CREPE_DEVICE` supprime, `DEMUCS_DEVICE=cuda:0` inchange

**Critere de succes** : pipeline analyse complete en <30s (1er run), pitch CPU en <3s, A3B se recharge en <5s apres analyse. Worker n'utilise qu'1 GPU.

**Impact GPU** :
```
Avant : worker = 2 GPUs (cuda:0 Demucs, cuda:1 CREPE) → A3B sur 3 GPUs
Apres : worker = 1 GPU (cuda:0 Demucs) → A3B sur 4 GPUs ← DONE
```

---

### Sprint 2 — SOTA separation + denoise (3-5 jours)

> Objectif : RoFormer +52% SDR, DeepFilterNet3 denoise, qualite d'analyse best-in-class

#### 2.1 — DeepFilterNet3 pre-processing (CPU) ✅ (2026-03-04)
- [x] Ajouter `deepfilternet` dans `worker/requirements-project.txt`
- [x] Creer `worker/tasks/audio_enhancement.py` — wrapper DeepFilterNet3, lazy load, CPU-only
- [x] Integrer dans `pipeline.py` : appliquer AVANT Demucs sur `user_recording`
- [x] Optionnel : env var `DENOISE_ENABLED=true` (comme `DEBLEED_ENABLED`)
- [ ] Benchmark : WER avant/apres sur 5 enregistrements mobiles bruites

#### 2.2 — BS-RoFormer remplace Demucs ✅ (2026-03-04)
- [x] Ajouter `audio-separator[gpu]` dans `worker/requirements-project.txt`
- [x] Modifier `worker/tasks/audio_separation.py` : RoFormer via `audio-separator`, meme interface in/out
- [x] Modele : `model_bs_roformer_ep_317_sdr_12.9755.ckpt` (SDR 12.97)
- [x] Garder de-bleeding Wiener (sur fichiers WAV post-separation)
- [x] Pattern lazy load singleton (`_roformer_separator = None`)
- [x] Fallback : Demucs auto si RoFormer echoue (`SEPARATION_ENGINE=roformer|demucs`)
- [ ] Benchmark : SDR sur 5 chansons test, temps de separation, VRAM peak

#### 2.3 — Petits modeles d'enrichissement ✅ (2026-03-05)
- [x] Integrer UTMOSv2 — score qualite vocale perceptuel (MOS 1-5)
  - `worker/tasks/vocal_quality.py`, lazy load, ~500 MB GPU
  - Nouveau champ `vocal_quality` dans resultats (mos + mos_100)
- [x] Integrer MERT-v1-95M — extraction features musicales
  - `worker/tasks/music_features.py`, lazy load, ~1 GB GPU
  - Output : `{energy_mean, energy_std, dynamics, tags, ...}`
  - Cache dans storage : `cache/{youtube_id}/mert_features.json`
- [x] Injecter MERT + UTMOSv2 dans prompt jury (`scoring.py`)
- [ ] Benchmark : VRAM peak, latence, qualite feedback jury enrichi

**Critere de succes** : SDR >12 dB, WER ameliore sur mobile, nouveau score MOS visible dans resultats, jury contextualise.

---

### Sprint 3 — Coaching technique + feedback par passage (5-7 jours)

> Objectif : feedback actionnable, pas juste un score global

#### 3.1 — Analyse technique vocale (post-traitement SwiftF0)
- [ ] Implementer dans `worker/tasks/vocal_technique.py` :
  - Vibrato detection (oscillation 5-7 Hz dans F0, extent en cents, regularite %)
  - Breath support (variance pitch sur notes tenues >0.5s, stability score 0-1)
  - Pitch accuracy par phrase (deviation en cents vs reference, aligne par cross-correlation)
  - Onset precision (decalage temporel vs reference par syllabe, ms)
- [ ] Sortie : JSON avec heatmap par passage (timestamp, score, detail)

#### 3.2 — Evaluer STARS (ACL 2025) comme enrichissement
- [ ] Tester STARS sur 3-5 chansons : qualite alignment, detection techniques
- [ ] Si viable : integrer pour vibrato/falsetto/breathy/belt detection
- [ ] Si non viable : rester sur post-traitement SwiftF0 (3.1)

#### 3.3 — Feedback LLM enrichi
- [ ] Enrichir le prompt jury avec : MERT features + UTMOSv2 MOS + techniques vocales
- [ ] Nouveau mode "coach" en plus du "jury" (prompt different, feedback constructif)
- [ ] Exemple : "Sur ce morceau melancolique en la mineur, ton vibrato est irregulier au refrain (4.2 Hz au lieu de 5-6 Hz), et tu arrives 200ms en retard sur le premier couplet."

#### 3.4 — UI resultats detailles
- [ ] Vue heatmap par passage (scrollable, code couleur vert/jaune/rouge)
- [ ] Cliquable pour re-ecouter le passage
- [ ] Score breakdown : 3 jauges separees (pitch, rhythm, lyrics) + MOS + techniques

**Critere de succes** : feedback par passage visible, techniques vocales detectees, jury utilise le contexte musical.

---

### Sprint 4 — UX et partage (3-5 jours)

> Objectif : rendre les resultats partageables, ameliorer l'experience

- [ ] **Score breakdown visuel** — 3 jauges pitch/rhythm/lyrics + MOS (donnees deja calculees)
- [ ] **Partage resultats** — card generee (Canvas/SVG) avec score, extrait jury, pochette Spotify
- [ ] Open Graph meta pour preview Twitter/Instagram/WhatsApp
- [ ] **Real-time pitch overlay** pendant enregistrement (SwiftF0 CPU ou FCPE WASM)
- [ ] Ameliorer la page resultats (design, animations, responsive)

**Critere de succes** : card partageable generee, preview correct sur reseaux sociaux, pitch real-time visible.

---

### Sprint 5 — Features avancees (semaines 8+)

> Objectif : fosse technologique

- [ ] ACE-Step 1.5 — generation backing tracks depuis a cappella (<4 GB GPU)
- [ ] RVC v2 — voice conversion "entends ta voix comme l'artiste" (~4 GB GPU)
- [ ] Mode entrainement — re-chanter un passage en boucle, voir progression
- [ ] Basic Pitch — extraction MIDI depuis vocals (CPU, Spotify open-source)
- [ ] Vocal emotion detection (post-traitement energie/dynamique + MERT)

---

### Sprint 6 — Social et competition (semaines 10+)

> Objectif : viralite, retention — **vient en dernier** (l'analyse doit etre parfaite d'abord)

- [ ] Schema DB : users, scores historiques, leaderboard
- [ ] Authentification (OAuth Google/Apple/email)
- [ ] Leaderboard par chanson (top scores)
- [ ] Profil utilisateur (historique, stats, progression)
- [ ] Contests hebdomadaires (chanson de la semaine)
- [ ] Duels (comparer son score a un ami)

---

## 5. Metriques de succes

### Technique

| Metrique | Actuel | Cible Sprint 1-2 | Cible Sprint 5+ |
|----------|--------|------------------|-----------------|
| SDR separation vocale | ~8.5 dB (Demucs) | ~12.9 dB (RoFormer) | ~13+ dB |
| Precision pitch (RPA) | ~80% (CREPE GPU) | **~92% (SwiftF0 CPU)** | ~92%+ |
| Temps pitch extraction | ~4-5s (CREPE, GPU) | **<1s (SwiftF0, CPU)** | <1s |
| GPUs utilises par pipeline | 2 (Demucs + CREPE) | **1 (RoFormer seul)** | 1-2 |
| Temps pipeline (1er run) | 40-67s | **<25s** | <15s |
| Temps pipeline (cache) | 10-27s | **<8s** | <5s |
| Temps word timestamps | 30-51s | <10s | <5s |
| Score MOS correlation | N/A | >0.85 (UTMOSv2) | >0.90 |
| Qualite denoise mobile | N/A | DeepFilterNet3 PESQ>3.5 | >4.0 |

### Produit

| Metrique | Actuel | Cible 6 mois | Cible 12 mois |
|----------|--------|-------------|--------------|
| Users actifs / semaine | ~0 (beta) | 100 | 1000 |
| Analyses / jour | ~5 | 50 | 500 |
| Retention J7 | ? | 30% | 50% |
| Partages sociaux / jour | 0 | 10 | 100 |
| Note App Store | N/A | 4.0 | 4.5 |

---

## 6. Decisions a prendre

> Ces decisions doivent etre tranchees avant implementation.

### D1 — Modele economique
- [ ] Gratuit avec pub ?
- [ ] Freemium (X analyses gratuites/jour, premium illimite) ?
- [ ] Abonnement (mensuel/annuel) ?
- [ ] Pay-per-analysis ?

### D2 — Authentification
- [ ] Anonyme (actuel) → quand forcer le login ?
- [ ] OAuth providers : Google, Apple, email, Spotify ?
- [ ] Lier le compte Spotify pour enrichir le profil ?

### D3 — Mobile app vs PWA
- [ ] Rester en PWA (web mobile) ?
- [ ] App native (React Native / Capacitor) pour push notifications, offline ?
- [ ] PWA d'abord, app native plus tard ?

### D4 — Langue / marche
- [ ] France only d'abord ?
- [ ] Multilingue des le debut (FR + EN) ?
- [ ] Catalogue de chansons par region ?

### D5 — Nom et branding
- [ ] "Kiaraoke" definitif ?
- [ ] Domaine kiaraoke.fr confirme ?
- [ ] Charte graphique / design system a formaliser ?

---

## 7. Liens documentation

| Document | Role | Statut |
|----------|------|--------|
| [VISION_2026.md](VISION_2026.md) | Strategie globale (ce fichier) | ✅ Actif |
| [SOTA_MODELS.md](SOTA_MODELS.md) | Catalogue modeles SOTA avec specs | ✅ Actif |
| [GPU_TIMESHARING.md](GPU_TIMESHARING.md) | Strategie time-sharing auto GPU | ✅ Actif |
| [ROADMAP.md](ROADMAP.md) | Roadmap implementation detaillee | ⚠️ A mettre a jour |
| [GPU_CAPABILITIES_2026.md](GPU_CAPABILITIES_2026.md) | Inventaire hardware GPU | ✅ Actif |
| [KIARAOKE_IMPROVEMENTS_2026.md](KIARAOKE_IMPROVEMENTS_2026.md) | Fixes urgents post-A3B | ⚠️ Partiellement obsolete |
| [KIARAOKE_IMPROVEMENTS_2026_v2.md](KIARAOKE_IMPROVEMENTS_2026_v2.md) | idem v2 | ⚠️ Partiellement obsolete |
| [GPU_EVOLUTION_A3B.md](GPU_EVOLUTION_A3B.md) | Migration A3B | ⚠️ Historique |

### Commandes Claude disponibles

| Commande | Usage |
|----------|-------|
| `/brainstorm` | Session de brainstorming features/strategie |
| `/sota-check` | Verifier les mises a jour SOTA des modeles |
| `/kiaraoke-roadmap` | Consulter et mettre a jour la roadmap |
| `/debt-report` | Rapport dette technique |
| `/security-audit` | Audit securite |
| `/seo-audit` | Audit SEO |
