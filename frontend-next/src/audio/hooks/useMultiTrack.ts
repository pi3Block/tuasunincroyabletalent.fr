/**
 * Multi-track orchestrator hook.
 * Synchronizes playback across multiple tracks.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { useAudioStore } from '@/stores/audioStore'
import { TrackProcessor } from '../core/TrackProcessor'
import {
  buildAudioUrl,
  createAudioElement,
  createTrackProcessor,
  getTrackKey,
  getAllTrackIds,
  getPracticeTrackIds,
} from '../core/AudioPlayerFactory'
import { ensureAudioContextRunning, setMasterVolume } from '../core/AudioContext'
import type { TrackId, AudioTracksResponse, StudioContext } from '../types'
import type { EffectType } from '../effects/types'

interface UseMultiTrackOptions {
  sessionId: string
  context?: StudioContext
  onReady?: () => void
  onError?: (error: Error) => void
}

interface TrackInstance {
  audio: HTMLAudioElement
  processor: TrackProcessor
}

export function useMultiTrack({
  sessionId,
  context = 'results',
  onReady,
  onError,
}: UseMultiTrackOptions) {
  const trackInstancesRef = useRef<Map<string, TrackInstance>>(new Map())
  const animationFrameRef = useRef<number | null>(null)
  const isInitializedRef = useRef(false)
  const [isReady, setIsReady] = useState(false)

  const {
    tracks,
    transport,
    masterVolume,
    addTrack,
    setTrackLoaded,
    setTrackError,
    setCurrentTime,
    setDuration,
    play: storePlay,
    pause: storePause,
    stop: storeStop,
    reset,
    setLoading,
  } = useAudioStore()

  // Initialize a single track (directUrl bypasses API proxy → loads from storage directly)
  const initTrack = useCallback(
    async (id: TrackId, directUrl?: string | null): Promise<boolean> => {
      const key = getTrackKey(id)
      const url = directUrl || buildAudioUrl(sessionId, id.source, id.type)

      // Add to store
      addTrack(id, url)

      try {
        // Create audio element
        const audio = createAudioElement(url)
        const processor = createTrackProcessor()

        // Wait for metadata to load
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error(`Timeout loading ${key}`))
          }, 30000)

          audio.onloadedmetadata = () => {
            clearTimeout(timeoutId)
            resolve()
          }

          audio.onerror = () => {
            clearTimeout(timeoutId)
            reject(new Error(`Failed to load ${key}`))
          }

          audio.load()
        })

        // Connect to processor
        processor.connectAudioElement(audio)

        // Store instance
        trackInstancesRef.current.set(key, { audio, processor })

        // Update store
        setTrackLoaded(id, audio.duration)

        return true
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setTrackError(id, errorMessage)
        return false
      }
    },
    [sessionId, addTrack, setTrackLoaded, setTrackError]
  )

  // Fetch available tracks from API
  const fetchAvailableTracks = useCallback(async (): Promise<AudioTracksResponse | null> => {
    try {
      const baseUrl = ''  // Next.js rewrites handle /api/* → api.kiaraoke.fr
      const response = await fetch(`${baseUrl}/api/audio/${sessionId}/tracks`)
      if (!response.ok) {
        throw new Error(`Failed to fetch tracks: ${response.status}`)
      }
      const text = await response.text()
      if (!text || !text.trim()) return null
      try {
        return JSON.parse(text) as AudioTracksResponse
      } catch {
        console.warn('Invalid JSON from /api/audio/tracks:', text.slice(0, 100))
        return null
      }
    } catch (err) {
      console.error('Failed to fetch available tracks:', err)
      return null
    }
  }, [sessionId])

  // Reset initialization state so loadTracks can be called again (e.g. retries)
  const resetInit = useCallback(() => {
    isInitializedRef.current = false
    setIsReady(false)
  }, [])

  // Resolve direct storage URL for a track (bypasses API proxy → faster, no CORS redirect)
  const getDirectUrl = useCallback(
    (availableTracks: AudioTracksResponse | null, id: TrackId): string | null => {
      if (!availableTracks) return null
      const trackInfo = availableTracks.tracks[id.source]
      const urlKey = `${id.type}_url` as keyof typeof trackInfo
      const url = trackInfo[urlKey]
      return typeof url === 'string' && url.startsWith('http') ? url : null
    },
    []
  )

  // Load all available tracks
  const loadTracks = useCallback(async () => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true
    setIsReady(false)

    setLoading(true, 'Chargement des pistes audio...')

    try {
      // Fetch available tracks from API
      const availableTracks = await fetchAvailableTracks()

      // Determine which tracks to load based on context
      const trackIdsToLoad = context === 'practice' ? getPracticeTrackIds() : getAllTrackIds()

      // Filter to only available tracks
      const tracksToLoad = trackIdsToLoad.filter((id) => {
        if (!availableTracks) return true // Try all if API fails
        return availableTracks.tracks[id.source][id.type]
      })

      if (tracksToLoad.length === 0) {
        throw new Error('Aucune piste audio disponible')
      }

      // Load all tracks in parallel — use direct storage URLs when available
      const results = await Promise.all(
        tracksToLoad.map((id) => {
          const directUrl = getDirectUrl(availableTracks, id)
          return initTrack(id, directUrl)
        })
      )

      // Check if at least one loaded successfully
      const successCount = results.filter((r) => r).length
      if (successCount === 0) {
        throw new Error('Impossible de charger les pistes audio')
      }

      // Find max duration from loaded tracks
      let maxDuration = 0
      trackInstancesRef.current.forEach((instance) => {
        if (instance.audio.duration > maxDuration) {
          maxDuration = instance.audio.duration
        }
      })
      setDuration(maxDuration)

      setLoading(false)
      setIsReady(true)
      onReady?.()
    } catch (err) {
      setLoading(false)
      setIsReady(false)
      const error = err instanceof Error ? err : new Error('Unknown error')
      onError?.(error)
    }
  }, [context, fetchAvailableTracks, getDirectUrl, initTrack, setDuration, setLoading, onReady, onError])

  // Sync all tracks to current transport state
  const syncPlayback = useCallback(() => {
    const instances = trackInstancesRef.current

    instances.forEach((instance, key) => {
      const trackState = tracks[key]
      if (!trackState || !trackState.loaded) return

      // Sync time if drift is too large
      if (Math.abs(instance.audio.currentTime - transport.currentTime) > 0.15) {
        instance.audio.currentTime = transport.currentTime
      }

      // Sync play state
      if (transport.playing && instance.audio.paused) {
        instance.audio.play().catch(console.error)
      } else if (!transport.playing && !instance.audio.paused) {
        instance.audio.pause()
      }

      // Apply volume (considering mute, solo, master)
      const soloActive = Object.values(tracks).some((t) => t.solo)
      const shouldPlay = !soloActive || trackState.solo
      const effectiveVolume =
        trackState.muted || !shouldPlay ? 0 : trackState.volume

      instance.processor.setVolume(effectiveVolume)
      instance.processor.setPan(trackState.pan)
    })

    // Sync master volume
    setMasterVolume(masterVolume)
  }, [tracks, transport.playing, transport.currentTime, masterVolume])

  // Animation frame loop for time updates
  useEffect(() => {
    if (!transport.playing) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const updateTime = () => {
      // Get time from first available track
      const firstInstance = trackInstancesRef.current.values().next().value as TrackInstance | undefined
      if (firstInstance && !transport.seeking) {
        setCurrentTime(firstInstance.audio.currentTime)
      }
      animationFrameRef.current = requestAnimationFrame(updateTime)
    }

    animationFrameRef.current = requestAnimationFrame(updateTime)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [transport.playing, transport.seeking, setCurrentTime])

  // Sync playback whenever state changes
  useEffect(() => {
    syncPlayback()
  }, [syncPlayback])

  // Sync effect state from store to EffectChain instances
  useEffect(() => {
    const instances = trackInstancesRef.current
    instances.forEach((instance, key) => {
      const trackState = tracks[key]
      if (!trackState?.loaded || !trackState.effects) return

      const effectTypes: EffectType[] = ['pitchShift', 'reverb', 'compressor']
      for (const type of effectTypes) {
        const fx = trackState.effects[type]
        if (!fx) continue

        const chain = instance.processor.getEffectChain()
        if (fx.enabled) {
          // Enable + update params (enable is async but fire-and-forget is fine here)
          chain.enable(type, fx.params).catch(console.error)
          chain.updateParams(type, fx.params).catch(console.error)
        } else {
          chain.disable(type)
        }
      }
    })
  }, [tracks])

  // Cleanup on unmount
  useEffect(() => {
    const instances = trackInstancesRef.current
    return () => {
      // Stop animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      // Cleanup all track instances
      instances.forEach((instance) => {
        instance.audio.pause()
        instance.audio.src = ''
        instance.processor.dispose()
      })
      instances.clear()

      // Reset store
      reset()
      setIsReady(false)
      isInitializedRef.current = false
    }
  }, [reset])

  // Play all tracks
  const play = useCallback(async () => {
    await ensureAudioContextRunning()
    storePlay()
  }, [storePlay])

  // Pause all tracks
  const pause = useCallback(() => {
    storePause()
  }, [storePause])

  // Stop all tracks
  const stop = useCallback(() => {
    trackInstancesRef.current.forEach((instance) => {
      instance.audio.currentTime = 0
    })
    storeStop()
  }, [storeStop])

  // Seek all tracks
  const seek = useCallback(
    (time: number) => {
      // transport.duration can be 0 while metadata is still settling.
      // Avoid clamping every incoming seek to 0 in that transient window.
      const maxDuration = transport.duration > 0 ? transport.duration : Number.POSITIVE_INFINITY
      const clampedTime = Math.max(0, Math.min(time, maxDuration))
      trackInstancesRef.current.forEach((instance) => {
        instance.audio.currentTime = clampedTime
      })
      setCurrentTime(clampedTime)
    },
    [transport.duration, setCurrentTime]
  )

  // Get a track processor for visualization
  const getProcessor = useCallback((id: TrackId): TrackProcessor | null => {
    const key = getTrackKey(id)
    return trackInstancesRef.current.get(key)?.processor || null
  }, [])

  return {
    loadTracks,
    resetInit,
    play,
    pause,
    stop,
    seek,
    getProcessor,
    isReady,
  }
}

