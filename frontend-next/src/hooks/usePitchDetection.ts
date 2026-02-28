/**
 * Hook for real-time pitch detection using Web Audio API.
 * Uses autocorrelation algorithm for fundamental frequency detection.
 *
 * Performance: Throttled to ~12fps to avoid blocking the main thread
 * during recording (autocorrelation is O(n²) on buffer size).
 */
import { useState, useRef, useCallback, useEffect } from 'react'

export interface PitchData {
  frequency: number      // Hz (0 if no voice detected)
  note: string          // e.g., "A4", "C#5"
  cents: number         // Deviation from perfect pitch (-50 to +50)
  volume: number        // Volume level 0-1
  isVoiced: boolean     // Is there a voice detected?
}

export interface UsePitchDetectionOptions {
  minFrequency?: number   // Minimum voice frequency (default 80Hz)
  maxFrequency?: number   // Maximum voice frequency (default 1000Hz)
  smoothingFactor?: number // Smoothing for less jittery display (0-1)
}

export interface UsePitchDetectionReturn {
  pitchData: PitchData
  isAnalyzing: boolean
  startAnalysis: (stream: MediaStream) => void
  stopAnalysis: () => void
}

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Target ~12fps for pitch detection (enough for visual feedback, easy on main thread)
const PITCH_FRAME_INTERVAL = 80 // ms

// Convert frequency to note name and cents deviation
function frequencyToNote(frequency: number): { note: string; cents: number } {
  if (frequency <= 0) return { note: '-', cents: 0 }

  // A4 = 440Hz as reference
  const A4 = 440
  const semitonesFromA4 = 12 * Math.log2(frequency / A4)
  const roundedSemitones = Math.round(semitonesFromA4)
  const cents = Math.round((semitonesFromA4 - roundedSemitones) * 100)

  // Calculate note index (A4 is index 9 in octave 4)
  const noteIndex = ((roundedSemitones % 12) + 12 + 9) % 12
  const octave = Math.floor((roundedSemitones + 9) / 12) + 4

  const note = `${NOTE_NAMES[noteIndex]}${octave}`
  return { note, cents }
}

// Autocorrelation-based pitch detection
function autoCorrelate(
  buffer: Float32Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number
): number {
  const SIZE = buffer.length
  const maxSamples = Math.floor(sampleRate / minFreq)
  const minSamples = Math.floor(sampleRate / maxFreq)

  // Check if there's enough signal (reuse same buffer, no extra alloc)
  let rms = 0
  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i]
  }
  rms = Math.sqrt(rms / SIZE)

  if (rms < 0.01) return 0 // Too quiet

  // Autocorrelation
  let bestOffset = -1
  let bestCorrelation = 0
  let foundGoodCorrelation = false

  for (let offset = minSamples; offset < maxSamples && offset < SIZE; offset++) {
    let correlation = 0

    for (let i = 0; i < SIZE - offset; i++) {
      correlation += buffer[i] * buffer[i + offset]
    }

    correlation = correlation / (SIZE - offset)

    if (correlation > 0.9) {
      foundGoodCorrelation = true
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestOffset = offset
    }
  }

  if (!foundGoodCorrelation || bestCorrelation < 0.5 || bestOffset === -1) {
    return 0
  }

  // Parabolic interpolation for more precision
  const prev = autoCorrelateAt(buffer, bestOffset - 1)
  const curr = autoCorrelateAt(buffer, bestOffset)
  const next = autoCorrelateAt(buffer, bestOffset + 1)

  const shift = (prev - next) / (2 * (prev - 2 * curr + next))
  const refinedOffset = bestOffset + shift

  return sampleRate / refinedOffset
}

function autoCorrelateAt(buffer: Float32Array, offset: number): number {
  if (offset < 0 || offset >= buffer.length) return 0
  let correlation = 0
  const SIZE = buffer.length
  for (let i = 0; i < SIZE - offset; i++) {
    correlation += buffer[i] * buffer[i + offset]
  }
  return correlation / (SIZE - offset)
}

