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
  /** Whether playback is active */
  isPlaying: boolean
  /** Container element ref */
  containerRef: React.RefObject<HTMLElement | null>
  /** Whether auto-scroll is enabled */
  enabled?: boolean
  /** Debounce delay in ms */
  debounceMs?: number
  /** Scroll position as fraction of viewport height (0-1). Default 0.30 (30% from top). */
  scrollPosition?: number
  /** When true, fall back to native smooth scroll instead of spring physics. */
  reducedMotion?: boolean
}

interface UseLyricsScrollReturn {
  /** Ref to attach to the current line element */
  currentLineRef: React.RefObject<HTMLDivElement | null>
  /** Ref to attach to the scroll target line (same as current) */
  scrollTargetRef: React.RefObject<HTMLDivElement | null>
  /** Index of the line used as scroll target (equals currentLineIndex) */
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
  isPlaying,
  containerRef,
  enabled = true,
  debounceMs = PERFORMANCE_CONFIG.SCROLL_DEBOUNCE_MS,
  scrollPosition = 0.30,
  reducedMotion = false,
}: UseLyricsScrollOptions): UseLyricsScrollReturn {
  const currentLineRef = useRef<HTMLDivElement>(null)
  const scrollTargetRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUserScrollingRef = useRef(false)
  const lastScrollTimeRef = useRef(0)
  // Spring animation state — persists across renders for interruption + velocity carry-over
  const springStateRef = useRef<{
    rafId: number | null
    velocity: number
    currentY: number
  } | null>(null)

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(enabled)

  // Scroll directly to current line (not ahead) - positioning handled by CSS padding
  const scrollTargetIndex = currentLineIndex

  // Detect user scroll interaction
  // IMPORTANT: Listen on the Radix ScrollArea viewport, not the outer container.
  // The `scroll` event does NOT bubble, so the listener must be on the element
  // that actually scrolls (the Radix viewport), not a parent container.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Find the actual scrollable element (Radix ScrollArea nested viewport)
    const viewport = container.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
    const scrollTarget = viewport || container

    const handleScroll = () => {
      const now = Date.now()

      // Ignore programmatic scrolls (spring animation keeps lastScrollTimeRef fresh)
      // 500ms window prevents fast line changes from falsely triggering user-scroll detection
      if (now - lastScrollTimeRef.current < 500) return

      // Cancel any ongoing spring animation when user takes manual control
      if (springStateRef.current?.rafId != null) {
        cancelAnimationFrame(springStateRef.current.rafId)
        springStateRef.current.rafId = null
        springStateRef.current.velocity = 0
      }

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

    scrollTarget.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      scrollTarget.removeEventListener('scroll', handleScroll)
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

  // Spring scroll — replaces scrollTo({ behavior: 'smooth' }).
  // Uses rAF + spring physics for Apple Music-like natural deceleration.
  // Interruptible: calling again mid-animation carries over velocity for smooth redirect.
  // lastScrollTimeRef is refreshed on every tick to suppress the user-scroll listener.
  const springScrollTo = useCallback((scrollContainer: HTMLElement, targetY: number) => {
    const prevState = springStateRef.current
    // Carry over velocity if already animating (avoids jarring direction change)
    const initialVelocity = prevState?.rafId != null ? prevState.velocity : 0

    if (prevState?.rafId != null) {
      cancelAnimationFrame(prevState.rafId)
    }

    const stiffness = 120
    const damping = 26
    const mass = 1

    const state = {
      rafId: null as number | null,
      velocity: initialVelocity,
      currentY: scrollContainer.scrollTop,
    }
    springStateRef.current = state

    let lastTime = performance.now()

    function tick(now: number) {
      // Keep marking as programmatic so scroll listener ignores these events
      lastScrollTimeRef.current = Date.now()

      const dt = Math.min((now - lastTime) / 1000, 0.05) // cap at 50ms (handles tab blur)
      lastTime = now

      const displacement = state.currentY - targetY
      const springForce = -stiffness * displacement
      const dampingForce = -damping * state.velocity
      const acceleration = (springForce + dampingForce) / mass

      state.velocity += acceleration * dt
      state.currentY += state.velocity * dt
      scrollContainer.scrollTop = state.currentY

      if (Math.abs(state.velocity) > 0.5 || Math.abs(displacement) > 0.5) {
        state.rafId = requestAnimationFrame(tick)
      } else {
        // Snap to final position to avoid sub-pixel drift
        scrollContainer.scrollTop = targetY
        state.rafId = null
      }
    }

    state.rafId = requestAnimationFrame(tick)
  }, []) // stable — only uses refs and closure variables

  // Debounced scroll to current line
  // Positions the line at ~30% from top of visible area (ideal for karaoke)
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
      const container = containerRef.current
      if (!element || !container) return

      // Mark this as a programmatic scroll
      lastScrollTimeRef.current = Date.now()

      // Find the actual scrollable viewport (Radix ScrollArea uses a nested viewport)
      const viewport = container.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      const scrollContainer = viewport || container

      // Calculate position to place line at the configured fraction from top
      const containerRect = scrollContainer.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()

      const targetOffset = containerRect.height * scrollPosition

      // Calculate the scroll position needed
      const elementTopRelativeToContainer = elementRect.top - containerRect.top + scrollContainer.scrollTop
      const targetScrollTop = Math.max(0, elementTopRelativeToContainer - targetOffset)

      if (reducedMotion) {
        // Native smooth scroll — browser respects prefers-reduced-motion natively
        scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
      } else {
        springScrollTo(scrollContainer, targetScrollTop)
      }
    }, debounceMs)

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [currentLineIndex, scrollTargetIndex, autoScrollEnabled, enabled, debounceMs, containerRef, springScrollTo, scrollPosition, reducedMotion])

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
