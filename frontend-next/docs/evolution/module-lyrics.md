# Module Lyrics — Rapport d'Evolution

> **Objectif** : Rendre la lecture des paroles absolument fluide pour le chanteur, que ce soit en mode karaoke (word-level) ou en mode lyrics (line-level).
>
> **Date** : 2026-02-27
> **Derniere revision** : 2026-02-28 (v3 — implementation complete)
> **Statut** : TERMINE — Toutes les phases implementees (sauf #14 syllable-level sync)

---

## Table des matieres

1. [Analyse de l'implementation actuelle](#1-analyse-de-limplementation-actuelle)
2. [Problemes critiques identifies (36)](#2-problemes-critiques-identifies)
3. [Etat de l'art — Comment font les meilleurs](#3-etat-de-lart)
4. [Techniques d'animation — Performance Tier List](#4-techniques-danimation)
5. [Gradient Fill Progressif (Apple Music Style)](#5-gradient-fill-progressif)
6. [Spring Scroll](#6-spring-scroll)
7. [Blur Depth-of-Field](#7-blur-depth-of-field)
8. [Synthese des ameliorations possibles (20)](#8-synthese-des-ameliorations)
9. [Plan d'action recommande](#9-plan-daction)
10. [Sources](#10-sources)

---

## 1. Analyse de l'implementation actuelle

### Architecture des composants

```
LyricsDisplayPro (orchestrateur)
├── useLyricsSync()              → Sync ligne/mot (binary search O(log n))
├── useLyricsScroll()            → Spring auto-scroll + detection user scroll
├── usePrefersReducedMotion()    → Detecte prefers-reduced-motion systeme
├── useOrientation()             → Responsive scroll position (mobile/desktop/landscape)
├── useWordTimestamps()          → Lifecycle word timestamps (Whisper/Celery)
├── LyricLine                    → Ligne : opacity, scale, blur, glow, pre-roll, teleprompter
│   └── KaraokeWordGroup         → Groupe de mots karaoke
│       └── KaraokeWord          → Mot : clip-path fill progressif (GPU Tier S)
├── LyricsControls               → UI offset adjustment
└── TimelineDebug                → Debug visuel (optionnel)
```

### Fichiers concernes

| Fichier | Role |
|---------|------|
| `src/components/lyrics/LyricsDisplayPro.tsx` | Orchestrateur principal, parsing 3-tiers, virtualisation, tap-to-sync |
| `src/components/lyrics/LyricLine.tsx` | Ligne : opacity, scale, text size, glow, word rendering |
| `src/components/lyrics/KaraokeWord.tsx` | Mot : clip-path fill progressif (active=primary, past=foreground, inactive=muted) + KaraokeWordGroup |
| `src/components/lyrics/LyricsControls.tsx` | UI : offset +-0.5s, quick offset +-5s/30s, manual sync |
| `src/components/lyrics/TimelineDebug.tsx` | Debug : video time, lyrics time, offset, ideal offset |
| `src/hooks/useLyricsSync.ts` | Binary search ligne, word tracking avec hysteresis 80ms, EMA smoothing |
| `src/hooks/useLyricsScroll.ts` | Auto-scroll 30% from top, user scroll detection, 3s re-enable |
| `src/hooks/useWordTimestamps.ts` | Fetch/generate word timestamps lifecycle (Celery polling) |
| `src/types/lyrics.ts` | Types + config animation (DEFAULT_ANIMATION_CONFIG, PERFORMANCE_CONFIG, OFFSET_CONFIG) |
| `src/hooks/usePrefersReducedMotion.ts` | Hook a11y : detecte prefers-reduced-motion systeme |
| `src/stores/sessionStore.ts` | State lyrics : lines, syncType, offset, playbackTime |
| `src/app/globals.css` | Animations karaoke (pulse-subtle, word-bounce, line-glow, karaoke-fill) |

### Systeme de donnees 3-tiers

```
Priorite 1 (Best)  : syncedLines + wordLines → merge (texte original + timing Whisper)
Priorite 2 (Good)  : wordLines seul           → segmentation Whisper directe
Priorite 3 (Fallback): syncedLines seul       → timing ligne uniquement, pas de mots
Priorite 4 (Dernier): texte brut              → split par \n, pas de timing
```

### Algorithme de synchronisation (useLyricsSync)

**Recherche de ligne** : Binary search O(log n) pour trouver la ligne contenant `currentTime + offset`
- Linear search pour < 20 lignes
- Retourne `currentLineIndex`, `lineProgress`, `currentLine`, `nextLine`

**Tracking de mot** :
- Recherche lineaire O(n) dans la ligne active
- **Forward-only** : les mots ne reculent jamais (protection contre jitter Whisper)
- **Multi-word jump** : autorise si `timeMs > currentWord.endTimeMs` (corrige stutter chansons rapides)
- **Hysteresis adaptative** : `min(0.15 * avgWordDuration, 150ms)` au lieu de 80ms fixe
- **EMA smoothing** : `PROGRESS_SMOOTHING = 0.3` → 70% poids sur valeur precedente
- **Seek detection** : si `abs(adjustedTime - prevAdjustedTime) > 1s`, saut direct au bon mot (bypass forward-only)

**Calcul du progress** :
```typescript
wordProgress = (currentTime - wordStart) / (wordEnd - wordStart)  // 0 → 1
smoothed = 0.3 * rawProgress + 0.7 * previousSmoothed              // EMA
```

**Purete React** : Les refs sont mutees dans `useMemo` mais protegees par des **idempotency guards** (`wordGuardTime`, `progressGuardTime`) — en Strict Mode, la double invocation retourne le resultat cache sans re-muter.

### Comportement du scroll (useLyricsScroll)

- **Position cible** : responsive — 30% mobile portrait, 35% desktop, 40% landscape, 45% teleprompter
- **Methode** : Spring physics custom (rAF + `performance.now()` delta)
  - Config : `stiffness=120, damping=26, mass=1`
  - Interruptible : carry-over velocity sur nouveau scroll
  - Fallback `prefers-reduced-motion` : `scrollTo({ behavior: 'smooth' })` natif
- **Debounce** : 50ms entre les commandes de scroll
- **Scroll programmatique** : cible correctement le viewport Radix via `container.querySelector('[data-radix-scroll-area-viewport]')`
- **Detection user scroll** : event listener `scroll` attache au **viewport Radix** (corrige — `scroll` ne bubble pas)
- **Fenetre programmatique** : 500ms (evite les faux positifs sur chansons rapides)
- **Re-activation** : 3 secondes apres le dernier scroll utilisateur
- **Padding** : 30% top + 70% bottom pour permettre au scroll d'atteindre la bonne position

### Rendu des lignes (LyricLine)

**Opacity** (distance-based) :
```
Active      → 1.0
Next (+1)   → 1.0
+2          → 0.85
+3          → 0.75
+4          → 0.65
+5...       → max(0.55, 0.7 - distance * 0.03)
Past -1     → 0.6
Past -2     → 0.5
Past -3     → 0.45
Past -4...  → max(0.4, 0.5 - distance * 0.03)
```

**Scale** :
```
Active → 1.0
Next   → 0.94
Others → 0.92
```

**Text size** :
```
Active → text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-4xl font-bold
Next   → text-lg sm:text-xl md:text-xl lg:text-2xl font-semibold
Others → text-base md:text-lg lg:text-xl
```

**Glow** : Un seul effet sur la ligne active — `textShadow` vert theme (`rgba(34, 197, 94, 0.6)`, 20px).
Pre-roll glow (0.3 opacity) sur la prochaine ligne quand <2s de l'activation.
Desactive en mode `prefers-reduced-motion` et teleprompter.

**Transition** : `transition-[transform,opacity,filter] duration-300 ease-out` — uniquement proprietes compositor.
Mode teleprompter : `transition-opacity duration-300`.
Mode `prefers-reduced-motion` : `transition-none`.

**will-change** : Dynamique via `containerStyle` — `distance <= 10 ? 'transform, opacity, filter' : 'auto'`.

### Rendu des mots (KaraokeWord)

**Couleurs** (theme-aware via tokens CSS) :
```
Active   → text-primary (clip-path fill progressif) + font-bold
Past     → text-foreground + font-semibold
Inactive → text-muted-foreground + font-normal
```

**Fill progressif** : `clip-path: inset(0 X% 0 0)` sur overlay (GPU Tier S)
- 2 DOM nodes uniquement sur le mot actif (base muted + overlay primary)
- 1 DOM node pour past et inactive
- `willChange: 'clip-path'` sur l'overlay actif
- Fallback `prefers-reduced-motion` : couleur instantanee (1 seul node, text-primary)

**Historique** : L'approche `background-clip: text` a ete tentee puis abandonnee
(incompatible `text-shadow`, `text-fill-color: transparent`). Remplacee par `clip-path: inset()`.

### Animations CSS (globals.css)

Dead code nettoye : `pulse-subtle`, `word-bounce`, `line-glow`, `karaoke-fill` supprimes.

### Ce qui fonctionne bien

- Binary search O(log n) — performant pour grands textes
- Virtualisation ±100 lignes — memoire maitrisee
- Memoisation complete (React.memo, useMemo, useCallback)
- 3-tiers de donnees avec merge intelligent
- Tap-to-sync (clic sur ligne recalcule offset)
- Forward-only word tracking (protection jitter Whisper) + multi-word jump si past endTime
- Seek detection (>1s) : saut direct au bon mot
- Hysteresis adaptative (proportionnelle a la duree moyenne des mots)
- Granular Zustand selectors (pas de re-render cascade)
- Scroll programmatique cible correctement le viewport Radix
- Spring scroll physics (stiffness=120, damping=26, mass=1) — interruptible, velocity carry-over
- Blur depth-of-field progressif par distance (will-change dynamique ±10 lignes)
- Gradient fill clip-path: inset() GPU Tier S (2 DOM nodes actif, 1 sinon)
- Pre-roll glow (2s avant activation), interlude dots (gap >5s)
- Couleurs 100% theme-aware (tokens CSS, dark/light mode)
- Scroll position responsive (30% mobile, 35% desktop, 40% landscape, 45% teleprompter)
- Mode teleprompeur (texte uniforme, pas scale/blur/glow, line-level only)
- prefers-reduced-motion (disable spring, blur, clip-path, glow)
- Idempotency guards pour React Strict Mode (double-invocation safe)
- Auto-scroll indicator ("Reprendre le defilement")
- Gestion instrumentaux (retourne -1 pour gaps >2s)

---

## 2. Problemes critiques identifies

### Severite CRITIQUE

| # | Composant | Probleme | Impact |
|---|-----------|----------|--------|
| 1 | KaraokeWord | **Pas de gradient fill progressif** — le `progress` est passe mais jamais utilise (void _progress) | Le chanteur ne voit PAS le mot se remplir en temps reel. Changement couleur instantane au lieu d'un sweep progressif. C'est LA feature manquante vs Apple Music. |
| 2 | useLyricsSync | **Avancement mot-par-mot cape a +1** — les sauts multi-mots legitimes sont bloques | Stutter visible sur chansons rapides (120+ BPM). A 2 mots/seconde, le cap +1 + hysteresis 80ms = lag cumule visible. |
| 3 | LyricLine | **Couleurs hardcodees** (text-white, text-gray-200, text-gray-400, #f472b6) — pas de tokens theme | Texte invisible en light mode. Pink ne correspond pas au theme vert. Pas de support dark:/light: |
| 4 | useLyricsScroll | **Scroll event listener sur le conteneur externe, pas le viewport Radix** — `scroll` ne bubble pas | La detection de scroll utilisateur est **cassee**. Le listener sur `containerRef.current` ne recoit jamais les events scroll du viewport Radix interne (`[data-radix-scroll-area-viewport]`). Le scroll programmatique cible correctement le viewport (l.179), mais le listener de detection (l.138) cible le mauvais element. L'auto-scroll peut se desactiver de maniere erratique ou ne jamais se desactiver. |
| 5 | useLyricsSync | **Mutations de refs a l'interieur de `useMemo`** (lignes 274-335) | Viole le contrat de purete de `useMemo`. En React Strict Mode (dev), le memo est appele 2x → double mutation des refs (`prevWordIndexRef`, `wordIndexChangeTimeRef`, `smoothedProgressRef`) → etat de tracking corrompu. Fonctionne en production (Strict Mode desactive) mais est une bombe a retardement et rend le debugging impossible en dev. |
| 6 | useWordTimestamps | **Polling non nettoye au changement de `spotifyTrackId`** | Si l'utilisateur change de chanson pendant une generation, le poll continue pour l'ancien task → donnees de la mauvaise piste chargees dans le state. `pollIntervalRef` n'est clear que quand une nouvelle generation demarre, pas quand les IDs changent. |

### Severite HAUTE

| # | Composant | Probleme | Impact |
|---|-----------|----------|--------|
| 7 | useLyricsScroll | **`scrollTo({ behavior: 'smooth' })` sans controle** — easing et duree delegues au navigateur | Scroll saccade, pas de spring physics. Pas de controle sur la vitesse ou le feel du scroll. |
| 8 | useLyricsScroll | **Fenetre detection scroll programmatique trop etroite (200ms)** | CSS smooth scroll peut durer 300-500ms. Chansons rapides (lignes toutes les 500ms) → 2 scrolls programmatiques se chevauchent → le 2eme est detecte comme "user scroll" → auto-scroll desactive par erreur. |
| 9 | useLyricsScroll | **Debounce 100ms introduit du lag visible** | A 120 BPM (2 mots/sec), 100ms debounce = retard perceptible au changement de ligne |
| 10 | LyricsDisplayPro | **Word midpoint bucketing misaligne les mots aux frontieres de ligne** | Mot 5900-6200ms, ligne 1 finit a 6000ms → midpoint 6050ms → assigne a ligne 2 (faux) |
| 11 | useLyricsScroll | **Timeout re-activation 3000ms hardcode** + pas de feedback UI | Le chanteur attend 3 secondes sans savoir que l'auto-scroll est desactive |
| 12 | LyricLine | **`will-change-transform` sur TOUTES les lignes rendues** (~200 lignes dans la fenetre ±100) | Chaque element avec `will-change` cree un layer GPU dedie. 200 layers = surconsommation memoire GPU significative, surtout sur mobile. Le rapport recommande ±10 lignes (§7), mais le code existant l'applique deja partout via la classe CSS. |
| 13 | LyricLine | **`transition-all` anime les proprietes non-compositor** | `transition-all duration-300 ease-out` anime `color`, `font-size`, `text-shadow` qui declenchent des repaints main thread a chaque changement de ligne. Devrait etre `transition-[transform,opacity]` pour rester sur le compositor. |
| 14 | LyricsDisplayPro | **`hasWordData` ne verifie que `lines[0]`** | Si la 1ere ligne n'a pas de mots (ex: titre instrumental) mais les suivantes en ont, le mode karaoke ne s'active jamais. `lines[0].words?.length` est fragile. |
| 15 | LyricsDisplayPro | **Fallback Priority 4 (texte brut) met `startTime: 0` pour toutes les lignes** | Toutes les lignes apparaissent "actives" simultanement car `findLineIndex` matche toute ligne avec `time >= 0`. Le chanteur ne sait pas ou il en est. |

### Severite MOYENNE

| # | Composant | Probleme | Impact |
|---|-----------|----------|--------|
| 16 | useLyricsSync | **EMA smoothing (0.3) avec reset brutal au changement de ligne** | Saut visuel en debut de chaque nouvelle ligne (progress saute de smooth → 0) |
| 17 | LyricLine | **Scale next line = 0.94 vs 0.92 (delta 0.02)** — imperceptible | A 24px, delta 0.02 = 0.48px. N'aide pas le chanteur a lire en avance |
| 18 | LyricLine | **Opacity falloff avec discontinuites** (distance 4→5 : saut de 0.1) | Grouping visuel non intentionnel |
| 19 | KaraokeWord | **Pink (#f472b6) ne correspond pas au theme vert** | Incoherence visuelle globale |
| 20 | KaraokeWordGroup | **Seuil 85% pour dernier mot arbitraire** | Desynchronise avec le timing de transition de ligne |
| 21 | LyricsControls | **Fine adjustment 0.5s trop grossier pour word-level sync** | A resolution mot, 0.5s = 5-10 mots dans passages rapides |
| 22 | globals.css | **Animations definies mais jamais utilisees** (dead code) | pulse-subtle, word-bounce, line-glow, karaoke-fill → 0 utilisation |
| 23 | LyricsDisplayPro | **Auto-switch karaoke force** quand word data disponible, pas de controle user | L'utilisateur ne peut pas choisir line-mode meme avec word data |
| 24 | LyricsDisplayPro | **Proportional word matching echoue quand word count differe** | "L'amour" (1 mot) vs "l amour" (2 mots Whisper) → timing faux |
| 25 | useLyricsScroll | **Position 30% hardcodee, pas configurable** | Suboptimal en landscape, desktop, ou petits ecrans |
| 26 | LyricsControls | **Etat collapsed non persistant** | Re-collapses au re-render |
| 27 | LyricsControls | **Manual sync assume timing 1ere ligne fiable** | Si 1ere ligne a un mauvais timing, manual sync propage l'erreur |
| 28 | useLyricsSync | **Binary search ne gere pas les gaps entre lignes** (instrumentaux) | Pendant un instrumental (gap > 2s entre 2 lignes), le systeme affiche toujours une ligne comme "active" au lieu de retourner -1. Le fallback `Math.min(low, lines.length - 1)` force un resultat. |
| 29 | useLyricsSync | **`adjustedTime` dans un `useMemo` qui change chaque frame** | `useMemo([currentTime, offset])` recalcule a ~60fps puisque `currentTime` change tout le temps. L'overhead du memo (comparaison + stockage) est superieur a `currentTime + offset` direct. Perf negative nette. |
| 30 | useLyricsSync | **Sur seek, forward-only repart du mot 0** | Quand l'utilisateur seek au milieu d'une ligne, `prevWordIndexRef` est -1 → force le retour a word 0 (l.290-293). Les premiers mots se remplissent un par un au lieu de sauter directement au bon mot. |
| 31 | LyricLine | **Double glow non intentionnel** sur la ligne active | `textShadow` ambre/gold (containerStyle) ET `drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]` blanc (textClasses) se superposent, creant un halo double. |

### Severite BASSE

| # | Composant | Probleme | Impact |
|---|-----------|----------|--------|
| 32 | globals.css | **Couleurs animation hardcodees vert** — pas theme-aware | Invisible en light mode |
| 33 | useLyricsSync | **Mots de duree 0** retournent progress=1.0 immediatement | Mots Whisper silencieux apparaissent "chantes" instantanement |
| 34 | useWordTimestamps | **Polling 3s pour generation** — pas de timeout | Si Celery task hang, polling infini sans feedback |
| 35 | useWordTimestamps | **~60 lignes de polling dupliquees** entre `triggerGeneration` et `regenerate` | Maintenance fragile, risque de divergence entre les deux fonctions |
| 36 | Dead code | **Composants/config jamais utilises** | `LyricsControlsMobile` exporte mais jamais importe ; `OFFSET_CONFIG.DEBOUNCE_SAVE_MS` jamais lu ; `OFFSET_CONFIG.QUICK_STEPS[60]` jamais affiche ; `DEFAULT_ANIMATION_CONFIG.blurAmount` jamais lu (blur commente) ; `LyricLineProps.innerRef` jamais utilise (forwardRef a la place) |

---

## 3. Etat de l'art

### Apple Music Sing — La Reference Absolue

**Source** : [How Apple Music Maps Audio to Lyrics (DEV.to)](https://dev.to/vimu_kale_4b5058f002ff8b1/how-apple-music-maps-audio-to-lyrics-the-engineering-behind-real-time-lyric-sync-4fin)

| Technique | Detail |
|-----------|--------|
| **Format** | TTML (Timed Text Markup Language, XML W3C) — `<span begin="..." end="...">` par syllabe |
| **Forced Alignment** | MFCCs + HMM/CTC + Viterbi → precision **~30-50ms** par mot |
| **Time representation** | `CMTime` (nombre rationnel) — evite la derive floating-point |
| **Boundary observers** | Callbacks pre-enregistres aux timestamps lyrics (pas de polling) |
| **Seek re-sync** | Binary search pour retrouver la position apres seek |
| **Progress masking** | `(currentTime - wordStart) / (wordEnd - wordStart)` → pilote un **clip-path ou overlay** qui revele le mot de gauche a droite progressivement |
| **Spring animations** | `UIViewPropertyAnimator` avec **damping ratio** calibre → deceleration physique naturelle (pas de linear easing) |
| **Depth-of-field** | Lignes passees **retrecies + floutees** (blur), lignes futures **attenuees** → focus visuel sur le present |
| **Scale/prominence** | Ligne active nettement plus large. Lignes passees retrecissent. Lignes futures subdued |
| **Pace encoding** | La velocite d'animation derive naturellement du tempo via les timestamps mot — pas de vitesse fixe |
| **Multi-voix** | Voix de fond animees independamment. Duets affiches de chaque cote de l'ecran |
| **WWDC 2025** | Nouveau mode karaoke avec mic integre + visualiseur temps reel |

**Ce qu'Apple fait et que nous ne faisons PAS** :
1. Gradient fill progressif (mot se remplit visuellement)
2. Spring scroll (physique naturelle)
3. Blur depth-of-field
4. Spring-based scale transitions
5. Boundary observers (au lieu de polling `setInterval`)
6. Seek re-sync (jump au bon mot apres seek, au lieu de repartir du mot 0)

### Spotify — Scroll Spring + Line Focus

**Source** : [react-native-spotify-lyrics (GitHub)](https://github.com/uragirii/react-native-spotify-lyrics)

| Technique | Detail |
|-----------|--------|
| **Sync level** | Line-level uniquement (pas de word-level expose) |
| **Scroll** | Spring physics via Reanimated 2 (React Native) |
| **Active line** | Nettement plus grande, blanc pur, bold |
| **Past lines** | Gris fonce, opacity reduite, PAS de blur |
| **Anticipation** | 2-3 lignes suivantes visibles avec opacity decroissante |
| **Transition** | Spring ease-out sur changement de ligne |

### KaraFun / Smule — Karaoke Pro

| Technique | Detail |
|-----------|--------|
| **Display** | 2 lignes visibles max (tradition karaoke bar) |
| **Color wipe** | Le mot se remplit de couleur progressivement (gradient hard-edge de gauche a droite) |
| **Countdown** | Indicateur visuel avant le debut du chant (●●● ou barre de compte a rebours) |
| **Pitch guide** | Ligne de pitch superposee aux paroles (guide la hauteur de voix) |
| **Font** | Grande taille (36px+), contraste maximal sur fond sombre |

### Teleprompter Pro (LivePrompter, SingerPro, BlackBox)

**Source** : [Teleprompter.com](https://www.teleprompter.com/blog/lyrics-prompter)

| Technique | Detail |
|-----------|--------|
| **Scroll** | Continu, pas de saut — defilement lisse constant a vitesse basee sur le tempo |
| **Position** | La ligne active est TOUJOURS au meme endroit a l'ecran (fixe) |
| **Police** | Tres grande (36-48px), lisibilite maximale |
| **Fond** | Dark background, contraste maximal pour conditions sceniques |
| **UI** | Zero scrollbar, zero element parasite — uniquement le texte |
| **Anticipation** | Tout le texte visible a la fois, pas de masquage |
| **Design insight** | Les chanteurs qui lisent un ecran tendent a fixer l'ecran au lieu de performer. Un affichage ou tout tient sur un seul ecran (sans scroll) est preferable pour le contact avec le public |

---

## 4. Techniques d'animation

### Performance Tier List Web

**Source** : [Web Animation Performance Tier List (Motion Magazine)](https://motion.dev/blog/web-animation-performance-tier-list), [MDN CSS/JS Animation Performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance)

| Tier | Technique | Thread | FPS | Usage Karaoke |
|------|-----------|--------|-----|---------------|
| **S** | CSS `transform` + `opacity` (composited properties) | Compositor thread | 120fps | Scale/opacity des lignes, transitions d'etat |
| **S** | `clip-path: inset()` animation | Compositor thread | 120fps | **Gradient fill alternatif** (Apple Music native) |
| **S** | Web Animations API (WAAPI) `.animate()` | Compositor thread | 120fps | Opacity transitions |
| **A** | CSS `transition` sur `transform`/`opacity` | Compositor thread | 60fps | Changements d'etat ligne (active/past) |
| **A** | Framer Motion `layout` + `spring` | Main thread optimise | 60fps | **Spring scroll** — on a deja la dep! |
| **B** | `requestAnimationFrame` + `transform` | Main thread | 60fps | Scroll custom, sync fill precise |
| **B** | `background-clip: text` + `linear-gradient` | Main thread + repaint | 60fps | **Gradient fill** (1 DOM node, mais repaint) |
| **B** | `react-spring` (useSpring) | Main thread | 60fps | Alternative a Framer Motion |
| **C** | `scrollTo({ behavior: 'smooth' })` | Browser-controlled | Variable | **NOTRE SCROLL ACTUEL** — aucun controle |
| **D** | CSS `color`/`background-color` transitions | Main thread + repaint | 30-60fps | Changement couleur (declenche repaint) |
| **D** | CSS `filter: blur()` sans `will-change` | Main thread + repaint | 30fps | Blur non-optimise |

> **Correction v2** : `background-clip: text` + `linear-gradient` est **Tier B, pas Tier S**. La propriete `background` n'est PAS compositor-friendly — elle declenche un repaint main thread. Seuls `transform`, `opacity`, `filter` (avec `will-change`), et `clip-path` sont compositor. En pratique, le repaint est localise a un seul mot (petit surface), donc performant, mais ce n'est pas du GPU pur.

**Verdict** : Notre scroll (`scrollTo smooth` = **Tier C**) est l'une des techniques les moins performantes. Apple Music utilise du **Tier S** (spring transforms + compositor).

### Proprietes compositor vs main thread

```
COMPOSITOR (GPU, ne bloque pas) :     MAIN THREAD (bloque le JS) :
├── transform                         ├── width, height
├── opacity                           ├── top, left, right, bottom
├── filter (avec will-change)         ├── margin, padding
└── clip-path                         ├── color, background-color
                                      ├── background (inclut linear-gradient)
                                      ├── font-size
                                      └── border
```

**Regle d'or** : Animer UNIQUEMENT `transform`, `opacity`, `filter`, `clip-path` pour rester sur le compositor thread a 120fps.

### Scroll-Driven Animations (CSS natif — futur)

**Source** : [Chrome Developers](https://developer.chrome.com/docs/css-ui/scroll-driven-animations), [MDN ScrollTimeline](https://developer.mozilla.org/en-US/docs/Web/API/ScrollTimeline)

```css
/* Futur : animer les lignes en fonction du scroll, GPU-accelerated */
@keyframes fade-in {
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: scale(1); }
}

.lyric-line {
  animation: fade-in linear;
  animation-timeline: view();  /* Lie au scroll container */
  animation-range: entry 0% entry 100%;
}
```

- **Support** : Chrome 115+, Edge 115+, Safari TP (2025), Firefox experimental
- **Avantage** : GPU-accelerated, zero JS, fluide
- **Inconvenient** : Lie au scroll, pas au temps audio — pas directement applicable pour sync temporelle, mais utilisable pour les effets visuels de distance

---

## 5. Gradient Fill Progressif

C'est **LA** technique manquante. Le `progress` (0→1) est deja calcule dans `useLyricsSync` et passe a `KaraokeWord`, mais jamais visualise (void _progress).

> **Contexte important** : Le code source (`KaraokeWord.tsx:60`) contient le commentaire *"We avoid background-clip:text as it has rendering issues — Instead, we use simple color transitions"*. L'approche `background-clip: text` a ete **volontairement abandonnee** par le precedent developpeur. Si on la re-adopte, il faudra tester les cas de rendering mentionnes (probablement lies a `text-fill-color: transparent` + `text-shadow` qui ne cohabitent pas bien).

### Approche 1 : `background-clip: text` + `linear-gradient`

**Sources** : [CSS-Tricks background-clip](https://css-tricks.com/almanac/properties/b/background-clip/), [Chen Hui Jing gradient hacking](https://chenhuijing.com/blog/hacking-background-clip-with-gradient-colour-stops/)

```css
.karaoke-word-fill {
  /* Gradient a hard-edge : couleur chantee | couleur non-chantee */
  background: linear-gradient(
    to right,
    var(--color-sung, #22c55e) 0%,
    var(--color-sung, #22c55e) var(--fill-progress, 0%),
    var(--color-unsung, #9ca3af) var(--fill-progress, 0%),
    var(--color-unsung, #9ca3af) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
```

**En React** :
```tsx
const KaraokeWord = memo(({ word, isActive, isPast, progress }) => {
  const fillPercent = isPast ? 100 : isActive ? progress * 100 : 0

  return (
    <span
      className="karaoke-word-fill font-bold"
      style={{ '--fill-progress': `${fillPercent}%` } as React.CSSProperties}
    >
      {word.text}
    </span>
  )
})
```

**Avantages** :
- Un seul DOM node par mot
- Hard-edge = pas de flou entre les couleurs → tres lisible
- Fonctionne sur inline `<span>`
- Support navigateurs : 98%+

**Inconvenients** :
- **Performance Tier B** (declenche repaint main thread, pas compositor)
- Necessite `text-fill-color: transparent` (WebKit prefix encore requis)
- **Incompatible avec `text-shadow`** (le glow disparait quand `text-fill-color: transparent`) — c'est probablement la raison du commentaire "rendering issues" dans le code
- Solution glow : utiliser `filter: drop-shadow()` au lieu de `text-shadow` (fonctionne avec `background-clip: text`)

### Approche 2 : Overlay avec `width` clippee

```tsx
<span className="relative inline-block">
  {/* Texte de base (non-chante, gris) */}
  <span className="text-gray-400">{word.text}</span>
  {/* Overlay (chante, vert) — clippe par progress */}
  <span
    className="absolute inset-0 text-green-500 overflow-hidden whitespace-nowrap"
    style={{ width: `${progress * 100}%` }}
  >
    {word.text}
  </span>
</span>
```

**Avantages** :
- Conceptuellement simple
- Permet des couleurs/effets differents (glow sur overlay)

**Inconvenients** :
- 2x les DOM nodes par mot (lourd avec beaucoup de mots)
- `width` declenche layout (main thread, pas compositor) — **Tier D**
- Problemes de sous-pixel rendering aux frontieres

### Approche 3 : `clip-path: inset()` (Apple Music native) — RECOMMANDEE

```tsx
<span className="relative inline-block">
  <span className="text-gray-400">{word.text}</span>
  <span
    className="absolute inset-0 text-green-500"
    style={{ clipPath: `inset(0 ${100 - progress * 100}% 0 0)` }}
  >
    {word.text}
  </span>
</span>
```

**Avantages** :
- `clip-path` est compositor-friendly (GPU) — **Tier S** reel
- Rendu precis au sous-pixel
- Permet `text-shadow` / glow sur l'overlay (contrairement a `background-clip: text`)
- C'est ce qu'Apple utilise nativement

**Inconvenients** :
- 2x les DOM nodes
- Necessite `position: absolute` (layout complexe pour inline text)
- Le surcout DOM est mitige : seul le mot actif a `clip-path` anime, les mots past/inactive sont statiques

### Recommandation revisee : **Approche 3** (`clip-path: inset()`)

Changement par rapport a la v1 du rapport qui recommandait l'Approche 1. Raisons :

1. **Performance reelle Tier S** — `clip-path` est la seule approche reellement compositor (GPU). `background-clip: text` est Tier B (repaint)
2. **Compatible glow** — `text-shadow` fonctionne normalement sur l'overlay (pas de `text-fill-color: transparent`)
3. **Historique code** — L'Approche 1 a deja ete tentee et abandonnee pour "rendering issues" (`KaraokeWord.tsx:60`)
4. **DOM overhead maitrise** — Seuls les mots de la ligne active (5-15 mots) ont 2 nodes. Les mots past/inactive n'ont que la couche base

**Implementation optimisee** :
```tsx
const KaraokeWord = memo(({ word, isActive, isPast, progress }) => {
  if (!isActive && !isPast) {
    // Inactive: 1 seul node (pas d'overlay)
    return <span className="text-muted-foreground">{word.text}</span>
  }

  if (isPast) {
    // Past: 1 seul node, couleur pleine
    return <span className="text-foreground font-semibold">{word.text}</span>
  }

  // Active: 2 nodes avec clip-path
  return (
    <span className="relative inline-block">
      <span className="text-muted-foreground">{word.text}</span>
      <span
        className="absolute inset-0 text-primary font-bold"
        style={{
          clipPath: `inset(0 ${100 - progress * 100}% 0 0)`,
          willChange: 'clip-path',
        }}
      >
        {word.text}
      </span>
    </span>
  )
})
```

---

## 6. Spring Scroll

### Probleme actuel

```typescript
// useLyricsScroll.ts — ACTUEL (Tier C)
scrollContainer.scrollTo({
  top: Math.max(0, targetScrollTop),
  behavior: 'smooth',  // ← delegue au navigateur, zero controle
})
```

Le navigateur choisit sa propre courbe d'easing et sa duree. Pas de spring physics. Le resultat est un scroll "generique" sans le feeling organique d'Apple Music ou Spotify.

### Solution 1 : Framer Motion `useAnimate`

On a **Framer Motion 12** dans nos deps. On peut utiliser `useAnimate` pour un scroll spring.

```typescript
import { useAnimate } from 'framer-motion'

const [scrollRef, animate] = useAnimate()

// Remplacer scrollTo par :
async function springScrollTo(targetScrollTop: number) {
  const container = scrollRef.current
  if (!container) return

  await animate(
    container,
    { scrollTop: targetScrollTop },
    {
      type: 'spring',
      stiffness: 100,   // Rigidite du ressort
      damping: 20,       // Amortissement (evite les oscillations)
      mass: 0.5,         // Masse (inertie)
    }
  )
}
```

> **Limitation** : Framer Motion `animate` ne supporte pas directement `scrollTop` comme propriete animable. Il faudra utiliser `requestAnimationFrame` avec les spring values de Framer Motion, ou une approche custom.

### Solution 2 : rAF + Spring Physics custom (RECOMMANDEE)

```typescript
function springScroll(
  container: HTMLElement,
  targetY: number,
  config = { stiffness: 120, damping: 26, mass: 1 }
) {
  let velocity = 0
  let currentY = container.scrollTop
  let rafId: number
  let lastTime = performance.now()

  function tick(now: number) {
    // Utiliser le delta temps reel au lieu de 1/60 fixe
    const dt = Math.min((now - lastTime) / 1000, 0.05) // cap a 50ms pour eviter les sauts
    lastTime = now

    const displacement = currentY - targetY
    const springForce = -config.stiffness * displacement
    const dampingForce = -config.damping * velocity
    const acceleration = (springForce + dampingForce) / config.mass

    velocity += acceleration * dt
    currentY += velocity * dt

    container.scrollTop = currentY

    // Continuer tant que le mouvement est significatif
    if (Math.abs(velocity) > 0.5 || Math.abs(displacement) > 0.5) {
      rafId = requestAnimationFrame(tick)
    }
  }

  rafId = requestAnimationFrame(tick)

  // Retourner une fonction de cleanup
  return () => cancelAnimationFrame(rafId)
}
```

> **Correction v2** : Le code utilise `performance.now()` pour le delta temps reel au lieu de `1/60` fixe. Cela gere correctement les ecrans 120Hz, les frames droppees, et les onglets arriere-plan.

> **Note perf** : `scrollTop` declenche du layout/repaint a chaque frame (main thread). C'est incontournable pour un scroll custom. L'alternative serait d'animer un `translateY` sur le contenu au lieu de `scrollTop`, mais cela casse le hit testing et la detection d'overflow.

**Config recommandee pour karaoke** :
```
Chansons lentes (< 80 BPM)  : stiffness: 80,  damping: 22, mass: 1.2  (doux, lent)
Chansons moyennes (80-120)   : stiffness: 120, damping: 26, mass: 1.0  (standard)
Chansons rapides (> 120 BPM) : stiffness: 200, damping: 30, mass: 0.8  (vif, reactif)
```

### Solution 3 : CSS `scroll-behavior` + `@scroll-timeline` (FUTUR)

Pas encore assez supporte pour production (manque Safari stable).

### Recommandation : **Solution 2** (rAF + Spring custom)

- Zero dependance externe pour le scroll
- Controle total sur stiffness/damping/mass
- Peut etre adapte au BPM de la chanson
- Interruptible (cancelAnimationFrame si nouveau scroll demande)
- **IMPORTANT** : le scroll listener pour la detection user scroll doit cibler le bon element (viewport Radix, pas le conteneur externe) — corriger le bug #4 en meme temps

---

## 7. Blur Depth-of-Field

### Technique Apple Music

Apple floute legerement les lignes non-actives, creant un effet de profondeur de champ qui guide naturellement l'oeil vers la ligne a chanter.

### Historique dans le code

Le blur etait implemente puis **volontairement retire**. Commentaires dans `LyricLine.tsx` :
- Ligne 107 : *"Note: blur filter removed to allow smooth scrolling through lyrics"*
- Ligne 115 : *"No filter/blur - it was preventing scrolling"*

Le `DEFAULT_ANIMATION_CONFIG.blurAmount = 1.5` est defini dans `types/lyrics.ts` mais jamais lu.

Le probleme etait probablement que le blur etait applique **sans `will-change`** et/ou sur trop d'elements, causant des saccades au scroll. La solution est de :
1. Ajouter `will-change: filter, transform, opacity` uniquement sur ±10 lignes
2. Limiter le blur max a 2-3px
3. Utiliser `transition` specifique au lieu de `transition-all`

### Implementation CSS

```css
/* Integrer dans le style de LyricLine */

.line-active {
  filter: blur(0px);
  transform: scale(1.0);
  opacity: 1;
  transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 400ms cubic-bezier(0.16, 1, 0.3, 1),
              filter 400ms cubic-bezier(0.16, 1, 0.3, 1);
}

.line-adjacent {  /* ±1 */
  filter: blur(0.3px);
  transform: scale(0.95);
  opacity: 0.85;
}

.line-near {  /* ±2-3 */
  filter: blur(1px);
  transform: scale(0.9);
  opacity: 0.6;
}

.line-far {  /* ±4+ */
  filter: blur(2px);
  transform: scale(0.88);
  opacity: 0.4;
}
```

### Performance

- `filter: blur()` est **compositor-friendly** sur Chrome/Safari modernes **avec `will-change: filter`**
- **IMPORTANT** : ajouter `will-change: filter, transform, opacity` UNIQUEMENT sur ±10 lignes autour de l'active
- **CORRIGER** le code actuel qui met `will-change-transform` sur TOUTES les lignes (bug #12) — retirer la classe globale et appliquer `will-change` dynamiquement via `containerStyle`
- Utiliser `transition-[transform,opacity,filter]` au lieu de `transition-all` (corrige bug #13)
- Benchmark : blur de 0-3px sur 20 elements = negligeable sur mobile moderne

### Integration dans LyricLine

```typescript
const containerStyle = useMemo(() => {
  const blurAmount = isActive ? 0
    : isNext ? 0.3
    : distance <= 3 ? Math.min(distance * 0.4, 1.5)
    : Math.min(2 + (distance - 4) * 0.2, 3)

  return {
    transform: `scale(${scale})`,
    opacity,
    filter: `blur(${blurAmount}px)`,
    willChange: distance <= 10 ? 'filter, transform, opacity' : 'auto',
    // Remplacer la classe `will-change-transform` globale par ce willChange dynamique
  }
}, [isActive, isNext, distance, scale, opacity])
```

---

## 8. Synthese des ameliorations

### Tier 0 — Bugfixes critiques (a faire AVANT les features)

| # | Fix | Effort | Impact | Detail |
|---|-----|--------|--------|--------|
| 0a | **Scroll listener sur le viewport Radix** | Facile | Corrige la detection user scroll cassee | Attacher le listener `scroll` sur `container.querySelector('[data-radix-scroll-area-viewport]')` au lieu de `container` directement |
| 0b | **Extraire les mutations de refs hors de `useMemo`** | Moyen | Corrige le comportement en React Strict Mode | Deplacer les mutations (`prevWordIndexRef`, etc.) dans un `useEffect` ou utiliser un pattern `useRef` + calcul pur dans le memo |
| 0c | **Nettoyer le polling au changement de track** | Facile | Evite de charger les mauvaises donnees | `useEffect(() => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current) }, [spotifyTrackId, youtubeVideoId])` |
| 0d | **Cibler `transition-[transform,opacity]`** au lieu de `transition-all` | Facile | Elimine les repaints main thread inutiles | Modifier la classe CSS dans `LyricLine.tsx` |
| 0e | **`will-change` dynamique** ±10 lignes au lieu de global | Facile | Reduit la consommation memoire GPU | Retirer `will-change-transform` de `className`, le mettre dans `containerStyle` conditionnel |

### Tier 1 — Impact Maximal (transforme l'experience)

| # | Amelioration | Effort | Impact | Technique |
|---|-------------|--------|--------|-----------|
| 1 | **Gradient fill progressif** dans chaque mot | Moyen | Le chanteur VOIT le mot se remplir en temps reel | `clip-path: inset()` sur overlay (Tier S GPU) — 2 DOM nodes sur mot actif uniquement |
| 2 | **Spring scroll** au lieu de `scrollTo smooth` | Moyen | Scroll fluide, naturel, physiquement correct | `requestAnimationFrame` + spring physics custom + `performance.now()` delta |
| 3 | **Blur depth-of-field** sur les lignes non-actives | Moyen | Focus visuel immediat sur la ligne a chanter | `filter: blur()` progressif par distance + `will-change` dynamique ±10 lignes. Re-implementation avec les gardes manquantes (le blur etait deja code puis retire pour perf) |
| 4 | **Supprimer le cap +1 mot** + hysteresis adaptative | Facile | Supprime le stutter sur chansons rapides | Permettre +2/+3 sauts si ecart temps > seuil. Hysteresis adaptative : `min(0.15 * avgWordDuration, 150ms)` au lieu de 80ms fixe |

### Tier 2 — Polish Professionnel

| # | Amelioration | Effort | Impact | Technique |
|---|-------------|--------|--------|-----------|
| 5 | **Pre-roll visual** : prochaine ligne pulse/glow 1-2s avant activation | Facile | Le chanteur anticipe la prochaine phrase | Detecter `timeToNextLine < 2s` → ajouter classe `pre-roll` |
| 6 | **Countdown dots** entre sections (interludes) | Facile | Le chanteur sait quand reprendre | Detecter gap > 5s entre lignes → afficher ●●● avec animation |
| 7 | **Scale differencie** : active=1.0, next=0.98, others=0.85 | Facile | Hierarchie visuelle forte | Modifier `getScale()` dans LyricLine |
| 8 | **Couleurs theme-aware** (`hsl(var(--primary))`) | Facile | Fonctionne en light+dark mode | Remplacer #f472b6 / #ffffff / #9ca3af par tokens CSS |
| 9 | **Debounce reduit** a 50ms + fenetre programmatique elargie a 500ms | Facile | Scroll plus reactif, moins de faux "user scroll" | Modifier constantes dans useLyricsScroll |
| 10 | **Auto-scroll indicator** (badge "Auto OFF") | Facile | L'utilisateur sait pourquoi ca ne scroll plus | Ajouter badge dans LyricsDisplayPro quand autoScrollEnabled=false |
| 11 | **Seek → word jump** | Moyen | Le bon mot s'affiche immediatement apres un seek | Detecter `abs(currentTime - previousTime) > 1s` → desactiver forward-only et hysteresis pour 1 frame, sauter directement au bon mot |

### Tier 3 — Experience Premium

| # | Amelioration | Effort | Impact | Technique |
|---|-------------|--------|--------|-----------|
| 12 | **Scroll position configurable** : 30% mobile, 40% desktop, 50% landscape | Moyen | Optimal par form factor | Prop `scrollPosition` dans useLyricsScroll + media queries |
| 13 | **Fine offset 0.1s** au lieu de 0.5s | Facile | Sync word-level precis | Modifier `FINE_STEP` dans LyricsControls |
| 14 | **Syllable-level sync** (decoupage phonemique) | Difficile | Precision Apple Music sur mots longs | Phoneme splitting cote worker + TTML-like data |
| 15 | **Mode teleprompeur** : scroll continu, vitesse basee sur tempo | Moyen | Alternative pro pour scene | Nouveau mode display dans LyricsDisplayPro |
| 16 | **Gestion instrumentaux** : retourner -1 pendant les gaps | Facile | Pas de ligne "fantome" active pendant les instrumentaux | Modifier binary search : si `adjustedTime` tombe dans un gap > 2s entre 2 lignes, retourner -1. Afficher un etat "interlude" |
| 17 | **Nettoyage dead code** | Facile | Codebase plus propre | Supprimer `LyricsControlsMobile`, `DEBOUNCE_SAVE_MS`, `QUICK_STEPS[60]`, `innerRef`, `blurAmount`, corriger les animations CSS mortes |
| 18 | **`prefers-reduced-motion`** (accessibilite) | Facile | Respect des preferences systeme | Desactiver spring scroll, blur, gradient fill si `prefers-reduced-motion: reduce`. Fallback sur les transitions simples actuelles |

---

## 9. Plan d'action

### Phase 0 — Bugfixes critiques : COMPLETE

| # | Fix | Statut | Implementation |
|---|-----|--------|----------------|
| 0a | Scroll listener sur viewport Radix | FAIT | `useLyricsScroll.ts:124` — `querySelector('[data-radix-scroll-area-viewport]')` |
| 0b | Mutations hors useMemo (Strict Mode) | FAIT | `useLyricsSync.ts:244-258` — Idempotency guards |
| 0c | Polling nettoye au changement de track | FAIT | `useWordTimestamps.ts:295-306` — cleanup dans useEffect des IDs |
| 0d | `transition-[transform,opacity,filter]` | FAIT | `LyricLine.tsx:214` |
| 0e | will-change dynamique ±10 lignes | FAIT | `LyricLine.tsx:131` — `distance <= 10 ? 'transform, opacity, filter' : 'auto'` |
| 0f | Double glow supprime | FAIT | Un seul glow vert theme dans containerStyle |

### Phase 1 — Le "Wow" : COMPLETE

| # | Feature | Statut | Implementation |
|---|---------|--------|----------------|
| 1 | Gradient fill `clip-path: inset()` | FAIT | `KaraokeWord.tsx:71-88` — Approche 3 (Tier S GPU), 2 DOM nodes actif, 1 sinon |
| 2 | Spring scroll (rAF + physics) | FAIT | `useLyricsScroll.ts:180-228` — stiffness=120, damping=26, mass=1, interruptible |
| 3 | Blur depth-of-field | FAIT | `LyricLine.tsx:115-118` — blur progressif par distance |
| 4 | Fix word advancement | FAIT | `useLyricsSync.ts:354-369` — multi-word jump + hysteresis adaptative L315-319 |

### Phase 2 — Le Polish : COMPLETE

| # | Feature | Statut | Implementation |
|---|---------|--------|----------------|
| 5 | Pre-roll visual | FAIT | `LyricsDisplayPro.tsx:394-402` + `LyricLine.tsx:122-124` |
| 6 | Countdown dots (interludes >5s) | FAIT | `LyricsDisplayPro.tsx:407-428` — 3 dots `animate-pulse` |
| 7 | Scale differencie | FAIT | `LyricLine.tsx:55-58` — active=1.0, next=0.98, others=0.85 |
| 8 | Couleurs 100% theme-aware | FAIT | `text-foreground`, `text-muted-foreground`, `text-primary` partout |
| 9 | Debounce 50ms + fenetre 500ms | FAIT | `types/lyrics.ts:300` + `useLyricsScroll.ts:132` |
| 10 | Auto-scroll indicator badge | FAIT | `LyricsDisplayPro.tsx:639-654` — "Reprendre le defilement" |
| 11 | Seek → word jump | FAIT | `useLyricsSync.ts:302-303` — detection + saut direct |

### Phase 3 — Premium : COMPLETE (sauf #14)

| # | Feature | Statut | Implementation |
|---|---------|--------|----------------|
| 12 | Scroll position responsive | FAIT | `LyricsDisplayPro.tsx` — 30% mobile, 35% desktop, 40% landscape, 45% teleprompter via `useOrientation` |
| 13 | Fine offset 0.1s | FAIT | `OFFSET_CONFIG.FINE_STEP = 0.1` |
| 14 | Syllable-level sync | NON FAIT | Necessite backend phoneme splitting + TTML data — hors scope |
| 15 | Mode teleprompeur | FAIT | `LyricLine.tsx` mode teleprompter (texte uniforme, pas scale/blur/glow), toggle UI dans `app/page.tsx` |
| 16 | Gestion instrumentaux (-1) | FAIT | `useLyricsSync.ts:94-103` — gap >2s retourne -1 |
| 17 | Nettoyage dead code | FAIT | Suppression `blurAmount`, `LyricsControlsMobile`, `DEBOUNCE_SAVE_MS`, animations CSS mortes |
| 18 | prefers-reduced-motion | FAIT | `usePrefersReducedMotion.ts` hook + fallback dans scroll, blur, clip-path, glow |

### Fichier nouveau

| Fichier | Role |
|---------|------|
| `src/hooks/usePrefersReducedMotion.ts` | Hook a11y SSR-safe — detecte `prefers-reduced-motion: reduce` |

---

## 10. Sources

### Apple Music
- [How Apple Music Maps Audio to Lyrics — DEV Community](https://dev.to/vimu_kale_4b5058f002ff8b1/how-apple-music-maps-audio-to-lyrics-the-engineering-behind-real-time-lyric-sync-4fin)
- [Apple introduces Apple Music Sing — Apple Newsroom](https://www.apple.com/newsroom/2022/12/apple-introduces-apple-music-sing/)
- [Apple Music Lyric Animation (SwiftUI) — GitHub](https://github.com/HuangRunHua/Apple-Music-Lyric-Animation)
- [Apple Music Sing gets karaoke mode in tvOS 26 — AppleInsider](https://appleinsider.com/articles/25/06/13/apple-music-sing-gets-karaoke-mode-visualizer-in-tvos-26)
- [WWDC25 Apple Music features — RouteNote](https://routenote.com/blog/apple-music-drops-fresh-features-at-wwdc25-animated-lock-screen-album-art-lyric-translation-lyric-pronunciation-and-more/)

### Spotify
- [react-native-spotify-lyrics — GitHub](https://github.com/uragirii/react-native-spotify-lyrics)

### Animation Performance
- [Web Animation Performance Tier List — Motion Magazine](https://motion.dev/blog/web-animation-performance-tier-list)
- [CSS and JavaScript Animation Performance — MDN](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance)
- [Mastering requestAnimationFrame — DEV Community](https://dev.to/codewithrajat/mastering-requestanimationframe-create-smooth-high-performance-animations-in-javascript-2hpi)

### CSS Techniques
- [background-clip — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/background-clip)
- [Hacking background-clip with gradient colour stops — Chen Hui Jing](https://chenhuijing.com/blog/hacking-background-clip-with-gradient-colour-stops/)
- [Animated Gradient Text — web.dev](https://web.dev/articles/speedy-css-tip-animated-gradient-text)
- [CSS Gradient Text — CSS Gradient](https://cssgradient.io/blog/css-gradient-text/)
- [Karaoke Text Rendering CSS POC — CodePen](https://codepen.io/trongthanh/pen/dyRLmo)

### Scroll & Spring Physics
- [Framer Motion Layout Animations — Motion.dev](https://motion.dev/docs/react-layout-animations)
- [React Spring — GitHub](https://github.com/pmndrs/react-spring)
- [Scroll-Driven Animations — Chrome Developers](https://developer.chrome.com/docs/css-ui/scroll-driven-animations)
- [ScrollTimeline — MDN](https://developer.mozilla.org/en-US/docs/Web/API/ScrollTimeline)
- [Web Animations API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts)

### Teleprompter & UX
- [Teleprompter.com Lyrics Prompter](https://www.teleprompter.com/blog/lyrics-prompter)
- [LivePrompter — Teleprompter for Musicians](https://www.liveprompter.com/)
- [Smooth Scroll in CSS — TestMu AI](https://www.testmuai.com/blog/smooth-scroll-in-css/)

### React Karaoke Libraries
- [react-karaoke-lyric — GitHub](https://github.com/chentsulin/react-karaoke-lyric)
- [react-karaoke — GitHub](https://github.com/justintemps/react-karaoke)
- [react-progressing-lyric — GitHub](https://github.com/gokoururi-git/react-progressing-lyric)
- [lyrics-animation (React Native, ELRC) — GitHub](https://github.com/akshayjadhav4/lyrics-animation)
