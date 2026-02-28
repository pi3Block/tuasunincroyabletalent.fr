/**
 * @fileoverview Lyrics offset and sync controls component.
 *
 * Features:
 * - Manual sync (tap-to-sync) button
 * - Quick offset adjustments (±5s, ±30s)
 * - Fine offset adjustments (±0.5s)
 * - Offset reset
 * - Sync status indicator
 * - Collapsible controls (hidden by default on mobile)
 *
 * Architecture: Compound component with clear separation of button groups.
 */

import { memo, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Minus,
  Plus,
  Target,
  ChevronDown,
  ChevronUp,
  Settings2,
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
  /** Start with controls expanded (default: false on mobile, true on desktop) */
  defaultExpanded?: boolean
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
  defaultExpanded,
}: LyricsControlsProps) {
  // Default: collapsed on mobile, expanded on desktop
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false)

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
      {/* Toggle button to show/hide controls */}
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setIsExpanded(!isExpanded)}
        title={isExpanded ? 'Cacher les contrôles de sync' : 'Afficher les contrôles de sync'}
      >
        <Settings2 className="h-4 w-4" />
        {isExpanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </Button>

      {/* Collapsed view: just show offset value and sync status */}
      {!isExpanded && (
        <>
          <span className="text-xs font-mono text-muted-foreground">
            {offsetDisplay}
          </span>
          {hasSyncedTimestamps && (
            <span className="text-xs text-green-500 font-medium">
              ⚡
            </span>
          )}
        </>
      )}

      {/* Expanded controls */}
      {isExpanded && (
        <>
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
        </>
      )}
    </div>
  )
})

export default LyricsControls
