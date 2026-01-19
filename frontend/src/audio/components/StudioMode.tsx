/**
 * Studio Mode - Full audio mixing interface.
 * Displayed during jury processing, on results page, or as a pre-recording practice mode.
 */
import React, { useEffect } from 'react'
import { useMultiTrack } from '../hooks/useMultiTrack'
import { TrackMixer } from './TrackMixer'
import { TransportBar } from './TransportBar'
import { useAudioLoading } from '@/stores/audioStore'
import { Loader2, Music2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StudioContext } from '../types'

interface StudioModeProps {
  sessionId: string
  context?: StudioContext
  onReady?: () => void
  onError?: (error: Error) => void
  className?: string
}

const CONTEXT_TITLES: Record<StudioContext, string> = {
  analyzing: 'Écoute pendant l\'analyse',
  results: 'Studio de comparaison',
  practice: 'Mode pratique',
}

const CONTEXT_DESCRIPTIONS: Record<StudioContext, string> = {
  analyzing: 'Écoutez et comparez pendant que le jury analyse votre performance',
  results: 'Comparez votre voix avec l\'original, ajustez les volumes',
  practice: 'Entraînez-vous avec la référence avant d\'enregistrer',
}

export function StudioMode({
  sessionId,
  context = 'results',
  onReady,
  onError,
  className,
}: StudioModeProps) {
  const [error, setError] = React.useState<string | null>(null)
  const { isLoading, loadingMessage } = useAudioLoading()

  const { loadTracks, play, pause, stop, seek, isReady } = useMultiTrack({
    sessionId,
    context,
    onReady: () => {
      setError(null)
      onReady?.()
    },
    onError: (err) => {
      setError(err.message)
      onError?.(err)
    },
  })

  useEffect(() => {
    loadTracks()
  }, [loadTracks])

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card/80 backdrop-blur border border-border/50',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="relative">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <Music2 className="h-5 w-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-lg font-medium">Chargement du studio...</p>
            <p className="text-sm text-muted-foreground mt-1">
              {loadingMessage || 'Préparation des pistes audio'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div
        className={cn(
          'rounded-xl bg-destructive/10 border border-destructive/30',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div className="text-center">
            <p className="text-lg font-medium text-destructive">
              Impossible de charger le studio
            </p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null)
              loadTracks()
            }}
            className={cn(
              'px-4 py-2 rounded-lg',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'touch-manipulation active:scale-95'
            )}
          >
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  // Not ready yet (no tracks loaded)
  if (!isReady) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card/80 backdrop-blur border border-border/50',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <Music2 className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <p className="text-lg font-medium">Aucune piste disponible</p>
            <p className="text-sm text-muted-foreground mt-1">
              Les pistes audio seront disponibles après la séparation
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="rounded-xl bg-card/80 backdrop-blur border border-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Music2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{CONTEXT_TITLES[context]}</h2>
            <p className="text-sm text-muted-foreground">
              {CONTEXT_DESCRIPTIONS[context]}
            </p>
          </div>
        </div>
      </div>

      {/* Transport controls */}
      <TransportBar onPlay={play} onPause={pause} onStop={stop} onSeek={seek} />

      {/* Track mixer */}
      <TrackMixer />
    </div>
  )
}
