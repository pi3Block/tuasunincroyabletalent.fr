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
  /** Vocal energy (0-1) for active word glow/breathing */
  energy?: number
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
  /** Vocal energy (0-1) for active word glow/breathing */
  energy?: number
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

/** Scale for the next line (distance=1, not past). Between active and inactive. */
export const NEXT_LINE_SCALE = 0.98

/**
 * Energy-reactive effects on the active karaoke word (glow + breathing).
 * Used by KaraokeWord for Framer Motion spring animations.
 */
export const ENERGY_CONFIG = {
  /** Minimum energy to trigger effects (avoids noise) */
  THRESHOLD: 0.05,
  /** Inner glow radius multiplier (energy * this = px) */
  GLOW_INNER_MULTIPLIER: 50,
  /** Outer glow radius multiplier (energy * this = px) */
  GLOW_OUTER_MULTIPLIER: 100,
  /** Glow opacity at zero energy */
  GLOW_BASE_OPACITY: 0.5,
  /** Additional opacity range scaled by energy */
  GLOW_OPACITY_RANGE: 0.5,
  /** Outer glow opacity multiplier */
  GLOW_OUTER_OPACITY: 0.35,
  /** Scale increase multiplier (1 + energy * this) */
  SCALE_MULTIPLIER: 0.12,
  /** Framer Motion spring config for glow + scale */
  SPRING: { type: 'spring' as const, stiffness: 300, damping: 20 },
} as const

/**
 * Blur depth-of-field config for non-active lines (Apple Music-style focus).
 * Applied via CSS filter in LyricLine.
 */
export const BLUR_CONFIG = {
  /** Blur for next line (distance=1) */
  NEXT: 0.3,
  /** Blur multiplier for near lines (distance 2-3) */
  NEAR_MULTIPLIER: 0.4,
  /** Max blur for near lines */
  NEAR_MAX: 1.5,
  /** Base blur for far lines (distance 4+) */
  FAR_BASE: 2,
  /** Incremental blur per extra distance beyond 4 */
  FAR_STEP: 0.2,
  /** Maximum blur (never exceed) */
  FAR_MAX: 3,
} as const

/**
 * Spring physics config for auto-scroll (useLyricsScroll).
 */
export const SCROLL_SPRING_CONFIG = {
  STIFFNESS: 120,
  DAMPING: 26,
  MASS: 1,
} as const

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
  /** Max lines to render above/below active line (virtualization window) */
  RENDER_WINDOW: 30,
  /** Scroll debounce in ms — 50ms for snappier response at line changes */
  SCROLL_DEBOUNCE_MS: 50,
  /** Binary search threshold for line lookup */
  BINARY_SEARCH_THRESHOLD: 20,
  /** Hysteresis: minimum ms before changing to a new word (prevents micro-jumps) */
  WORD_CHANGE_DELAY_MS: 80,
  /** EMA smoothing factor for word progress (0 = very smooth, 1 = no smoothing) */
  PROGRESS_SMOOTHING: 0.3,
} as const
