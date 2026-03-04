# VISION 2026 — Kiaraoke, leader analyse vocale IA en France

> Derniere mise a jour : 2026-03-04
> Statut : STRATEGIE — Aucune implementation commencee

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
| Separation vocale | Demucs htdemucs (~8.5 dB SDR) | Mel-Band RoFormer (~12.9 dB SDR) | +52% SDR |
| Pitch user | torchcrepe full | RMVPE | +precis sur chant, +rapide |
| Pitch reference | torchcrepe tiny | FCPE (torchfcpe) | 77x plus rapide |
| Score perceptuel | Aucun | UTMOSv2 fine-tune SingMOS-Pro | Nouveau : qualite vocale MOS |
| Contexte musical | Aucun | MERT-v1-95M | Nouveau : key, tempo, emotion |
| Detection erreurs | DTW+WER heuristique | DL-based (frequency/amplitude/pronunciation) | Feedback par passage |
| Techniques vocales | Aucun | Post-traitement pitch (vibrato, breath, formant) | Coaching technique |

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

## 4. Roadmap par phases

### Phase 1 — Fondations SOTA (semaines 1-3)

> Objectif : pipeline d'analyse best-in-class, zero changement UX

- [ ] Fix `CTC_ALIGN_DEVICE=cuda:1` dans Coolify env (5 min)
- [ ] Remplacer Demucs htdemucs → Mel-Band RoFormer (`audio-separator`)
- [ ] Remplacer torchcrepe full → RMVPE (pitch user)
- [ ] Remplacer torchcrepe tiny → FCPE (pitch reference)
- [ ] Integrer UTMOSv2 — score qualite vocale perceptuel
- [ ] Integrer MERT-v1-95M — extraction features musicales (key, tempo, emotion)
- [ ] Mettre a jour le scoring pour inclure les nouvelles metriques
- [ ] Implémenter GPU time-sharing auto (unload A3B → load Kiaraoke models)
- [ ] Benchmarker : temps pipeline, SDR, precision pitch, MOS correlation

### Phase 2 — Coaching technique (semaines 4-6)

> Objectif : feedback actionnable par passage

- [ ] Analyse vibrato (rate Hz, extent cents, regularite) depuis pitch RMVPE
- [ ] Analyse breath support (stabilite pitch sur notes tenues)
- [ ] Detection erreurs par passage (pitch, amplitude, prononciation)
- [ ] Feedback LLM enrichi (donnees MERT + UTMOSv2 + technique dans le prompt)
- [ ] UI : vue detaillee par passage (scrollable, cliquable pour re-ecouter)

### Phase 3 — Social et competition (semaines 7-10)

> Objectif : viralit, retention

- [ ] Schema DB : users, scores historiques, leaderboard
- [ ] Authentification (OAuth Google/Apple/email)
- [ ] Leaderboard par chanson (top scores)
- [ ] Profil utilisateur (historique, stats, progression)
- [ ] Partage resultats (cards generees, Open Graph pour preview)
- [ ] Contests hebdomadaires (chanson de la semaine)

### Phase 4 — Features avancees (semaines 11+)

> Objectif : fossé technologique infranchissable

- [ ] ACE-Step 1.5 — generation backing tracks depuis a cappella (<4 GB)
- [ ] RVC v2 — voice conversion ("entends ta voix comme l'artiste")
- [ ] Mode entrainement — re-chanter un passage, voir progression
- [ ] Real-time pitch overlay pendant l'enregistrement (FCPE, RTF 0.006)
- [ ] Basic Pitch — extraction MIDI depuis vocals (Spotify open-source)
- [ ] Vocal emotion detection (expression dans le chant)

---

## 5. Metriques de succes

### Technique

| Metrique | Actuel | Cible Phase 1 | Cible Phase 4 |
|----------|--------|--------------|--------------|
| SDR separation vocale | ~8.5 dB | ~12.9 dB | ~13+ dB |
| Precision pitch (RPA) | ~80% (CREPE) | ~87% (RMVPE) | ~90%+ |
| Temps pipeline (1er run) | 40-67s | <20s | <15s |
| Temps pipeline (cache) | 10-27s | <8s | <5s |
| Temps word timestamps | 30-51s | <10s | <5s |
| Score MOS correlation | N/A | >0.85 | >0.90 |

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
