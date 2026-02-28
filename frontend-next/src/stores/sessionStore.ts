import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Track, YouTubeMatch, AnalysisResults, SyncedLyricLine } from '@/api/client'

type SessionStatus = 'idle' | 'selecting' | 'preparing' | 'needs_fallback' | 'downloading' | 'ready' | 'recording' | 'uploading' | 'analyzing' | 'results'

/**
 * Valid status transitions. Any transition not listed here is blocked.
 * This prevents SSE events or stale callbacks from corrupting the flow.
 */
const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle:           ['selecting'],
  selecting:      ['preparing', 'idle'],
  preparing:      ['downloading', 'ready', 'needs_fallback', 'selecting'],
  needs_fallback: ['preparing', 'downloading', 'selecting'],
  downloading:    ['ready', 'needs_fallback', 'selecting'],
  ready:          ['recording', 'selecting', 'idle'],
  recording:      ['uploading', 'ready'],
  uploading:      ['analyzing', 'ready'],
  analyzing:      ['results', 'ready'],  // ready only on error/timeout
  results:        ['ready', 'selecting', 'idle'],
}
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
  // User stems ready during analysis (before jury verdict)
  userTracksReady: boolean

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
  setError: (error: string) => void
  setPlaybackTime: (time: number) => void
  setIsVideoPlaying: (isPlaying: boolean) => void
  setLyricsOffset: (offset: number) => void
  setLyricsOffsetStatus: (status: 'idle' | 'loading' | 'loaded' | 'saving' | 'error') => void
  setUserTracksReady: (ready: boolean) => void
  reset: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
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
  userTracksReady: false,

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

  setStatus: (next: SessionStatus) => {
    const current = get().status
    const allowed = VALID_TRANSITIONS[current]
    if (!allowed?.includes(next)) {
      console.warn(`[State] Blocked transition: ${current} → ${next}`)
      return
    }
    set({ status: next })
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

  setUserTracksReady: (userTracksReady: boolean) => {
    set({ userTracksReady })
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
      userTracksReady: false,
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

/** User stems ready during analysis (before jury verdict) */
export const useUserTracksReady = () => useSessionStore((s) => s.userTracksReady)
