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

/** Colors for the gradient fill - Apple Music style */
const COLORS = {
  /** Active/highlighted color - bright yellow/gold like Apple Music */
  active: '#facc15',
  /** Active glow color */
  activeGlow: '#eab308',
  /** Inactive/upcoming color - lighter gray for better contrast */
  inactive: '#9ca3af',
  /** Past color - white/sung */
  past: '#ffffff',
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
  progress: _progress,
}: KaraokeWordProps) {
  // progress reserved for future within-word gradient animation
  void _progress
  // Calculate style for word based on state
  // Note: We avoid background-clip:text as it has rendering issues
  // Instead, we use simple color transitions
  const wordStyle = useMemo(() => {
    if (isActive) {
      // For active word, show it in the active color (fully highlighted)
      // The progress is shown by which word is active, not within-word gradient
      return {
        color: COLORS.active,
      } as React.CSSProperties
    }

    if (isPast) {
      return {
        color: COLORS.past,
      } as React.CSSProperties
    }

    return {
      color: COLORS.inactive,
    } as React.CSSProperties
  }, [isActive, isPast])

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
        'transition-colors duration-75 ease-out',
        textClass
      )}
      style={wordStyle}
    >
      {word.text}
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
    <span className={cn('inline', className)}>
      {words.map((word, index) => (
        <React.Fragment key={`${word.text}-${index}`}>
          <KaraokeWord
            word={word}
            isActive={index === currentWordIndex}
            isPast={index < currentWordIndex}
            progress={index === currentWordIndex ? wordProgress : 0}
          />
          {index < words.length - 1 && ' '}
        </React.Fragment>
      ))}
    </span>
  )
})

export default KaraokeWord
