/**
 * Type definitions for per-track audio effects (Tone.js).
 */

export type EffectType = 'pitchShift' | 'reverb' | 'compressor'

export interface PitchShiftParams {
  type: 'pitchShift'
  /** Semitones shift (-12 to +12) */
  semitones: number
}

export interface ReverbParams {
  type: 'reverb'
  /** Decay time in seconds (0.1 to 10) */
  decay: number
  /** Wet/dry mix (0 to 1) */
  wet: number
}

export interface CompressorParams {
  type: 'compressor'
  /** Threshold in dB (-60 to 0) */
  threshold: number
  /** Compression ratio (1 to 20) */
  ratio: number
}

export type EffectParams = PitchShiftParams | ReverbParams | CompressorParams

export interface EffectState {
  enabled: boolean
  params: EffectParams
}

export type TrackEffectsState = Record<EffectType, EffectState>

export const DEFAULT_EFFECTS: TrackEffectsState = {
  pitchShift: {
    enabled: false,
    params: { type: 'pitchShift', semitones: 0 },
  },
  reverb: {
    enabled: false,
    params: { type: 'reverb', decay: 2.5, wet: 0.3 },
  },
  compressor: {
    enabled: false,
    params: { type: 'compressor', threshold: -24, ratio: 4 },
  },
}
