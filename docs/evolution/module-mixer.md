# Spec: YouTube Video-Only + Multi-Track Audio pendant l'enregistrement

## Contexte

Actuellement, pendant la phase pre-analyse (preparing → ready → recording), YouTube fournit **video + audio**. Le Mixer sidebar affiche "Studio disponible apres analyse" car les pistes separees ne sont pas servies avant `analyze_performance`. L'utilisateur ne peut pas controler independamment voix/instrumentaux pendant l'enregistrement.

**Objectif**: YouTube = video seule (mute), multi-track = audio (ref vocals + ref instrumentals via Demucs). L'utilisateur peut mixer via la sidebar pendant l'enregistrement.

**Prerequis technique**: `prepare_reference` (Celery) cree DEJA `sessions/{session_id}_ref/vocals.wav` et `sessions/{session_id}_ref/instrumentals.wav` en storage. Ces fichiers existent des que la tache se termine. Le probleme est uniquement cote frontend : StudioMode en `practice` context ne retry pas le chargement.

---

## Architecture cible

```
PREPARING → READY → RECORDING
  YouTube = video muted
  Multi-track = ref/vocals + ref/instrumentals (Demucs)
  Mixer sidebar = fonctionnel (solo/mute/volume, preferences persistees)
  TransportBar = controle multi-track, YouTube video suit
  Indicateur source = badge "MT" vert (multi-track actif)

FALLBACK (pistes pas encore pretes)
  YouTube = video + audio (comportement actuel)
  Crossfade auto → mute YouTube quand pistes chargees (~500ms)
  Indicateur source = badge "YT" jaune (fallback YouTube)

RESULTS
  Inchange: multi-track 4 pistes, YouTube disparu
```

---

## Plan d'implementation (10 etapes)

### Etape 1 — Types YouTube IFrame API

**Fichier**: `frontend-next/src/types/youtube.d.ts`

Ajouter les methodes manquantes a `YT.Player`:
```ts
mute(): void
unMute(): void
setVolume(volume: number): void
getVolume(): number
isMuted(): boolean
```

---

### Etape 2 — Hook useYouTubePlayer: exposer mute/volume

**Fichier**: `frontend-next/src/hooks/useYouTubePlayer.ts`

- Etendre `UseYouTubePlayerReturn` avec `mute`, `unMute`, `setVolume`, `getVolume`
- 4 `useCallback` delegant a `playerRef.current?.mute()` etc.
- Les ajouter au return object

---

### Etape 3 — YouTubePlayer: etendre les controls exposes

**Fichier**: `frontend-next/src/components/app/YouTubePlayer.tsx`

- Etendre `YouTubePlayerControls` avec `mute`, `unMute`, `setVolume`, `getVolume`
- Destructurer les nouvelles methodes depuis `useYouTubePlayer`
- Les inclure dans le callback `onControlsReady`

---

### Etape 4 — StudioMode: auto-retry pour context `practice` + pre-fetch speculatif

**Fichier**: `frontend-next/src/audio/components/StudioMode.tsx`

Actuellement, l'auto-retry (poll chaque 5s) est reserve au context `analyzing`. Etendre au context `practice`:

- Ligne ~91: `if (context === 'analyzing' && ...)` → `if ((context === 'analyzing' || context === 'practice') && ...)`
- UI `waitingForTracks` pour practice: remplacer le message statique "Studio disponible apres analyse" par un spinner + "Pistes audio en preparation..." + compteur de retries

C'est ce qui fait que les pistes ref se chargent automatiquement des que `prepare_reference` termine.

**Amelioration: pre-fetch agressif**

Reduire l'intervalle de polling a **2s** (au lieu de 5s) pour le context `practice`, car les pistes ref arrivent typiquement en 5-25s. L'utilisateur percoit une disponibilite quasi-instantanee apres Demucs:
```tsx
const RETRY_INTERVAL = context === 'practice' ? 2000 : 5000;
retryIntervalRef.current = setInterval(() => { ... }, RETRY_INTERVAL);
```

---

### Etape 5 — LandscapeRecordingLayout: forward des callbacks YouTube

