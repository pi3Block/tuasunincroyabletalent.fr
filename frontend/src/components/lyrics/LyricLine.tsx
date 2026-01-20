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
 * All lines remain readable (minimum 0.5 opacity) to allow scrolling.
 */
function getOpacity(distance: number, isActive: boolean): number {
  if (isActive) return 1
  if (distance === 1) return 0.8
  if (distance === 2) return 0.7
  if (distance === 3) return 0.6
  // Minimum 0.5 opacity so all lines remain readable
  return Math.max(0.5, 0.7 - distance * 0.05)
}

/**
 * Get scale based on active state.
 */
function getScale(isActive: boolean, config = DEFAULT_ANIMATION_CONFIG): number {
  return isActive ? config.activeScale : config.inactiveScale
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
      onClick,
    },
    ref
  ) {
    // Compute styles based on state
    // Note: blur filter removed to allow smooth scrolling through lyrics
    const containerStyle = useMemo(() => {
      const scale = getScale(isActive)
      const opacity = getOpacity(distance, isActive)

      return {
        transform: `scale(${scale})`,
        opacity,
        // No filter/blur - it was preventing scrolling
        // Glow effect for active line
        ...(isActive && DEFAULT_ANIMATION_CONFIG.enableGlow
          ? {
              textShadow: `0 0 ${DEFAULT_ANIMATION_CONFIG.glowIntensity}px ${DEFAULT_ANIMATION_CONFIG.glowColor}`,
            }
          : {}),
      } as React.CSSProperties
    }, [isActive, distance])

    // Determine text classes based on state
    // Reduced sizes for better readability and more lines visible
    // Colors: white for current, gray for past/future (high contrast)
    const textClasses = useMemo(() => {
      if (isActive) {
        return 'text-xl sm:text-2xl md:text-2xl lg:text-3xl font-bold text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]'
      }
      if (isPast) {
        return 'text-base md:text-lg lg:text-xl text-gray-500'
      }
      return 'text-base md:text-lg lg:text-xl text-gray-400'
    }, [isActive, isPast])

    // Render content based on display mode
    const content = useMemo(() => {
      // Use karaoke word rendering if we have word data and mode supports it
      const hasWords = line.words && line.words.length > 0
      const useWordMode = hasWords && (displayMode === 'karaoke' || displayMode === 'word')

      if (useWordMode && line.words) {
        return (
          <KaraokeWordGroup
            words={line.words}
            currentWordIndex={isActive ? currentWordIndex : -1}
            wordProgress={isActive ? wordProgress : 0}
          />
        )
      }

      // Standard text rendering
      return line.text
    }, [line, displayMode, isActive, currentWordIndex, wordProgress])

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
          // Transition
          'transition-all duration-300 ease-out',
          // Will-change for GPU acceleration
          'will-change-transform',
          // Hover effect (only on non-active)
          !isActive && 'hover:scale-[0.96] hover:opacity-80'
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
