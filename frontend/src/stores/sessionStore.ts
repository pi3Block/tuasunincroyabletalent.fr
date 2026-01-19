import { create } from 'zustand'
import type { Track, YouTubeMatch, AnalysisResults } from '@/api/client'

type SessionStatus = 'idle' | 'selecting' | 'preparing' | 'needs_fallback' | 'downloading' | 'ready' | 'recording' | 'uploading' | 'analyzing' | 'results'

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
  lyricsStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'error'
  error: string | null
  // Playback state
  playbackTime: number
  isVideoPlaying: boolean
  // Lyrics offset
  lyricsOffset: number
  lyricsOffsetStatus: 'idle' | 'loading' | 'loaded' | 'saving' | 'error'

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
  setLyricsStatus: (status: 'idle' | 'loading' | 'found' | 'not_found' | 'error') => void
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
  lyricsStatus: 'idle',
  error: null,
  playbackTime: 0,
  isVideoPlaying: false,
  lyricsOffset: 0,
  lyricsOffsetStatus: 'idle',

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
      lyricsStatus: 'idle',
      error: null,
      playbackTime: 0,
      isVideoPlaying: false,
      lyricsOffset: 0,
      lyricsOffsetStatus: 'idle',
    })
  },
}))