**Fichier**: `frontend-next/src/components/app/LandscapeRecordingLayout.tsx`

Le layout paysage cree sa propre instance `YouTubePlayer` mais ne forward pas `onControlsReady` ni `onDurationChange`. Le parent (`page.tsx`) n'a donc pas de reference au player visible en mode paysage.

- Ajouter `onControlsReady` et `onDurationChange` a l'interface props
- Les passer au `<YouTubePlayer>` interne (ligne ~76-80)
- Dans `page.tsx`, passer `handleYoutubeControlsReady` et `handleYoutubeDurationChange` au `<LandscapeRecordingLayout>`

---

### Etape 6 — page.tsx: orchestration YouTube ↔ Multi-Track

**Fichier**: `frontend-next/src/app/app/page.tsx`

C'est le changement principal. Sous-etapes:

**6a. Nouveau state `multiTrackReady`**
```tsx
const [multiTrackReady, setMultiTrackReady] = useState(false);
const handleStudioTransportReady = useCallback((controls) => {
  setStudioControls(controls);
  setMultiTrackReady(true);
}, []);
// Passer handleStudioTransportReady au lieu de setStudioControls dans AppSidebar
```

Reset `multiTrackReady = false` dans `handleReset`.

**6b. Flag `useMultiTrackAudio`**
```tsx
const useMultiTrackAudio = multiTrackReady &&
  ['preparing', 'downloading', 'ready', 'recording'].includes(status);
```

**6c. Effect crossfade YouTube → Multi-Track**

Remplace un mute/unmute brutal par un **crossfade de ~500ms** pour une transition sans "pop" audio:
```tsx
useEffect(() => {
  if (!youtubeControls) return;

  if (useMultiTrackAudio) {
    // Crossfade: YouTube volume 100→0 sur 500ms
    const startVolume = youtubeControls.getVolume();
    const steps = 10;
    const stepMs = 500 / steps;
    let step = 0;
    const fadeOut = setInterval(() => {
      step++;
      const volume = Math.round(startVolume * (1 - step / steps));
      youtubeControls.setVolume(Math.max(0, volume));
      if (step >= steps) {
        clearInterval(fadeOut);
        youtubeControls.mute();
      }
    }, stepMs);
    return () => clearInterval(fadeOut);
  } else {
    youtubeControls.unMute();
    youtubeControls.setVolume(100);
  }
}, [useMultiTrackAudio, youtubeControls]);
```

Note: Cote multi-track, le `masterVolume` de l'audioStore est deja a 1.0 par defaut, pas besoin de fade-in (les pistes viennent de se charger).

**6d. Transition: sync multi-track sur la position YouTube**

Quand `multiTrackReady` passe de false a true:
- `studioControls.seek(playbackTime)` pour aligner la position
- Si YouTube jouait → `studioControls.play()` pour demarrer le multi-track
- Utiliser un `useRef(false)` pour detecter le front montant

```tsx
const prevMultiTrackReady = useRef(false);
useEffect(() => {
  if (multiTrackReady && !prevMultiTrackReady.current && studioControls) {
    // Front montant: multi-track vient de devenir pret
    studioControls.seek(playbackTime);
    if (isVideoPlaying) {
      studioControls.play();
    }
  }
  prevMultiTrackReady.current = multiTrackReady;
}, [multiTrackReady, studioControls, playbackTime, isVideoPlaying]);
```

**6e. Redefiner `effectiveStudioControls`**

3 cas:
1. `useMultiTrackAudio = true`: controles vont au multi-track **ET** YouTube video suit (mute)
   ```
   play → studioControls.play() + youtubeControls.play()
   pause → studioControls.pause() + youtubeControls.pause()
   seek → studioControls.seek(t) + youtubeControls.seekTo(t)
   ```
2. `youtubeActive = true` (fallback): controles vont a YouTube avec audio (inchange)
3. Sinon: `studioControls` brut (results state)

**6f. Intercepter YouTube `onStateChange` + detection seek quand multi-track est actif**

