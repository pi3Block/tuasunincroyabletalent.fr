/**
 * Transport controls: play/pause, seek, time display.
 */
import { useCallback } from 'react'
import { useTransport } from '@/stores/audioStore'
import { Slider } from '@/components/ui/slider'
import { Play, Pause, SkipBack, SkipForward, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TransportBarProps {
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeek: (time: number) => void
  className?: string
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function TransportBar({
  onPlay,
  onPause,
  onStop,
  onSeek,
  className,
}: TransportBarProps) {
  const transport = useTransport()

  const handlePlayPause = useCallback(() => {
    if (transport.playing) {
      onPause()
    } else {
      onPlay()
    }
  }, [transport.playing, onPlay, onPause])

  const handleSeekChange = useCallback(
    (values: number[]) => {
      onSeek(values[0])
    },
    [onSeek]
  )

  const handleSkipBack = useCallback(() => {
    onSeek(Math.max(0, transport.currentTime - 10))
  }, [onSeek, transport.currentTime])

  const handleSkipForward = useCallback(() => {
    onSeek(Math.min(transport.duration, transport.currentTime + 10))
  }, [onSeek, transport.currentTime, transport.duration])

  const progress = transport.duration > 0
    ? (transport.currentTime / transport.duration) * 100
    : 0

  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-4',
        'bg-card/80 backdrop-blur rounded-xl border border-border/50',
        className
      )}
    >
      {/* Time slider */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-muted-foreground w-12 text-right tabular-nums">
          {formatTime(transport.currentTime)}
        </span>
        <div className="flex-1 relative">
          <Slider
            value={[transport.currentTime]}
            max={transport.duration || 100}
            step={0.1}
            onValueChange={handleSeekChange}
            className="cursor-pointer"
          />
          {/* Progress indicator */}
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-primary/30 rounded-full pointer-events-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-mono text-muted-foreground w-12 tabular-nums">
          {formatTime(transport.duration)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {/* Skip back 10s */}
        <button
          type="button"
          onClick={handleSkipBack}
          className={cn(
            'h-12 w-12 rounded-full flex items-center justify-center',
            'bg-muted/50 text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Reculer de 10 secondes"
          aria-label="Reculer de 10 secondes"
        >
          <SkipBack className="h-5 w-5" />
        </button>

        {/* Stop button */}
        <button
          type="button"
          onClick={onStop}
          className={cn(
            'h-12 w-12 rounded-full flex items-center justify-center',
            'bg-muted/50 text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Arrêter"
          aria-label="Arrêter"
        >
          <Square className="h-5 w-5" />
        </button>

        {/* Play/Pause button - larger and prominent */}
        <button
          type="button"
          onClick={handlePlayPause}
          className={cn(
            'h-16 w-16 rounded-full flex items-center justify-center',
            'bg-primary text-primary-foreground shadow-lg',
            'hover:bg-primary/90 transition-all',
            'touch-manipulation active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
          aria-label={transport.playing ? 'Pause' : 'Lecture'}
        >
          {transport.playing ? (
            <Pause className="h-7 w-7" />
          ) : (
            <Play className="h-7 w-7 ml-1" />
          )}
        </button>

        {/* Skip forward 10s */}
        <button
          type="button"
          onClick={handleSkipForward}
          className={cn(
            'h-12 w-12 rounded-full flex items-center justify-center',
            'bg-muted/50 text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Avancer de 10 secondes"
          aria-label="Avancer de 10 secondes"
        >
          <SkipForward className="h-5 w-5" />
        </button>

        {/* Empty spacer to balance layout */}
        <div className="h-12 w-12" />
      </div>
    </div>
  )
}
