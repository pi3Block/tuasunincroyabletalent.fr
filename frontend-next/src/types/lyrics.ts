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
  | 'line'          // Standard line-by-line (Spotify-style)
  | 'word'          // Word-by-word highlight (Apple Music-style)
  | 'karaoke'       // Full karaoke with gradient fill
  | 'compact'       // Single line display
  | 'teleprompter'  // Pro teleprompter: uniform large text, center scroll, line-level only

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
  /** Whether this line is about to become active (<2s away) — triggers pre-roll glow */
  isPreRoll?: boolean
  /** Whether prefers-reduced-motion is active (disables blur, glow, scale transitions) */
  reducedMotion?: boolean
  /** Callback when line is clicked */
  onClick?: () => void
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
  /** Whether prefers-reduced-motion is active (disables clip-path animation) */
  reducedMotion?: boolean
}

// ============================================================================
// ANIMATION TYPES
// ============================================================================

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
  inactiveScale: 0.85, // stronger recession for clear visual hierarchy
  enableGlow: true,
  glowColor: 'rgba(34, 197, 94, 0.6)', // primary green (#22c55e), matches theme
  glowIntensity: 20,
}

/**
 * Offset configuration constants.
 */
export const OFFSET_CONFIG = {
  MIN: -300,
  MAX: 300,
  FINE_STEP: 0.1,
} as const

/**
 * Performance configuration.
 */
export const PERFORMANCE_CONFIG = {
  /** Max lines to render (virtualization window) - high value to allow scrolling all lyrics */
  RENDER_WINDOW: 100,
  /** Scroll debounce in ms — 50ms for snappier response at line changes */
  SCROLL_DEBOUNCE_MS: 50,
  /** Binary search threshold for line lookup */
  BINARY_SEARCH_THRESHOLD: 20,
} as const
