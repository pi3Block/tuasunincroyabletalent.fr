/**
 * API client for Kiaraoke backend
 *
 * In Next.js with rewrites configured in next.config.ts:
 * - Browser calls: /api/* → proxied to api.kiaraoke.fr (no CORS needed)
 * - SSR calls: use NEXT_PUBLIC_API_URL directly
 */

const API_URL =
  typeof window !== "undefined"
    ? "" // Browser: Next.js rewrites handle /api/* → api.kiaraoke.fr
    : (process.env.NEXT_PUBLIC_API_URL || "https://api.kiaraoke.fr");

export interface Track {
  id: string;
  name: string;
  artists: string[];
  album: {
    name: string | null;
    image: string | null;
  };
  duration_ms: number;
  preview_url: string | null;
  external_url: string | null;
}

export interface SearchResponse {
  query: string;
  tracks: Track[];
  count: number;
}

export interface YouTubeMatch {
  id: string;
  title: string;
  duration: number;
  channel: string;
  url: string;
  confidence?: number;
  spotify_duration?: number;
}

export interface SessionResponse {
  session_id: string;
  status: string;
  reference_status: string;
  youtube_match?: YouTubeMatch | null;
}

export interface SessionStatus {
  session_id: string;
  status: string;
  reference_status: string;
  reference_ready: boolean;
  track_name?: string;
  artist_name?: string;
  youtube_url?: string;
  error?: string;
}

export interface AnalysisResponse {
  session_id: string;
  task_id: string;
  status: string;
  message: string;
}

export interface AnalysisStatus {
  session_id: string;
  task_id?: string;
  analysis_status: string;
  progress?: {
    step: string;
    progress: number;
    detail?: string;
  };
  results?: AnalysisResults;
  error?: string;
}

export interface JuryComment {
  persona: string;
  comment: string;
  vote: "yes" | "no";
}

export interface AutoSync {
  offset_seconds: number;
  confidence: number;
  method: string;
}

export interface AnalysisResults {
  session_id: string;
  score: number;
  pitch_accuracy: number;
  rhythm_accuracy: number;
  lyrics_accuracy: number;
  jury_comments: JuryComment[];
  auto_sync?: AutoSync;
}

export interface RecentTrack {
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_image: string | null;
  duration_ms: number;
  timestamp: string;
}

export interface PerformanceHistoryItem {
  session_id: string;
  track_name: string;
  artist_name: string;
  album_image?: string | null;
  total_score: number;
  pitch_accuracy: number;
  rhythm_accuracy: number;
  lyrics_accuracy: number;
  jury_comments: JuryComment[];
  created_at: string;
}

export interface SyncedLyricLine {
  text: string;
  startTimeMs: number;
  endTimeMs?: number;
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface WordLine {
  startMs: number;
  endMs: number;
  text: string;
  words: WordTimestamp[];
}

export interface WordTimestampsResponse {
  syncType: "WORD_SYNCED" | "LINE_SYNCED" | "none";
  words?: WordTimestamp[];
  lines?: WordLine[];
  source: string;
  language?: string;
  status: "found" | "generating" | "not_found" | "error";
  quality?: {
    confidence?: number;
    word_count?: number;
  };
  cachedAt?: string;
}

export interface GenerateWordTimestampsRequest {
  spotify_track_id: string;
  youtube_video_id: string;
  artist_name?: string;
  track_name?: string;
  language?: string;
  force_regenerate?: boolean;
}

export interface GenerateWordTimestampsResponse {
  status: "queued" | "cached" | "error";
  task_id?: string;
  message: string;
}

export interface LyricsResponse {
  session_id: string;
  lyrics: string;
  lines?: SyncedLyricLine[];
  syncType: "synced" | "unsynced" | "none";
  source: "spotify" | "genius" | "none";
  status: "found" | "not_found" | "error";
  url?: string;
  error?: string;
  cachedAt?: string;
}

export interface LyricsOffsetResponse {
  spotify_track_id: string;
  youtube_video_id: string;
  offset_seconds: number;
}

export interface AudioTracksResponse {
  session_id: string;
  tracks: {
    ref: {
      vocals: boolean;
      instrumentals: boolean;
      original: boolean;
    };
    user: {
      vocals: boolean;
      instrumentals: boolean;
      original: boolean;
    };
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Unknown error" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text || !text.trim()) {
      throw new Error(`Empty response from ${endpoint}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON from ${endpoint}`);
    }
  }

