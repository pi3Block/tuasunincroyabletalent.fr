/**
 * @fileoverview Lyrics offset and sync controls component.
 *
 * Features:
 * - Manual sync (tap-to-sync) button
 * - Quick offset adjustments (±5s, ±30s)
 * - Fine offset adjustments (±0.5s)
 * - Offset reset
 * - Sync status indicator
 *
 * Architecture: Compound component with clear separation of button groups.
 */

import { memo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Minus,
  Plus,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { OFFSET_CONFIG } from '@/types/lyrics'

// ============================================================================
// TYPES
// ============================================================================

interface LyricsControlsProps {
  /** Current offset in seconds */
  offset: number
  /** Callback when offset changes */
  onOffsetChange: (offset: number) => void
  /** Manual sync handler (sync first line to current time) */
  onManualSync?: () => void
  /** Whether lyrics have timestamps */
  hasSyncedTimestamps?: boolean
  /** Custom class name */
  className?: string
  /** Compact mode (for mobile) */
  compact?: boolean
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface QuickOffsetButtonProps {
  delta: number
  onClick: (delta: number) => void
  className?: string
}

const QuickOffsetButton = memo(function QuickOffsetButton({
  delta,
  onClick,
  className,
}: QuickOffsetButtonProps) {
  const label = delta > 0 ? `+${delta}s` : `${delta}s`
  const title = delta > 0 ? `+${delta} seconds` : `${delta} seconds`

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('h-9 px-2 text-xs font-mono', className)}
      onClick={() => onClick(delta)}
      title={title}
    >
      {label}
    </Button>
  )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Lyrics offset and sync controls.
 *
 * @example
 * ```tsx
 * <LyricsControls
 *   offset={offset}
 *   onOffsetChange={setOffset}
 *   onManualSync={handleManualSync}
 *   hasSyncedTimestamps={true}
 * />
 * ```
 */
export const LyricsControls = memo(function LyricsControls({
  offset,
  onOffsetChange,
  onManualSync,
  hasSyncedTimestamps = false,
  className,
  compact = false,
}: LyricsControlsProps) {
  // Offset handlers with clamping
  const handleQuickOffset = useCallback(
    (delta: number) => {
      const newOffset = Math.max(
        OFFSET_CONFIG.MIN,
        Math.min(OFFSET_CONFIG.MAX, offset + delta)
      )
      onOffsetChange(newOffset)
    },
    [offset, onOffsetChange]
  )

  const handleFineDecrease = useCallback(() => {
    handleQuickOffset(-OFFSET_CONFIG.FINE_STEP)
  }, [handleQuickOffset])

  const handleFineIncrease = useCallback(() => {
    handleQuickOffset(OFFSET_CONFIG.FINE_STEP)
  }, [handleQuickOffset])

  const handleReset = useCallback(() => {
    onOffsetChange(0)
  }, [onOffsetChange])

  // Format offset display
  const offsetDisplay = `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}s`

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {/* Manual sync button */}
      {onManualSync && (
        <Button
          variant="default"
          size="sm"
          className="h-9 gap-1.5 bg-green-600 hover:bg-green-500"
          onClick={onManualSync}
          title="Sync: Align first line to current playback time"
        >
          <Target className="h-4 w-4" />
          {!compact && <span className="hidden sm:inline">Sync</span>}
        </Button>
      )}

      {/* Quick offset buttons - negative (desktop only) */}
      {!compact && (
        <div className="hidden md:flex items-center gap-1 ml-2">
          <QuickOffsetButton delta={-30} onClick={handleQuickOffset} />
          <QuickOffsetButton delta={-5} onClick={handleQuickOffset} />
        </div>
      )}

      {/* Fine adjustment: decrease */}
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={handleFineDecrease}
        title={`-${OFFSET_CONFIG.FINE_STEP} seconds`}
      >
        <Minus className="h-4 w-4" />
      </Button>

      {/* Offset display - click to reset */}
      <Button
        variant={offset === 0 ? 'outline' : 'secondary'}
        size="sm"
        className={cn(
          'h-9 font-mono text-sm',
          compact ? 'min-w-[70px]' : 'min-w-[80px]'
        )}
        onClick={handleReset}
        title="Click to reset offset to 0"
      >
        {offsetDisplay}
      </Button>

      {/* Fine adjustment: increase */}
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={handleFineIncrease}
        title={`+${OFFSET_CONFIG.FINE_STEP} seconds`}
      >
        <Plus className="h-4 w-4" />
      </Button>

      {/* Quick offset buttons - positive (desktop only) */}
      {!compact && (
        <div className="hidden md:flex items-center gap-1">
          <QuickOffsetButton delta={5} onClick={handleQuickOffset} />
          <QuickOffsetButton delta={30} onClick={handleQuickOffset} />
        </div>
      )}

      {/* Sync status indicator */}
      {hasSyncedTimestamps && (
        <span className="ml-2 text-xs text-green-500 font-medium whitespace-nowrap">
          ⚡ Synced
        </span>
      )}
    </div>
  )
})

// ============================================================================
// COMPACT MOBILE CONTROLS
// ============================================================================

interface LyricsControlsMobileProps {
  offset: number
  onOffsetChange: (offset: number) => void
  className?: string
}

/**
 * Compact controls for mobile view.
 */
export const LyricsControlsMobile = memo(function LyricsControlsMobile({
  offset,
  onOffsetChange,
  className,
}: LyricsControlsMobileProps) {
  const handleQuickOffset = useCallback(
    (delta: number) => {
      const newOffset = Math.max(
        OFFSET_CONFIG.MIN,
        Math.min(OFFSET_CONFIG.MAX, offset + delta)
      )
      onOffsetChange(newOffset)
    },
    [offset, onOffsetChange]
  )

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      {/* Quick back */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        onClick={() => handleQuickOffset(-5)}
      >
        -5s
      </Button>

      {/* Fine controls */}
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => handleQuickOffset(-0.5)}
      >
        <Minus className="h-3 w-3" />
      </Button>

      {/* Offset display */}
      <span className="text-sm font-mono min-w-[60px] text-center">
        {offset >= 0 ? '+' : ''}{offset.toFixed(1)}s
      </span>

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => handleQuickOffset(0.5)}
      >
        <Plus className="h-3 w-3" />
      </Button>

      {/* Quick forward */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        onClick={() => handleQuickOffset(5)}
      >
        +5s
      </Button>
    </div>
  )
})

export default LyricsControls
