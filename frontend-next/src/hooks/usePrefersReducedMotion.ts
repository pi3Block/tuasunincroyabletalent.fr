/**
 * @fileoverview Hook to detect user's prefers-reduced-motion system preference.
 *
 * When enabled, the lyrics module disables:
 * - Spring scroll physics (falls back to native smooth scroll)
 * - Blur depth-of-field effect
 * - Clip-path gradient fill animation (falls back to instant color change)
 * - Scale/glow transitions
 *
 * Hydration-safe: always initializes to `false` (both server and client),
 * then syncs with the real OS preference in useEffect after mount.
 * This avoids React hydration mismatches while keeping the first paint fast.
 */

import { useState, useEffect } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Returns `true` when the user has enabled "Reduce motion" in their OS settings.
 * SSR-safe and hydration-safe: always `false` on first render, syncs after mount.
 */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    // Sync with actual value after hydration
    setReducedMotion(mql.matches)

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return reducedMotion
}

export default usePrefersReducedMotion
