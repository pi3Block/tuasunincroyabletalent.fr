/**
 * API client for The AI Voice Jury backend
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export interface Track {
  id: string
  name: string
  artists: string[]
  album: {
    name: string | null
    image: string | null
  }
  duration_ms: number
  preview_url: string | null
  external_url: string | null
}

export interface SearchResponse {
  query: string
  tracks: Track[]
  count: number
}

export interface YouTubeMatch {
  id: string
  title: string
  duration: number
  channel: string
  url: string
  confidence?: number
  spotify_duration?: number
}

export interface SessionResponse {
  session_id: string
  status: string
  reference_status: string
  youtube_match?: YouTubeMatch | null
}

export interface SessionStatus {
  session_id: string
  status: string
  reference_status: string
  reference_ready: boolean
  track_name?: string
  artist_name?: string
  youtube_url?: string
  error?: string
}

export interface AnalysisResponse {
  session_id: string
  task_id: string
  status: string
  message: string
}

export interface AnalysisStatus {
  session_id: string
  task_id?: string
  analysis_status: string
  progress?: {
    step: string
    progress: number
    detail?: string
  }
  results?: AnalysisResults
  error?: string
}

export interface JuryComment {
  persona: string
  comment: string
  vote: 'yes' | 'no'
}

export interface AnalysisResults {
  session_id: string
  score: number
  pitch_accuracy: number
  rhythm_accuracy: number
  lyrics_accuracy: number
  jury_comments: JuryComment[]
}

export interface RecentTrack {
  spotify_track_id: string
  track_name: string
  artist_name: string
  album_image: string | null
  duration_ms: number
  timestamp: string
}

export interface SyncedLyricLine {
  text: string
  startTimeMs: number
  endTimeMs?: number
}

export interface LyricsResponse {
  session_id: string
  lyrics: string
  lines?: SyncedLyricLine[]
  syncType: 'synced' | 'unsynced' | 'none'
  source: 'spotify' | 'genius' | 'none'
  status: 'found' | 'not_found' | 'error'
  url?: string
  error?: string
  cachedAt?: string
}

export interface LyricsOffsetResponse {
  spotify_track_id: string
  youtube_video_id: string
  offset_seconds: number
}

export interface AutoSyncResponse {
  suggested_offset: number
  confidence: number
  method: 'cross_correlation' | 'text_matching' | 'none'
  applied: boolean
  error?: string
}

// Audio track availability response
export interface AudioTracksResponse {
  session_id: string
  tracks: {
    ref: {
      vocals: boolean
      instrumentals: boolean
      original: boolean
    }
    user: {
      vocals: boolean
      instrumentals: boolean
      original: boolean
    }
  }
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }

  // Search endpoints
  async searchTracks(query: string, limit = 10): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    return this.request<SearchResponse>(`/api/search/tracks?${params}`)
  }

  async getTrack(trackId: string): Promise<Track> {
    return this.request<Track>(`/api/search/tracks/${trackId}`)
  }

  async getRecentTracks(limit = 10): Promise<RecentTrack[]> {
    return this.request<RecentTrack[]>(`/api/search/recent?limit=${limit}`)
  }

  // Session endpoints
  async startSession(trackId: string, trackName: string): Promise<SessionResponse> {
    return this.request<SessionResponse>('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({
        spotify_track_id: trackId,
        spotify_track_name: trackName,
      }),
    })
  }

  async setFallbackSource(sessionId: string, youtubeUrl: string): Promise<{ status: string }> {
    return this.request('/api/session/fallback-source', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        youtube_url: youtubeUrl,
      }),
    })
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return this.request<SessionStatus>(`/api/session/${sessionId}/status`)
  }

  // Recording & Analysis endpoints
  async uploadRecording(sessionId: string, audioBlob: Blob): Promise<{ status: string; file_size: number }> {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'recording.webm')

    const response = await fetch(`${this.baseUrl}/api/session/${sessionId}/upload-recording`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async startAnalysis(sessionId: string): Promise<AnalysisResponse> {
    return this.request<AnalysisResponse>(`/api/session/${sessionId}/analyze`, {
      method: 'POST',
    })
  }

  async getAnalysisStatus(sessionId: string): Promise<AnalysisStatus> {
    return this.request<AnalysisStatus>(`/api/session/${sessionId}/analysis-status`)
  }

  async getResults(sessionId: string): Promise<{ session_id: string; results: AnalysisResults }> {
    return this.request(`/api/session/${sessionId}/results`)
  }

  // Lyrics endpoint
  async getLyrics(sessionId: string): Promise<LyricsResponse> {
    return this.request<LyricsResponse>(`/api/session/${sessionId}/lyrics`)
  }

  // Lyrics offset endpoints
  async getLyricsOffset(sessionId: string): Promise<LyricsOffsetResponse> {
    return this.request<LyricsOffsetResponse>(`/api/session/${sessionId}/lyrics-offset`)
  }

  async setLyricsOffset(sessionId: string, offsetSeconds: number): Promise<LyricsOffsetResponse> {
    return this.request<LyricsOffsetResponse>(`/api/session/${sessionId}/lyrics-offset`, {
      method: 'POST',
      body: JSON.stringify({ offset_seconds: offsetSeconds }),
    })
  }

  // Auto-sync endpoint
  async autoSyncLyrics(sessionId: string): Promise<AutoSyncResponse> {
    return this.request<AutoSyncResponse>(`/api/session/${sessionId}/auto-sync`, {
      method: 'POST',
    })
  }

  // Audio endpoints
  async getAudioTracks(sessionId: string): Promise<AudioTracksResponse> {
    return this.request<AudioTracksResponse>(`/api/audio/${sessionId}/tracks`)
  }

  getAudioTrackUrl(
    sessionId: string,
    source: 'user' | 'ref',
    trackType: 'vocals' | 'instrumentals' | 'original'
  ): string {
    return `${this.baseUrl}/api/audio/${sessionId}/${source}/${trackType}`
  }
}

export const api = new ApiClient(API_URL)
