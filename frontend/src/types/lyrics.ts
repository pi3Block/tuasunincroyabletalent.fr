/**
 * @fileoverview Lyrics type definitions for the karaoke system.
 *
 * Architecture: Domain-Driven Design with clear separation of concerns.
 * These types are the foundation for word-level and line-level sync.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * A single word with timing information for word-by-word karaoke.
 * Used for Apple Music-style progressive highlight.
 */
export interface LyricWord {
  /** The word text */
  text: string
  /** Start time in milliseconds */
  startTimeMs: number
  /** End time in milliseconds */
  endTimeMs: number
  /** Optional confidence score from transcription (0-1) */
  confidence?: number
}

/**
 * A line of lyrics with optional word-level timing.
 * Supports both line-level (Spotify-style) and word-level (Apple Music-style) sync.
 */
export interface LyricLine {
  /** Unique identifier for the line */
  id: string
  /** Full text of the line */
  text: string
  /** Start time in seconds */
  startTime: number
  /** End time in seconds (optional, calculated from next line if missing) */
  endTime?: number
  /** Word-level timing for karaoke mode (optional) */
  words?: LyricWord[]
}

/**
 * Complete lyrics data with metadata.
 */
export interface SyncedLyrics {
  /** Track identifier (Spotify/YouTube) */
  trackId: string
  /** Song title */
  title: string
  /** Artist name */
  artist: string
  /** Array of lyric lines */
  lines: LyricLine[]
  /** Sync format available */
  format: LyricsSyncFormat
  /** Source of the lyrics */
  source: LyricsSource
}

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/**
 * Display modes for the lyrics component.
 */
export type LyricsDisplayMode =
  | 'line'     // Standard line-by-line (Spotify-style)
  | 'word'     // Word-by-word highlight (Apple Music-style)
  | 'karaoke'  // Full karaoke with gradient fill
  | 'compact'  // Single line display

/**
 * Sync format of the lyrics.
 */
export type LyricsSyncFormat =
  | 'line-level'  // Only line timestamps
  | 'word-level'  // Word-level timestamps available
  | 'unsynced'    // No timestamps

/**
 * Source of the lyrics data.
 */
export type LyricsSource =
  | 'spotify'
  | 'lrclib'
  | 'genius'
  | 'musixmatch'
  | 'manual'
  | 'unknown'

// ============================================================================
// SYNC STATE TYPES
// ============================================================================

/**
 * Current sync state returned by useLyricsSync hook.
 */
export interface LyricsSyncState {
  /** Index of the currently active line (-1 if none) */
  currentLineIndex: number
  /** Index of the currently active word within the line (-1 if none/not word mode) */
  currentWordIndex: number
  /** Progress through current word (0-1) for gradient fill */
  wordProgress: number
  /** Progress through current line (0-1) */
  lineProgress: number
  /** The current active line object */
  currentLine: LyricLine | null
  /** The next line (for preview) */
  nextLine: LyricLine | null
  /** Whether we're at the start (before first line) */
  isBeforeStart: boolean
  /** Whether we're at the end (after last line) */
  isAfterEnd: boolean
}

/**
 * Offset configuration and state.
 */
