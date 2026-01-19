import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Track, YouTubeMatch, AnalysisResults, SyncedLyricLine } from '@/api/client'

type SessionStatus = 'idle' | 'selecting' | 'preparing' | 'needs_fallback' | 'downloading' | 'ready' | 'recording' | 'uploading' | 'analyzing' | 'results'
type LyricsSyncType = 'synced' | 'unsynced' | 'none'
type LyricsSource = 'spotify' | 'genius' | 'none'

interface AnalysisProgress {
  step: string
  progress: number
  detail?: string
}

interface SessionState {
  // State
  status: SessionStatus
  sessionId: string | null
  selectedTrack: Track | null
  youtubeMatch: YouTubeMatch | null
  referenceStatus: string | null
  results: AnalysisResults | null
  analysisProgress: AnalysisProgress | null
  lyrics: string | null
  lyricsLines: SyncedLyricLine[] | null
  lyricsSyncType: LyricsSyncType
  lyricsSource: LyricsSource
  lyricsStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'error'
  error: string | null
  // Playback state
  playbackTime: number
  isVideoPlaying: boolean
  // Lyrics offset
  lyricsOffset: number
  lyricsOffsetStatus: 'idle' | 'loading' | 'loaded' | 'saving' | 'error'
  // Auto-sync
  autoSyncOffset: number | null
  autoSyncConfidence: number | null

  // Actions
  startSession: () => void
  selectTrack: (track: Track) => void
  setSessionId: (sessionId: string) => void
  setYoutubeMatch: (match: YouTubeMatch | null) => void
  setReferenceStatus: (status: string) => void
  setStatus: (status: SessionStatus) => void
  startRecording: () => void
  stopRecording: () => void
  setResults: (results: AnalysisResults) => void
  setAnalysisProgress: (progress: AnalysisProgress | null) => void
  setLyrics: (lyrics: string | null) => void
  setLyricsLines: (lines: SyncedLyricLine[] | null) => void
  setLyricsSyncType: (syncType: LyricsSyncType) => void
  setLyricsSource: (source: LyricsSource) => void
  setLyricsStatus: (status: 'idle' | 'loading' | 'found' | 'not_found' | 'error') => void
  setAutoSync: (offset: number | null, confidence: number | null) => void
  setError: (error: string) => void
  setPlaybackTime: (time: number) => void
  setIsVideoPlaying: (isPlaying: boolean) => void
  setLyricsOffset: (offset: number) => void
  setLyricsOffsetStatus: (status: 'idle' | 'loading' | 'loaded' | 'saving' | 'error') => void
  reset: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  // Initial state
  status: 'idle',
  sessionId: null,
  selectedTrack: null,
  youtubeMatch: null,
  referenceStatus: null,
  results: null,
  analysisProgress: null,
  lyrics: null,
  lyricsLines: null,
  lyricsSyncType: 'none',
  lyricsSource: 'none',
  lyricsStatus: 'idle',
  error: null,
  playbackTime: 0,
  isVideoPlaying: false,
  lyricsOffset: 0,
  lyricsOffsetStatus: 'idle',
  autoSyncOffset: null,
  autoSyncConfidence: null,

  // Actions
  startSession: () => {
    set({ status: 'selecting', error: null })
  },

  selectTrack: (track: Track) => {
    set({ selectedTrack: track, status: 'preparing' })
  },

  setSessionId: (sessionId: string) => {
    set({ sessionId })
  },

  setYoutubeMatch: (match: YouTubeMatch | null) => {
    set({ youtubeMatch: match })
  },

  setReferenceStatus: (status: string) => {
    set({ referenceStatus: status })
  },

  setStatus: (status: SessionStatus) => {
    set({ status })
  },

  startRecording: () => {
    set({ status: 'recording' })
  },

  stopRecording: () => {
    set({ status: 'analyzing' })
  },

