/**
 * Hook for real-time pitch detection using Web Audio API.
 *
 * The expensive O(n²) autocorrelation runs in a **Web Worker** so the main
 * thread is never blocked — no more audio stuttering during recording.
 *
 * Main thread only does:
 *  - rAF loop (throttled ~12fps)
 *  - getFloatTimeDomainData  (fast WebAudio copy)
 *  - RMS check               (O(n), < 0.1 ms)
 *  - postMessage to worker    (structured clone of Float32Array)
 *
 * Worker thread does:
 *  - Full autocorrelation + parabolic interpolation
 *  - Posts back { frequency }
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { getAudioContext } from '@/audio/core/AudioContext'

export interface PitchData {
  frequency: number      // Hz (0 if no voice detected)
  note: string          // e.g., "A4", "C#5"
  cents: number         // Deviation from perfect pitch (-50 to +50)
  volume: number        // Volume level 0-1
  isVoiced: boolean     // Is there a voice detected?
}

export interface UsePitchDetectionOptions {
  minFrequency?: number
  maxFrequency?: number
  smoothingFactor?: number
}

export interface UsePitchDetectionReturn {
  pitchData: PitchData
  isAnalyzing: boolean
  startAnalysis: (stream: MediaStream) => void
  stopAnalysis: () => void
}

// ── Note helpers (main thread, cheap) ───────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function frequencyToNote(frequency: number): { note: string; cents: number } {
  if (frequency <= 0) return { note: '-', cents: 0 }
  const A4 = 440
  const semitonesFromA4 = 12 * Math.log2(frequency / A4)
  const roundedSemitones = Math.round(semitonesFromA4)
  const cents = Math.round((semitonesFromA4 - roundedSemitones) * 100)
  const noteIndex = ((roundedSemitones % 12) + 12 + 9) % 12
  const octave = Math.floor((roundedSemitones + 9) / 12) + 4
  return { note: `${NOTE_NAMES[noteIndex]}${octave}`, cents }
}

// ── Inline Web Worker (autocorrelation off main thread) ─────────────────────

const WORKER_CODE = /* js */ `
'use strict';

function autoCorrelateAt(buffer, offset) {
  if (offset < 0 || offset >= buffer.length) return 0;
  var c = 0, SIZE = buffer.length;
  for (var i = 0; i < SIZE - offset; i++) c += buffer[i] * buffer[i + offset];
  return c / (SIZE - offset);
}

function autoCorrelate(buffer, sampleRate, minFreq, maxFreq) {
  var SIZE = buffer.length;
  var maxSamples = Math.floor(sampleRate / minFreq);
  var minSamples = Math.floor(sampleRate / maxFreq);

  var rms = 0;
  for (var i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return 0;

  var bestOffset = -1, bestCorrelation = 0, foundGood = false;

  for (var offset = minSamples; offset < maxSamples && offset < SIZE; offset++) {
    var correlation = 0;
    for (var j = 0; j < SIZE - offset; j++) correlation += buffer[j] * buffer[j + offset];
    correlation /= (SIZE - offset);
    if (correlation > 0.9) foundGood = true;
    if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = offset; }
  }

  if (!foundGood || bestCorrelation < 0.5 || bestOffset === -1) return 0;

  var prev = autoCorrelateAt(buffer, bestOffset - 1);
  var curr = autoCorrelateAt(buffer, bestOffset);
  var next = autoCorrelateAt(buffer, bestOffset + 1);
  var shift = (prev - next) / (2 * (prev - 2 * curr + next));
  return sampleRate / (bestOffset + shift);
}

self.onmessage = function(e) {
  var d = e.data;
  var freq = autoCorrelate(d.buffer, d.sampleRate, d.minFreq, d.maxFreq);
  self.postMessage({ frequency: freq, id: d.id });
};
`

let sharedWorker: Worker | null = null
let workerRefCount = 0

function getSharedWorker(): Worker {
  if (!sharedWorker) {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' })
    sharedWorker = new Worker(URL.createObjectURL(blob))
  }
  workerRefCount++
  return sharedWorker
}