Si l'utilisateur clique directement sur le player YouTube pendant que le multi-track est la source audio → forward play/pause au multi-track:
```tsx
if (useMultiTrackAudio && studioControls) {
  isPlaying ? studioControls.play() : studioControls.pause();
}
```

**Detection seek YouTube** (l'API YouTube ne fournit pas d'evenement `onSeek`):

Le polling bridge 250ms (6g) permet de detecter un seek manuel de l'utilisateur sur le player YouTube en comparant la position attendue vs reelle:
```tsx
// Dans le bridge interval (6g)
const ytTime = youtubeControls.getCurrentTime();
const mtTime = useAudioStore.getState().transport.currentTime;
const delta = Math.abs(ytTime - mtTime);
if (delta > 1.5) {
  // L'utilisateur a seek directement sur YouTube → sync multi-track
  studioControls.seek(ytTime);
}
```

**6g. Bridge multi-track time → sessionStore (pour les lyrics)**

Quand multi-track est la source, `transport.currentTime` (audioStore) doit etre copie vers `playbackTime` (sessionStore) pour que le karaoke se synchronise:
```tsx
useEffect(() => {
  if (!useMultiTrackAudio) return;
  const id = setInterval(() => {
    setPlaybackTime(useAudioStore.getState().transport.currentTime);

    // Detection seek YouTube (6f amelioration)
    if (youtubeControls) {
      const ytTime = youtubeControls.getCurrentTime();
      const mtTime = useAudioStore.getState().transport.currentTime;
      if (Math.abs(ytTime - mtTime) > 1.5) {
        studioControls?.seek(ytTime);
      }
    }
  }, 250); // Meme frequence que le polling YouTube
  return () => clearInterval(id);
}, [useMultiTrackAudio, setPlaybackTime, youtubeControls, studioControls]);
```

**6h. Sync YouTube video ← multi-track par evenements (remplace polling)**

Plutot qu'un `setInterval(2000)` grossier qui cause du drift visuel (~2s de decalage levres/musique), synchroniser la video YouTube **par evenements** du multi-track:

```tsx
// Sync sur play/pause/seek du multi-track
const handleMultiTrackPlay = useCallback(() => {
  if (useMultiTrackAudio && youtubeControls) {
    youtubeControls.seekTo(useAudioStore.getState().transport.currentTime);
    youtubeControls.play();
  }
}, [useMultiTrackAudio, youtubeControls]);

const handleMultiTrackPause = useCallback(() => {
  if (useMultiTrackAudio && youtubeControls) {
    youtubeControls.pause();
  }
}, [useMultiTrackAudio, youtubeControls]);

const handleMultiTrackSeek = useCallback((time: number) => {
  if (useMultiTrackAudio && youtubeControls) {
    youtubeControls.seekTo(time);
  }
}, [useMultiTrackAudio, youtubeControls]);
```

Ces callbacks doivent etre connectes aux actions du multi-track (via `effectiveStudioControls` qui les appelle deja — pas de wiring supplementaire).

**Fallback drift-correction** — un interval lent (5s) en filet de securite pour les cas ou les evenements sont rates:
```tsx
useEffect(() => {
  if (!useMultiTrackAudio || !youtubeControls) return;
  const id = setInterval(() => {
    const mtTime = useAudioStore.getState().transport.currentTime;
    const ytTime = youtubeControls.getCurrentTime();
    if (Math.abs(mtTime - ytTime) > 1.0) {
      youtubeControls.seekTo(mtTime);
    }
  }, 5000);
  return () => clearInterval(id);
}, [useMultiTrackAudio, youtubeControls]);
```

**6i. TransportBar overrides**

Quand `useMultiTrackAudio = true` → ne PAS passer d'overrides (TransportBar lit directement audioStore, qui est pilote par useMultiTrack).
Quand YouTube fallback → passer les overrides existants (playbackTime, youtubeDuration).

**6j. Keyboard shortcuts**

Adapter pour utiliser `effectiveStudioControls` dans tous les cas, avec le bon state pour la position/duree courante.

---

### Etape 7 — Indicateur visuel de source audio

