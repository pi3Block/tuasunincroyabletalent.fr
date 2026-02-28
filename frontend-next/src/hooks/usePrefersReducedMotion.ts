/**
 * @fileoverview Hook to detect user's prefers-reduced-motion system preference.
 *
 * When enabled, the lyrics module disables:
 * - Spring scroll physics (falls back to native smooth scroll)
 * - Blur depth-of-field effect
 * - Clip-path gradient fill animation (falls back to instant color change)
 * - Scale/glow transitions
 */

import { useState, useEffect } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Returns `true` when the user has enabled "Reduce motion" in their OS settings.
 * SSR-safe: returns `false` on the server (no `window`).
 */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(QUERY).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)

    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return reducedMotion
}

export default usePrefersReducedMotion
