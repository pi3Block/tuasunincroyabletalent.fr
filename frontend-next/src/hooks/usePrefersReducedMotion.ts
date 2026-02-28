/**
 * @fileoverview Hook to detect user's prefers-reduced-motion system preference.
 *
 * Delegates to Framer Motion's useReducedMotion (same matchMedia logic,
 * SSR-safe, listener-based). Avoids duplicating what the library already provides.
 *
 * When enabled, the lyrics module disables:
 * - Spring scroll physics (falls back to native smooth scroll)
 * - Blur depth-of-field effect
 * - Clip-path gradient fill animation (falls back to instant color change)
 * - Scale/glow transitions
 */

import { useReducedMotion } from 'framer-motion'

/**
 * Returns `true` when the user has enabled "Reduce motion" in their OS settings.
 * SSR-safe: returns `false` on first render, syncs after mount.
 */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false
}

export default usePrefersReducedMotion
