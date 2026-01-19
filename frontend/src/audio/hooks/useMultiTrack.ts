/**
 * Multi-track orchestrator hook.
 * Synchronizes playback across multiple tracks.
 */
import { useEffect, useRef, useCallback } from 'react'
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

  // Initialize a single track
  const initTrack = useCallback(
    async (id: TrackId): Promise<boolean> => {
      const key = getTrackKey(id)
      const url = buildAudioUrl(sessionId, id.source, id.type)

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

        // Ensure AudioContext is running
        await ensureAudioContextRunning()

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
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      const response = await fetch(`${baseUrl}/api/audio/${sessionId}/tracks`)
      if (!response.ok) {
        throw new Error('Failed to fetch tracks')
      }
      return await response.json()
    } catch (err) {
      console.error('Failed to fetch available tracks:', err)
      return null
    }
  }, [sessionId])

  // Load all available tracks
  const loadTracks = useCallback(async () => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true

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

      // Load all tracks in parallel
      const results = await Promise.all(tracksToLoad.map(initTrack))

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
      onReady?.()
    } catch (err) {
      setLoading(false)
      const error = err instanceof Error ? err : new Error('Unknown error')
      onError?.(error)
    }
  }, [context, fetchAvailableTracks, initTrack, setDuration, setLoading, onReady, onError])

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      // Cleanup all track instances
      trackInstancesRef.current.forEach((instance) => {
        instance.audio.pause()
        instance.audio.src = ''
        instance.processor.dispose()
      })
      trackInstancesRef.current.clear()

      // Reset store
      reset()
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
      const clampedTime = Math.max(0, Math.min(time, transport.duration))
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
    play,
    pause,
    stop,
    seek,
    getProcessor,
    isReady: Object.values(tracks).some((t) => t.loaded),
  }
}
