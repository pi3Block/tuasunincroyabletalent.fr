/**
 * @fileoverview Hook for fetching and managing word-level timestamps.
 *
 * Handles the full lifecycle:
 * 1. Check if word timestamps are cached
 * 2. If not, trigger generation via Celery
 * 3. Poll for completion
 * 4. Return data when ready
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type WordLine } from '@/api/client'

interface UseWordTimestampsOptions {
  /** Spotify track ID */
  spotifyTrackId: string | null
  /** YouTube video ID (required for Whisper generation) */
  youtubeVideoId: string | null
  /** Artist name (for metadata) */
  artistName?: string
  /** Track name (for metadata) */
  trackName?: string
  /** Language code for Whisper */
  language?: string
  /** Auto-generate if not found */
  autoGenerate?: boolean
  /** Polling interval in ms */
  pollInterval?: number
}

interface UseWordTimestampsResult {
  /** Word-level lines with timestamps */
  wordLines: WordLine[] | null
  /** Loading state */
  isLoading: boolean
  /** Generation in progress */
  isGenerating: boolean
  /** Error message */
  error: string | null
  /** Source of the data */
  source: string | null
  /** Data status */
  status: 'found' | 'generating' | 'not_found' | 'error' | 'idle'
  /** Quality metrics */
  quality: { confidence?: number; word_count?: number } | null
  /** Manually trigger generation */
  triggerGeneration: () => Promise<void>
  /** Force regeneration (invalidate cache and regenerate) */
  regenerate: () => Promise<void>
  /** Refresh data */
  refresh: () => Promise<void>
}

/**
 * Hook for managing word-level timestamps (karaoke mode).
 *
 * @example
 * ```tsx
 * const { wordLines, isLoading, isGenerating } = useWordTimestamps({
 *   spotifyTrackId: '4iV5W9uYEdYUVa79Axb7Rh',
 *   youtubeVideoId: 'dQw4w9WgXcQ',
 *   autoGenerate: true,
 * })
 * ```
 */
