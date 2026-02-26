import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { api, type Track, type RecentTrack } from '@/api/client'

interface TrackSearchProps {
  onSelect: (track: Track) => void
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function TrackSearch({ onSelect }: TrackSearchProps) {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [recentTracks, setRecentTracks] = useState<RecentTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load recent tracks on mount
  useEffect(() => {
    api.getRecentTracks(5)
      .then(setRecentTracks)
      .catch(console.error)
  }, [])

  const handleRecentTrackSelect = useCallback((track: RecentTrack) => {
    onSelect({
      id: track.spotify_track_id,
      name: track.track_name,
      artists: track.artist_name.split(', '),
      album: { name: null, image: track.album_image },
      duration_ms: track.duration_ms,
      preview_url: null,
      external_url: null,
    })
  }, [onSelect])

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setTracks([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await api.searchTracks(searchQuery)
      setTracks(response.tracks)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setTracks([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      search(query)
    }, 300)

    return () => clearTimeout(timer)
  }, [query, search])

  return (
    <div className="w-full space-y-4">
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Recherche une chanson..."
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pl-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
          🔍
        </span>
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            <span className="block w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </span>
        )}
      </div>

      {/* Recent tracks (shown when no query) */}
      {recentTracks.length > 0 && !query && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400 flex items-center gap-2">
            <span>🔥</span> Chansons récentes
          </p>
          <div className="space-y-2">
            {recentTracks.map((track) => (
              <button
                key={track.spotify_track_id}
                onClick={() => handleRecentTrackSelect(track)}
                className="w-full flex items-center gap-3 bg-gray-800/50 hover:bg-gray-700 rounded-xl p-3 transition-colors text-left border border-gray-700/50"
              >
                {track.album_image ? (
                  <Image
                    src={track.album_image}
                    alt=""
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-xl">🎵</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white truncate">{track.track_name}</p>
                  <p className="text-sm text-gray-400 truncate">{track.artist_name}</p>
                </div>
                <span className="text-gold-400 text-sm">⚡</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {tracks.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {tracks.map((track) => (
            <button
              key={track.id}
              onClick={() => onSelect(track)}
              className="w-full flex items-center gap-3 bg-gray-800 hover:bg-gray-700 rounded-xl p-3 transition-colors text-left"
            >
              {/* Album Art */}
              {track.album.image ? (
                <Image
                  src={track.album.image}
                  alt={track.album.name || ''}
                  width={56}
                  height={56}
                  className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">🎵</span>
                </div>
              )}

              {/* Track Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate">{track.name}</p>
                <p className="text-sm text-gray-400 truncate">
                  {track.artists.join(', ')}
                </p>
                <p className="text-xs text-gray-500">
                  {formatDuration(track.duration_ms)}
                </p>
              </div>

              {/* Select indicator */}
              <span className="text-primary-400 text-xl">›</span>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {query && !loading && tracks.length === 0 && !error && (
        <div className="text-center text-gray-500 py-8">
          Aucun résultat pour &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  )
}