**Fichier**: `frontend-next/src/audio/components/TransportBar.tsx` (ou composant dedie)

Afficher un badge compact dans la TransportBar indiquant la source audio active. Feedback visuel essentiel pour que l'utilisateur comprenne d'ou vient le son.

**Props a ajouter:**
```tsx
interface TransportBarProps {
  // ... existant
  audioSource?: 'youtube' | 'multitrack' | null;
}
```

**Rendu:**
```tsx
{audioSource === 'youtube' && (
  <Badge variant="outline" className="bg-amber-500/20 text-amber-400 text-xs px-1.5">
    YT
  </Badge>
)}
{audioSource === 'multitrack' && (
  <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 text-xs px-1.5">
    MT
  </Badge>
)}
```

**Transition animee** — Framer Motion `AnimatePresence` pour un fade entre les deux badges lors du crossfade (6c):
```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={audioSource}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.8 }}
    transition={{ duration: 0.3 }}
  >
    {/* Badge */}
  </motion.div>
</AnimatePresence>
```

Dans `page.tsx`, passer la prop:
```tsx
audioSource={useMultiTrackAudio ? 'multitrack' : youtubeActive ? 'youtube' : null}
```

---

### Etape 8 — Persistance des preferences mixer (localStorage)

**Fichier**: `frontend-next/src/audio/components/TrackMixer.tsx` (ou hook dedie `useMixerPreferences`)

Sauvegarder et restaurer les preferences mixer (volume, solo, mute par piste) par chanson. L'utilisateur retrouve son mix en revenant sur la meme chanson.

**Cle localStorage**: `mixer_prefs_{spotify_track_id}`

**Structure:**
```ts
interface MixerPreferences {
  tracks: Record<string, { volume: number; muted: boolean; solo: boolean }>;
  savedAt: number; // timestamp pour expiration eventuelle
}
```

**Hook `useMixerPreferences`:**
```tsx
function useMixerPreferences(spotifyTrackId: string | null) {
  // Charger au mount
  useEffect(() => {
    if (!spotifyTrackId) return;
    const key = `mixer_prefs_${spotifyTrackId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const prefs: MixerPreferences = JSON.parse(saved);
      // Appliquer aux tracks via audioStore
      Object.entries(prefs.tracks).forEach(([trackId, settings]) => {
        useAudioStore.getState().setTrackVolume(trackId, settings.volume);
        useAudioStore.getState().setTrackMuted(trackId, settings.muted);
        useAudioStore.getState().setTrackSolo(trackId, settings.solo);
      });
    }
  }, [spotifyTrackId]);

  // Sauvegarder a chaque changement (debounced 500ms)
  const save = useDebouncedCallback(() => {
    if (!spotifyTrackId) return;
    const tracks = useAudioStore.getState().tracks;
    const prefs: MixerPreferences = {
      tracks: Object.fromEntries(
        Object.entries(tracks).map(([id, t]) => [id, {
          volume: t.volume, muted: t.muted, solo: t.solo
        }])
      ),
      savedAt: Date.now(),
    };
    localStorage.setItem(`mixer_prefs_${spotifyTrackId}`, JSON.stringify(prefs));
  }, 500);

  return { save };
}
```

Note: Verifier les noms exacts des actions dans audioStore (`setTrackVolume`, etc.) avant implementation.

---

### Etape 9 — Backend: cache fallback + source metadata dans audio.py

**Fichier**: `backend/app/routers/audio.py`

**9a. Cache fallback (accelere la disponibilite de ~5s)**

Optimisation pour rendre les pistes disponibles plus tot:
- `list_available_tracks`: si `sessions/{session_id}_ref/vocals.wav` n'existe pas, checker `cache/{youtube_id}/vocals.wav`
- `get_audio_track`: meme fallback avec redirect 302 vers l'URL cache

Necessite de lire `youtube_id` depuis la session Redis (deja stocke).

```python
# Dans list_available_tracks
session_data = await redis_client.get_session(session_id)
youtube_id = session_data.get("youtube_id") if session_data else None

