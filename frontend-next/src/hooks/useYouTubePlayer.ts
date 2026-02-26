import { useEffect, useRef, useState, useCallback } from 'react'

declare global {
  interface Window {
    YT: typeof YT
    onYouTubeIframeAPIReady: () => void
  }
}

interface UseYouTubePlayerOptions {
  videoId: string
  autoplay?: boolean
  onReady?: () => void
  onStateChange?: (isPlaying: boolean) => void
  onTimeUpdate?: (time: number) => void
}

interface UseYouTubePlayerReturn {
  containerRef: React.RefObject<HTMLDivElement | null>
  isReady: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  play: () => void
  pause: () => void
  seekTo: (seconds: number) => void
}

let apiLoaded = false
let apiLoading = false
const apiReadyCallbacks: (() => void)[] = []

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (apiLoaded) {
      resolve()
      return
    }

    apiReadyCallbacks.push(resolve)

    if (apiLoading) {
      return
    }

    apiLoading = true

    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)

    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true
      apiLoading = false
      apiReadyCallbacks.forEach((cb) => cb())
      apiReadyCallbacks.length = 0
    }
  })
}

export function useYouTubePlayer({
  videoId,
  autoplay = false,
  onReady,
  onStateChange,
  onTimeUpdate,
}: UseYouTubePlayerOptions): UseYouTubePlayerReturn {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const intervalRef = useRef<number | null>(null)

  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Store callbacks in refs to avoid re-creating player on callback changes
  const onReadyRef = useRef(onReady)
  const onStateChangeRef = useRef(onStateChange)
  const onTimeUpdateRef = useRef(onTimeUpdate)

  useEffect(() => {
    onReadyRef.current = onReady
    onStateChangeRef.current = onStateChange
    onTimeUpdateRef.current = onTimeUpdate
  }, [onReady, onStateChange, onTimeUpdate])

  // Time update polling
  const startTimePolling = useCallback(() => {
    if (intervalRef.current) return

    intervalRef.current = window.setInterval(() => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        const time = playerRef.current.getCurrentTime()
        setCurrentTime(time)
        onTimeUpdateRef.current?.(time)
      }
    }, 250)
  }, [])

  const stopTimePolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Initialize player
  useEffect(() => {
    let mounted = true

    const initPlayer = async () => {
      await loadYouTubeAPI()

      if (!mounted || !containerRef.current) return

      // Create a unique ID for the container
      const containerId = `youtube-player-${videoId}-${Date.now()}`
      containerRef.current.id = containerId

      playerRef.current = new window.YT.Player(containerId, {
        videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            if (!mounted) return
            setIsReady(true)
            setDuration(event.target.getDuration())
            onReadyRef.current?.()

            // Start polling if autoplay
            if (autoplay) {
              setIsPlaying(true)
              startTimePolling()
            }
          },
          onStateChange: (event) => {
            if (!mounted) return

            const playing = event.data === window.YT.PlayerState.PLAYING
            setIsPlaying(playing)
            onStateChangeRef.current?.(playing)

            if (playing) {
              startTimePolling()
              // Update duration in case it wasn't available initially
              if (playerRef.current) {
                setDuration(playerRef.current.getDuration())
              }
            } else {
              stopTimePolling()
              // Get final time when paused
              if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
                const time = playerRef.current.getCurrentTime()
                setCurrentTime(time)
                onTimeUpdateRef.current?.(time)
              }
            }
          },
        },
      })
    }

    initPlayer()

    return () => {
      mounted = false
      stopTimePolling()
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [videoId, autoplay, startTimePolling, stopTimePolling])

  const play = useCallback(() => {
    playerRef.current?.playVideo()
  }, [])

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo()
  }, [])

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true)
    setCurrentTime(seconds)
    onTimeUpdateRef.current?.(seconds)
  }, [])

  return {
    containerRef,
    isReady,
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    seekTo,
  }
}
