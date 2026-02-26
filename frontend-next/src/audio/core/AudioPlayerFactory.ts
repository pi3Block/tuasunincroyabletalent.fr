/**
 * Factory Pattern for creating audio players.
 * Abstracts the complexity of audio player creation.
 */
import { TrackProcessor } from './TrackProcessor'
import type { AudioSource, TrackType, TrackId } from '../types'

/**
 * Build URL for audio track from the API.
 */
export function buildAudioUrl(
  sessionId: string,
  source: AudioSource,
  trackType: TrackType
): string {
  const baseUrl = ''  // Next.js rewrites handle /api/* → api.kiaraoke.fr
  return `${baseUrl}/api/audio/${sessionId}/${source}/${trackType}`
}

/**
 * Generate unique track key from TrackId.
 */
export function getTrackKey(id: TrackId): string {
  return `${id.source}:${id.type}`
}

/**
 * Parse track key back to TrackId.
 */
export function parseTrackKey(key: string): TrackId {
  const [source, type] = key.split(':') as [AudioSource, TrackType]
  return { source, type }
}

/**
 * Factory function to create a configured TrackProcessor.
 */
export function createTrackProcessor(): TrackProcessor {
  return new TrackProcessor()
}

/**
 * Factory function to create audio element with proper config.
 */
export function createAudioElement(url: string): HTMLAudioElement {
  const audio = new Audio()
  audio.crossOrigin = 'anonymous' // Required for Web Audio API
  audio.preload = 'metadata'
  audio.src = url
  return audio
}

/**
 * Configuration presets for different track types.
 */
export const TRACK_PRESETS = {
  ref: {
    vocals: { defaultVolume: 0.8, defaultPan: 0, label: 'Voix originale', icon: 'mic' },
    instrumentals: { defaultVolume: 0.6, defaultPan: 0, label: 'Instrumental', icon: 'music' },
    original: { defaultVolume: 0.7, defaultPan: 0, label: 'Original', icon: 'disc' },
  },
  user: {
    vocals: { defaultVolume: 1.0, defaultPan: 0, label: 'Votre voix', icon: 'mic' },
    instrumentals: { defaultVolume: 0.4, defaultPan: 0, label: 'Votre instru', icon: 'music' },
    original: { defaultVolume: 0.8, defaultPan: 0, label: 'Votre enregistrement', icon: 'disc' },
  },
} as const

/**
 * Get track label in French.
 */
export function getTrackLabel(id: TrackId): string {
  return TRACK_PRESETS[id.source][id.type].label
}

/**
 * Get default volume for a track type.
 */
export function getDefaultVolume(id: TrackId): number {
  return TRACK_PRESETS[id.source][id.type].defaultVolume
}

/**
 * Get all possible track IDs.
 */
export function getAllTrackIds(): TrackId[] {
  return [
    { source: 'ref', type: 'vocals' },
    { source: 'ref', type: 'instrumentals' },
    { source: 'user', type: 'vocals' },
    { source: 'user', type: 'instrumentals' },
  ]
}

/**
 * Get track IDs for practice mode (reference only).
 */
export function getPracticeTrackIds(): TrackId[] {
  return [
    { source: 'ref', type: 'vocals' },
    { source: 'ref', type: 'instrumentals' },
  ]
}
