/**
 * @fileoverview Karaoke word component with progressive gradient fill.
 *
 * This component renders a single word with Apple Music-style
 * progressive highlight animation using CSS gradient.
 *
 * Architecture: Pure presentational component with CSS-in-JS gradient.
 */

import React, { memo, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { KaraokeWordProps } from '@/types/lyrics'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Colors for the gradient fill */
const COLORS = {
  /** Active/highlighted color (amber-400) */
  active: '#fbbf24',
  /** Inactive/upcoming color */
  inactive: '#9ca3af',
  /** Past color (slightly dimmed) */
  past: '#d1d5db',
} as const

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Karaoke word with progressive gradient fill.
 *
 * The gradient creates a "filling" effect as the word is being sung,
 * similar to Apple Music's karaoke mode.
 *
 * @example
 * ```tsx
 * <KaraokeWord
 *   word={{ text: "Hello", startTimeMs: 1000, endTimeMs: 1500 }}
 *   isActive={true}
 *   isPast={false}
 *   progress={0.6}
 * />
 * ```
 */
export const KaraokeWord = memo(function KaraokeWord({
  word,
  isActive,
  isPast,
  progress,
}: KaraokeWordProps) {
  // Calculate gradient style for active word
  const gradientStyle = useMemo(() => {
    if (!isActive) return undefined

    // Clamp progress to 0-1
    const p = Math.max(0, Math.min(1, progress)) * 100

    return {
      background: `linear-gradient(90deg,
        ${COLORS.active} 0%,
        ${COLORS.active} ${p}%,
        ${COLORS.inactive} ${p}%,
        ${COLORS.inactive} 100%)`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    } as React.CSSProperties
  }, [isActive, progress])

  // Determine text class based on state
  const textClass = useMemo(() => {
    if (isActive) {
      return 'font-bold'
    }
    if (isPast) {
      return 'text-amber-400/90'
    }
    return 'text-muted-foreground/70'
  }, [isActive, isPast])

  return (
    <span
      className={cn(
        'inline-block transition-all duration-150',
        textClass
      )}
      style={gradientStyle}
    >
      {word.text}
      {/* Space after word */}
      <span className="text-transparent"> </span>
    </span>
  )
})

// ============================================================================
// WORD GROUP COMPONENT
// ============================================================================

interface KaraokeWordGroupProps {
  /** Array of words to render */
  words: KaraokeWordProps['word'][]
  /** Current word index */
  currentWordIndex: number
  /** Progress through current word */
  wordProgress: number
  /** Custom class name */
  className?: string
}

/**
 * Group of karaoke words with proper spacing.
 */
export const KaraokeWordGroup = memo(function KaraokeWordGroup({
  words,
  currentWordIndex,
  wordProgress,
  className,
}: KaraokeWordGroupProps) {
  return (
    <span className={cn('inline-flex flex-wrap justify-center gap-x-1', className)}>
      {words.map((word, index) => (
        <KaraokeWord
          key={`${word.text}-${index}`}
          word={word}
          isActive={index === currentWordIndex}
          isPast={index < currentWordIndex}
          progress={index === currentWordIndex ? wordProgress : 0}
        />
      ))}
    </span>
  )
})

export default KaraokeWord