export interface LyricsOffsetState {
  /** Current offset in seconds */
  offset: number
  /** Minimum allowed offset */
  minOffset: number
  /** Maximum allowed offset */
  maxOffset: number
  /** Whether offset is being saved */
  isSaving: boolean
  /** Auto-sync suggested offset (null if not calculated) */
  autoSyncOffset: number | null
  /** Auto-sync confidence score (0-1) */
  autoSyncConfidence: number | null
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

/**
 * Props for the main LyricsDisplay component.
 */
export interface LyricsDisplayProps {
  /** Plain text lyrics (fallback) */
  lyrics: string
  /** Synced lyrics with timestamps */
  syncedLines?: LyricLine[] | null
  /** Current playback time in seconds */
  currentTime: number
  /** Whether audio is playing */
  isPlaying: boolean
  /** Display mode */
  displayMode?: LyricsDisplayMode
  /** Manual offset in seconds */
  offset?: number
  /** Callback when offset changes */
  onOffsetChange?: (offset: number) => void
  /** Show offset controls */
  showOffsetControls?: boolean
  /** Callback when line changes */
  onLineChange?: (lineIndex: number) => void
  /** Callback when user taps a line (tap-to-sync) */
  onLineTap?: (lineIndex: number, lineStartTime: number) => void
  /** Auto-sync handler */
  onAutoSync?: () => Promise<{ offset: number; confidence: number } | null>
  /** Whether auto-sync is in progress */
  isAutoSyncing?: boolean
  /** Auto-sync confidence after calculation */
  autoSyncConfidence?: number | null
  /** Custom class name */
  className?: string
}

/**
 * Props for individual lyric line component.
 */
export interface LyricLineProps {
  /** The line data */
  line: LyricLine
  /** Line index in the array */
  index: number
  /** Whether this line is currently active */
  isActive: boolean
  /** Whether this line has already been sung */
  isPast: boolean
  /** Distance from current line (for blur/opacity effects) */
  distance: number
  /** Display mode */
  displayMode: LyricsDisplayMode
  /** Current word index (for karaoke mode) */
  currentWordIndex: number
  /** Word progress (0-1) for gradient fill */
  wordProgress: number
  /** Callback when line is clicked */
  onClick?: () => void
  /** Ref for the active line */
  innerRef?: React.Ref<HTMLDivElement>
}

/**
 * Props for karaoke word component.
 */
export interface KaraokeWordProps {
  /** The word data */
  word: LyricWord
  /** Whether this word is currently being sung */
  isActive: boolean
  /** Whether this word has been sung */
  isPast: boolean
  /** Progress through the word (0-1) */
  progress: number
}

// ============================================================================
// ANIMATION TYPES
// ============================================================================

/**
 * Animation variants for Framer Motion.
 */
export interface LyricLineVariants {
  inactive: {
    scale: number
    opacity: number
    filter?: string
    y?: number
  }
  active: {
    scale: number
    opacity: number
    filter?: string
    y?: number
  }
  past: {
    scale: number
    opacity: number
    filter?: string
    y?: number
  }
}

/**
 * Configuration for lyrics animations.
 */
export interface LyricsAnimationConfig {
  /** Transition duration in ms */
  transitionDuration: number
  /** Easing function */
  easing: string
  /** Scale factor for active line */
  activeScale: number
  /** Scale factor for inactive lines */
  inactiveScale: number
  /** Blur amount for distant lines (px) */
  blurAmount: number
  /** Enable glow effect on active line */
  enableGlow: boolean
  /** Glow color */
  glowColor: string
  /** Glow intensity */
  glowIntensity: number
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Default animation configuration.
 */
export const DEFAULT_ANIMATION_CONFIG: LyricsAnimationConfig = {
  transitionDuration: 300,
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  activeScale: 1.0,
  inactiveScale: 0.92,
  blurAmount: 1.5,
  enableGlow: true,
  glowColor: 'rgba(251, 191, 36, 0.6)',
  glowIntensity: 20,
}

/**
 * Offset configuration constants.
 */
export const OFFSET_CONFIG = {
  MIN: -300,
  MAX: 300,
  FINE_STEP: 0.5,
  QUICK_STEPS: [5, 30, 60],
  DEBOUNCE_SAVE_MS: 1000,
} as const

/**
 * Performance configuration.
 */
export const PERFORMANCE_CONFIG = {
  /** Max lines to render (virtualization window) */
  RENDER_WINDOW: 10,
  /** Scroll debounce in ms */
  SCROLL_DEBOUNCE_MS: 100,
  /** Binary search threshold for line lookup */
  BINARY_SEARCH_THRESHOLD: 20,
} as const