  async searchTracks(query: string, limit = 10): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request<SearchResponse>(`/api/search/tracks?${params}`);
  }

  async getTrack(trackId: string): Promise<Track> {
    return this.request<Track>(`/api/search/tracks/${trackId}`);
  }

  async getRecentTracks(limit = 10): Promise<RecentTrack[]> {
    return this.request<RecentTrack[]>(`/api/search/recent?limit=${limit}`);
  }

  async getResultsHistory(limit = 6): Promise<PerformanceHistoryItem[]> {
    return this.request<PerformanceHistoryItem[]>(
      `/api/results/history?limit=${limit}`,
    );
  }

  async startSession(
    trackId: string,
    trackName: string,
  ): Promise<SessionResponse> {
    return this.request<SessionResponse>("/api/session/start", {
      method: "POST",
      body: JSON.stringify({
        spotify_track_id: trackId,
        spotify_track_name: trackName,
      }),
    });
  }

  async setFallbackSource(
    sessionId: string,
    youtubeUrl: string,
  ): Promise<{ status: string }> {
    return this.request("/api/session/fallback-source", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        youtube_url: youtubeUrl,
      }),
    });
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return this.request<SessionStatus>(`/api/session/${sessionId}/status`);
  }

  async uploadRecording(
    sessionId: string,
    audioBlob: Blob,
  ): Promise<{ status: string; file_size: number }> {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    const response = await fetch(
      `${this.baseUrl}/api/session/${sessionId}/upload-recording`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Upload failed" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text || !text.trim()) {
      throw new Error("Empty response from upload");
    }
    return JSON.parse(text);
  }

  async startAnalysis(sessionId: string): Promise<AnalysisResponse> {
    return this.request<AnalysisResponse>(
      `/api/session/${sessionId}/analyze`,
      {
        method: "POST",
      },
    );
  }

  async getAnalysisStatus(sessionId: string): Promise<AnalysisStatus> {
    return this.request<AnalysisStatus>(
      `/api/session/${sessionId}/analysis-status`,
    );
  }

  async getResults(
    sessionId: string,
  ): Promise<{ session_id: string; results: AnalysisResults }> {
    return this.request(`/api/session/${sessionId}/results`);
  }

  async getLyrics(sessionId: string): Promise<LyricsResponse> {
    return this.request<LyricsResponse>(`/api/session/${sessionId}/lyrics`);
  }

  async getLyricsOffset(sessionId: string): Promise<LyricsOffsetResponse> {
    return this.request<LyricsOffsetResponse>(
      `/api/session/${sessionId}/lyrics-offset`,
    );
  }

  async setLyricsOffset(
    sessionId: string,
    offsetSeconds: number,
  ): Promise<LyricsOffsetResponse> {
    return this.request<LyricsOffsetResponse>(
      `/api/session/${sessionId}/lyrics-offset`,
      {
        method: "POST",
        body: JSON.stringify({ offset_seconds: offsetSeconds }),
      },
    );
  }

  async getAudioTracks(sessionId: string): Promise<AudioTracksResponse> {
    return this.request<AudioTracksResponse>(
      `/api/audio/${sessionId}/tracks`,
    );
  }

  getAudioTrackUrl(
    sessionId: string,
    source: "user" | "ref",
    trackType: "vocals" | "instrumentals" | "original",
  ): string {
    return `${this.baseUrl}/api/audio/${sessionId}/${source}/${trackType}`;
  }

  async getWordTimestamps(
    spotifyTrackId: string,
    youtubeVideoId?: string,
  ): Promise<WordTimestampsResponse> {
    const params = youtubeVideoId
      ? new URLSearchParams({ youtube_video_id: youtubeVideoId })
      : "";
    return this.request<WordTimestampsResponse>(
      `/api/lyrics/word-timestamps/${spotifyTrackId}${params ? `?${params}` : ""}`,
    );
  }

  async generateWordTimestamps(
    request: GenerateWordTimestampsRequest,
  ): Promise<GenerateWordTimestampsResponse> {
    return this.request<GenerateWordTimestampsResponse>(
      "/api/lyrics/word-timestamps/generate",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async getWordTimestampsTaskStatus(taskId: string): Promise<{
    task_id: string;
    status: string;
    ready: boolean;
    successful?: boolean;
    result?: unknown;
    error?: string;
  }> {
    return this.request(`/api/lyrics/word-timestamps/task/${taskId}`);
  }

  async invalidateWordTimestamps(
    spotifyTrackId: string,
    youtubeVideoId?: string,
  ): Promise<{ status: string; spotify_track_id: string }> {
    const params = youtubeVideoId
      ? new URLSearchParams({ youtube_video_id: youtubeVideoId })
      : "";
    return this.request(
      `/api/lyrics/word-timestamps/${spotifyTrackId}${params ? `?${params}` : ""}`,
      { method: "DELETE" },
    );
  }
}

export const api = new ApiClient(API_URL);
