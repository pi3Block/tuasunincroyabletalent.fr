/**
 * @fileoverview Orchestration hook for flow visualization state.
 *
 * Drives the FlowBar canvas by sampling the pre-computed amplitude envelope
 * at 30fps via requestAnimationFrame, applying EMA smoothing, and maintaining
 * a ring buffer of recent energy values for waveform rendering.
 *
 * Phase 1: pre-computed envelope only (works in YouTube simple + StudioMode).
 * Phase 2 (future): real-time AnalyserNode enhancement when StudioMode is active.
 */

import { useRef, useEffect, useState, useCallback } from 'react'

const HISTORY_SIZE = 64  // ~2s at 30fps
const EMA_ALPHA = 0.15   // smoothing factor (lower = smoother)
const TARGET_FPS = 30
const FRAME_INTERVAL = 1000 / TARGET_FPS

export interface FlowVisualizationState {
  /** Current raw energy level 0-1 */
  energy: number
  /** Smoothed energy (EMA) for gradual transitions */
  smoothEnergy: number
  /** Recent energy history for waveform drawing (newest at end) */
  energyHistory: number[]
  /** Data source being used */
  source: 'precomputed' | 'none'
}

interface UseFlowVisualizationOptions {
  /** O(1) lookup into pre-computed envelope */
  getEnergyAtTime: (t: number) => number
  /** Whether envelope data is available */
  envelopeReady: boolean
  /** Current playback time in seconds */
  currentTime: number
  /** Whether audio is playing */
  isPlaying: boolean
  /** Reduced motion preference (slower updates, no EMA) */
  reducedMotion?: boolean
}

const EMPTY_STATE: FlowVisualizationState = {
  energy: 0,
  smoothEnergy: 0,
  energyHistory: [],
  source: 'none',
}

export function useFlowVisualization({
  getEnergyAtTime,
  envelopeReady,
  currentTime,
  isPlaying,
  reducedMotion = false,
}: UseFlowVisualizationOptions): FlowVisualizationState {
  const [state, setState] = useState<FlowVisualizationState>(EMPTY_STATE)

  // Mutable refs for rAF loop (avoids stale closures)
  const smoothRef = useRef(0)
  const historyRef = useRef<number[]>(new Array(HISTORY_SIZE).fill(0))
  const lastFrameRef = useRef(0)
  const currentTimeRef = useRef(currentTime)
  const isPlayingRef = useRef(isPlaying)

  // Keep refs in sync
  currentTimeRef.current = currentTime
  isPlayingRef.current = isPlaying

  const tick = useCallback(() => {
    const raw = getEnergyAtTime(currentTimeRef.current)

    // EMA smoothing (skip in reduced motion)
    const smooth = reducedMotion
      ? raw
      : EMA_ALPHA * raw + (1 - EMA_ALPHA) * smoothRef.current
    smoothRef.current = smooth

    // Push to ring buffer
    const hist = historyRef.current
    hist.push(smooth)
    if (hist.length > HISTORY_SIZE) hist.shift()

    setState({
      energy: raw,
      smoothEnergy: smooth,
      energyHistory: hist.slice(),
      source: 'precomputed',
    })
  }, [getEnergyAtTime, reducedMotion])

  useEffect(() => {
    if (!envelopeReady) {
      setState(EMPTY_STATE)
      return
    }

    // Initial tick to show something immediately
    tick()

    if (!isPlaying) return

    let rafId: number
    const loop = (timestamp: number) => {
      const elapsed = timestamp - lastFrameRef.current
      if (elapsed >= FRAME_INTERVAL) {
        lastFrameRef.current = timestamp - (elapsed % FRAME_INTERVAL)
        tick()
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    return () => cancelAnimationFrame(rafId)
  }, [envelopeReady, isPlaying, tick])

  // When paused but envelope is ready, still update on time changes (seeking)
  useEffect(() => {
    if (!envelopeReady || isPlaying) return
    tick()
  }, [envelopeReady, isPlaying, currentTime, tick])

  return state
}
