/**
 * Real-time pitch indicator component.
 * Shows a visual representation of vocal pitch accuracy.
 */
import { useMemo } from 'react'
import type { PitchData } from '@/hooks/usePitchDetection'

interface PitchIndicatorProps {
  pitchData: PitchData
  targetNote?: string // Optional target note to compare against
}

export function PitchIndicator({ pitchData, targetNote }: PitchIndicatorProps) {
  const { note, cents, volume, isVoiced } = pitchData

  // Determine pitch accuracy color
  const accuracyColor = useMemo(() => {
    if (!isVoiced) return 'bg-gray-600'

    const absCents = Math.abs(cents)
    if (absCents <= 10) return 'bg-green-500'    // Excellent
    if (absCents <= 25) return 'bg-yellow-500'   // Good
    if (absCents <= 40) return 'bg-orange-500'   // Fair
    return 'bg-red-500'                          // Off
  }, [cents, isVoiced])

  // Accuracy label
  const accuracyLabel = useMemo(() => {
    if (!isVoiced) return 'En attente...'

    const absCents = Math.abs(cents)
    if (absCents <= 10) return 'Parfait !'
    if (absCents <= 25) return 'Bien !'
    if (absCents <= 40) return 'Presque...'
    return cents > 0 ? 'Trop haut' : 'Trop bas'
  }, [cents, isVoiced])

  // Indicator position (cents from -50 to +50 mapped to 0-100%)
  const indicatorPosition = useMemo(() => {
    if (!isVoiced) return 50
    // Clamp cents to -50 to +50 range
    const clampedCents = Math.max(-50, Math.min(50, cents))
    return 50 + clampedCents // 0 = -50 cents, 100 = +50 cents
  }, [cents, isVoiced])

  return (
    <div className="w-full bg-gray-800/50 backdrop-blur rounded-2xl p-4 space-y-3">
      {/* Header with note display */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎵</span>
          <span className="text-sm text-gray-400">Ta note</span>
        </div>
        <div className="text-right">
          <span className={`text-3xl font-bold ${isVoiced ? 'text-white' : 'text-gray-500'}`}>
            {note}
          </span>
          {targetNote && (
            <p className="text-xs text-gray-500">
              Cible: {targetNote}
            </p>
          )}
        </div>
      </div>

      {/* Pitch accuracy bar */}
      <div className="relative">
        {/* Background bar with gradient zones */}
        <div className="h-8 rounded-full overflow-hidden flex">
          <div className="flex-1 bg-gradient-to-r from-red-600 via-red-500 to-orange-500" />
          <div className="flex-1 bg-gradient-to-r from-orange-500 via-yellow-500 to-green-500" />
          <div className="w-8 bg-green-500" />
          <div className="flex-1 bg-gradient-to-r from-green-500 via-yellow-500 to-orange-500" />
          <div className="flex-1 bg-gradient-to-r from-orange-500 via-red-500 to-red-600" />
        </div>

        {/* Center line (perfect pitch) */}
        <div className="absolute top-0 left-1/2 w-1 h-8 bg-white/50 transform -translate-x-1/2" />

        {/* Current pitch indicator */}
        <div
          className="absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 transition-all duration-75"
          style={{ left: `${indicatorPosition}%` }}
        >
          <div
            className={`w-6 h-6 rounded-full border-2 border-white shadow-lg ${
              isVoiced ? accuracyColor : 'bg-gray-600'
            }`}
          />
        </div>

        {/* Labels */}
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>Trop bas</span>
          <span className="text-green-400">Juste</span>
          <span>Trop haut</span>
        </div>
      </div>

      {/* Accuracy feedback */}
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${
          isVoiced ? 'text-white' : 'text-gray-500'
        }`}>
          {accuracyLabel}
        </span>

        {/* Volume meter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Volume</span>
          <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-75 ${
                volume > 0.7 ? 'bg-red-500' :
                volume > 0.3 ? 'bg-green-500' :
                'bg-gray-500'
              }`}
              style={{ width: `${volume * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Cents deviation (technical info) */}
      {isVoiced && (
        <div className="text-center">
          <span className="text-xs text-gray-500">
            {cents > 0 ? '+' : ''}{cents} cents
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Compact version for inline display
 */
export function PitchIndicatorCompact({ pitchData }: { pitchData: PitchData }) {
  const { note, cents, isVoiced } = pitchData

  const color = useMemo(() => {
    if (!isVoiced) return 'text-gray-500'
    const absCents = Math.abs(cents)
    if (absCents <= 10) return 'text-green-400'
    if (absCents <= 25) return 'text-yellow-400'
    if (absCents <= 40) return 'text-orange-400'
    return 'text-red-400'
  }, [cents, isVoiced])

  return (
    <div className="flex items-center gap-2 bg-gray-800/50 rounded-full px-3 py-1">
      <div className={`w-2 h-2 rounded-full ${isVoiced ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
      <span className={`font-mono font-bold ${color}`}>
        {note}
      </span>
    </div>
  )
}
