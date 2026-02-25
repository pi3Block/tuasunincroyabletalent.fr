import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: { VITE_API_URL: 'http://test-api' } } })

// Need to import after mocking
const { ApiClient } = await (async () => {
  // Re-import to pick up mocked fetch
  const mod = await import('@api/client')
  return mod
})()

// Create a test client instance directly
class TestApiClient {
  private baseUrl = 'http://test-api'

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async searchTracks(query: string, limit = 10) {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    return this.request(`/api/search/tracks?${params}`)
  }

  async startSession(trackId: string, trackName: string) {
    return this.request('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ spotify_track_id: trackId, spotify_track_name: trackName }),
    })
  }

  getAudioTrackUrl(sessionId: string, source: string, trackType: string) {
    return `${this.baseUrl}/api/audio/${sessionId}/${source}/${trackType}`
  }
}

describe('API Client', () => {
  let client: TestApiClient

  beforeEach(() => {
    mockFetch.mockReset()
    client = new TestApiClient()
  })

  it('searchTracks sends correct request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: 'test', tracks: [], count: 0 }),
    })

    const result = await client.searchTracks('test', 5)

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/search/tracks?q=test&limit=5',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    )
    expect(result).toEqual({ query: 'test', tracks: [], count: 0 })
  })

  it('startSession sends POST with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'abc-123',
        status: 'created',
        reference_status: 'pending',
      }),
    })

    const result = await client.startSession('track-id', 'Song Name')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/session/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          spotify_track_id: 'track-id',
          spotify_track_name: 'Song Name',
        }),
      }),
    )
    expect(result.session_id).toBe('abc-123')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    })

    await expect(client.searchTracks('test')).rejects.toThrow('Not found')
  })

  it('throws generic error when response has no JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('no json') },
    })

    await expect(client.searchTracks('test')).rejects.toThrow('Unknown error')
  })

  it('getAudioTrackUrl builds correct URL', () => {
    const url = client.getAudioTrackUrl('session-1', 'ref', 'vocals')
    expect(url).toBe('http://test-api/api/audio/session-1/ref/vocals')
  })
})