const DEFAULT_PITCH: PitchData = {
  frequency: 0,
  note: '-',
  cents: 0,
  volume: 0,
  isVoiced: false,
}

export function usePitchDetection(
  options: UsePitchDetectionOptions = {}
): UsePitchDetectionReturn {
  const {
    minFrequency = 80,
    maxFrequency = 1000,
    smoothingFactor = 0.3,
  } = options

  const [pitchData, setPitchData] = useState<PitchData>(DEFAULT_PITCH)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const previousFrequencyRef = useRef<number>(0)
  // Reuse buffer across frames to avoid GC pressure
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  // Timestamp of last actual analysis (for throttling)
  const lastAnalysisRef = useRef<number>(0)

  const analyze = useCallback((timestamp: number) => {
    if (!analyserRef.current) return

    // Schedule next frame first (keeps loop alive even if we skip this frame)
    animationFrameRef.current = requestAnimationFrame(analyze)

    // Throttle: skip frame if not enough time has passed
    const elapsed = timestamp - lastAnalysisRef.current
    if (elapsed < PITCH_FRAME_INTERVAL) return
    lastAnalysisRef.current = timestamp

    const analyser = analyserRef.current
    const bufferLength = analyser.fftSize

    // Reuse Float32Array buffer
    if (!bufferRef.current || bufferRef.current.length !== bufferLength) {
      bufferRef.current = new Float32Array(bufferLength)
    }
    const buffer = bufferRef.current

    analyser.getFloatTimeDomainData(buffer)

    // Fast volume check — skip expensive autocorrelation if silent
    let rms = 0
    for (let i = 0; i < bufferLength; i++) {
      rms += buffer[i] * buffer[i]
    }
    rms = Math.sqrt(rms / bufferLength)
    const volume = Math.min(1, rms * 10)

    if (rms < 0.01) {
      // Silent — skip autocorrelation entirely, just update volume
      if (previousFrequencyRef.current !== 0) {
        previousFrequencyRef.current = 0
        setPitchData({ frequency: 0, note: '-', cents: 0, volume, isVoiced: false })
      }
      return
    }

    // Detect pitch (expensive O(n²) autocorrelation)
    const frequency = autoCorrelate(
      buffer,
      audioContextRef.current!.sampleRate,
      minFrequency,
      maxFrequency
    )

    // Apply smoothing
    const smoothedFrequency = frequency > 0
      ? previousFrequencyRef.current > 0
        ? previousFrequencyRef.current * smoothingFactor + frequency * (1 - smoothingFactor)
        : frequency
      : 0

    previousFrequencyRef.current = smoothedFrequency

    const { note, cents } = frequencyToNote(smoothedFrequency)

    setPitchData({
      frequency: Math.round(smoothedFrequency),
      note,
      cents,
      volume,
      isVoiced: smoothedFrequency > 0 && volume > 0.05,
    })
  }, [minFrequency, maxFrequency, smoothingFactor])

  const startAnalysis = useCallback((stream: MediaStream) => {
    try {
      // Create audio context
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      audioContextRef.current = audioContext

      // Create analyser node
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current = analyser

      // Connect stream to analyser
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      sourceRef.current = source

      setIsAnalyzing(true)
    } catch (err) {
      // Clean up AudioContext if setup failed partway through
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      analyserRef.current = null
      sourceRef.current = null
      throw err
    }
  }, [])

  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false)

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyserRef.current = null
    previousFrequencyRef.current = 0
    bufferRef.current = null
    lastAnalysisRef.current = 0

    setPitchData(DEFAULT_PITCH)
  }, [])

  // Start analysis loop when isAnalyzing changes
  useEffect(() => {
    if (isAnalyzing) {
      lastAnalysisRef.current = 0
      animationFrameRef.current = requestAnimationFrame(analyze)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isAnalyzing, analyze])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAnalysis()
    }
  }, [stopAnalysis])

  return {
    pitchData,
    isAnalyzing,
    startAnalysis,
    stopAnalysis,
  }
}
