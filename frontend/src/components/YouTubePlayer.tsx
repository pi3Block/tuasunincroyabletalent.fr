import type { YouTubeMatch } from '@/api/client'

interface YouTubePlayerProps {
  video: YouTubeMatch
  autoplay?: boolean
}

export function YouTubePlayer({ video, autoplay = false }: YouTubePlayerProps) {
  // Build embed URL with optional autoplay
  const embedUrl = `https://www.youtube.com/embed/${video.id}?rel=0&modestbranding=1${autoplay ? '&autoplay=1' : ''}`

  return (
    <div className="w-full rounded-xl overflow-hidden bg-black shadow-lg">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute inset-0 w-full h-full"
          src={embedUrl}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="bg-gray-800 p-3">
        <p className="text-white font-medium truncate text-sm">{video.title}</p>
        <p className="text-gray-400 text-xs">{video.channel}</p>
      </div>
    </div>
  )
}
