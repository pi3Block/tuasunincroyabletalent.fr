/**
 * @fileoverview High-performance lyrics synchronization hook.
 *
 * Architecture: Custom hook with binary search optimization for O(log n) line lookup.
 * Supports both line-level and word-level synchronization.
 *
 * Features:
 * - Binary search for efficient line finding (scales to 1000+ lines)
 * - Word-level progress calculation for karaoke mode
 * - Memoized calculations to prevent unnecessary re-renders
 * - Stable references for downstream consumers
 */

import { useMemo, useCallback, useRef } from 'react'
import type { LyricLine, LyricsSyncState, LyricsDisplayMode } from '@/types/lyrics'
import { PERFORMANCE_CONFIG } from '@/types/lyrics'

// ============================================================================
// SMOOTHING CONSTANTS
// ============================================================================

/** Hysteresis: minimum ms before changing to a new word (prevents micro-jumps) */
const WORD_CHANGE_DELAY_MS = 80

/** EMA smoothing factor for word progress (0 = very smooth, 1 = no smoothing) */
const PROGRESS_SMOOTHING = 0.3

// ============================================================================
// TYPES
// ============================================================================

interface UseLyricsSyncOptions {
  /** Array of lyric lines */
  lines: LyricLine[]
  /** Current playback time in seconds */
  currentTime: number
  /** Offset in seconds (positive = lyrics earlier) */
  offset: number
  /** Display mode */
  displayMode: LyricsDisplayMode
  /** Enable word-level tracking */
  enableWordTracking?: boolean
}

interface UseLyricsSyncReturn extends LyricsSyncState {
  /** Adjusted time (currentTime + offset) */
  adjustedTime: number
  /** Find line index for a given time */
  findLineAtTime: (time: number) => number
  /** Check if a line is visible in render window */
  isLineVisible: (index: number) => boolean
}

// ============================================================================
// BINARY SEARCH UTILITIES
// ============================================================================

/**
 * Binary search to find the line index for a given time.
 * O(log n) complexity for efficient lookup.
 *
 * @param lines - Array of lyric lines (must be sorted by startTime)
 * @param time - Time in seconds to find
 * @returns Index of the line containing the time, or -1 if before first line or in instrumental gap (>2s)
 */
function binarySearchLineIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1
  if (time < lines[0].startTime) return -1
  if (time >= (lines[lines.length - 1].endTime ?? lines[lines.length - 1].startTime + 10)) {
    return lines.length - 1
  }

  let low = 0
  let high = lines.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const line = lines[mid]
    const lineStart = line.startTime
    const lineEnd = line.endTime ?? lines[mid + 1]?.startTime ?? lineStart + 10

    if (time >= lineStart && time < lineEnd) {
      return mid
    }

    if (time < lineStart) {
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  // Fallback: time is between two lines.
  // If the gap to the next line is > 2s, treat as instrumental — return -1.
  // Otherwise return the closest preceding line.
  const prevIndex = Math.min(low - 1, lines.length - 1)
  if (prevIndex >= 0 && prevIndex < lines.length - 1) {
    const prevLine = lines[prevIndex]
    const nextLine = lines[prevIndex + 1]
    const prevEnd = prevLine.endTime ?? prevLine.startTime + 4
    const gap = nextLine.startTime - prevEnd
    if (gap > 2) return -1
  }

  return Math.max(0, prevIndex)
}

/**
 * Linear search for small arrays (faster due to cache locality).
 * Returns -1 for instrumental gaps (>2s between lines).
 */
function linearSearchLineIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1
  if (time < lines[0].startTime) return -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = line.startTime
    const lineEnd = line.endTime ?? lines[i + 1]?.startTime ?? lineStart + 10

    if (time >= lineStart && time < lineEnd) {
      return i
    }

    // Time is past this line — check if we're in a gap before the next one
    if (i < lines.length - 1 && time >= lineEnd && time < lines[i + 1].startTime) {
      const gap = lines[i + 1].startTime - lineEnd
      return gap > 2 ? -1 : i
    }
  }

  // After all lines
  if (time >= lines[lines.length - 1].startTime) {
    return lines.length - 1
  }

  return -1
}

/**
 * Choose optimal search algorithm based on array size.
 */
function findLineIndex(lines: LyricLine[], time: number): number {
  if (lines.length < PERFORMANCE_CONFIG.BINARY_SEARCH_THRESHOLD) {
    return linearSearchLineIndex(lines, time)
  }
  return binarySearchLineIndex(lines, time)
}

// ============================================================================
// WORD TRACKING UTILITIES
// ============================================================================

/**
 * Find the current word index within a line.
 */
function findWordIndex(line: LyricLine, timeMs: number): number {
  if (!line.words || line.words.length === 0) return -1

  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i]
    if (timeMs >= word.startTimeMs && timeMs < word.endTimeMs) {
      return i
    }
  }

  // If after all words, return last word
  const lastWord = line.words[line.words.length - 1]
  if (timeMs >= lastWord.endTimeMs) {
    return line.words.length - 1
  }

  return -1
}

