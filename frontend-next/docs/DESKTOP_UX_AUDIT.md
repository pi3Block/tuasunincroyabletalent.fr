# Audit UX/UI Desktop — Kiaraoke

> Date : 2026-02-26
> Scope : frontend-next (Next.js 15 / React 19)
> Methode : lecture exhaustive de chaque composant, analyse responsive breakpoint par breakpoint

---

## Table des matieres

1. [Problemes globaux](#1-problemes-globaux)
2. [Landing page](#2-landing-page)
3. [Page /app — Session interactive](#3-page-app--session-interactive)
4. [Systeme Lyrics](#4-systeme-lyrics)
5. [Systeme Audio (StudioMode)](#5-systeme-audio-studiomode)
6. [Matrice de severite](#6-matrice-de-severite)

---

## 1. Problemes globaux

### 1.1 Zoom navigateur desactive (WCAG violation)

**Fichier :** `src/app/layout.tsx:12-16`

```ts
export const viewport: Viewport = {
  maximumScale: 1,
  userScalable: false,  // bloque Ctrl+scroll et pinch-to-zoom
};
```

- **Impact :** Les utilisateurs desktop ne peuvent plus zoomer (Ctrl++ / Ctrl+scroll). Violation WCAG 1.4.4.
- **Fix :** Supprimer `maximumScale` et `userScalable`. Si necessaire sur mobile (eviter le zoom sur focus input), utiliser `touch-action: manipulation` en CSS plutot qu'un meta viewport restrictif.

### 1.2 Aucune navigation persistante

Aucune page n'a de navbar desktop. Pas de logo cliquable, pas de liens de navigation, pas de theme toggle visible.

- **Landing page :** Zero navigation. Le seul CTA est le bouton hero.
- **Page /app :** Un header centre avec le texte "Kiaraoke" et un lien "Retour" visible uniquement en mode `selecting`. Dans tous les autres etats (recording, analyzing, results), aucun moyen de revenir a l'accueil.
- **Page /results/[id] :** Aucune navigation du tout.

### 1.3 Pas de conteneur global unifie

`src/app/page.tsx:13` : `<main>` sans `max-width`. Chaque section definit son propre `max-w-*` :

| Section | max-width |
|---------|-----------|
| Hero | `max-w-4xl` (896px) |
| How It Works | `max-w-6xl` (1152px) |
| Tech Stack | `max-w-6xl` (1152px) |
| Recent Performances | `max-w-6xl` (1152px) |
| Footer | `max-w-6xl` (1152px) |

Le contenu saute de 896px a 1152px entre le hero et la section suivante. Sur un ecran 1440px, c'est visuellement incoherent.

### 1.4 Classes de couleur `primary-*` inexistantes

**Fichier :** `src/app/app/page.tsx:568`

```tsx
className="bg-gradient-to-r from-primary-600 to-primary-500"
```

`globals.css` definit `--primary` comme une seule variable CSS (pas une palette `-100` a `-900`). Les classes `primary-600`, `primary-500`, `primary-100` ne resolvent a rien. Le header de `/app` n'a probablement aucun gradient visible. Meme probleme pour `bg-primary-500`, `ring-primary-500`, `text-primary-100` utilises ailleurs dans le fichier.

---

## 2. Landing page

### 2.1 Hero — `src/components/sections/hero.tsx`

| Probleme | Ligne | Detail | Severite |
|----------|-------|--------|----------|
| Titre plafonne a `lg:text-7xl` | 90 | Pas de `xl:text-8xl` ni `2xl:text-9xl`. 72px sur un ecran 2560px parait petit | Moyenne |
| Stats capees a `max-w-md` (448px) | 311 | Grid 3 colonnes dans 448px sur un ecran 1440px — minuscule et decentre par rapport au titre au-dessus | Haute |
| Micro anime `md:w-40 md:h-40` max | 119 | 160x160px fixe au-dela de `md`. Petit sur grand ecran | Basse |
| Blobs background en pixels fixes | 23,33,42 | `w-[600px]`, `w-[500px]`, `w-[400px]` — ne scalent pas. Clairsemes sur ecran 2K+ | Basse |
| CTA button unique sans second CTA | ~250 | Un seul bouton "Commence maintenant". Pas de lien secondaire "En savoir plus" ou "Voir une demo" comme les concurrents | Moyenne |

### 2.2 How It Works — `src/components/sections/how-it-works.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Max 3 colonnes (`lg:grid-cols-3`) | 215 | 6 etapes en 2 lignes. Sur un ecran `xl`, pourrait etre 6 colonnes en une ligne |
| Connecteurs entre etapes de 8px (`w-8`) | 122 | Visibles uniquement a `lg:`. Ne scalent pas avec le gap entre les cards |
| Icones a taille fixe `w-12 h-12` | ~varies | Pas de scaling `lg:w-16 lg:h-16` |

### 2.3 Recent Performances — `src/components/sections/recent-performances.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Carousel avec math pixel hardcodes | 312-313 | `x: -currentIndex * (320 + 24)` — ne correspond pas si les cards s'elargissent |
| Pas d'indicateur de quantite sur desktop | ~325 | Les dots de pagination sont `md:hidden`. Desktop n'a aucune indication du nombre total d'items |
| Pas de visual overflow hint | 309 | `overflow-hidden` sans fade-out aux bords ni card partielle visible |
| Cards a `min-w-[320px]` ne grandissent pas | ~290 | Les cards ne remplissent pas l'espace disponible. Pas de `flex-1` |

### 2.4 Tech Stack — `src/components/sections/tech-stack.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Stats bar `text-2xl md:text-3xl` sans `lg:` | ~295 | Les chiffres (< 60s, 5 IA, etc.) ne scalent plus apres `md` |

### 2.5 Footer — `src/components/layout/footer.tsx`

Le footer est correct (`max-w-6xl`, `flex-col md:flex-row`). Seule incoherence : `max-w-6xl` vs hero `max-w-4xl`.

---

## 3. Page /app — Session interactive

### 3.1 Header app sans navigation

**Fichier :** `src/app/app/page.tsx:567-575`

```tsx
<header className="bg-gradient-to-r from-primary-600 to-primary-500 p-4 text-center">
  <Link href="/">Kiaraoke</Link>
  <p>Fais-toi juger par l'IA !</p>
</header>
```

- Centre (pas de layout logo-gauche / nav-droite)
- Gradient probablement invisible (classes `primary-600/500` inexistantes)
- Pas de bouton retour/home dans les etats non-`selecting`
- Pas de theme toggle

### 3.2 Etat SELECTING — Recherche

**Fichier :** `src/components/app/TrackSearch.tsx`

| Probleme | Detail |
|----------|--------|
| `max-h-96` (384px) sur les resultats | Sur un ecran 1080p, seuls 4-5 resultats visibles. Le reste necessite du scroll |
| Layout single-column | Pas de layout 2 colonnes (recherches recentes a gauche, resultats a droite) sur desktop |
| Items de resultat en `p-3` avec `h-14` d'album art | Sizing touch (80px par row). Sur desktop, `md:p-2` serait plus dense et montrerait plus de resultats |
| Input `w-full` sans max-width | Etire a 896px (`max-w-4xl` du parent). Un input de recherche de 896px est trop large — 500px max est le standard |

### 3.3 Etat READY — Video + Lyrics

**Fichier :** `src/app/app/page.tsx:790-898`

```tsx
<div className="flex flex-col lg:flex-row gap-6">
  <div className="flex-1"> {/* Video */}
  <div className="flex-1"> {/* Lyrics */}
```

| Probleme | Detail |
|----------|--------|
| Video 50% / Lyrics 50% | Pas de ratio ajustable. La video (16:9 dans un container 50%) est grande mais la zone lyrics a cote n'a que 450px de hauteur |
| Bouton "Enregistrer" `w-full py-5 text-xl rounded-full` | Dans une colonne de ~650px, ce bouton est enorme. Devrait etre `lg:max-w-sm lg:mx-auto` |
| TrackCard `w-full` sans `max-w` | La card album art + info s'etire a toute la largeur de la colonne (650px) — trop de whitespace |
| Info bar YouTube visible sur desktop | `bg-gray-800 p-3` sous le player affiche titre + channel. Redondant avec les controles YouTube integres |

### 3.4 Etat RECORDING

| Probleme | Detail |
|----------|--------|
| `PitchIndicator` sans scaling desktop | La barre de pitch `w-full` fonctionne mais le volume meter `w-16 h-2` est minuscule |
| `LandscapeRecordingLayout` s'active sur laptops | `useOrientation` utilise `smallerDimension < 768`. Un laptop 1280x720 (courant en mode fenetre) declenche le layout mobile plein ecran (`fixed inset-0 z-50`) — **bug critique** |

### 3.5 Etat ANALYZING

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Progress bar `max-w-xs` (320px) | 1024 | Minuscule et perdue au centre d'un grand ecran |
| Pas de detail des etapes visible | — | Le `analysisProgress.step` est affiche mais le texte est petit (`text-sm`). Sur desktop, pourrait etre un stepper visuel horizontal |

### 3.6 Etat RESULTS

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Tout cappe a `max-w-4xl` (896px) | 1047 | Pas de `xl:` ni `2xl:` breakpoint |
| Score cards en `grid-cols-3` avec `p-3 text-2xl` | 1059 | Compact. Pas de `lg:p-6 lg:text-3xl` |
| Jury cards empilees verticalement | ~1070 | 3 personas en colonne. Devrait etre `lg:grid-cols-3` cote a cote |
| StudioMode empile aussi | — | Pourrait profiter de la largeur desktop |

### 3.7 Etat NEEDS_FALLBACK

| Probleme | Detail |
|----------|--------|
| Input YouTube URL `w-full` + bouton `w-full` | Pourraient etre side-by-side (`md:flex md:flex-row md:gap-3`) |

### 3.8 Layout du /app — `src/app/app/layout.tsx`

Le layout est un pass-through (`return children`). Pas de wrapper commun fournissant max-width, background, ou responsive container. Chaque etat gere sa largeur independamment → inconsistances documentees ci-dessus.

---

## 4. Systeme Lyrics

### 4.1 LyricsDisplayPro — `src/components/lyrics/LyricsDisplayPro.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| ScrollArea capped `lg:h-[450px]` | 532 | Sur 1080p, un ecran peut afficher 12-15 lignes. A 450px, seules 5-6 lignes visibles. Manque `xl:h-[600px] 2xl:h-[700px]` |
| Padding stops at `md:px-10 md:py-10` | 536 | Pas de `lg:px-16` pour respirer sur grand ecran |
| Header controls bar peut overflow | 489-527 | `LyricsControls` en `flex-wrap` peut pousser les fleches de navigation hors alignement |

### 4.2 LyricsControls — `src/components/lyrics/LyricsControls.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| `defaultExpanded: false` partout | 107 | Sur desktop, l'espace est abondant. Les controles devraient etre ouverts par defaut a `lg:` |
| Quick steps +-30s sont `hidden md:flex` | ~180 | Bien, mais le layout des boutons ne scale pas au-dela de `md` |

### 4.3 LyricLine — `src/components/lyrics/LyricLine.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Active line s'arrete a `lg:text-3xl` (30px) | 131 | Pas de `xl:text-4xl`. Sur un grand ecran avec un ScrollArea plus haut, une typo plus grande serait plus impactante |

---

## 5. Systeme Audio (StudioMode)

### 5.1 StudioMode — `src/audio/components/StudioMode.tsx`

- Layout toujours en `space-y-4` (vertical stack)
- Pas de `lg:flex lg:flex-row` pour disposer TransportBar et TrackMixer cote a cote
- Header card + TransportBar + TrackMixer empiles meme sur un ecran 1440px

### 5.2 TransportBar — `src/audio/components/TransportBar.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Bouton play `h-16 w-16` (64px) | 127 | Touch-sized. Standard desktop : 40-44px. Manque `lg:h-10 lg:w-10` |
| Boutons secondaires `h-12 w-12` (48px) | ~150 | Idem, oversized pour desktop |
| Spacer fantome `h-12 w-12` a droite | 162 | Div vide pour "balancer" le layout. Un `justify-center` propre eliminerait le besoin |

### 5.3 TrackMixer — `src/audio/components/TrackMixer.tsx`

| Probleme | Ligne | Detail |
|----------|-------|--------|
| Master volume slider `w-24` (96px) | 120 | Trop court pour un controle precis a la souris. Desktop standard : 200-300px |
| Pas de layout horizontal pour les tracks | — | Toutes les pistes empilees verticalement. Sur desktop, un layout multi-colonnes (ref tracks a gauche, user tracks a droite) serait plus intuitif |

### 5.4 AudioTrack — `src/audio/components/AudioTrack.tsx`

- Les boutons M(ute), S(olo), Download sont compacts (`text-xs`) pour mobile
- Pas de labels texte desktop (`md:` pourrait ajouter "Mute", "Solo" a cote des icones)

---

## 6. Matrice de severite

### Critique (casse l'experience desktop)

| # | Issue | Composant |
|---|-------|-----------|
| C1 | `userScalable: false` bloque le zoom | layout.tsx |
| C2 | `LandscapeRecordingLayout` sur laptops 720p | useOrientation.ts |
| C3 | `primary-600/500/100` inexistantes | app/page.tsx |
| C4 | Lyrics coupees a 450px | LyricsDisplayPro.tsx |

### Haute (UX mediocre)

| # | Issue | Composant |
|---|-------|-----------|
| H1 | Aucune navbar desktop | Global |
| H2 | Recherche `max-h-96` + single-column | TrackSearch.tsx |
| H3 | Resultats jury en colonne unique | app/page.tsx (results) |
| H4 | Bouton "Enregistrer" `w-full` 650px | app/page.tsx (ready) |
| H5 | LyricsControls collapsed sur desktop | LyricsControls.tsx |
| H6 | StudioMode/Transport/Mixer sans layout desktop | audio/components/* |

### Moyenne (polish)

| # | Issue | Composant |
|---|-------|-----------|
| M1 | `max-w` inconsistant (4xl vs 6xl) | Landing sections |
| M2 | Hero stats `max-w-md` trop etroit | hero.tsx |
| M3 | Typo hero sans `xl:` scaling | hero.tsx |
| M4 | Carousel math hardcode | recent-performances.tsx |
| M5 | Transport buttons oversized (64px) | TransportBar.tsx |
| M6 | Volume slider `w-24` trop court | TrackMixer.tsx |
| M7 | Progress bar analyse `max-w-xs` | app/page.tsx (analyzing) |
| M8 | YouTube info bar redondante | YouTubePlayer.tsx |
