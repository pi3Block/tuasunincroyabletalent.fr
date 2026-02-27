import { useCallback, useEffect, useRef } from 'react'
import type { YouTubeMatch } from '@/api/client'
import { useYouTubePlayer } from '@/hooks/useYouTubePlayer'

export interface YouTubePlayerControls {
  play: () => void
  pause: () => void
  seekTo: (seconds: number) => void
  mute: () => void
  unMute: () => void
  setVolume: (volume: number) => void
  getVolume: () => number
  getCurrentTime: () => number
}

interface YouTubePlayerProps {
  video: YouTubeMatch
  autoplay?: boolean
  onReady?: () => void
  onStateChange?: (isPlaying: boolean) => void
  onTimeUpdate?: (time: number) => void
  onDurationChange?: (duration: number) => void
  /** Called when the player is ready with imperative controls */
  onControlsReady?: (controls: YouTubePlayerControls) => void
}

export function YouTubePlayer({
  video,
  autoplay = false,
  onReady,
  onStateChange,
  onTimeUpdate,
  onDurationChange,
  onControlsReady,
}: YouTubePlayerProps) {
  const { containerRef, isReady, play, pause, seekTo, mute, unMute, setVolume, getVolume, currentTime } = useYouTubePlayer({
    videoId: video.id,
    autoplay,
    onReady,
    onStateChange,
    onTimeUpdate,
    onDurationChange,
  })

  // Expose imperative controls to parent when player is ready
  const onControlsReadyRef = useRef(onControlsReady)
  onControlsReadyRef.current = onControlsReady

  const getCurrentTimeRef = useCallback(() => currentTime, [currentTime])

  useEffect(() => {
    if (isReady) {
      onControlsReadyRef.current?.({ play, pause, seekTo, mute, unMute, setVolume, getVolume, getCurrentTime: getCurrentTimeRef })
    }
  }, [isReady, play, pause, seekTo, mute, unMute, setVolume, getVolume, getCurrentTimeRef])

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
