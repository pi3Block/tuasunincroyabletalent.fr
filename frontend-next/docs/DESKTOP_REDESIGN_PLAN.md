# Plan de Redesign Desktop — Kiaraoke

> Date : 2026-02-26
> Base : [DESKTOP_UX_AUDIT.md](./DESKTOP_UX_AUDIT.md) + [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md)

---

## Table des matieres

1. [Principes de design](#1-principes-de-design)
2. [Tier 1 — Quick fixes](#2-tier-1--quick-fixes)
3. [Tier 2 — Desktop layout redesign](#3-tier-2--desktop-layout-redesign)
4. [Tier 3 — Polish et coherence](#4-tier-3--polish-et-coherence)
5. [Fichiers impactes par tier](#5-fichiers-impactes-par-tier)
6. [Maquettes ASCII](#6-maquettes-ascii)

---

## 1. Principes de design

| Principe | Application |
|----------|------------|
| **Mobile-first, desktop-enhanced** | Garder le mobile intact, ajouter des breakpoints `lg:` et `xl:` |
| **Conteneur unifie** | `max-w-7xl` (1280px) pour `/app`, `max-w-6xl` (1152px) pour le landing |
| **Densite adaptative** | Plus compact sur desktop (items de liste, boutons, sliders) |
| **Espace = respiration** | Plus de padding, plus de gap, typo plus grande sur grand ecran |
| **Coherence** | Un seul `max-w` par page, une seule navbar, un theme unifie |

---

## 2. Tier 1 — Quick fixes

> Impact immediat, changements localises, pas de nouveau composant.

### 2.1 Supprimer le blocage de zoom

**Fichier :** `src/app/layout.tsx`
**Changement :**

```diff
 export const viewport: Viewport = {
   width: "device-width",
   initialScale: 1,
-  maximumScale: 1,
-  userScalable: false,
   themeColor: "#ef4444",
 };
```

**Raison :** WCAG 1.4.4. Les utilisateurs desktop doivent pouvoir zoomer. Le `touch-action: manipulation` dans `globals.css` (deja present via `-webkit-tap-highlight-color: transparent` + classes `touch-manipulation`) empeche le zoom involontaire sur mobile.

---

### 2.2 Fixer le seuil landscape mobile

**Fichier :** `src/hooks/useOrientation.ts`
**Changement :**

```diff
- const isMobile = smallerDimension < 768;
+ const isMobile = smallerDimension < 640;
```

**Raison :** 768px exclut les tablettes mais inclut les laptops en mode fenetre (1280x720 est un viewport courant). 640px est le breakpoint `sm` de Tailwind — tout ce qui est au-dessus est "non-mobile".

---

### 2.3 Definir la palette primary dans globals.css

**Fichier :** `src/app/globals.css`
**Changement :** Ajouter dans `@theme inline {}` :

```css
/* Primary scale pour les gradients et etats */
--color-primary-50: oklch(0.985 0 0);
--color-primary-100: oklch(0.95 0 0);
--color-primary-200: oklch(0.9 0 0);
--color-primary-300: oklch(0.85 0 0);
--color-primary-400: oklch(0.7 0 0);
--color-primary-500: oklch(0.556 0 0);
--color-primary-600: oklch(0.45 0 0);
--color-primary-700: oklch(0.35 0 0);
--color-primary-800: oklch(0.269 0 0);
--color-primary-900: oklch(0.205 0 0);
```

**Alternative :** Remplacer les classes `primary-600/500/100` dans `app/page.tsx` par des classes existantes :
```diff
- className="bg-gradient-to-r from-primary-600 to-primary-500 p-4 text-center"
+ className="bg-gradient-to-r from-gray-800 to-gray-700 p-4 text-center border-b border-border"
```

---

### 2.4 Agrandir les lyrics sur desktop

**Fichier :** `src/components/lyrics/LyricsDisplayPro.tsx`
**Changement :**

```diff
- <ScrollArea className={scrollAreaClassName || "h-[300px] md:h-[400px] lg:h-[450px]"}>
+ <ScrollArea className={scrollAreaClassName || "h-[300px] md:h-[400px] lg:h-[500px] xl:h-[600px] 2xl:h-[700px]"}>
```

---

### 2.5 Agrandir la zone de recherche sur desktop

**Fichier :** `src/components/app/TrackSearch.tsx`
**Changement :**

```diff
- <div className="space-y-2 max-h-96 overflow-y-auto">
+ <div className="space-y-2 max-h-96 lg:max-h-[600px] overflow-y-auto">
```

---

### 2.6 Lyrics controls ouverts par defaut sur desktop

**Fichier :** `src/components/lyrics/LyricsDisplayPro.tsx`
**Changement :** Passer `defaultExpanded` conditionnellement :

```tsx
// Dans le composant, detecter desktop
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

<LyricsControls
  defaultExpanded={isDesktop}
  // ... other props
/>
```

---

### 2.7 Bouton "Enregistrer" contraint sur desktop

**Fichier :** `src/app/app/page.tsx`
**Changement :**

```diff
- className="w-full bg-red-500 hover:bg-red-600 ... py-5 px-10 text-xl rounded-full"
+ className="w-full lg:max-w-sm lg:mx-auto bg-red-500 hover:bg-red-600 ... py-5 lg:py-3 px-10 text-xl lg:text-lg rounded-full"
```

---

### 2.8 Progress bar analyse plus large

**Fichier :** `src/app/app/page.tsx`
**Changement :**

```diff
- <div className="h-2 bg-gray-700 rounded-full overflow-hidden max-w-xs mx-auto">
+ <div className="h-2 bg-gray-700 rounded-full overflow-hidden max-w-xs md:max-w-sm lg:max-w-md mx-auto">
```

---

## 3. Tier 2 — Desktop layout redesign

> Nouveaux composants et restructurations de layout.

### 3.1 Creer un composant Navbar

**Nouveau fichier :** `src/components/layout/navbar.tsx`

**Structure :**

```
Desktop (lg:) :
┌──────────────────────────────────────────────────────────┐
│ [Logo]   Accueil   Studio          [ThemeToggle] [User]  │
└──────────────────────────────────────────────────────────┘

Mobile :
┌──────────────────────────────────────────────────────────┐
│ [Logo]                                      [Hamburger]  │
└──────────────────────────────────────────────────────────┘
```

**Specs :**
- Sticky `top-0 z-40`
- Hauteur `h-14`
- `backdrop-blur-xl bg-background/80 border-b border-border` (glassmorphism)
- Logo a gauche (`<Link href="/">Kiaraoke</Link>`)
- Liens au centre : Accueil (`/`), Studio (`/app`)
- Theme toggle a droite (composant `ThemeToggle` avec `useTheme()`)
- Hamburger mobile avec Sheet (shadcn) pour le menu

**Integration :**
- Landing : dans `page.tsx` au-dessus de `<HeroSection />`
- App : remplace le `<header>` actuel dans `app/page.tsx`
- Results : dans `results/[sessionId]/page.tsx`

---

### 3.2 Redesign page results en layout bento

**Fichier :** `src/app/app/page.tsx` — section results

**Layout actuel :**
```
[Score Cards - 3 cols]
[Jury Card 1]
[Jury Card 2]
[Jury Card 3]
[StudioMode]
```

**Layout propose (desktop) :**
```
┌─────────────────────────────────────────────────────┐
│              Score Global  87/100                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Justesse │  │  Rythme  │  │ Paroles  │          │
│  │   82%    │  │   90%    │  │   88%    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
├─────────────┬──────────────┬────────────────────────┤
│  Jury 1     │   Jury 2     │    Jury 3              │
│  [Avatar]   │   [Avatar]   │    [Avatar]            │
│  Commentaire│   Commentaire│    Commentaire         │
│  ...        │   ...        │    ...                  │
├─────────────┴──────────────┴────────────────────────┤
│                  StudioMode                          │
│  [TransportBar]                                      │
│  [TrackMixer - pleine largeur]                       │
└─────────────────────────────────────────────────────┘
```

**Changements :**
```diff
- <div className="space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
+ <div className="space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-6xl">

  {/* Jury cards */}
- <div className="space-y-4">
+ <div className="space-y-4 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">

  {/* Score cards */}
- <div className="grid grid-cols-3 gap-3">
+ <div className="grid grid-cols-3 gap-3 lg:gap-6">
    <ScoreCard ... className="lg:p-6 lg:text-3xl" />
```

---

### 3.3 Redesign StudioMode pour desktop

**Fichier :** `src/audio/components/StudioMode.tsx`

**Layout actuel :**
```
[Header Card]
[TransportBar]
[TrackMixer]
```

**Layout propose (desktop) :**
```
┌──────────────────────────────────────────────┐
│ Header: Titre + status                        │
├──────────────┬───────────────────────────────┤
│ TransportBar │  TrackMixer                    │
│              │  ┌───────────────────────────┐ │
│  [<<] [>] [>>] │  Ref Vocals   [---====--] │ │
│              │  Ref Instr.   [---====--]    │ │
│  00:00/03:20 │  User Vocals  [---======]   │ │
│              │  User Instr.  [---====--]    │ │
│              │  ┌───────────────────────────┐ │
│              │  Master       [---======]    │ │
│              └───────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Changements :**
```diff
  <div className="space-y-4">
+ {/* Desktop: side-by-side */}
+ <div className="lg:flex lg:gap-6">
    <TransportBar ... />
-   <TrackMixer ... />
+   <div className="lg:flex-1">
+     <TrackMixer ... />
+   </div>
+ </div>
```

---

### 3.4 TransportBar compact sur desktop

**Fichier :** `src/audio/components/TransportBar.tsx`
**Changements :**

```diff
  {/* Bouton play */}
- <button className="h-16 w-16 rounded-full ...">
+ <button className="h-16 w-16 lg:h-12 lg:w-12 rounded-full ...">

  {/* Boutons skip */}
- <button className="h-12 w-12 rounded-full ...">
+ <button className="h-12 w-12 lg:h-9 lg:w-9 rounded-full ...">

  {/* Supprimer le spacer fantome */}
- <div className="h-12 w-12" />
```

---

### 3.5 TrackMixer sliders elargis

**Fichier :** `src/audio/components/TrackMixer.tsx`
**Changements :**

```diff
  {/* Master volume */}
- <div className="w-24">
+ <div className="w-24 lg:w-48 xl:w-64">

  {/* Layout tracks */}
+ <div className="lg:grid lg:grid-cols-2 lg:gap-4">
    {/* Ref tracks group */}
    {/* User tracks group */}
+ </div>
```

---

### 3.6 Recherche 2 colonnes sur desktop

**Fichier :** `src/components/app/TrackSearch.tsx`

**Layout propose :**
```
Desktop (lg:) :
┌────────────────────────────────────────────┐
│  [🔍 Recherche...]                          │
├───────────────────┬────────────────────────┤
│  Recherches       │  Resultats             │
│  recentes         │                        │
│                   │  [Album] Titre - Artiste│
│  [x] Track 1     │  [Album] Titre - Artiste│
│  [x] Track 2     │  [Album] Titre - Artiste│
│  [x] Track 3     │  ...                    │
└───────────────────┴────────────────────────┘
```

**Changements :**
```diff
+ {/* Desktop: 2 colonnes */}
+ <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-6">
    {/* Recent tracks (colonne gauche sur desktop) */}
+   <div className="lg:order-1">
      {recentTracks...}
+   </div>
    {/* Search results (colonne droite sur desktop) */}
+   <div className="lg:order-2">
      {searchResults...}
+   </div>
+ </div>
```

---

### 3.7 YouTube info bar masquee sur desktop

**Fichier :** `src/components/app/YouTubePlayer.tsx`
**Changement :**

```diff
- <div className="bg-gray-800 p-3">
+ <div className="bg-gray-800 p-3 lg:hidden">
```

---

### 3.8 Raccourcis clavier

**Nouveau fichier :** `src/hooks/useKeyboardShortcuts.ts`

**Raccourcis :**
| Touche | Action |
|--------|--------|
| `Space` | Play/pause (video ou audio player actif) |
| `ArrowLeft` | Seek -10s |
| `ArrowRight` | Seek +10s |
| `ArrowUp` | Volume +5% |
| `ArrowDown` | Volume -5% |
| `Escape` | Retour / fermer overlay |

**Implementation :**
```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Ne pas intercepter si focus dans un input/textarea
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlayback();
        break;
      case 'ArrowLeft':
        seek(-10);
        break;
      // ...
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

---

## 4. Tier 3 — Polish et coherence

### 4.1 Unifier max-width sur le landing

**Fichiers :** `hero.tsx`, `how-it-works.tsx`, `tech-stack.tsx`, `recent-performances.tsx`

```diff
  {/* Hero */}
- <div className="max-w-4xl mx-auto">
+ <div className="max-w-6xl mx-auto">

  {/* Stats */}
- <div className="max-w-md mx-auto">
+ <div className="max-w-2xl mx-auto">
```

### 4.2 Hero responsive typography

**Fichier :** `src/components/sections/hero.tsx`

```diff
- <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold">
+ <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold">

  {/* Micro anime */}
- <div className="w-32 h-32 md:w-40 md:h-40">
+ <div className="w-32 h-32 md:w-40 md:h-40 lg:w-48 lg:h-48">

  {/* Background blobs */}
- className="absolute w-[600px] h-[600px]"
+ className="absolute w-[600px] h-[600px] xl:w-[40vw] xl:h-[40vw]"
```

### 4.3 Carousel → grid statique sur desktop

**Fichier :** `src/components/sections/recent-performances.tsx`

```diff
  {/* Desktop: grille statique de toutes les cards */}
+ <div className="hidden lg:grid lg:grid-cols-3 gap-6">
+   {performances.map(p => <PerformanceCard key={p.id} {...p} />)}
+ </div>

  {/* Mobile: carousel swipable */}
- <div className="...">
+ <div className="lg:hidden ...">
```

### 4.4 LyricLine typography scaling

**Fichier :** `src/components/lyrics/LyricLine.tsx`

```diff
- return 'text-xl sm:text-2xl md:text-2xl lg:text-3xl font-bold'
+ return 'text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-4xl font-bold'
```

### 4.5 Fallback YouTube URL — layout side-by-side

**Fichier :** `src/app/app/page.tsx` — etat NEEDS_FALLBACK

```diff
+ <div className="md:flex md:gap-3">
    <input type="url" ... />
-   <button className="w-full ...">
+   <button className="w-full md:w-auto md:whitespace-nowrap ...">
+ </div>
```

---

## 5. Fichiers impactes par tier

### Tier 1 (8 changements, 6 fichiers)

| Fichier | Changement |
|---------|-----------|
| `src/app/layout.tsx` | Supprimer `maximumScale` + `userScalable` |
| `src/hooks/useOrientation.ts` | Seuil 640 au lieu de 768 |
| `src/app/globals.css` | Palette `primary-*` OU fix inline |
| `src/app/app/page.tsx` | Header classes, bouton record, progress bar |
| `src/components/lyrics/LyricsDisplayPro.tsx` | ScrollArea heights, LyricsControls expanded |
| `src/components/app/TrackSearch.tsx` | `max-h` desktop |

### Tier 2 (8 changements, 5 fichiers + 2 nouveaux)

| Fichier | Changement |
|---------|-----------|
| `src/components/layout/navbar.tsx` | **Nouveau** — composant Navbar |
| `src/hooks/useKeyboardShortcuts.ts` | **Nouveau** — raccourcis clavier |
| `src/app/app/page.tsx` | Layout results bento, integration navbar |
| `src/audio/components/StudioMode.tsx` | Layout horizontal desktop |
| `src/audio/components/TransportBar.tsx` | Boutons compacts desktop |
| `src/audio/components/TrackMixer.tsx` | Sliders elargis, grid 2 colonnes |
| `src/components/app/YouTubePlayer.tsx` | Info bar `lg:hidden` |

### Tier 3 (5 changements, 5 fichiers)

| Fichier | Changement |
|---------|-----------|
| `src/components/sections/hero.tsx` | Typo, blobs, mic, stats responsive |
| `src/components/sections/recent-performances.tsx` | Grid statique desktop |
| `src/components/lyrics/LyricLine.tsx` | `xl:text-4xl` |
| `src/app/app/page.tsx` | Fallback side-by-side |
| Toutes les sections landing | `max-w-6xl` unifie |

---

## 6. Maquettes ASCII

### 6.1 Landing page desktop (1440px)

```
┌──────────────────────────────────────────────────────────────┐
│ [Logo Kiaraoke]    Accueil    Studio         [☀/🌙] [User]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    LE JURY IA QUI                             │
│                  ANALYSE TON CHANT                           │
│                                                              │
│                      [🎤 Anim]                               │
│                                                              │
│              [  Commence maintenant  ]                       │
│              [  Voir une demo  ]                             │
│                                                              │
│        1247 performances    98% precision    4.8/5           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Comment ca marche ?                                         │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐          │
│  │ 1  │──│ 2  │──│ 3  │──│ 4  │──│ 5  │──│ 6  │          │
│  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘          │
├──────────────────────────────────────────────────────────────┤
│  Performances recentes                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Card 1   │  │ Card 2   │  │ Card 3   │                  │
│  │          │  │          │  │          │                   │
│  └──────────┘  └──────────┘  └──────────┘                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Card 4   │  │ Card 5   │  │ Card 6   │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
├──────────────────────────────────────────────────────────────┤
│  Stack technique                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Audio IA │  │ IA & LLM │  │ Stack Web│                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
├──────────────────────────────────────────────────────────────┤
│  [Logo]  Made with ♡  [GitHub] [Twitter]                     │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Page /app — Etat READY desktop (1440px)

```
┌──────────────────────────────────────────────────────────────┐
│ [Logo]    Accueil    Studio                   [☀/🌙]        │
├──────────────────────────────────────────────────────────────┤
│  ┌─ Track Card ──────────────────────────────────────────┐  │
│  │ [Album Art]  Titre — Artiste              [Practice]  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │                     │  │ ♫ Paroles synchronisees       │  │
│  │   YouTube Player    │  │                              │  │
│  │   (16:9)            │  │   Ligne precedente (dim)     │  │
│  │                     │  │   ► LIGNE ACTIVE (bold)  ◄   │  │
│  │                     │  │   Ligne suivante             │  │
│  │                     │  │   Ligne +2                   │  │
│  └─────────────────────┘  │   ...                        │  │
│                            │                              │  │
│  [PitchIndicator compact]  │  [Offset: +0.5s] [Sync]     │  │
│                            └──────────────────────────────┘  │
│                                                              │
│           [  ● Enregistrer  ]                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 Page /app — Etat RESULTS desktop (1440px)

```
┌──────────────────────────────────────────────────────────────┐
│ [Logo]    Accueil    Studio                   [☀/🌙]        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              Score Global : 87/100                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │  Justesse    │ │   Rythme     │ │   Paroles    │        │
│  │    82%       │ │    90%       │ │    88%       │        │
│  │  ████████░░  │ │  █████████░  │ │  ████████░░  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   🎭 Simon   │ │  🎭 Marie    │ │  🎭 Bruno    │        │
│  │              │ │              │ │              │         │
│  │ "Ta justesse │ │ "J'ai senti │ │ "Le rythme   │        │
│  │  est vraiment│ │  beaucoup    │ │  etait       │        │
│  │  impression- │ │  d'emotion  │ │  impeccable  │        │
│  │  nante..."   │ │  dans..."   │ │  mais..."    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Studio Mode                                          │   │
│  │  ┌────────────┐  ┌──────────────────────────────────┐│   │
│  │  │ [<<][>][>>]│  │ Ref Vocals   [────●────────]    ││   │
│  │  │            │  │ Ref Instr.   [──────●──────]    ││   │
│  │  │  01:23     │  │ User Vocals  [────────●────]    ││   │
│  │  │  /03:20    │  │ User Instr.  [──────●──────]    ││   │
│  │  │            │  │                                  ││   │
│  │  │            │  │ Master       [──────●──────]    ││   │
│  │  └────────────┘  └──────────────────────────────────┘│   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│           [  Recommencer  ]  [  Partager  ]                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.4 Page /app — Etat SELECTING desktop (1440px)

```
┌──────────────────────────────────────────────────────────────┐
│ [Logo]    Accueil    Studio                   [☀/🌙]        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              Choisis ta chanson                               │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  🔍 Recherche un artiste ou un titre...               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Recentes ────────┐  ┌─ Resultats ──────────────────┐   │
│  │                    │  │                               │   │
│  │  [♫] Last song 1  │  │  [Album] Titre — Artiste     │   │
│  │  [♫] Last song 2  │  │  [Album] Titre — Artiste     │   │
│  │  [♫] Last song 3  │  │  [Album] Titre — Artiste     │   │
│  │  [♫] Last song 4  │  │  [Album] Titre — Artiste     │   │
│  │  [♫] Last song 5  │  │  [Album] Titre — Artiste     │   │
│  │                    │  │  [Album] Titre — Artiste     │   │
│  │                    │  │  [Album] Titre — Artiste     │   │
│  │                    │  │  [Album] Titre — Artiste     │   │
│  └────────────────────┘  └──────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Estimation de complexite

| Tier | Items | Fichiers | Complexite |
|------|-------|----------|-----------|
| **Tier 1** | 8 quick fixes | 6 fichiers existants | Faible — changements CSS/props |
| **Tier 2** | 8 restructurations | 5 existants + 2 nouveaux | Moyenne — nouveaux composants + layout |
| **Tier 3** | 5 polish items | 5 fichiers existants | Faible — ajustements CSS |

**Ordre recommande :** Tier 1 → Tier 2 → Tier 3

Les fixes Tier 1 resolvent les bugs critiques et ameliorent immediatement l'experience. Le Tier 2 est le coeur du redesign desktop. Le Tier 3 est du polish qui peut etre fait incrementalement.
