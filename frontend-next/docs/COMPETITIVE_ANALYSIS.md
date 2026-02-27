# Analyse Concurrentielle — Karaoke & Analyse Vocale

> Date : 2026-02-26
> Objectif : Identifier les patterns UI/UX desktop des leaders pour informer le redesign de Kiaraoke

---

## Table des matieres

1. [Concurrents analyses](#1-concurrents-analyses)
2. [Patterns UI communs](#2-patterns-ui-communs)
3. [Tendances UI 2025-2026](#3-tendances-ui-2025-2026)
4. [Benchmarks applicables a Kiaraoke](#4-benchmarks-applicables-a-kiaraoke)

---

## 1. Concurrents analyses

### 1.1 Singa — "Netflix du karaoke"

**URL :** https://singa.com
**Positionnement :** Karaoke streaming premium, cross-platform

**Patterns UI desktop :**
- **Navigation 3 onglets en haut** : Discover / Browse / My Library
- **Barre de recherche prominente** en haut de page
- **Player minimisable** en bottom-left, expand/collapse par clic sur la pochette
- **Queue de chansons** en bottom-right avec drag & drop pour reordonner
- **Recherche dans la queue** sans quitter la vue en cours
- **Mode plein ecran** ou pop-out player dans une nouvelle fenetre
- **Raccourcis clavier** : Espace (play/pause), fleches gauche/droite (seek +-10s), fleches haut/bas (volume), Escape (minimize)
- **Profil** en haut a droite

**A retenir :** Le pattern "player bottom-bar minimisable" est devenu le standard (comme Spotify). La navigation par onglets est claire et previsible.

> Source : https://singa.com/blog/meet-the-all-new-singa-web-browser-app/

### 1.2 KaraFun — Karaoke professionnel

**URL :** https://karafun.com
**Positionnement :** Solution karaoke pour Windows/Mac/mobile, catalogue premium

**Patterns UI desktop :**
- **Sidebar redessinee** avec navigation laterale
- **Dark mode automatique** qui s'adapte aux preferences systeme
- **Player contextuel** qui met en avant le morceau en cours avec controles dedies selon l'activite
- **Playlists sync cross-device** (Windows, Mac, Android, iOS)
- **Barre d'espace = play/pause** toujours prioritaire quel que soit le focus
- **Sliders de volume et seek bar** optimises pour la lisibilite
- **Palette de couleurs rafraichie** avec animations subtiles dans la navigation

**A retenir :** Le dark mode automatique + sidebar + player contextuel = experience desktop mature. Les raccourcis clavier (espace = play) sont devenus obligatoires.

> Source : https://www.karafun.com/blog/1460-the-next-generation-of-karafun-discover-the-new-windows-app-and-its-features.html

### 1.3 Moises.ai — Separation vocale IA

**URL :** https://moises.ai
**Positionnement :** Outil musicien IA — separation stems, practice

**Patterns UI desktop :**
- **Bouton "+ New"** pour importer un morceau (upload ou cloud)
- **Choix du type de split** a l'import (Vocals, Instrumental, 4 stems, etc.)
- **Sliders de volume par stem** visibles en permanence apres le processing
- **Panneau lateral droit** contextuel (generation de stems, parametres)
- **Export** via menu 3 points (save to device / share, MP3 / M4A / WAV)
- **Studio et Web App** avec le meme design

**A retenir :** Le pattern "volume par piste avec sliders larges" est exactement ce dont le TrackMixer de Kiaraoke a besoin sur desktop. Le panneau contextuel a droite est un bon pattern pour les controles lyrics/offset.

> Source : https://moises.ai/products/moises-web-app/

### 1.4 Yousician — Apprentissage vocal

**URL :** https://yousician.com
**Positionnement :** Education musicale gamifiee (guitare, piano, chant)

**Patterns UI desktop :**
- **Practice mode / Play mode** — deux modes avec des objectifs differents
- **Pitch visualise en temps reel** avec scroll horizontal (les notes defilent)
- **Multiplicateur de points** (3x → 5x) en haut a gauche — gamification
- **Controles de tempo** avec slider (25% → 125%, pas de 5%)
- **Changement de tonalite** integre
- **Volume voix guide** ajustable + reverb toggle
- **Lyrics en Play mode** pour la collection "Sing Along"

**A retenir :** La gamification (multiplicateur, etoiles) et la visualisation pitch en temps reel sont des patterns forts pour l'engagement. Le controle de tempo/tonalite est un plus que Kiaraoke n'a pas.

> Source : https://support.yousician.com/hc/en-us/articles/360000553289

### 1.5 BandLab — DAW navigateur

**URL :** https://bandlab.com
**Positionnement :** Studio de creation musicale gratuit, navigateur

**Patterns UI desktop :**
- **DAW full-width** — pas de max-width, tout l'ecran est utilise
- **Multitrack horizontal** — chaque piste est une rangee avec waveform
- **Mixer en bas** — panneau repliable
- **Timeline en haut** avec curseur de lecture
- **Sidebar d'instruments/effets** a gauche
- **Splitter AI** pour separer un morceau en stems

**A retenir :** Pour le StudioMode de Kiaraoke, s'inspirer du layout DAW : pistes horizontales, timeline, mixer. Le full-width est important — pas de `max-w-4xl` sur un studio.

> Source : https://blog.bandlab.com/studio-faq/

### 1.6 LALAL.AI — Separation vocale

**URL :** https://lalal.ai
**Positionnement :** Outil simple de separation vocale

**Patterns UI :**
- **Interface drag & drop** centree — upload direct
- **Resultats cote a cote** — stem vocal a gauche, instrumental a droite
- **Players audio inline** pour chaque stem
- **Download direct** par stem

**A retenir :** La simplicite du workflow (upload → resultat cote a cote) est un bon modele pour la page results de Kiaraoke.

---

## 2. Patterns UI communs

### 2.1 Navigation

| Pattern | Utilise par | Pertinence Kiaraoke |
|---------|------------|---------------------|
| **Top nav avec onglets** | Singa, KaraFun | Haute — `/`, `/app`, `/results` |
| **Sidebar** | KaraFun, BandLab | Moyenne — utile si plus de pages |
| **Player bottom-bar** | Singa, Spotify pattern | Haute — pour le TransportBar |
| **Search bar en haut** | Singa, tous | Haute — pour TrackSearch |

### 2.2 Studio / Player

| Pattern | Utilise par | Pertinence Kiaraoke |
|---------|------------|---------------------|
| **Sliders larges par piste** | Moises, BandLab | Haute — TrackMixer |
| **Pistes horizontales** | BandLab, Moises | Moyenne — StudioMode |
| **Timeline / seek bar large** | Tous | Haute — TransportBar |
| **Panneau contextuel lateral** | Moises | Moyenne — LyricsControls |
| **Raccourcis clavier** | Singa, KaraFun | Haute — espace/fleches |

### 2.3 Feedback & Scoring

| Pattern | Utilise par | Pertinence Kiaraoke |
|---------|------------|---------------------|
| **Pitch en temps reel** | Yousician | Deja present (PitchIndicator) |
| **Gamification (etoiles, multiplicateur)** | Yousician | Moyenne — page results |
| **Scores cote a cote** | LALAL.AI (stems) | Haute — jury cards en 3 colonnes |

### 2.4 Theme & Visuel

| Pattern | Utilise par | Pertinence Kiaraoke |
|---------|------------|---------------------|
| **Dark mode par defaut** | Tous | Deja en place |
| **Dark mode auto systeme** | KaraFun | En place via next-themes |
| **Animations subtiles navigation** | KaraFun, Singa | Partiellement (Framer Motion sur landing) |

---

## 3. Tendances UI 2025-2026

### 3.1 Bento-style layouts

Le contenu est divise en blocs visuellement distincts qui ne se chevauchent pas. Ideal pour les dashboards et les pages ou l'utilisateur doit traiter beaucoup d'information sans se sentir submerge.

**Application Kiaraoke :** Page results en grille bento — score global en haut, 3 jury cards en colonnes, StudioMode en bas pleine largeur.

> Source : https://www.bootstrapdash.com/blog/ui-ux-design-trends

### 3.2 Glassmorphism

Effet verre depoli avec transparence et `backdrop-blur`. Utilise dans les dashboards, overlays et panneaux.

**Application Kiaraoke :** Overlay lyrics en `backdrop-blur` sur la video en mode desktop immersif. Header navbar avec glassmorphism.

> Source : https://shakuro.com/blog/ui-ux-design-trends-for-2025

### 3.3 Dark mode contextuel

Le dark mode ne se contente plus d'inverser les couleurs — il s'adapte au contexte, ameliorant la lisibilite et reduisant la fatigue oculaire.

**Application Kiaraoke :** Deja en place avec next-themes. Ajouter un toggle visible dans la navbar.

### 3.4 Micro-interactions

Hover states, transitions de page fluides, feedback visuel sur chaque action.

**Application Kiaraoke :** Hover sur les cards de resultats, transitions entre les etats de la state machine, feedback sonore optionnel.

> Source : https://www.lummi.ai/blog/ui-design-trends-2025

### 3.5 Dashboards adaptatifs

Les dashboards integrent de plus en plus l'IA pour mettre en avant les patterns et suggerer des actions. Les rapports statiques deviennent des experiences dynamiques et interactives.

**Application Kiaraoke :** Les commentaires jury sont deja generes par IA. Ajouter des recommandations d'amelioration basees sur les scores (ex: "Travaille ta justesse sur le refrain").

> Source : https://cygnis.co/blog/web-app-ui-ux-best-practices-2025/

---

## 4. Benchmarks applicables a Kiaraoke

### Ce que Kiaraoke fait bien

- Dark mode par defaut (tous les concurrents font pareil)
- Separation vocale Demucs (meme tech que Moises)
- Pitch detection temps reel (comme Yousician)
- Lyrics synchronisees mot a mot (comme Singa/KaraFun)
- Jury IA 3 personas (unique — aucun concurrent ne fait ca)

### Ce que Kiaraoke ne fait pas (et que les concurrents font)

| Manque | Qui le fait | Priorite |
|--------|------------|----------|
| Navbar desktop avec recherche integree | Singa, KaraFun, tous | Critique |
| Player bottom-bar minimisable | Singa, Spotify | Haute |
| Raccourcis clavier (espace, fleches) | Singa, KaraFun | Haute |
| Sliders de volume larges par piste | Moises, BandLab | Haute |
| Layout studio horizontal (DAW-like) | BandLab | Moyenne |
| Queue de morceaux | Singa | Basse (single-session) |
| Controle tempo/tonalite | Yousician | Basse (complexe) |
| Gamification (etoiles, badges) | Yousician | Basse |

### Avantage competitif unique de Kiaraoke

**3 personas jury IA** avec des personnalites distinctes. Aucun concurrent n'offre un feedback aussi personnalise et divertissant. C'est le differenciateur cle — la page results doit etre spectaculaire et mettre ce contenu en valeur avec un layout desktop digne de ce contenu.
