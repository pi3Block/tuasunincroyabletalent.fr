/**
 * Transport controls: play/pause, seek, time display.
 */
import { useCallback } from 'react'
import { useTransport } from '@/stores/audioStore'
import { Slider } from '@/components/ui/slider'
import { Play, Pause, SkipBack, SkipForward, Square, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TransportBarProps {
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeek: (time: number) => void
  /** Override playing state from an external source (e.g. YouTube) */
  isPlaying?: boolean
  /** Override current time from an external source (e.g. YouTube) */
  currentTime?: number
  /** Override duration from an external source (e.g. YouTube) */
  duration?: number
  /** Inline single-row layout for bottom bar */
  compact?: boolean
  /** Toggle mixer panel */
  onMixerToggle?: () => void
  /** Whether the mixer panel is open */
  mixerOpen?: boolean
  /** Current audio source indicator */
  audioSource?: 'youtube' | 'multitrack' | null
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
  isPlaying: isPlayingOverride,
  currentTime: currentTimeOverride,
  duration: durationOverride,
  compact = false,
  onMixerToggle,
  mixerOpen = false,
  audioSource,
  className,
}: TransportBarProps) {
  const transport = useTransport()
  const playing = isPlayingOverride ?? transport.playing
  const time = currentTimeOverride ?? transport.currentTime
  const dur = durationOverride ?? transport.duration

  const handlePlayPause = useCallback(() => {
    if (playing) {
      onPause()
    } else {
      onPlay()
    }
  }, [playing, onPlay, onPause])

  const handleSeekChange = useCallback(
    (values: number[]) => {
      onSeek(values[0])
    },
    [onSeek]
  )

  const handleSkipBack = useCallback(() => {
    onSeek(Math.max(0, time - 10))
  }, [onSeek, time])

  const handleSkipForward = useCallback(() => {
    onSeek(Math.min(dur, time + 10))
  }, [onSeek, time, dur])

  const progress = dur > 0
    ? (time / dur) * 100
    : 0

  // Compact (inline) layout — used in AppBottomBar
  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {/* Mixer toggle */}
        {onMixerToggle && (
          <button
            type="button"
            onClick={onMixerToggle}
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
              'transition-colors touch-manipulation active:scale-95',
              mixerOpen
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title={mixerOpen ? 'Fermer le mixer' : 'Ouvrir le mixer'}
            aria-label={mixerOpen ? 'Fermer le mixer' : 'Ouvrir le mixer'}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        )}

        {/* Audio source badge */}
        {audioSource === 'youtube' && (
          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            YT
          </span>
        )}
        {audioSource === 'multitrack' && (
          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            MT
          </span>
        )}

        {/* Skip back */}
        <button
          type="button"
          onClick={handleSkipBack}
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
            'text-muted-foreground hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Reculer de 10 secondes"
          aria-label="Reculer de 10 secondes"
        >
          <SkipBack className="h-4 w-4" />
        </button>

        {/* Stop */}
        <button
          type="button"
          onClick={onStop}
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
            'text-muted-foreground hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Arrêter"
          aria-label="Arrêter"
        >
          <Square className="h-3.5 w-3.5" />
        </button>

        {/* Play/Pause */}
        <button
          type="button"
          onClick={handlePlayPause}
          className={cn(
            'h-9 w-9 rounded-full flex items-center justify-center shrink-0',
            'bg-primary text-primary-foreground shadow',
            'hover:bg-primary/90 transition-all',
            'touch-manipulation active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label={playing ? 'Pause' : 'Lecture'}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        {/* Skip forward */}
        <button
          type="button"
          onClick={handleSkipForward}
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
            'text-muted-foreground hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Avancer de 10 secondes"
          aria-label="Avancer de 10 secondes"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        {/* Time + Slider */}
        <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0 ml-1">
          {formatTime(time)}
        </span>
        <div className="flex-1 min-w-[80px] relative">
          <Slider
            value={[time]}
            max={dur || 100}
            step={0.1}
            onValueChange={handleSeekChange}
            className="cursor-pointer"
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
          {formatTime(dur)}
        </span>
      </div>
    )
  }

  // Default vertical layout
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
          {formatTime(time)}
        </span>
        <div className="flex-1 relative">
          <Slider
            value={[time]}
            max={dur || 100}
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
          {formatTime(dur)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {/* Mixer toggle */}
        {onMixerToggle && (
          <button
            type="button"
            onClick={onMixerToggle}
            className={cn(
              'h-12 w-12 lg:h-9 lg:w-9 rounded-full flex items-center justify-center',
              'transition-colors touch-manipulation active:scale-95',
              mixerOpen
                ? 'bg-primary/20 text-primary'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            title={mixerOpen ? 'Fermer le mixer' : 'Ouvrir le mixer'}
            aria-label={mixerOpen ? 'Fermer le mixer' : 'Ouvrir le mixer'}
          >
            <SlidersHorizontal className="h-5 w-5 lg:h-4 lg:w-4" />
          </button>
        )}

        {/* Skip back 10s */}
        <button
          type="button"
          onClick={handleSkipBack}
          className={cn(
            'h-12 w-12 lg:h-9 lg:w-9 rounded-full flex items-center justify-center',
            'bg-muted/50 text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Reculer de 10 secondes"
          aria-label="Reculer de 10 secondes"
        >
          <SkipBack className="h-5 w-5 lg:h-4 lg:w-4" />
        </button>

        {/* Stop button */}
        <button
          type="button"
          onClick={onStop}
          className={cn(
            'h-12 w-12 lg:h-9 lg:w-9 rounded-full flex items-center justify-center',
            'bg-muted/50 text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Arrêter"
          aria-label="Arrêter"
        >
          <Square className="h-5 w-5 lg:h-4 lg:w-4" />
        </button>

        {/* Play/Pause button - larger and prominent */}
        <button
          type="button"
          onClick={handlePlayPause}
          className={cn(
            'h-16 w-16 lg:h-12 lg:w-12 rounded-full flex items-center justify-center',
            'bg-primary text-primary-foreground shadow-lg',
            'hover:bg-primary/90 transition-all',
            'touch-manipulation active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
          aria-label={playing ? 'Pause' : 'Lecture'}
        >
          {playing ? (
            <Pause className="h-7 w-7 lg:h-5 lg:w-5" />
          ) : (
            <Play className="h-7 w-7 lg:h-5 lg:w-5 ml-1" />
          )}
        </button>

        {/* Skip forward 10s */}
        <button
          type="button"
          onClick={handleSkipForward}
          className={cn(
            'h-12 w-12 lg:h-9 lg:w-9 rounded-full flex items-center justify-center',
            'bg-muted/50 text-muted-foreground',
            'hover:bg-muted hover:text-foreground transition-colors',
            'touch-manipulation active:scale-95'
          )}
          title="Avancer de 10 secondes"
          aria-label="Avancer de 10 secondes"
        >
          <SkipForward className="h-5 w-5 lg:h-4 lg:w-4" />
        </button>
      </div>
    </div>
  )
}
