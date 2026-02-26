/**
 * Studio Mode - Full audio mixing interface.
 * Displayed during jury processing, on results page, or as a pre-recording practice mode.
 */
import React, { useEffect, useRef, useCallback } from 'react'
import { useMultiTrack } from '../hooks/useMultiTrack'
import { TrackMixer } from './TrackMixer'
import { TransportBar } from './TransportBar'
import { useAudioLoading, useAudioStore } from '@/stores/audioStore'
import { Loader2, Music2, AlertCircle, RefreshCw } from 'lucide-react'
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
  analyzing: 'Les pistes seront disponibles après la séparation audio',
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
  const [retryCount, setRetryCount] = React.useState(0)
  const [waitingForTracks, setWaitingForTracks] = React.useState(false)
  const { isLoading, loadingMessage } = useAudioLoading()
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reset = useAudioStore((s) => s.reset)

  const { loadTracks, play, pause, stop, seek, isReady } = useMultiTrack({
    sessionId,
    context,
    onReady: () => {
      setError(null)
      setWaitingForTracks(false)
      // Clear retry interval on success
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current)
        retryIntervalRef.current = null
      }
      onReady?.()
    },
    onError: (err) => {
      // For analyzing context, don't show error immediately - tracks may not be ready yet
      if (context === 'analyzing' && err.message.includes('Aucune piste')) {
        setWaitingForTracks(true)
        setError(null)
      } else {
        setError(err.message)
        setWaitingForTracks(false)
      }
      onError?.(err)
    },
  })

  // Initial load
  useEffect(() => {
    loadTracks()
  }, [loadTracks])

  // Auto-retry for analyzing context when tracks aren't ready yet
  useEffect(() => {
    if (context === 'analyzing' && waitingForTracks && !isReady) {
      // Poll every 5 seconds to check if tracks are available
      retryIntervalRef.current = setInterval(() => {
        setRetryCount((c) => c + 1)
        // Reset the store before retrying
        reset()
        // Small delay before reloading
        setTimeout(() => {
          loadTracks()
        }, 100)
      }, 5000)

      return () => {
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current)
          retryIntervalRef.current = null
        }
      }
    }
  }, [context, waitingForTracks, isReady, loadTracks, reset])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current)
      }
    }
  }, [])

  const handleRetry = useCallback(() => {
    setError(null)
    setWaitingForTracks(false)
    reset()
    setTimeout(() => {
      loadTracks()
    }, 100)
  }, [loadTracks, reset])

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card/80 backdrop-blur border border-border/50',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="relative">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <Music2 className="h-4 w-4 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium">Chargement du studio...</p>
            <p className="text-sm text-muted-foreground mt-1">
              {loadingMessage || 'Préparation des pistes audio'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Waiting for tracks (analyzing context - tracks being separated)
  if (waitingForTracks && context === 'analyzing') {
    return (
      <div
        className={cn(
          'rounded-xl bg-amber-500/10 border border-amber-500/30',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="relative">
            <div className="h-10 w-10 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
            <Music2 className="h-4 w-4 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-amber-500" />
          </div>
          <div className="text-center">
            <p className="font-medium text-amber-200">Séparation audio en cours...</p>
            <p className="text-sm text-amber-300/70 mt-1">
              Le studio sera disponible une fois les pistes prêtes
            </p>
            {retryCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Vérification automatique... ({retryCount})
              </p>
            )}
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
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div className="text-center">
            <p className="font-medium text-destructive">
              Impossible de charger le studio
            </p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'touch-manipulation active:scale-95'
            )}
          >
            <RefreshCw className="h-4 w-4" />
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  // Not ready yet (no tracks loaded) - for non-analyzing contexts
  if (!isReady) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card/80 backdrop-blur border border-border/50',
          className
        )}
      >
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Music2 className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium">Pistes non disponibles</p>
            <p className="text-sm text-muted-foreground mt-1">
              {context === 'practice'
                ? 'La référence audio doit d\'abord être téléchargée'
                : 'Les pistes seront disponibles après la séparation'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm',
              'bg-muted text-muted-foreground',
              'hover:bg-muted/80 transition-colors',
              'touch-manipulation active:scale-95'
            )}
          >
            <RefreshCw className="h-3 w-3" />
            Vérifier
          </button>
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
            <Music2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">{CONTEXT_TITLES[context]}</h2>
            <p className="text-sm text-muted-foreground">
              {CONTEXT_DESCRIPTIONS[context]}
            </p>
          </div>
        </div>
      </div>

      {/* Transport controls */}
      <TransportBar onPlay={play} onPause={pause} onStop={stop} onSeek={seek} />

      {/* Track mixer */}
      <TrackMixer showDownload={context === 'results'} />
    </div>
  )
}