  setResults: (results: AnalysisResults) => {
    set({ status: 'results', results })
  },

  setAnalysisProgress: (progress: AnalysisProgress | null) => {
    set({ analysisProgress: progress })
  },

  setLyrics: (lyrics: string | null) => {
    set({ lyrics })
  },

  setLyricsLines: (lyricsLines: SyncedLyricLine[] | null) => {
    set({ lyricsLines })
  },

  setLyricsSyncType: (lyricsSyncType: LyricsSyncType) => {
    set({ lyricsSyncType })
  },

  setLyricsSource: (lyricsSource: LyricsSource) => {
    set({ lyricsSource })
  },

  setLyricsStatus: (lyricsStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'error') => {
    set({ lyricsStatus })
  },

  setAutoSync: (autoSyncOffset: number | null, autoSyncConfidence: number | null) => {
    set({ autoSyncOffset, autoSyncConfidence })
  },

  setError: (error: string) => {
    set({ error })
  },

  setPlaybackTime: (playbackTime: number) => {
    set({ playbackTime })
  },

  setIsVideoPlaying: (isVideoPlaying: boolean) => {
    set({ isVideoPlaying })
  },

  setLyricsOffset: (lyricsOffset: number) => {
    set({ lyricsOffset })
  },

  setLyricsOffsetStatus: (lyricsOffsetStatus: 'idle' | 'loading' | 'loaded' | 'saving' | 'error') => {
    set({ lyricsOffsetStatus })
  },

  reset: () => {
    set({
      status: 'idle',
      sessionId: null,
      selectedTrack: null,
      youtubeMatch: null,
      referenceStatus: null,
      results: null,
      analysisProgress: null,
      lyrics: null,
      lyricsLines: null,
      lyricsSyncType: 'none',
      lyricsSource: 'none',
      lyricsStatus: 'idle',
      error: null,
      playbackTime: 0,
      isVideoPlaying: false,
      lyricsOffset: 0,
      lyricsOffsetStatus: 'idle',
      autoSyncOffset: null,
      autoSyncConfidence: null,
    })
  },
}))

// ============================================
// Performance-optimized selector hooks
// Use these instead of destructuring the entire store
// ============================================

/** Session identification - rarely changes */
export const useSessionId = () => useSessionStore((s) => s.sessionId)

/** Current status - changes on state transitions */
export const useStatus = () => useSessionStore((s) => s.status)

/** Error state - changes on errors */
export const useError = () => useSessionStore((s) => s.error)

/** Selected track - changes once per session */
export const useSelectedTrack = () => useSessionStore((s) => s.selectedTrack)

/** YouTube match - changes once per session */
export const useYoutubeMatch = () => useSessionStore((s) => s.youtubeMatch)

/** Playback time - changes frequently (60fps) - isolate to prevent cascading re-renders */
export const usePlaybackTime = () => useSessionStore((s) => s.playbackTime)

/** Video playing state - changes on play/pause */
export const useIsVideoPlaying = () => useSessionStore((s) => s.isVideoPlaying)

/** Lyrics data - use for LyricsDisplay component */
export const useLyricsState = () => useSessionStore(
  useShallow((s) => ({
    lyrics: s.lyrics,
    lyricsLines: s.lyricsLines,
    lyricsSyncType: s.lyricsSyncType,
    lyricsSource: s.lyricsSource,
    lyricsStatus: s.lyricsStatus,
    lyricsOffset: s.lyricsOffset,
  }))
)

/** Analysis progress - changes during analysis */
export const useAnalysisProgress = () => useSessionStore((s) => s.analysisProgress)

/** Results - changes once after analysis */
export const useResults = () => useSessionStore((s) => s.results)

/** Auto-sync state */
export const useAutoSync = () => useSessionStore(
  useShallow((s) => ({
    autoSyncOffset: s.autoSyncOffset,
    autoSyncConfidence: s.autoSyncConfidence,
  }))
)
