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
  /** Whether the reference audio is ready (required for generation) */
  referenceReady?: boolean
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
  referenceReady = false,
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
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs to always have the latest functions (avoids stale closure issues in intervals)
  const fetchWordTimestampsRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const triggerGenerationRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
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
      }
    } catch (err) {
      console.error('[useWordTimestamps] Fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch word timestamps')
      setStatus('error')
    } finally {
      setIsLoading(false)
    }
  }, [spotifyTrackId, youtubeVideoId])

  // Keep ref updated with latest fetchWordTimestamps
  fetchWordTimestampsRef.current = fetchWordTimestamps

  // Shared polling logic: starts polling a task and stops when done (success or failure).
  // Max timeout: 5 minutes — guards against Celery task hanging indefinitely.
  const startPolling = useCallback((taskId: string, errorLabel: string) => {
    // Clear any existing polling before starting a new one
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }

    const stopPolling = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const taskStatus = await api.getWordTimestampsTaskStatus(taskId)

        if (taskStatus.ready) {
          stopPolling()

          if (taskStatus.successful) {
            await fetchWordTimestampsRef.current()
          } else {
            setError(taskStatus.error || `${errorLabel} failed`)
            setStatus('error')
            setIsGenerating(false)
          }
        }
      } catch (pollError) {
        console.error('[useWordTimestamps] Poll error:', pollError)
      }
    }, pollInterval)

    // Safety timeout: abort polling after 5 minutes
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling()
      setError(`${errorLabel} timed out after 5 minutes`)
      setStatus('error')
      setIsGenerating(false)
    }, 5 * 60 * 1000)
  }, [pollInterval])

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
        await fetchWordTimestampsRef.current()
        return
      }

      if (response.status === 'queued' && response.task_id) {
        taskIdRef.current = response.task_id
        startPolling(response.task_id, 'Generation')
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
  }, [spotifyTrackId, youtubeVideoId, artistName, trackName, language, startPolling])

  // Keep ref updated with latest triggerGeneration
  triggerGenerationRef.current = triggerGeneration

  // Auto-generate when reference becomes ready and timestamps not found.
  // Dedicated effect to avoid race condition: the initial fetch happens before
  // referenceReady is true, so auto-generation must react to referenceReady changing.
  useEffect(() => {
    if (
      autoGenerate &&
      referenceReady &&
      spotifyTrackId &&
      youtubeVideoId &&
      status === 'not_found' &&
      !isGenerating
    ) {
      triggerGenerationRef.current()
    }
  }, [autoGenerate, referenceReady, spotifyTrackId, youtubeVideoId, status, isGenerating])

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
      await api.invalidateWordTimestamps(spotifyTrackId, youtubeVideoId)
      console.log('[useWordTimestamps] Cache invalidated, regenerating...')

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
        startPolling(response.task_id, 'Regeneration')
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
  }, [spotifyTrackId, youtubeVideoId, artistName, trackName, language, startPolling])

  // Initial fetch when IDs change
  // Also cleans up any active polling from the previous track to prevent
  // stale data from a previous generation being loaded into state.
  useEffect(() => {
    // Clear polling from previous track before fetching new data
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
    taskIdRef.current = null
    setIsGenerating(false)

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