# Check session path first, then cache fallback
ref_vocals_ready = await storage.exists(f"sessions/{session_id}_ref/vocals.wav")
if not ref_vocals_ready and youtube_id:
    ref_vocals_ready = await storage.exists(f"cache/{youtube_id}/vocals.wav")
```

**9b. Metadata `source` dans la reponse tracks**

Retourner un champ supplementaire `source` pour chaque piste, utile pour le debug et la transparence:

```python
# Reponse enrichie
{
  "tracks": [
    {"name": "ref/vocals", "available": true, "source": "cache"},
    {"name": "ref/instrumentals", "available": true, "source": "session"},
    ...
  ]
}
```

Gain: les pistes sont disponibles des que Demucs termine (avant la copie session), economisant ~5s. Le frontend peut optionnellement afficher la source dans un mode debug.

---

### Etape 10 — Backend: SSE event `tracks_ready`

**Fichier**: `backend/app/routers/sse.py` + `worker/tasks/pipeline.py`

Remplacer le polling StudioMode (2-5s) par une notification push via le stream SSE existant. Latence: **<500ms** au lieu de 0-5s de polling.

**10a. Worker: publier l'event quand `prepare_reference` termine**

Dans `pipeline.py`, apres l'upload des stems ref:
```python
# Fin de prepare_reference, apres upload session_ref
await redis_client.publish_session_event(session_id, {
    "type": "tracks_ready",
    "data": {
        "source": "ref",
        "tracks": ["vocals", "instrumentals"]
    }
})
```

Implementation: utiliser la meme mecanique que les events `session_status` et `analysis_progress` — ecrire dans Redis, le SSE router les diffuse.

Concretement dans `pipeline.py` (qui est sync/Celery), utiliser le pattern existant:
```python
import redis as sync_redis

r = sync_redis.from_url(REDIS_URL)
r.publish(f"session:{session_id}:events", json.dumps({
    "type": "tracks_ready",
    "data": {"source": "ref", "tracks": ["vocals", "instrumentals"]}
}))
```

**10b. SSE router: relayer l'event**

Dans `sse.py`, ajouter `tracks_ready` aux types d'events reconnus. Pas de changement structurel — le router diffuse deja tous les events du channel Redis.

**10c. Frontend: ecouter l'event dans StudioMode**

```tsx
// Dans StudioMode ou via useSSE existant
useEffect(() => {
  if (context !== 'practice' || !sessionId) return;

  const eventSource = useSSE(sessionId); // hook existant
  const handler = (event: SSEEvent) => {
    if (event.type === 'tracks_ready') {
      // Recharger les tracks immediatement
      loadTracks();
    }
  };
  eventSource.addEventListener('tracks_ready', handler);
  return () => eventSource.removeEventListener('tracks_ready', handler);
}, [context, sessionId, loadTracks]);
```

Le polling 2s (etape 4) reste en **fallback** si le SSE est indisponible (reconnexion, navigateur en background, etc.). Le SSE est la methode primaire, le polling le filet de securite.

---

## Ameliorations futures (hors scope)

### Pre-separation pendant le choix de chanson

Lancer `prepare_reference` des la **selection du track Spotify** (avant meme que l'utilisateur clique "Enregistrer"). Quand il arrive en mode recording, Demucs a deja tourne. Gain potentiel: ~25s elimines.

Necessite un refactor du flow session (creer une session "provisoire" ou un mecanisme de pre-warm cache). Impact architectural significatif → spec separee.

### Offline-capable mixer via Service Worker

Cacher les pistes audio ref dans un **Cache API** cote navigateur. Si l'utilisateur revient sur la meme chanson, les pistes sont servies localement sans aucune latence reseau.

Complexite: Cache invalidation, quota storage (~50 Mo/chanson), strategie d'eviction. → spec separee.

---

## Cas limites

| Scenario | Comportement |
|----------|-------------|
| Premiere ecoute (Demucs cache MISS, ~25s) | YouTube audio pendant ~25s → crossfade 500ms vers multi-track quand pistes pretes |
| Demucs cache HIT (~5-10s) | YouTube audio ~5-10s → crossfade 500ms |
| Tout en cache (instantane) | Multi-track direct, YouTube mute des le depart |
| Pistes echouent a charger | YouTube audio reste (fallback gracieux), badge "YT" persiste |
| Transition mid-recording | Crossfade attenue la discontinuite |
| Layout paysage mobile | Forward des controls YouTube → mute + crossfade fonctionnent |
| Passage en results | Multi-track reload 4 pistes, YouTube disparu, inchange |
| User seek directement sur YouTube | Detection via delta >1.5s dans bridge 250ms → sync multi-track |
| SSE indisponible / reconnexion | Polling 2s prend le relais (fallback automatique) |
| Retour sur meme chanson | Preferences mixer restaurees depuis localStorage |

---

## Ordre d'implementation

```
Phase 1 — Prerequis (independants, aucun risque)
  1. Etape 1-3  (API mute YouTube) — purement additif
  2. Etape 4    (StudioMode auto-retry + pre-fetch 2s) — testable seul
  3. Etape 5    (Landscape forward props) — forward de props

