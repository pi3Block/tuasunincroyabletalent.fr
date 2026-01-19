/**
 * @fileoverview Timeline Debug UI Component
 *
 * Visual debugging tool to understand lyrics synchronization.
 * Shows the relationship between video time, lyrics time, and offset.
 */

import { memo, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface TimelineDebugProps {
  /** Current video playback time in seconds */
  currentTime: number
  /** Offset applied to lyrics in seconds */
  offset: number
  /** First line start time in seconds */
  firstLineStartTime?: number
  /** Current line start time in seconds */
  currentLineStartTime?: number
  /** Current line index */
  currentLineIndex: number
  /** Total number of lines */
  totalLines: number
  /** Whether video is playing */
  isPlaying: boolean
  /** Custom class name */
  className?: string
}

/**
 * Timeline Debug Component
 *
 * Visual representation of:
 * - Video timeline (currentTime)
 * - Lyrics timeline (adjustedTime = currentTime + offset)
 * - How offset affects sync
 */
export const TimelineDebug = memo(function TimelineDebug({
  currentTime,
  offset,
  firstLineStartTime = 0,
  currentLineStartTime = 0,
  currentLineIndex,
  totalLines,
  isPlaying,
  className,
}: TimelineDebugProps) {
  // Calculate adjusted time (what the lyrics system sees)
  const adjustedTime = currentTime + offset

  // Calculate what offset SHOULD be to sync first line to current time
  const idealOffset = firstLineStartTime - currentTime

  // Timeline visualization scale (100px = 60 seconds)
  const scale = 100 / 60

  // Determine if lyrics are ahead or behind
  const syncStatus = useMemo(() => {
    if (Math.abs(offset) < 0.5) return { status: 'synced', color: 'text-green-400', label: 'Synchronisé' }
    if (offset > 0) return { status: 'ahead', color: 'text-orange-400', label: 'Paroles en avance' }
    return { status: 'behind', color: 'text-blue-400', label: 'Paroles en retard' }
  }, [offset])

  return (
    <div className={cn(
      'bg-gray-900/90 border border-gray-700 rounded-xl p-4 font-mono text-sm',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold flex items-center gap-2">
          🔧 Debug Timeline
          {isPlaying && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        </h3>
        <span className={cn('font-medium', syncStatus.color)}>
          {syncStatus.label}
        </span>
      </div>

      {/* Main values grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {/* Video Time */}
        <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-3">
          <div className="text-blue-300 text-xs mb-1">📹 Video Time</div>
          <div className="text-blue-400 text-xl font-bold">{currentTime.toFixed(1)}s</div>
        </div>

        {/* Offset */}
        <div className={cn(
          'border rounded-lg p-3',
          offset === 0
            ? 'bg-gray-500/20 border-gray-500/50'
            : offset > 0
              ? 'bg-orange-500/20 border-orange-500/50'
              : 'bg-purple-500/20 border-purple-500/50'
        )}>
          <div className={cn(
            'text-xs mb-1',
            offset === 0 ? 'text-gray-300' : offset > 0 ? 'text-orange-300' : 'text-purple-300'
          )}>
            ⚡ Offset
          </div>
          <div className={cn(
            'text-xl font-bold',
            offset === 0 ? 'text-gray-400' : offset > 0 ? 'text-orange-400' : 'text-purple-400'
          )}>
            {offset >= 0 ? '+' : ''}{offset.toFixed(1)}s
          </div>
        </div>

        {/* Adjusted Time (what lyrics see) */}
        <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-3">
          <div className="text-green-300 text-xs mb-1">🎵 Lyrics Time</div>
          <div className="text-green-400 text-xl font-bold">{adjustedTime.toFixed(1)}s</div>
        </div>

        {/* Current Line */}
        <div className="bg-pink-500/20 border border-pink-500/50 rounded-lg p-3">
          <div className="text-pink-300 text-xs mb-1">📝 Line</div>
          <div className="text-pink-400 text-xl font-bold">{currentLineIndex + 1}/{totalLines}</div>
        </div>
      </div>

      {/* Visual Timeline */}
      <div className="mb-4">
        <div className="text-gray-400 text-xs mb-2">Timeline visuelle (60s)</div>
        <div className="relative h-16 bg-gray-800 rounded-lg overflow-hidden">
          {/* Time markers */}
          {[0, 15, 30, 45, 60].map((t) => (
            <div
              key={t}
              className="absolute top-0 h-full border-l border-gray-600"
              style={{ left: `${(t / 60) * 100}%` }}
            >
              <span className="absolute top-1 left-1 text-gray-500 text-xs">{t}s</span>
            </div>
          ))}

          {/* First line start time marker */}
          {firstLineStartTime > 0 && firstLineStartTime <= 60 && (
            <div
              className="absolute top-0 h-full w-0.5 bg-yellow-500/70"
              style={{ left: `${(firstLineStartTime / 60) * 100}%` }}
              title={`First line: ${firstLineStartTime.toFixed(1)}s`}
            >
              <span className="absolute bottom-1 left-1 text-yellow-400 text-xs whitespace-nowrap">
                1st: {firstLineStartTime.toFixed(1)}s
              </span>
            </div>
          )}

          {/* Video time marker */}
          <div
            className="absolute top-0 h-full w-1 bg-blue-500 transition-all duration-100"
            style={{ left: `${Math.min(100, (currentTime / 60) * 100)}%` }}
          >
            <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-blue-500 rounded-full" />
          </div>

          {/* Adjusted time marker (lyrics position) */}
          <div
            className="absolute top-8 h-8 w-1 bg-green-500 transition-all duration-100"
            style={{ left: `${Math.max(0, Math.min(100, (adjustedTime / 60) * 100))}%` }}
          >
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-green-500 rounded-full" />
          </div>

          {/* Offset visualization (arrow between video and lyrics) */}
          {Math.abs(offset) > 0.5 && (
            <div
              className="absolute top-6 h-4 flex items-center"
              style={{
                left: offset > 0
                  ? `${(currentTime / 60) * 100}%`
                  : `${(adjustedTime / 60) * 100}%`,
                width: `${Math.abs(offset / 60) * 100}%`,
                maxWidth: '50%',
              }}
            >
              <div className={cn(
                'h-0.5 w-full',
                offset > 0 ? 'bg-orange-500' : 'bg-purple-500'
              )} />
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-2 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-blue-500 rounded-full" /> Video
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-green-500 rounded-full" /> Lyrics
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-yellow-500" /> 1ère ligne
          </span>
        </div>
      </div>

      {/* Detailed info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-800 rounded p-2">
          <span className="text-gray-400">1ère ligne commence à: </span>
          <span className="text-yellow-400 font-bold">{firstLineStartTime.toFixed(2)}s</span>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <span className="text-gray-400">Ligne actuelle commence à: </span>
          <span className="text-pink-400 font-bold">{currentLineStartTime.toFixed(2)}s</span>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <span className="text-gray-400">Calcul: </span>
          <span className="text-white">adjustedTime = {currentTime.toFixed(1)} + ({offset.toFixed(1)}) = {adjustedTime.toFixed(1)}</span>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <span className="text-gray-400">Offset idéal pour Sync: </span>
          <span className={cn(
            'font-bold',
            Math.abs(idealOffset - offset) < 0.5 ? 'text-green-400' : 'text-red-400'
          )}>
            {idealOffset >= 0 ? '+' : ''}{idealOffset.toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Formula explanation */}
      <div className="mt-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="text-gray-400 text-xs mb-2">💡 Comment ça marche:</div>
        <div className="text-gray-300 text-xs space-y-1">
          <p>• <span className="text-blue-400">Video Time</span> = position dans la vidéo YouTube</p>
          <p>• <span className="text-green-400">Lyrics Time</span> = Video Time + Offset</p>
          <p>• Le système cherche quelle ligne correspond à <span className="text-green-400">Lyrics Time</span></p>
          <p>• <span className="text-orange-400">Offset +</span> = paroles en avance (affichées plus tôt)</p>
          <p>• <span className="text-purple-400">Offset -</span> = paroles en retard (affichées plus tard)</p>
        </div>
      </div>
    </div>
  )
})

export default TimelineDebug
