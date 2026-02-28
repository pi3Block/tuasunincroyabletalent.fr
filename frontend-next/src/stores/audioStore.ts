/**
 * Audio Player State Management
 * Manages multi-track playback state with Zustand.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { TrackState, TransportState, TrackId } from '@/audio/types'
import { getTrackKey, getDefaultVolume } from '@/audio/core/AudioPlayerFactory'
import type { EffectType, EffectState, EffectParams } from '@/audio/effects/types'
import { DEFAULT_EFFECTS } from '@/audio/effects/types'

interface AudioState {
  // Track states
  tracks: Record<string, TrackState>

  // Transport (shared playback state)
  transport: TransportState

  // Master controls
  masterVolume: number

  // Loading state
  isLoading: boolean
  loadingMessage: string

  // Actions
  addTrack: (id: TrackId, url: string) => void
  removeTrack: (id: TrackId) => void
  setTrackLoading: (id: TrackId, loading: boolean) => void
  setTrackLoaded: (id: TrackId, duration: number) => void
  setTrackError: (id: TrackId, error: string) => void
  setTrackVolume: (id: TrackId, volume: number) => void
  setTrackMuted: (id: TrackId, muted: boolean) => void
  setTrackSolo: (id: TrackId, solo: boolean) => void
  setTrackPan: (id: TrackId, pan: number) => void

  // Effects actions
  setTrackEffectEnabled: (id: TrackId, effectType: EffectType, enabled: boolean) => void
  setTrackEffectParams: (id: TrackId, effectType: EffectType, params: EffectParams) => void
  setTrackEffects: (id: TrackId, effects: Record<EffectType, EffectState>) => void

  // Transport actions
  play: () => void
  pause: () => void
  stop: () => void
  seek: (time: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setSeeking: (seeking: boolean) => void

  // Master actions
  setMasterVolume: (volume: number) => void

  // Loading actions
  setLoading: (loading: boolean, message?: string) => void

  // Reset
  reset: () => void
}

const initialTransport: TransportState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  seeking: false,
}

export const useAudioStore = create<AudioState>((set) => ({
  tracks: {},
  transport: initialTransport,
  masterVolume: 1.0,
  isLoading: false,
  loadingMessage: '',

  addTrack: (id, url) => {
    const key = getTrackKey(id)
    const defaultVolume = getDefaultVolume(id)
    set((state) => ({
      tracks: {
        ...state.tracks,
        [key]: {
          id,
          url,
          loaded: false,
          loading: true,
          error: null,
          duration: 0,
          volume: defaultVolume,
          muted: false,
          solo: false,
          pan: 0,
          effects: structuredClone(DEFAULT_EFFECTS),
        },
      },
    }))
  },

  removeTrack: (id) => {
    const key = getTrackKey(id)
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _, ...rest } = state.tracks
      return { tracks: rest }
    })
  },

  setTrackLoading: (id, loading) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            loading,
          },
        },
      }
    })
  },

  setTrackLoaded: (id, duration) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            loaded: true,
            loading: false,
            duration,
          },
        },
      }
    })
  },

  setTrackError: (id, error) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            loading: false,
            error,
          },
        },
      }
    })
  },

  setTrackVolume: (id, volume) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            volume: Math.max(0, Math.min(1, volume)),
          },
        },
      }
    })
  },

  setTrackMuted: (id, muted) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            muted,
          },
        },
      }
    })
  },

  setTrackSolo: (id, solo) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            solo,
          },
        },
      }
    })
  },

  setTrackPan: (id, pan) => {
    const key = getTrackKey(id)
    set((state) => {
      if (!state.tracks[key]) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...state.tracks[key],
            pan: Math.max(-1, Math.min(1, pan)),
          },
        },
      }
    })
  },

  setTrackEffectEnabled: (id, effectType, enabled) => {
    const key = getTrackKey(id)
    set((state) => {
      const track = state.tracks[key]
      if (!track) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...track,
            effects: {
              ...track.effects,
              [effectType]: { ...track.effects[effectType], enabled },
            },
          },
        },
      }
    })
  },

  setTrackEffectParams: (id, effectType, params) => {
    const key = getTrackKey(id)
    set((state) => {
      const track = state.tracks[key]
      if (!track) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: {
            ...track,
            effects: {
              ...track.effects,
              [effectType]: { ...track.effects[effectType], params },
            },
          },
        },
      }
    })
  },

  setTrackEffects: (id, effects) => {
    const key = getTrackKey(id)
    set((state) => {
      const track = state.tracks[key]
      if (!track) return state
      return {
        tracks: {
          ...state.tracks,
          [key]: { ...track, effects },
        },
      }
    })
  },

  play: () =>
    set((state) => ({
      transport: { ...state.transport, playing: true },
    })),

  pause: () =>
    set((state) => ({
      transport: { ...state.transport, playing: false },
    })),

  stop: () =>
    set((state) => ({
      transport: { ...state.transport, playing: false, currentTime: 0 },
    })),

  seek: (time) =>
    set((state) => ({
      transport: { ...state.transport, currentTime: time, seeking: true },
    })),

  setCurrentTime: (time) =>
    set((state) => ({
      transport: { ...state.transport, currentTime: time, seeking: false },
    })),

  setDuration: (duration) =>
    set((state) => ({
      transport: { ...state.transport, duration },
    })),

  setSeeking: (seeking) =>
    set((state) => ({
      transport: { ...state.transport, seeking },
    })),

  setMasterVolume: (volume) =>
    set({ masterVolume: Math.max(0, Math.min(1, volume)) }),

  setLoading: (isLoading, message = '') =>
    set({ isLoading, loadingMessage: message }),

  reset: () =>
    set({
      tracks: {},
      transport: initialTransport,
      masterVolume: 1.0,
      isLoading: false,
      loadingMessage: '',
    }),
}))

// ============================================
// Performance-optimized selector hooks
// ============================================

/** Transport state - changes frequently during playback */
export const useTransport = () => useAudioStore((s) => s.transport)

/** All tracks - use for TrackMixer */
export const useTracks = () => useAudioStore((s) => s.tracks)

/** Master volume */
export const useMasterVolume = () => useAudioStore((s) => s.masterVolume)

/** Loading state */
export const useAudioLoading = () =>
  useAudioStore(
    useShallow((s) => ({
      isLoading: s.isLoading,
      loadingMessage: s.loadingMessage,
    }))
  )

/** Single track by ID */
export const useTrack = (id: TrackId) => {
  const key = getTrackKey(id)
  return useAudioStore((s) => s.tracks[key])
}

/** Check if any track is soloed */
export const useHasSoloTrack = () =>
  useAudioStore((s) => Object.values(s.tracks).some((t) => t.solo))

/** Get all loaded tracks count */
export const useLoadedTracksCount = () =>
  useAudioStore(
    (s) => Object.values(s.tracks).filter((t) => t.loaded).length
  )

/** Get total tracks count */
export const useTotalTracksCount = () =>
  useAudioStore((s) => Object.keys(s.tracks).length)

/** Per-track effects state */
export const useTrackEffects = (id: TrackId) => {
  const key = getTrackKey(id)
  return useAudioStore((s) => s.tracks[key]?.effects)
}

/** Whether any effect is active on a given track */
export const useTrackHasActiveEffects = (id: TrackId) => {
  const key = getTrackKey(id)
  return useAudioStore((s) => {
    const effects = s.tracks[key]?.effects
    if (!effects) return false
    return Object.values(effects).some((e) => e.enabled)
  })
}