Phase 2 — Coeur (depend de Phase 1)
  4. Etape 6    (Orchestration page.tsx) — logique principale

Phase 3 — Polish (independants, ameliorations UX)
  5. Etape 7    (Indicateur visuel source) — badge YT/MT
  6. Etape 8    (Persistance mixer localStorage) — preferences

Phase 4 — Backend (optionnel, amelioration performance)
  7. Etape 9    (Cache fallback + metadata audio.py) — ~5s gain
  8. Etape 10   (SSE tracks_ready) — <500ms notification
```

---

## Verification

### Tests fonctionnels

1. **Test 1ere ecoute** (cache miss): choisir une chanson jamais analysee → YouTube joue avec audio → apres ~25s, crossfade smooth vers multi-track → badge passe de "YT" jaune a "MT" vert → verifier que le Mixer sidebar est fonctionnel
2. **Test cache hit**: rechoisir la meme chanson → pistes chargent en ~5-10s → crossfade smooth → preferences mixer restaurees
3. **Test enregistrement**: en mode ready avec multi-track actif, cliquer Enregistrer → le son continue via multi-track → arreter → upload → analyse fonctionne
4. **Test Mixer**: pendant ready/recording, solo les instrumentaux → on n'entend que la musique, pas la voix originale → changer les volumes → quitter et revenir → preferences preservees
5. **Test TransportBar**: play/pause/seek depuis la barre → video YouTube suit (sans drift) → lyrics se synchro → badge source visible
6. **Test clic YouTube direct**: cliquer play sur le player YouTube → multi-track demarre (YouTube reste mute)
7. **Test seek YouTube direct**: seek sur le player YouTube → multi-track se repositionne (detection delta >1.5s)
8. **Test fallback**: simuler echec chargement pistes → YouTube audio reste actif → badge "YT" persiste
9. **Test results**: apres analyse, verifier que le multi-track 4 pistes fonctionne normalement
10. **Test mobile paysage**: verifier que le mute + crossfade fonctionnent aussi en layout paysage

### Tests SSE (si etape 10 implementee)

11. **Test SSE tracks_ready**: observer dans DevTools → Network → EventSource que l'event `tracks_ready` arrive quand `prepare_reference` termine
12. **Test SSE fallback**: couper la connexion SSE → le polling 2s prend le relais → pistes se chargent quand meme

### Tests techniques

13. **Build**: `npx tsc --noEmit` + `npx next lint` clean
14. **Performance**: verifier que le crossfade 500ms ne cause pas de CPU spike (10 setInterval steps de 50ms)
15. **localStorage**: verifier que les preferences sont bien purgees si le schema change (version key)

---

## Estimation

| Phase | Lignes | Effort |
|-------|--------|--------|
| Phase 1 (Etapes 1-5) | ~55 lignes | Faible |
| Phase 2 (Etape 6) | ~150 lignes | Eleve |
| Phase 3 (Etapes 7-8) | ~80 lignes | Moyen |
| Phase 4 (Etapes 9-10) | ~60 lignes | Moyen |
| **Total** | **~345 lignes** | |
