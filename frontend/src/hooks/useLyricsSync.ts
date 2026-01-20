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

import { useMemo, useCallback, useRef, useEffect } from 'react'
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
 * @returns Index of the line containing the time, or -1 if before first line
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

  // Fallback: return closest line
  return Math.min(low, lines.length - 1)
}

/**
 * Linear search for small arrays (faster due to cache locality).
 */
function linearSearchLineIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = line.startTime
    const lineEnd = line.endTime ?? lines[i + 1]?.startTime ?? lineStart + 10

    if (time >= lineStart && time < lineEnd) {
      return i
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
  // Cache previous line index for stability
  const prevLineIndexRef = useRef<number>(-1)

  // Smoothing refs for word tracking
  const prevWordIndexRef = useRef<number>(-1)
  const wordIndexChangeTimeRef = useRef<number>(0)
  const smoothedProgressRef = useRef<number>(0)
  const lastLineIndexRef = useRef<number>(-1)

  // Calculate adjusted time (with offset)
  const adjustedTime = useMemo(
    () => currentTime + offset,
    [currentTime, offset]
  )

  // Find current line index using optimal algorithm
  const currentLineIndex = useMemo(() => {
    if (lines.length === 0) return -1

    const index = findLineIndex(lines, adjustedTime)

    // Update ref for stability
    if (index !== -1) {
      prevLineIndexRef.current = index
    }

    return index
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

  // Calculate word index with hysteresis (prevents micro-jumps)
  // IMPORTANT: Word index can only move FORWARD, never backward (except on line change)
  // This prevents jumps caused by inconsistent Whisper timestamps
  const currentWordIndex = useMemo(() => {
    if (!shouldTrackWords || !currentLine) return -1

    // CRITICAL: Detect line change INSIDE useMemo to avoid timing issues with useEffect
    // useEffect runs AFTER render, so the first render would have stale refs
    if (currentLineIndex !== lastLineIndexRef.current) {
      lastLineIndexRef.current = currentLineIndex
      prevWordIndexRef.current = -1
      wordIndexChangeTimeRef.current = 0
      smoothedProgressRef.current = 0
    }

    const timeMs = adjustedTime * 1000
    const rawIndex = findWordIndex(currentLine, timeMs)
    const now = Date.now()

    // CRITICAL FIX: When starting a new line (prev is -1), ALWAYS start at word 0
    // This prevents Whisper's bad timestamps from jumping to middle of phrase
    if (prevWordIndexRef.current === -1) {
      // New line - start at beginning, only move forward from there
      // If rawIndex > 0, it means Whisper has bad timestamps - ignore and start at 0
      prevWordIndexRef.current = 0
      wordIndexChangeTimeRef.current = 0
      smoothedProgressRef.current = 0
      return 0
    }

    // If same word as before, keep it
    if (rawIndex === prevWordIndexRef.current) {
      wordIndexChangeTimeRef.current = 0
      return rawIndex
    }

    // CRITICAL: Never go backward - only allow forward movement
    // This prevents the "jump to middle then back to start" bug
    if (rawIndex < prevWordIndexRef.current) {
      // Whisper gave us an earlier word - ignore it, stay on current
      wordIndexChangeTimeRef.current = 0
      return prevWordIndexRef.current
    }

    // Only allow moving forward by 1 word at a time (prevents big jumps)
    const nextExpectedWord = prevWordIndexRef.current + 1
    const targetIndex = Math.min(rawIndex, nextExpectedWord)

    // If trying to jump ahead, cap at next word
    if (targetIndex !== rawIndex) {
      // Whisper wants to skip words - only advance by 1
      prevWordIndexRef.current = targetIndex
      wordIndexChangeTimeRef.current = 0
      smoothedProgressRef.current = 0
      return targetIndex
    }

    // If new word detected (moving forward by 1), apply hysteresis
    if (wordIndexChangeTimeRef.current === 0) {
      // First detection of new word, start timer
      wordIndexChangeTimeRef.current = now
    }

    // Only change if new word has been stable for WORD_CHANGE_DELAY_MS
    if (now - wordIndexChangeTimeRef.current >= WORD_CHANGE_DELAY_MS) {
      prevWordIndexRef.current = rawIndex
      wordIndexChangeTimeRef.current = 0
      // Reset progress smoothing when word changes
      smoothedProgressRef.current = 0
      return rawIndex
    }

    // Stay on previous word during hysteresis period
    return prevWordIndexRef.current
  }, [shouldTrackWords, currentLine, currentLineIndex, adjustedTime])

  // Calculate word progress with EMA smoothing
  const wordProgress = useMemo(() => {
    if (!shouldTrackWords || !currentLine || currentWordIndex < 0) return 0

    const timeMs = adjustedTime * 1000
    const rawProgress = calculateWordProgress(currentLine, currentWordIndex, timeMs)

    // Apply EMA smoothing: smoothed = α * raw + (1-α) * prev
    const smoothed = PROGRESS_SMOOTHING * rawProgress +
      (1 - PROGRESS_SMOOTHING) * smoothedProgressRef.current

    // Update ref for next frame
    smoothedProgressRef.current = smoothed

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
