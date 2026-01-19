/**
 * @fileoverview Smart auto-scroll hook for lyrics display.
 *
 * Features:
 * - Debounced smooth scrolling to prevent jank
 * - User interaction detection (disables auto-scroll when user scrolls)
 * - Re-enables auto-scroll on playback resume
 * - Intersection Observer for performance
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { PERFORMANCE_CONFIG } from '@/types/lyrics'

// ============================================================================
// TYPES
// ============================================================================

interface UseLyricsScrollOptions {
  /** Current line index to scroll to */
  currentLineIndex: number
  /** Total number of lines */
  totalLines?: number
  /** Whether playback is active */
  isPlaying: boolean
  /** Container element ref */
  containerRef: React.RefObject<HTMLElement>
  /** Whether auto-scroll is enabled */
  enabled?: boolean
  /** Scroll behavior */
  behavior?: ScrollBehavior
  /** Block position */
  block?: ScrollLogicalPosition
  /** Debounce delay in ms */
  debounceMs?: number
  /** Number of lines to show ahead of current line (default: 3) */
  linesAhead?: number
}

interface UseLyricsScrollReturn {
  /** Ref to attach to the current line element */
  currentLineRef: React.RefObject<HTMLDivElement>
  /** Ref to attach to the target scroll line (current + linesAhead) */
  scrollTargetRef: React.RefObject<HTMLDivElement>
  /** Index of the line that should be used as scroll target */
  scrollTargetIndex: number
  /** Whether auto-scroll is currently enabled */
  autoScrollEnabled: boolean
  /** Manually enable auto-scroll */
  enableAutoScroll: () => void
  /** Manually disable auto-scroll */
  disableAutoScroll: () => void
  /** Toggle auto-scroll */
  toggleAutoScroll: () => void
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Smart auto-scroll hook with user interaction detection.
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null)
 * const { currentLineRef, autoScrollEnabled } = useLyricsScroll({
 *   currentLineIndex,
 *   isPlaying,
 *   containerRef,
 * })
 *
 * return (
 *   <div ref={containerRef}>
 *     {lines.map((line, i) => (
 *       <div
 *         key={i}
 *         ref={i === currentLineIndex ? currentLineRef : undefined}
 *       >
 *         {line.text}
 *       </div>
 *     ))}
 *   </div>
 * )
 * ```
 */
export function useLyricsScroll({
  currentLineIndex,
  totalLines = 0,
  isPlaying,
  containerRef,
  enabled = true,
  behavior = 'smooth',
  block = 'center',
  debounceMs = PERFORMANCE_CONFIG.SCROLL_DEBOUNCE_MS,
  linesAhead = 3,
}: UseLyricsScrollOptions): UseLyricsScrollReturn {
  const currentLineRef = useRef<HTMLDivElement>(null)
  const scrollTargetRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUserScrollingRef = useRef(false)
  const lastScrollTimeRef = useRef(0)

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(enabled)

  // Calculate scroll target index (current line + lines ahead, clamped to total)
  const scrollTargetIndex = Math.min(currentLineIndex + linesAhead, totalLines - 1)

  // Detect user scroll interaction
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const now = Date.now()

      // Ignore programmatic scrolls (they happen right after we trigger them)
      if (now - lastScrollTimeRef.current < 200) return

      // User is scrolling manually
      isUserScrollingRef.current = true
      setAutoScrollEnabled(false)

      // Clear any pending timeout
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }

      // Re-enable after user stops scrolling for 3 seconds
      userScrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
        if (isPlaying) {
          setAutoScrollEnabled(true)
        }
      }, 3000)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }
  }, [containerRef, isPlaying])

  // Re-enable auto-scroll when playback starts
  useEffect(() => {
    if (isPlaying && !isUserScrollingRef.current) {
      setAutoScrollEnabled(true)
    }
  }, [isPlaying])

  // Debounced scroll to target line (current + linesAhead)
  // This ensures the singer always sees several lines ahead
  useEffect(() => {
    if (!autoScrollEnabled || !enabled) return

    // Use scrollTargetRef if available, fallback to currentLineRef
    const targetElement = scrollTargetRef.current || currentLineRef.current
    if (!targetElement) return

    // Clear previous timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Debounce scroll
    scrollTimeoutRef.current = setTimeout(() => {
      const element = scrollTargetRef.current || currentLineRef.current
      if (!element) return

      // Mark this as a programmatic scroll
      lastScrollTimeRef.current = Date.now()

      // Scroll so that the target line (current + linesAhead) is centered
      // This puts the current line near the top with linesAhead visible below
      element.scrollIntoView({
        behavior,
        block,
      })
    }, debounceMs)

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [currentLineIndex, scrollTargetIndex, autoScrollEnabled, enabled, behavior, block, debounceMs])

  // Manual controls
  const enableAutoScroll = useCallback(() => {
    isUserScrollingRef.current = false
    setAutoScrollEnabled(true)
  }, [])

  const disableAutoScroll = useCallback(() => {
    setAutoScrollEnabled(false)
  }, [])

  const toggleAutoScroll = useCallback(() => {
    setAutoScrollEnabled(prev => !prev)
  }, [])

  return {
    currentLineRef,
    scrollTargetRef,
    scrollTargetIndex,
    autoScrollEnabled,
    enableAutoScroll,
    disableAutoScroll,
    toggleAutoScroll,
  }
}

export default useLyricsScroll