export function useWordTimestamps({
  spotifyTrackId,
  youtubeVideoId,
  artistName,
  trackName,
  language = 'fr',
  autoGenerate = false,
  pollInterval = 3000,
}: UseWordTimestampsOptions): UseWordTimestampsResult {
  const [wordLines, setWordLines] = useState<WordLine[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [status, setStatus] = useState<'found' | 'generating' | 'not_found' | 'error' | 'idle'>('idle')
  const [quality, setQuality] = useState<{ confidence?: number; word_count?: number } | null>(null)

  const taskIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Refs to always have the latest functions (avoids stale closure issues in intervals)
  const fetchWordTimestampsRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const triggerGenerationRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Fetch word timestamps
  const fetchWordTimestamps = useCallback(async () => {
    if (!spotifyTrackId) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await api.getWordTimestamps(
        spotifyTrackId,
        youtubeVideoId || undefined
      )

      if (response.status === 'found' && response.lines) {
        setWordLines(response.lines)
        setSource(response.source)
        setStatus('found')
        setQuality(response.quality || null)
        setIsGenerating(false)
      } else if (response.status === 'generating') {
        setStatus('generating')
        setIsGenerating(true)
      } else {
        setStatus('not_found')
        setWordLines(null)

        // Auto-generate if enabled (use ref to get latest function)
        if (autoGenerate && youtubeVideoId) {
          await triggerGenerationRef.current()
        }
      }
    } catch (err) {
      console.error('[useWordTimestamps] Fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch word timestamps')
      setStatus('error')
    } finally {
      setIsLoading(false)
    }
  }, [spotifyTrackId, youtubeVideoId, autoGenerate])

  // Keep ref updated with latest fetchWordTimestamps
  fetchWordTimestampsRef.current = fetchWordTimestamps

  // Trigger generation (defined after fetchWordTimestamps so ref is updated below)
  const triggerGeneration = useCallback(async () => {
    if (!spotifyTrackId || !youtubeVideoId) {
      setError('Missing track or video ID')
      return
    }

    setIsGenerating(true)
    setStatus('generating')
    setError(null)

    try {
      const response = await api.generateWordTimestamps({
        spotify_track_id: spotifyTrackId,
        youtube_video_id: youtubeVideoId,
        artist_name: artistName,
        track_name: trackName,
        language,
      })

      if (response.status === 'cached') {
        // Already cached, fetch it using ref to get latest function
        await fetchWordTimestampsRef.current()
        return
      }

      if (response.status === 'queued' && response.task_id) {
        taskIdRef.current = response.task_id

        // Start polling for completion
        pollIntervalRef.current = setInterval(async () => {
          try {
            const taskStatus = await api.getWordTimestampsTaskStatus(response.task_id!)

            if (taskStatus.ready) {
              // Stop polling
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current)
                pollIntervalRef.current = null
              }

              if (taskStatus.successful) {
                // Fetch the new data using ref to get latest function
                await fetchWordTimestampsRef.current()
              } else {
                setError(taskStatus.error || 'Generation failed')
                setStatus('error')
                setIsGenerating(false)
              }
            }
          } catch (pollError) {
            console.error('[useWordTimestamps] Poll error:', pollError)
          }
        }, pollInterval)
      } else {
        setError(response.message || 'Failed to start generation')
        setStatus('error')
        setIsGenerating(false)
      }
    } catch (err) {
      console.error('[useWordTimestamps] Generation error:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate word timestamps')
      setStatus('error')
      setIsGenerating(false)
    }
  }, [spotifyTrackId, youtubeVideoId, artistName, trackName, language, pollInterval])

  // Keep ref updated with latest triggerGeneration
  triggerGenerationRef.current = triggerGeneration

  // Force regeneration (invalidate cache first, then regenerate)
  const regenerate = useCallback(async () => {
    if (!spotifyTrackId || !youtubeVideoId) {
      setError('Missing track or video ID')
      return
    }

    setIsGenerating(true)
    setStatus('generating')
    setError(null)

    try {
      // First invalidate the cache
      await api.invalidateWordTimestamps(spotifyTrackId, youtubeVideoId)
      console.log('[useWordTimestamps] Cache invalidated, regenerating...')

      // Then trigger generation with force_regenerate flag
      const response = await api.generateWordTimestamps({
        spotify_track_id: spotifyTrackId,
        youtube_video_id: youtubeVideoId,
        artist_name: artistName,
        track_name: trackName,
        language,
        force_regenerate: true,
      })

      if (response.status === 'queued' && response.task_id) {
        taskIdRef.current = response.task_id

        // Start polling for completion
        pollIntervalRef.current = setInterval(async () => {
          try {
            const taskStatus = await api.getWordTimestampsTaskStatus(response.task_id!)

            if (taskStatus.ready) {
              // Stop polling
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current)
                pollIntervalRef.current = null
              }

              if (taskStatus.successful) {
                // Fetch the new data using ref to get latest function
                console.log('[useWordTimestamps] Task successful, fetching new data...')
                await fetchWordTimestampsRef.current()
              } else {
                setError(taskStatus.error || 'Regeneration failed')
                setStatus('error')
                setIsGenerating(false)
              }
            }
          } catch (pollError) {
            console.error('[useWordTimestamps] Poll error:', pollError)
          }
        }, pollInterval)
      } else {
        setError(response.message || 'Failed to start regeneration')
        setStatus('error')
        setIsGenerating(false)
      }
    } catch (err) {
      console.error('[useWordTimestamps] Regeneration error:', err)
      setError(err instanceof Error ? err.message : 'Failed to regenerate word timestamps')
      setStatus('error')
      setIsGenerating(false)
    }
  }, [spotifyTrackId, youtubeVideoId, artistName, trackName, language, pollInterval])

  // Initial fetch when IDs change
  useEffect(() => {
    if (spotifyTrackId) {
      fetchWordTimestamps()
    } else {
      setWordLines(null)
      setStatus('idle')
    }
  }, [spotifyTrackId, youtubeVideoId, fetchWordTimestamps])

  return {
    wordLines,
    isLoading,
    isGenerating,
    error,
    source,
    status,
    quality,
    triggerGeneration,
    regenerate,
    refresh: fetchWordTimestamps,
  }
}

export default useWordTimestamps
