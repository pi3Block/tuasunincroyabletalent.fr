/**
 * Audio Player Type Definitions
 * Types for the multi-track audio player system.
 */

/** Track source identifier */
export type AudioSource = 'user' | 'ref'

/** Track type identifier */
export type TrackType = 'vocals' | 'instrumentals' | 'original'

/** Combined track identifier */
export interface TrackId {
  source: AudioSource
  type: TrackType
}

/** Track state */
export interface TrackState {
  id: TrackId
  url: string
  loaded: boolean
  loading: boolean
  error: string | null
  duration: number

  // Playback state
  volume: number // 0-1
  muted: boolean
  solo: boolean
  pan: number // -1 (left) to 1 (right)
}

/** Transport state (shared across all tracks) */
export interface TransportState {
  playing: boolean
  currentTime: number
  duration: number
  seeking: boolean
}

/** Multi-track mixer state */
export interface MixerState {
  tracks: Record<string, TrackState>
  transport: TransportState
  masterVolume: number
}

/** Track availability response from API */
export interface AudioTracksResponse {
  session_id: string
  tracks: {
    ref: {
      vocals: boolean
      instrumentals: boolean
      original: boolean
    }
    user: {
      vocals: boolean
      instrumentals: boolean
      original: boolean
    }
  }
}

/** Factory options for creating audio players */
export interface AudioPlayerOptions {
  sessionId: string
  source: AudioSource
  trackType: TrackType
  autoLoad?: boolean
  onLoad?: () => void
  onError?: (error: Error) => void
  onTimeUpdate?: (time: number) => void
}

/** Studio mode context - where the studio is being used */
export type StudioContext = 'analyzing' | 'results' | 'practice'
