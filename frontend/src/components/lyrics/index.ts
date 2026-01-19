/**
 * @fileoverview Lyrics display components barrel export.
 *
 * Architecture: Clean API surface with named exports.
 *
 * Usage:
 * ```tsx
 * import {
 *   LyricsDisplayPro,
 *   LyricsDisplayCompact,
 *   LyricsDisplayFullscreen,
 *   LyricLine,
 *   KaraokeWord,
 *   LyricsControls,
 * } from '@/components/lyrics'
 * ```
 */

// Main display components
export {
  LyricsDisplayPro,
  LyricsDisplayCompact,
  LyricsDisplayFullscreen,
  default as LyricsDisplay,
} from './LyricsDisplayPro'

// Individual components
export { LyricLine, LyricLineSkeleton } from './LyricLine'
export { KaraokeWord, KaraokeWordGroup } from './KaraokeWord'
export { LyricsControls, LyricsControlsMobile } from './LyricsControls'

// Re-export types for convenience
export type {
  LyricLine as LyricLineType,
  LyricWord,
  LyricsDisplayMode,
  LyricLineProps,
  KaraokeWordProps,
  LyricsSyncState,
  LyricsOffsetState,
  LyricsAnimationConfig,
} from '@/types/lyrics'

// Re-export hooks
export { useLyricsSync } from '@/hooks/useLyricsSync'
export { useLyricsScroll } from '@/hooks/useLyricsScroll'

// Re-export constants
export {
  OFFSET_CONFIG,
  PERFORMANCE_CONFIG,
  DEFAULT_ANIMATION_CONFIG,
} from '@/types/lyrics'
