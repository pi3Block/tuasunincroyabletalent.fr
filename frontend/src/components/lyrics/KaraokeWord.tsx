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
  progress,
}: KaraokeWordProps) {
  // Calculate gradient style for active word - Apple Music style progressive fill
  const wordStyle = useMemo(() => {
    if (isActive) {
      // Clamp progress to 0-1
      const p = Math.max(0, Math.min(1, progress)) * 100

      return {
        // Progressive gradient fill from left to right
        background: `linear-gradient(90deg,
          ${COLORS.active} 0%,
          ${COLORS.active} ${p}%,
          ${COLORS.inactive} ${p}%,
          ${COLORS.inactive} 100%)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        // Subtle glow effect via text-shadow (no filter to avoid rectangle)
        textShadow: `0 0 20px ${COLORS.activeGlow}, 0 0 40px ${COLORS.activeGlow}50`,
      } as React.CSSProperties
    }

    if (isPast) {
      return {
        color: COLORS.past,
        // Subtle glow on past words
        textShadow: `0 0 8px rgba(255, 255, 255, 0.3)`,
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
        'inline-block transition-colors duration-75 ease-out',
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
