import type { YouTubeMatch } from '@/api/client'
import { useYouTubePlayer } from '@/hooks/useYouTubePlayer'

interface YouTubePlayerProps {
  video: YouTubeMatch
  autoplay?: boolean
  onReady?: () => void
  onStateChange?: (isPlaying: boolean) => void
  onTimeUpdate?: (time: number) => void
}

export function YouTubePlayer({
  video,
  autoplay = false,
  onReady,
  onStateChange,
  onTimeUpdate,
}: YouTubePlayerProps) {
  const { containerRef, isReady } = useYouTubePlayer({
    videoId: video.id,
    autoplay,
    onReady,
    onStateChange,
    onTimeUpdate,
  })

  return (
    <div className="w-full rounded-xl overflow-hidden bg-black shadow-lg">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <div
          ref={containerRef}
          className="absolute inset-0 w-full h-full"
        />
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent" />
          </div>
        )}
      </div>
      <div className="lg:hidden bg-gray-800 p-3">
        <p className="text-white font-medium truncate text-sm">{video.title}</p>
        <p className="text-gray-400 text-xs">{video.channel}</p>
      </div>
    </div>
  )
}
