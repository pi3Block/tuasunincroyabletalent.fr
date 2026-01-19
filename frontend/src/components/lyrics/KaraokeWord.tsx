/**
 * @fileoverview Karaoke word component with progressive gradient fill.
 *
 * This component renders a single word with Apple Music-style
 * progressive highlight animation using CSS gradient + fun effects.
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
  /** Active/highlighted color - bright cyan/electric blue */
  active: '#22d3ee',
  /** Active glow color */
  activeGlow: '#06b6d4',
  /** Inactive/upcoming color */
  inactive: '#6b7280',
  /** Past color - golden/sung */
  past: '#fbbf24',
} as const

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Karaoke word with progressive gradient fill and fun effects.
 *
 * Features:
 * - Progressive color fill as word is sung
 * - Subtle pulse animation on active word
 * - Glow effect on active word
 * - Past words stay highlighted in gold
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
  const wordStyle = useMemo(() => {
    if (isActive) {
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
        // Add glow effect
        filter: `drop-shadow(0 0 8px ${COLORS.activeGlow})`,
        // Subtle scale for emphasis
        transform: 'scale(1.05)',
      } as React.CSSProperties
    }

    if (isPast) {
      return {
        color: COLORS.past,
        // Subtle glow on past words
        textShadow: `0 0 4px ${COLORS.past}40`,
      } as React.CSSProperties
    }

    return {
      color: COLORS.inactive,
    } as React.CSSProperties
  }, [isActive, isPast, progress])

  // Determine text class based on state
  const textClass = useMemo(() => {
    if (isActive) {
      return 'font-bold'
    }
    if (isPast) {
      return 'font-semibold'
    }
    return 'font-normal'
  }, [isActive, isPast])

  return (
    <span
      className={cn(
        'inline-block transition-all duration-100 ease-out',
        textClass,
        // Pulse animation on active word
        isActive && 'animate-pulse-subtle'
      )}
      style={wordStyle}
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
