---
description: Verifie que toute la documentation est a jour par rapport au code reel. Detecte les ecarts, les infos obsoletes, et les sections manquantes.
allowed-tools: Read, Glob, Grep, Bash(git diff:*, git log:*, git status:*)
---

# Verification de la documentation Kiaraoke frontend-next

Tu dois verifier systematiquement que chaque affirmation dans la documentation correspond au code reel. Produis un rapport d'ecarts.

## Phase 1 — Verifier CLAUDE.md

Lis `CLAUDE.md` et verifie chaque point contre le code reel :

### 1.1 Stack
- [ ] Lire `package.json` et verifier chaque dep/version listee dans la section Stack
- [ ] Verifier que `components.json` existe et correspond a la description
- [ ] Verifier la config Tailwind (`postcss.config.mjs`, `globals.css` imports)

### 1.2 Architecture
- [ ] Verifier que chaque fichier/dossier liste dans "Key Directories" existe reellement (`src/stores/`, `src/hooks/`, `src/audio/`, etc.)
- [ ] Verifier que les hooks listes existent : `useAudioRecorder`, `usePitchDetection`, `useYouTubePlayer`, `useLyricsSync`, `useLyricsScroll`, `useWordTimestamps`, `useOrientation`
- [ ] Verifier que les stores listes existent : `sessionStore.ts`, `audioStore.ts`
- [ ] Verifier les routes : `/`, `/app`, `/results/[sessionId]`

### 1.3 Conventions
- [ ] Verifier que `cn()` est utilise (grep pour `import.*cn.*from.*utils`)
- [ ] Verifier que `memo()` est utilise sur les composants (grep pour `React.memo` ou `memo(`)
- [ ] Verifier que les path aliases fonctionnent (`@/*`, `@components/*`, etc. dans `tsconfig.json`)
- [ ] Verifier que next-themes est configure (`ThemeProvider` dans layout)
- [ ] Verifier que sonner est configure (`Toaster` dans layout)

### 1.4 Environnement
- [ ] Verifier que `NEXT_PUBLIC_API_URL` est utilise (grep dans le code)
- [ ] Verifier `next.config.ts` pour les remote images et les rewrites

## Phase 2 — Verifier docs/DESKTOP_UX_AUDIT.md

Pour chaque probleme liste dans l'audit :

### 2.1 Verifier les problemes critiques
- [ ] C1 : `userScalable: false` est-il encore dans `layout.tsx` ?
- [ ] C2 : Le seuil `< 768` est-il encore dans `useOrientation.ts` ?
- [ ] C3 : Les classes `primary-600/500/100` sont-elles encore utilisees dans `app/page.tsx` ?
- [ ] C4 : Le lyrics scroll area est-il encore cappe a `lg:h-[450px]` ?

### 2.2 Verifier les problemes hauts
- [ ] H1 : Y a-t-il maintenant une navbar ? (chercher `navbar.tsx` ou `Navbar`)
- [ ] H2 : `max-h-96` est-il encore dans `TrackSearch.tsx` ?
- [ ] H3 : Les jury cards sont-elles encore en colonne unique ?
- [ ] H5 : `LyricsControls defaultExpanded` est-il gere ?
- [ ] H6 : StudioMode a-t-il un layout desktop ?

## Phase 3 — Verifier docs/DESKTOP_REDESIGN_PLAN.md

### 3.1 Etat d'avancement par tier
Pour chaque item des Tiers 1, 2 et 3 :
- [ ] Verifier si le changement a ete implemente (lire le fichier concerne)
- [ ] Marquer : FAIT / PAS FAIT / PARTIELLEMENT FAIT

### 3.2 Nouveaux fichiers prevus
- [ ] `src/components/layout/navbar.tsx` — existe ?
- [ ] `src/hooks/useKeyboardShortcuts.ts` — existe ?

## Phase 4 — Verifier docs/COMPETITIVE_ANALYSIS.md

- [ ] Verifier que les URLs des concurrents sont toujours valides (ne pas fetcher, juste noter si les noms/URLs semblent corrects)
- [ ] Verifier que l'avantage concurrentiel decrit (3 personas jury IA) correspond au code reel

## Phase 5 — Detecter les manques

Chercher dans le code des elements non documentes :

- [ ] Y a-t-il de nouveaux fichiers/composants non mentionnes dans la doc ?
- [ ] Y a-t-il de nouvelles deps dans `package.json` non listees dans CLAUDE.md ?
- [ ] Y a-t-il des fichiers documentes qui n'existent plus ?
- [ ] Le git log recent montre-t-il des changements significatifs non refletes dans la doc ?

```
git log --oneline -20
git diff --name-only HEAD~5
```

## Phase 6 — Rapport final

Produis un rapport structure :

```
## Rapport de verification — [date]

### Ecarts trouves
| Doc | Section | Probleme | Action requise |
|-----|---------|----------|----------------|
| ... | ...     | ...      | Mettre a jour / Supprimer / Ajouter |

### Documentation a jour
- [x] Liste des elements verifies et corrects

### Taches de redesign — Etat d'avancement
| Tier | Item | Status |
|------|------|--------|
| T1.1 | Supprimer userScalable | FAIT / PAS FAIT |
| T1.2 | Seuil orientation | FAIT / PAS FAIT |
| ...  | ...               | ...              |

### Recommandations
- Elements manquants a documenter
- Sections obsoletes a supprimer
- Mises a jour de version necessaires
```

Si des ecarts sont trouves, propose les corrections exactes (diffs) pour chaque document concerne. Ne fais PAS les corrections toi-meme — liste-les dans le rapport pour validation humaine.
