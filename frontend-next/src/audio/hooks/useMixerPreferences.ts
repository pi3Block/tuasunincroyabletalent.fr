/**
 * Hook to persist and restore mixer preferences (volume, mute, solo) per song.
 * Stores in localStorage keyed by Spotify track ID.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useAudioStore } from '@/stores/audioStore'
import type { TrackEffectsState } from '../effects/types'

interface TrackPrefs {
  volume: number
  muted: boolean
  solo: boolean
  effects?: TrackEffectsState
}

interface MixerPreferences {
  tracks: Record<string, TrackPrefs>
  savedAt: number
}

const STORAGE_PREFIX = 'mixer_prefs_'

export function useMixerPreferences(spotifyTrackId: string | null) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoredRef = useRef(false)

  // Restore preferences when tracks are loaded
  useEffect(() => {
    if (!spotifyTrackId || restoredRef.current) return

    const key = `${STORAGE_PREFIX}${spotifyTrackId}`
    try {
      const saved = localStorage.getItem(key)
      if (!saved) return

      const prefs: MixerPreferences = JSON.parse(saved)
      const store = useAudioStore.getState()
      const currentTracks = store.tracks

      // Only apply if we have tracks loaded
      if (Object.keys(currentTracks).length === 0) return

      Object.entries(prefs.tracks).forEach(([trackKey, settings]) => {
        if (currentTracks[trackKey]) {
          // Parse track key back to TrackId
          const [source, type] = trackKey.split(':') as [string, string]
          const id = { source: source as 'user' | 'ref', type: type as 'vocals' | 'instrumentals' | 'original' }
          store.setTrackVolume(id, settings.volume)
          store.setTrackMuted(id, settings.muted)
          store.setTrackSolo(id, settings.solo)
          if (settings.effects) {
            store.setTrackEffects(id, settings.effects)
          }
        }
      })
      restoredRef.current = true
    } catch (e) {
      console.warn('Failed to restore mixer preferences:', e)
    }
  }, [spotifyTrackId])

  // Save preferences (debounced)
  const save = useCallback(() => {
    if (!spotifyTrackId) return

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      try {
        const tracks = useAudioStore.getState().tracks
        const prefs: MixerPreferences = {
          tracks: Object.fromEntries(
            Object.entries(tracks).map(([key, t]) => [
              key,
              { volume: t.volume, muted: t.muted, solo: t.solo, effects: t.effects },
            ])
          ),
          savedAt: Date.now(),
        }
        localStorage.setItem(
          `${STORAGE_PREFIX}${spotifyTrackId}`,
          JSON.stringify(prefs)
        )
      } catch (e) {
        console.warn('Failed to save mixer preferences:', e)
      }
    }, 500)
  }, [spotifyTrackId])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Reset restored flag when track changes
  useEffect(() => {
    restoredRef.current = false
  }, [spotifyTrackId])

  return { save }
}
