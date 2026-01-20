/**
 * @fileoverview Hook to detect device orientation and screen size.
 * Useful for adapting layout to landscape mode on mobile devices.
 */

import { useState, useEffect } from 'react'

export interface OrientationState {
  /** Whether the device is in landscape mode */
  isLandscape: boolean
  /** Whether this is a mobile device (based on screen width in portrait) */
  isMobile: boolean
  /** Whether we should use the landscape mobile layout */
  useLandscapeMobileLayout: boolean
  /** Current window width */
  width: number
  /** Current window height */
  height: number
}

/**
 * Hook to detect orientation and provide layout hints.
 *
 * @example
 * ```tsx
 * const { useLandscapeMobileLayout, isLandscape } = useOrientation()
 *
 * if (useLandscapeMobileLayout) {
 *   return <LandscapeLayout />
 * }
 * return <PortraitLayout />
 * ```
 */
export function useOrientation(): OrientationState {
  const [state, setState] = useState<OrientationState>(() => {
    if (typeof window === 'undefined') {
      return {
        isLandscape: false,
        isMobile: true,
        useLandscapeMobileLayout: false,
        width: 0,
        height: 0,
      }
    }

    const width = window.innerWidth
    const height = window.innerHeight
    const isLandscape = width > height
    // Consider mobile if the smaller dimension is less than 768px
    const smallerDimension = Math.min(width, height)
    const isMobile = smallerDimension < 768

    return {
      isLandscape,
      isMobile,
      useLandscapeMobileLayout: isLandscape && isMobile,
      width,
      height,
    }
  })

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const isLandscape = width > height
      const smallerDimension = Math.min(width, height)
      const isMobile = smallerDimension < 768

      setState({
        isLandscape,
        isMobile,
        useLandscapeMobileLayout: isLandscape && isMobile,
        width,
        height,
      })
    }

    // Listen to both resize and orientation change
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    // Initial check
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  return state
}

export default useOrientation
