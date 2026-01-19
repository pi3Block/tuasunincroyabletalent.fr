/**
 * Audio Module - Public exports
 *
 * This module provides a professional multi-track audio player system
 * for the AI Voice Jury application.
 */

// Types
export type {
  AudioSource,
  TrackType,
  TrackId,
  TrackState,
  TransportState,
  MixerState,
  AudioTracksResponse,
  AudioPlayerOptions,
  StudioContext,
} from './types'

// Core
export {
  getAudioContext,
  getMasterGain,
  setMasterVolume,
  ensureAudioContextRunning,
  isAudioContextRunning,
  getAudioContextState,
  closeAudioContext,
} from './core/AudioContext'

export { TrackProcessor } from './core/TrackProcessor'

export {
  buildAudioUrl,
  getTrackKey,
  parseTrackKey,
  createTrackProcessor,
  createAudioElement,
  getTrackLabel,
  getDefaultVolume,
  getAllTrackIds,
  getPracticeTrackIds,
  TRACK_PRESETS,
} from './core/AudioPlayerFactory'

// Hooks
export { useMultiTrack } from './hooks/useMultiTrack'

// Components
export { VolumeSlider } from './components/VolumeSlider'
export { AudioTrack } from './components/AudioTrack'
export { TrackMixer } from './components/TrackMixer'
export { TransportBar } from './components/TransportBar'
export { StudioMode } from './components/StudioMode'
