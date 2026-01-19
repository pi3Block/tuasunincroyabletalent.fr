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
  error: string | null

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
  setError: (error: string) => void
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
  error: null,

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

  setError: (error: string) => {
    set({ error })
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
      error: null,
    })
  },
}))
