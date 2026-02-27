/**
 * @fileoverview Karaoke word component with clip-path progressive fill.
 *
 * Architecture: Progressive clip-path reveal for the active word (GPU compositor Tier S),
 * single DOM nodes for inactive/past words (minimal overhead).
 * Uses theme CSS variables for color-aware rendering in dark/light mode.
 *
 * Why clip-path instead of background-clip:text?
 * - background-clip:text was tried and abandoned (see git history — rendering issues)
 * - clip-path is a real compositor property (GPU Tier S, no main thread repaints)
 * - clip-path is compatible with text-shadow/glow (unlike background-clip:text)
 * - Only 2 DOM nodes on the active word; 1 node for all others
 */

import React, { memo } from 'react'
import type { KaraokeWordProps } from '@/types/lyrics'

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Karaoke word with Apple Music-style progressive fill.
 *
 * States:
 * - Inactive: 1 DOM node, muted color
 * - Past (sung): 1 DOM node, foreground color
 * - Active: 2 DOM nodes — base (muted) + overlay (primary, clip-path animated)
 *
 * The active word clip-path (`inset(0 X% 0 0)`) reveals the primary-colored overlay
 * from left to right as `progress` increases from 0 to 1. This animation runs on
 * the GPU compositor thread — zero main thread involvement.
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
  if (!isActive && !isPast) {
    // Inactive: single node, no GPU overhead, muted foreground
    return (
      <span className="font-normal text-muted-foreground">
        {word.text}
      </span>
    )
  }

  if (isPast) {
    // Past (sung): single node, full foreground color
    return (
      <span className="font-semibold text-foreground">
        {word.text}
      </span>
    )
  }

  // Active word: clip-path overlay reveals primary color from left to right.
  // clip-path is GPU compositor-accelerated (Tier S) — no layout, no paint.
  // Compatible with text-shadow/glow (unlike background-clip: text).
  const clipRight = Math.max(0, 100 - progress * 100)

  return (
    <span className="relative inline-block">
      {/* Base layer: muted color, hidden from AT (overlay provides accessible text) */}
      <span className="font-bold text-muted-foreground" aria-hidden="true">
        {word.text}
      </span>
      {/* Overlay: primary color, revealed left-to-right by clip-path */}
      <span
        className="absolute inset-0 font-bold text-primary"
        style={{
          clipPath: `inset(0 ${clipRight}% 0 0)`,
          willChange: 'clip-path',
        }}
      >
        {word.text}
      </span>
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
  /** Progress through current word (0-1) */
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
    <span className={className}>
      {words.map((word, index) => {
        const isCurrentWord = index === currentWordIndex
        const isLastWord = index === words.length - 1

        // Last word at ≥85% completion transitions to "past" early for a clean line change
        const isLastWordFinished = isCurrentWord && isLastWord && wordProgress >= 0.85

        return (
          <React.Fragment key={`${word.text}-${index}`}>
            <KaraokeWord
              word={word}
              isActive={isCurrentWord && !isLastWordFinished}
              isPast={index < currentWordIndex || isLastWordFinished}
              progress={isCurrentWord ? wordProgress : 0}
            />
            {index < words.length - 1 && ' '}
          </React.Fragment>
        )
      })}
    </span>
  )
})

export default KaraokeWord
