/**
 * Single audio track row with controls.
 */
import React from 'react'
import { cn } from '@/lib/utils'
import { VolumeSlider } from './VolumeSlider'
import { Mic, Music, Disc, Loader2 } from 'lucide-react'
import type { TrackId, TrackState } from '../types'
import { getTrackKey } from '../core/AudioPlayerFactory'

interface AudioTrackProps {
  id: TrackId
  state: TrackState
  onVolumeChange: (volume: number) => void
  onMuteToggle: () => void
  onSoloToggle: () => void
  compact?: boolean
}

const TRACK_LABELS: Record<string, string> = {
  'ref:vocals': 'Voix originale',
  'ref:instrumentals': 'Instrumental',
  'ref:original': 'Original',
  'user:vocals': 'Votre voix',
  'user:instrumentals': 'Votre instru',
  'user:original': 'Votre enreg.',
}

const TRACK_ICONS: Record<string, React.ReactNode> = {
  vocals: <Mic className="h-4 w-4" />,
  instrumentals: <Music className="h-4 w-4" />,
  original: <Disc className="h-4 w-4" />,
}

export const AudioTrack = React.memo(function AudioTrack({
  id,
  state,
  onVolumeChange,
  onMuteToggle,
  onSoloToggle,
  compact = false,
}: AudioTrackProps) {
  const key = getTrackKey(id)
  const label = TRACK_LABELS[key] || key
  const icon = TRACK_ICONS[id.type]

  const isUserTrack = id.source === 'user'

  if (state.loading) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg',
          'bg-muted/30 animate-pulse',
          compact ? 'p-2' : 'p-3'
        )}
      >
        <div className="flex items-center gap-2 min-w-[100px]">
          <div className="p-1.5 rounded bg-muted">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="flex-1 h-1.5 rounded-full bg-muted" />
      </div>
    )
  }

  if (state.error) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg',
          'bg-destructive/10 border border-destructive/20',
          compact ? 'p-2' : 'p-3'
        )}
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-destructive/20">
            {icon}
          </div>
          <span className="text-sm text-destructive">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground truncate">
          Non disponible
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg transition-all',
        isUserTrack ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30',
        state.solo && 'ring-2 ring-yellow-500/50 bg-yellow-500/10',
        state.muted && 'opacity-60',
        compact ? 'p-2' : 'p-3'
      )}
    >
      {/* Track icon and label */}
      <div className="flex items-center gap-2 min-w-[90px] sm:min-w-[110px]">
        <div
          className={cn(
            'p-1.5 rounded transition-colors',
            isUserTrack
              ? 'bg-primary/20 text-primary'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {icon}
        </div>
        <span className="text-sm font-medium truncate">{label}</span>
      </div>

      {/* Volume slider */}
      <div className="flex-1 min-w-[80px]">
        <VolumeSlider
          value={state.volume}
          onChange={onVolumeChange}
          muted={state.muted}
          onMuteToggle={onMuteToggle}
          size={compact ? 'sm' : 'md'}
          showIcon={false}
        />
      </div>

      {/* Control buttons */}
      <div className="flex items-center gap-1">
        {/* Solo button */}
        <button
          type="button"
          onClick={onSoloToggle}
          className={cn(
            'h-8 w-8 rounded text-sm font-bold transition-all',
            'flex items-center justify-center',
            'touch-manipulation active:scale-95',
            state.solo
              ? 'bg-yellow-500 text-yellow-950 shadow-md'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          )}
          title="Solo - Écouter uniquement cette piste"
          aria-pressed={state.solo}
        >
          S
        </button>

        {/* Mute button */}
        <button
          type="button"
          onClick={onMuteToggle}
          className={cn(
            'h-8 w-8 rounded text-sm font-bold transition-all',
            'flex items-center justify-center',
            'touch-manipulation active:scale-95',
            state.muted
              ? 'bg-red-500 text-white shadow-md'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          )}
          title="Mute - Couper cette piste"
          aria-pressed={state.muted}
        >
          M
        </button>
      </div>
    </div>
  )
})