function releaseSharedWorker() {
  workerRefCount--
  if (workerRefCount <= 0 && sharedWorker) {
    sharedWorker.terminate()
    sharedWorker = null
    workerRefCount = 0
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

const PITCH_FRAME_INTERVAL = 80 // ~12fps
const WARMUP_DELAY = 800 // ms — let MediaRecorder stabilize before starting pitch analysis

const DEFAULT_PITCH: PitchData = {
  frequency: 0,
  note: '-',
  cents: 0,
  volume: 0,
  isVoiced: false,
}

// ── Hook ────────────────────────────────────────────────────────────────────

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
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const lastAnalysisRef = useRef<number>(0)
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef(false) // true while waiting for worker response
  const msgIdRef = useRef(0)
  const startTimeRef = useRef(0)
  // Store volume from main thread so we can use it when worker responds
  const lastVolumeRef = useRef(0)

  // Worker message handler — receives { frequency, id }
  const handleWorkerMessage = useCallback((e: MessageEvent) => {
    pendingRef.current = false
    const { frequency } = e.data as { frequency: number; id: number }
    const volume = lastVolumeRef.current

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
  }, [smoothingFactor])

  // rAF loop — only reads audio data + sends to worker (zero heavy computation)
  const analyze = useCallback((timestamp: number) => {
    if (!analyserRef.current) return
    animationFrameRef.current = requestAnimationFrame(analyze)

    // Warmup: skip first N ms to let MediaRecorder stabilize
    if (timestamp - startTimeRef.current < WARMUP_DELAY) return

    // Throttle to ~12fps
    if (timestamp - lastAnalysisRef.current < PITCH_FRAME_INTERVAL) return
    lastAnalysisRef.current = timestamp

    // Don't send if worker is still processing previous frame
    if (pendingRef.current) return

    const analyser = analyserRef.current
    const bufferLength = analyser.fftSize

    if (!bufferRef.current || bufferRef.current.length !== bufferLength) {
      bufferRef.current = new Float32Array(bufferLength)
    }
    const buffer = bufferRef.current
    analyser.getFloatTimeDomainData(buffer)

    // Fast RMS check on main thread (O(n), ~0.05ms for 2048 samples)
    let rms = 0
    for (let i = 0; i < bufferLength; i++) rms += buffer[i] * buffer[i]
    rms = Math.sqrt(rms / bufferLength)
    const volume = Math.min(1, rms * 10)
    lastVolumeRef.current = volume

    if (rms < 0.01) {
      // Silent — no need to send to worker
      if (previousFrequencyRef.current !== 0) {
        previousFrequencyRef.current = 0
        setPitchData({ frequency: 0, note: '-', cents: 0, volume, isVoiced: false })
      }
      return
    }

    // Send buffer copy to worker (structured clone = off main thread)
    if (workerRef.current) {
      pendingRef.current = true
      const copy = new Float32Array(buffer)
      workerRef.current.postMessage({
        buffer: copy,
        sampleRate: audioContextRef.current!.sampleRate,
        minFreq: minFrequency,
        maxFreq: maxFrequency,
        id: ++msgIdRef.current,
      }, [copy.buffer]) // Transfer buffer (zero-copy)
    }
  }, [minFrequency, maxFrequency])

  const startAnalysis = useCallback((stream: MediaStream) => {
    try {
      // Use the singleton AudioContext shared with playback — avoids hardware
      // contention between two contexts which causes music stuttering/jitter.
      const audioContext = getAudioContext()
      audioContextRef.current = audioContext

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current = analyser

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      sourceRef.current = source

      // Spin up shared worker
      const worker = getSharedWorker()
      worker.onmessage = handleWorkerMessage
      workerRef.current = worker

      setIsAnalyzing(true)
    } catch (err) {
      // Don't close the shared AudioContext on error — it's used by playback
      audioContextRef.current = null
      analyserRef.current = null
      sourceRef.current = null
      throw err
    }
  }, [handleWorkerMessage])

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

    // Don't close the AudioContext — it's the shared singleton used by playback.
    // Just drop the reference; the analyser/source are already disconnected above.
    audioContextRef.current = null

    if (workerRef.current) {
      workerRef.current.onmessage = null
      releaseSharedWorker()
      workerRef.current = null
    }

    analyserRef.current = null
    previousFrequencyRef.current = 0
    bufferRef.current = null
    lastAnalysisRef.current = 0
    pendingRef.current = false
    msgIdRef.current = 0
    lastVolumeRef.current = 0

    setPitchData(DEFAULT_PITCH)
  }, [])

  useEffect(() => {
    if (isAnalyzing) {
      startTimeRef.current = performance.now()
      lastAnalysisRef.current = 0
      animationFrameRef.current = requestAnimationFrame(analyze)
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isAnalyzing, analyze])

  useEffect(() => {
    return () => { stopAnalysis() }
  }, [stopAnalysis])

  return { pitchData, isAnalyzing, startAnalysis, stopAnalysis }
}
