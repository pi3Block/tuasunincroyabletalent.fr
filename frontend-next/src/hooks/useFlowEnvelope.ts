/**
 * @fileoverview Hook to fetch pre-computed vocal amplitude envelope for flow visualization.
 *
 * The envelope is a compact time-series (20 Hz, ~50ms windows) of normalized RMS
 * energy values (0-1) computed from the Demucs-separated reference vocals.
 * It's generated server-side during `prepare_reference` and cached in storage.
 *
 * Provides `getEnergyAtTime(t)` for O(1) lookup into the envelope array.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type FlowEnvelopeResponse } from '@/api/client'

export interface FlowEnvelopeData {
  values: number[]
  sampleRateHz: number
  durationSeconds: number
}

export interface UseFlowEnvelopeResult {
  envelope: FlowEnvelopeData | null
  status: 'idle' | 'loading' | 'found' | 'not_found' | 'error'
  /** O(1) lookup: returns energy 0-1 at the given time in seconds */
  getEnergyAtTime: (t: number) => number
}

export function useFlowEnvelope(youtubeVideoId: string | null): UseFlowEnvelopeResult {
  const [envelope, setEnvelope] = useState<FlowEnvelopeData | null>(null)
  const [status, setStatus] = useState<UseFlowEnvelopeResult['status']>('idle')
  const envelopeRef = useRef<FlowEnvelopeData | null>(null)

  useEffect(() => {
    if (!youtubeVideoId) {
      setEnvelope(null)
      envelopeRef.current = null
      setStatus('idle')
      return
    }

    let cancelled = false
    setStatus('loading')

    api
      .getFlowEnvelope(youtubeVideoId)
      .then((res: FlowEnvelopeResponse) => {
        if (cancelled) return
        if (res.status === 'found' && res.values && res.sample_rate_hz) {
          const data: FlowEnvelopeData = {
            values: res.values,
            sampleRateHz: res.sample_rate_hz,
            durationSeconds: res.duration_seconds ?? 0,
          }
          setEnvelope(data)
          envelopeRef.current = data
          setStatus('found')
        } else {
          setStatus('not_found')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [youtubeVideoId])

  const getEnergyAtTime = useCallback((t: number): number => {
    const env = envelopeRef.current
    if (!env || env.values.length === 0) return 0
    const index = Math.floor(t * env.sampleRateHz)
    if (index < 0) return env.values[0]
    if (index >= env.values.length) return env.values[env.values.length - 1]
    return env.values[index]
  }, [])

  return { envelope, status, getEnergyAtTime }
}