/**
 * Calculate progress through the current word (0-1).
 */
function calculateWordProgress(line: LyricLine, wordIndex: number, timeMs: number): number {
  if (!line.words || wordIndex < 0 || wordIndex >= line.words.length) {
    return 0
  }

  const word = line.words[wordIndex]
  const duration = word.endTimeMs - word.startTimeMs

  if (duration <= 0) return 1

  const elapsed = timeMs - word.startTimeMs
  return Math.max(0, Math.min(1, elapsed / duration))
}

/**
 * Calculate progress through the current line (0-1).
 */
function calculateLineProgress(line: LyricLine, time: number): number {
  const lineStart = line.startTime
  const lineEnd = line.endTime ?? lineStart + 5

  const duration = lineEnd - lineStart
  if (duration <= 0) return 1

  const elapsed = time - lineStart
  return Math.max(0, Math.min(1, elapsed / duration))
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * High-performance lyrics synchronization hook.
 *
 * @example
 * ```tsx
 * const {
 *   currentLineIndex,
 *   currentWordIndex,
 *   wordProgress,
 *   currentLine,
 *   nextLine,
 * } = useLyricsSync({
 *   lines,
 *   currentTime: playbackTime,
 *   offset: lyricsOffset,
 *   displayMode: 'karaoke',
 * })
 * ```
 */
export function useLyricsSync({
  lines,
  currentTime,
  offset,
  displayMode,
  enableWordTracking = true,
}: UseLyricsSyncOptions): UseLyricsSyncReturn {
  // Direct computation — memo overhead exceeds cost of simple addition at 60fps
  const adjustedTime = currentTime + offset

  // Consolidated word tracking state with Strict Mode idempotency guards.
  // All mutable state lives in one ref to prevent scattered mutations.
  // Guards ensure double-invocation in Strict Mode produces identical results
  // by short-circuiting to cached output when inputs haven't changed.
  const wordTrackingRef = useRef({
    lineIndex: -1,
    wordIndex: -1,
    changeTime: 0,
    smoothedProgress: 0,
    // Idempotency guards (same inputs → same output, no double-mutation)
    wordGuardTime: -Infinity,
    wordGuardLine: -1,
    progressGuardTime: -Infinity,
    progressGuardWord: -1,
    cachedWordIndex: -1,
    cachedProgress: 0,
    // Seek detection: -1 = not yet initialized (skip first-frame detection)
    prevAdjustedTime: -1,
  })

  // Find current line index using optimal algorithm
  const currentLineIndex = useMemo(() => {
    if (lines.length === 0) return -1
    return findLineIndex(lines, adjustedTime)
  }, [lines, adjustedTime])

  // Get current and next line objects
  const currentLine = useMemo(
    () => (currentLineIndex >= 0 ? lines[currentLineIndex] : null),
    [lines, currentLineIndex]
  )

  const nextLine = useMemo(
    () => (currentLineIndex >= 0 && currentLineIndex < lines.length - 1
      ? lines[currentLineIndex + 1]
      : null),
    [lines, currentLineIndex]
  )

  // Word-level tracking (only for karaoke/word modes)
  const shouldTrackWords = enableWordTracking &&
    (displayMode === 'karaoke' || displayMode === 'word') &&
    currentLine?.words &&
    currentLine.words.length > 0

  // Calculate word index with hysteresis (prevents micro-jumps).
  // Word index only moves FORWARD (except on line change or after seek) to protect against Whisper jitter.
  // Uses idempotency guards so React Strict Mode double-invocation produces identical results.
  const currentWordIndex = useMemo(() => {
    if (!shouldTrackWords || !currentLine) return -1

    const t = wordTrackingRef.current

    // Strict Mode idempotency: same inputs → return cached result, no double-mutation
    if (t.wordGuardTime === adjustedTime && t.wordGuardLine === currentLineIndex) {
      return t.cachedWordIndex
    }
    t.wordGuardTime = adjustedTime
    t.wordGuardLine = currentLineIndex

    // Seek detection: large time jump (>1s) means user seeked — bypass forward-only this frame.
    // prevAdjustedTime === -1 on first render → no seek detection on initial load.
    const seekFrame = t.prevAdjustedTime >= 0 && Math.abs(adjustedTime - t.prevAdjustedTime) > 1
    t.prevAdjustedTime = adjustedTime

    // Line change → reset word tracking
    if (currentLineIndex !== t.lineIndex) {
      t.lineIndex = currentLineIndex
      t.wordIndex = -1
      t.changeTime = 0
      t.smoothedProgress = 0
    }

    // Adaptive hysteresis: proportional to average word duration.
    // Fast songs (120+ BPM) get a shorter window, slow songs get longer.
    const hysteresisMs = (() => {
      if (!currentLine.words || currentLine.words.length < 2) return WORD_CHANGE_DELAY_MS
      const totalMs = currentLine.words.reduce((s, w) => s + w.endTimeMs - w.startTimeMs, 0)
      return Math.min(0.15 * (totalMs / currentLine.words.length), 150)
    })()

    const timeMs = adjustedTime * 1000
    const rawIndex = findWordIndex(currentLine, timeMs)
    const now = Date.now()

    let result: number

    if (t.wordIndex === -1) {
      if (seekFrame) {
        // Seek to a new line: jump directly to the correct word (skip word-0 assumption)
        t.wordIndex = Math.max(0, rawIndex)
      } else {
        // New line (normal play): start at word 0 — protects against bad Whisper timestamps
        t.wordIndex = 0
      }
      t.changeTime = 0
      t.smoothedProgress = 0
      result = t.wordIndex
    } else if (rawIndex === t.wordIndex) {
      // Same word — reset hysteresis timer
      t.changeTime = 0
      result = rawIndex
    } else if (rawIndex < t.wordIndex) {
      // Backward movement — ignore (forward-only protects against Whisper jitter)
      t.changeTime = 0
      result = t.wordIndex
    } else {
      // Forward movement
      if (seekFrame) {
        // Seek within the same line: jump directly to the correct word
        t.wordIndex = rawIndex
        t.changeTime = 0
        t.smoothedProgress = 0
        result = rawIndex
      } else if (rawIndex > t.wordIndex + 1) {
        // Multi-word jump: allow if we're clearly past the current word's end time.
        // This fixes stutter on fast songs where the +1 cap causes cumulative lag.
        const curWord = currentLine.words![t.wordIndex]
        if (curWord && timeMs > curWord.endTimeMs) {
          t.wordIndex = rawIndex
          t.changeTime = 0
          t.smoothedProgress = 0
          result = rawIndex
        } else {
          // Not past current word yet: cap at +1
          t.wordIndex = t.wordIndex + 1
          t.changeTime = 0
          t.smoothedProgress = 0
          result = t.wordIndex
        }
      } else {
        // Single advance — apply adaptive hysteresis
        if (t.changeTime === 0) {
          t.changeTime = now
        }

        if (now - t.changeTime >= hysteresisMs) {
          t.wordIndex = rawIndex
          t.changeTime = 0
          t.smoothedProgress = 0
          result = rawIndex
        } else {
          result = t.wordIndex
        }
      }
    }

    t.cachedWordIndex = result
    return result
  }, [shouldTrackWords, currentLine, currentLineIndex, adjustedTime])

  // Calculate word progress with EMA smoothing
  const wordProgress = useMemo(() => {
    if (!shouldTrackWords || !currentLine || currentWordIndex < 0) return 0

    const t = wordTrackingRef.current

    // Strict Mode idempotency guard
    if (t.progressGuardTime === adjustedTime && t.progressGuardWord === currentWordIndex) {
      return t.cachedProgress
    }
    t.progressGuardTime = adjustedTime
    t.progressGuardWord = currentWordIndex

    const timeMs = adjustedTime * 1000
    const rawProgress = calculateWordProgress(currentLine, currentWordIndex, timeMs)

    // EMA smoothing: smoothed = α * raw + (1-α) * prev
    const smoothed = PROGRESS_SMOOTHING * rawProgress +
      (1 - PROGRESS_SMOOTHING) * t.smoothedProgress

    t.smoothedProgress = smoothed
    t.cachedProgress = smoothed

    return smoothed
  }, [shouldTrackWords, currentLine, currentWordIndex, adjustedTime])

  // Line progress
  const lineProgress = useMemo(() => {
    if (!currentLine) return 0
    return calculateLineProgress(currentLine, adjustedTime)
  }, [currentLine, adjustedTime])

  // Utility: find line at any time
  const findLineAtTime = useCallback(
    (time: number) => findLineIndex(lines, time),
    [lines]
  )

  // Utility: check if line is in render window
  const isLineVisible = useCallback(
    (index: number) => {
      const distance = Math.abs(index - currentLineIndex)
      return distance <= PERFORMANCE_CONFIG.RENDER_WINDOW
    },
    [currentLineIndex]
  )

  // Boundary checks
  const isBeforeStart = useMemo(
    () => lines.length > 0 && adjustedTime < lines[0].startTime,
    [lines, adjustedTime]
  )

  const isAfterEnd = useMemo(
    () => lines.length > 0 && currentLineIndex === lines.length - 1 &&
      adjustedTime >= (lines[lines.length - 1].endTime ?? lines[lines.length - 1].startTime + 10),
    [lines, currentLineIndex, adjustedTime]
  )

  return {
    currentLineIndex,
    currentWordIndex,
    wordProgress,
    lineProgress,
    currentLine,
    nextLine,
    isBeforeStart,
    isAfterEnd,
    adjustedTime,
    findLineAtTime,
    isLineVisible,
  }
}

export default useLyricsSync
