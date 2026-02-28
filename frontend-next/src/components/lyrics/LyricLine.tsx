/**
 * @fileoverview Individual lyric line component with animations.
 *
 * Features:
 * - Smooth scale/opacity transitions
 * - Blur effect for distant lines (depth perception)
 * - Glow effect on active line
 * - Karaoke word-by-word mode support
 * - Tap-to-sync interaction
 *
 * Architecture: Composite component using KaraokeWord for word-level rendering.
 */

import React, { memo, useMemo, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import type { LyricLineProps } from '@/types/lyrics'
import { DEFAULT_ANIMATION_CONFIG } from '@/types/lyrics'
import { KaraokeWordGroup } from './KaraokeWord'

// ============================================================================
// STYLE UTILITIES
// ============================================================================

/**
 * Calculate opacity based on distance from current line.
 * All lines remain readable to allow scrolling and reading ahead.
 * Upcoming lines (not past) get higher opacity to help singers read ahead.
 */
function getOpacity(distance: number, isActive: boolean, isNext: boolean, isPast: boolean): number {
  if (isActive) return 1

  // Upcoming lines (not past) should be more visible for reading ahead
  if (!isPast) {
    if (isNext) return 1 // Next line fully visible
    if (distance === 2) return 0.85
    if (distance === 3) return 0.75
    if (distance === 4) return 0.65
    // Minimum 0.55 for distant future lines
    return Math.max(0.55, 0.7 - distance * 0.03)
  }

  // Past lines can be dimmer
  if (distance === 1) return 0.6
  if (distance === 2) return 0.5
  if (distance === 3) return 0.45
  // Minimum 0.4 for distant past lines
  return Math.max(0.4, 0.5 - distance * 0.03)
}

/**
 * Teleprompter opacity: simplified, all text highly visible.
 */
function getTeleprompterOpacity(distance: number, isActive: boolean): number {
  if (isActive) return 1
  if (distance <= 1) return 0.7
  return 0.4
}

/**
 * Get scale based on active state.
 * Strong hierarchy: active=1.0, next=0.98, others=0.85
 * The large gap (0.85 vs 0.98) creates clear visual focus on active+next.
 */
function getScale(isActive: boolean, isNext: boolean, config = DEFAULT_ANIMATION_CONFIG): number {
  if (isActive) return config.activeScale  // 1.0
  if (isNext) return 0.98                  // clearly distinct from others
  return config.inactiveScale              // 0.85 — strong recession
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Individual lyric line with animations and effects.
 *
 * Supports multiple display modes:
 * - `line`: Standard line highlighting (Spotify-style)
 * - `word`: Word-by-word highlight without gradient
 * - `karaoke`: Full karaoke with progressive gradient fill
 *
 * @example
 * ```tsx
 * <LyricLine
 *   line={line}
 *   index={0}
 *   isActive={true}
 *   isPast={false}
 *   distance={0}
 *   displayMode="karaoke"
 *   currentWordIndex={2}
 *   wordProgress={0.5}
 *   onClick={() => handleLineTap(0)}
 * />
 * ```
 */
export const LyricLine = memo(forwardRef<HTMLDivElement, LyricLineProps>(
  function LyricLine(
    {
      line,
      index,
      isActive,
      isPast,
      distance,
      displayMode,
      currentWordIndex,
      wordProgress,
      isPreRoll = false,
      reducedMotion = false,
      energy,
      onClick,
    },
    ref
  ) {
    // Check if this is the next line (distance 1, not past)
    const isNext = distance === 1 && !isPast
    const isTeleprompter = displayMode === 'teleprompter'

    // Compute styles based on state
    const containerStyle = useMemo(() => {
      // Teleprompter: uniform scale, no blur, no glow — just opacity
      if (isTeleprompter) {
        const opacity = getTeleprompterOpacity(distance, isActive)
        return {
          opacity,
          willChange: distance <= 10 ? 'opacity' : 'auto',
        } as React.CSSProperties
      }

      // Reduced motion: no blur, no glow, no scale transform
      if (reducedMotion) {
        const opacity = getOpacity(distance, isActive, isNext, isPast)
        return { opacity } as React.CSSProperties
      }

      const scale = getScale(isActive, isNext)
      const opacity = getOpacity(distance, isActive, isNext, isPast)

      // Blur depth-of-field: focuses the eye on the active line (Apple Music-style).
      // Re-implemented with targeted transition + dynamic will-change (fixes previous
      // scrolling performance issue caused by global will-change + transition-all).
      const blurAmount = isActive ? 0
        : isNext ? 0.3
        : distance <= 3 ? Math.min(distance * 0.4, 1.5)
        : Math.min(2 + (distance - 4) * 0.2, 3)

      // Pre-roll: subtle anticipatory glow on the next line when <2s from activation.
      // Half the intensity of the active glow — visible but not distracting.
      const preRollGlow = isPreRoll && !isActive
        ? { textShadow: '0 0 12px rgba(34, 197, 94, 0.3)' }
        : {}

      return {
        transform: `scale(${scale})`,
        opacity,
        filter: blurAmount > 0 ? `blur(${blurAmount}px)` : undefined,
        // Dynamic will-change: promote ±10 lines to GPU layers (includes filter for blur)
        willChange: distance <= 10 ? 'transform, opacity, filter' : 'auto',
        // Glow effect for active line — overrides pre-roll if both somehow true
        ...(isActive && DEFAULT_ANIMATION_CONFIG.enableGlow
          ? {
              textShadow: `0 0 ${DEFAULT_ANIMATION_CONFIG.glowIntensity}px ${DEFAULT_ANIMATION_CONFIG.glowColor}`,
            }
          : preRollGlow),
      } as React.CSSProperties
    }, [isActive, isNext, isPast, distance, isPreRoll, isTeleprompter, reducedMotion])

    // Determine text classes based on state
    // Reduced sizes for better readability and more lines visible
    // Colors: foreground tokens (theme-aware dark/light), muted for past
    const textClasses = useMemo(() => {
      // Teleprompter: uniform large text, bold only on active
      if (isTeleprompter) {
        if (isActive) {
          return 'text-xl md:text-2xl lg:text-3xl font-bold text-foreground'
        }
        return 'text-xl md:text-2xl lg:text-3xl font-normal text-foreground'
      }

      if (isActive) {
        return 'text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-foreground'
      }
      // Next line: larger, full foreground for maximum readability
      if (isNext) {
        return 'text-lg sm:text-xl md:text-xl lg:text-2xl font-semibold text-foreground'
      }
      // Upcoming lines (not past): slightly muted but readable
      if (!isPast) {
        return 'text-base md:text-lg lg:text-xl text-foreground/70'
      }
      // Past lines: muted foreground
      return 'text-base md:text-lg lg:text-xl text-muted-foreground'
    }, [isActive, isNext, isPast, isTeleprompter])

    // Render content based on display mode
    const content = useMemo(() => {
      // Teleprompter: always line-level, no word rendering
      if (isTeleprompter) return line.text

      // Use karaoke word rendering if we have word data and mode supports it
      const hasWords = line.words && line.words.length > 0
      const useWordMode = hasWords && (displayMode === 'karaoke' || displayMode === 'word')

      if (useWordMode && line.words) {
        // Determine word index based on line state:
        // - Active line: use actual currentWordIndex
        // - Past line: all words are "past" (sung) → index = words.length
        // - Future line: no words are "past" yet → index = -1
        let effectiveWordIndex: number
        if (isActive) {
          effectiveWordIndex = currentWordIndex
        } else if (isPast) {
          // All words in a past line should be white (sung)
          effectiveWordIndex = line.words.length
        } else {
          // Future line - no words sung yet
          effectiveWordIndex = -1
        }

        return (
          <KaraokeWordGroup
            words={line.words}
            currentWordIndex={effectiveWordIndex}
            wordProgress={isActive ? wordProgress : 0}
            reducedMotion={reducedMotion}
            energy={isActive ? energy : undefined}
          />
        )
      }

      // Standard text rendering
      return line.text
    }, [line, displayMode, isActive, isPast, currentWordIndex, wordProgress, isTeleprompter, reducedMotion, energy])

    return (
      <div
        ref={ref}
        data-line-index={index}
        onClick={onClick}
        role="button"
        tabIndex={0}
        aria-label={`Ligne ${index + 1}: ${line.text}`}
        aria-current={isActive ? 'true' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.()
          }
        }}
        className={cn(
          // Base styles
          'cursor-pointer select-none',
          // Transition — adapted for motion preferences and display mode
          reducedMotion
            ? 'transition-none'
            : isTeleprompter
              ? 'transition-opacity duration-300 ease-out'
              : 'transition-[transform,opacity,filter] duration-300 ease-out',
          // Hover effect (only on non-active, disabled for teleprompter)
          !isActive && !isTeleprompter && 'hover:scale-[0.96] hover:opacity-80'
        )}
        style={containerStyle}
      >
        <p
          className={cn(
            'text-center leading-relaxed transition-colors duration-300',
            textClasses
          )}
        >
          {content}
        </p>
      </div>
    )
  }
))

// ============================================================================
// SKELETON COMPONENT
// ============================================================================

interface LyricLineSkeletonProps {
  /** Width variation (0-1) */
  widthFactor?: number
}

/**
 * Skeleton placeholder for loading state.
 */
export const LyricLineSkeleton = memo(function LyricLineSkeleton({
  widthFactor = 0.7,
}: LyricLineSkeletonProps) {
  const width = `${Math.round(widthFactor * 100)}%`

  return (
    <div className="animate-pulse py-4">
      <div
        className="h-8 bg-muted/30 rounded-lg mx-auto"
        style={{ width }}
      />
    </div>
  )
})

export default LyricLine
