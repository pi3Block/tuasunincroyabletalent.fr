/**
 * @fileoverview Professional-grade lyrics display component.
 *
 * This is the main orchestrating component that brings together:
 * - useLyricsSync: High-performance sync with binary search
 * - useLyricsScroll: Smart auto-scroll with user detection
 * - LyricLine: Individual line with animations
 * - LyricsControls: Offset and sync controls
 *
 * Features:
 * - Line-level and word-level synchronization
 * - Progressive karaoke highlight (Apple Music style)
 * - Blur depth effect for 3D perception
 * - Glow effect on active line
 * - Tap-to-sync: tap any line to set offset
 * - Smart auto-scroll with user override detection
 * - Virtualization for performance (renders only nearby lines)
 * - Full accessibility (ARIA, keyboard navigation)
 * - Responsive design (mobile-first)
 *
 * Architecture: Container component following composition pattern.
 */

import React, { memo, useCallback, useMemo, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

import type { LyricLine as LyricLineType, LyricWord } from '@/types/lyrics'
import { OFFSET_CONFIG } from '@/types/lyrics'
import type { WordLine } from '@/api/client'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useOrientation } from '@/hooks/useOrientation'

// Local props type to avoid type conflicts with SyncedLyricLine
interface LyricsDisplayProProps {
  /** Plain text lyrics (fallback) */
  lyrics: string
  /** Synced lyrics with timestamps */
  syncedLines?: SyncedLyricLine[] | null
  /** Word-level timestamps for karaoke mode */
  wordLines?: WordLine[] | null
  /** Current playback time in seconds */
  currentTime?: number
  /** Whether audio is playing */
  isPlaying?: boolean
  /** Display mode */
  displayMode?: 'line' | 'word' | 'karaoke' | 'compact' | 'teleprompter'
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
  /** Show debug timeline UI */
  showDebug?: boolean
  /** Custom class name */
  className?: string
  /** Override ScrollArea class name (e.g. "h-full" for landscape) */
  scrollAreaClassName?: string
}
import { useLyricsSync } from '@/hooks/useLyricsSync'
import { useLyricsScroll } from '@/hooks/useLyricsScroll'
import { LyricLine } from './LyricLine'
import { LyricsControls } from './LyricsControls'
import { TimelineDebug } from './TimelineDebug'
import type { SyncedLyricLine } from '@/api/client'

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Flatten all words from wordLines into a single array for matching.
 */
function flattenWords(wordLines: WordLine[]): Array<{
  word: string
  startMs: number
  endMs: number
  confidence?: number
}> {
  const allWords: Array<{
    word: string
    startMs: number
    endMs: number
    confidence?: number
  }> = []

  for (const line of wordLines) {
    for (const w of line.words) {
      allWords.push({
        word: w.word,
        startMs: w.startMs,
        endMs: w.endMs,
        confidence: w.confidence,
      })
    }
  }

  return allWords
}

/**
 * Assign word timestamps to synced lines.
 * Uses the ORIGINAL lyrics text but assigns Whisper timestamps to each word.
 * This ensures we display the correct lyrics while having word-level timing.
 */
function mergeWordTimestampsWithSyncedLines(
  syncedLines: SyncedLyricLine[],
  wordLines: WordLine[]
): LyricLineType[] {
  // Flatten all words from wordLines (Whisper transcription)
  const whisperWords = flattenWords(wordLines)
  if (whisperWords.length === 0) {
    // No words, fall back to synced lines without word data
    return syncedLines.map((line, index) => ({
      id: `line-${index}`,
      text: line.text,
      startTime: line.startTimeMs / 1000,
      endTime: line.endTimeMs ? line.endTimeMs / 1000 : undefined,
      words: undefined,
    }))
  }

  let whisperIndex = 0
  const result: LyricLineType[] = []

  for (let lineIndex = 0; lineIndex < syncedLines.length; lineIndex++) {
    const line = syncedLines[lineIndex]
    const lineStartMs = line.startTimeMs
    const nextLine = syncedLines[lineIndex + 1]
    const lineEndMs = nextLine ? nextLine.startTimeMs : lineStartMs + 10000

    // Split original lyrics line into words
    const originalWords = line.text.split(/\s+/).filter(w => w.length > 0)
    const lineWords: LyricWord[] = []

    // Collect Whisper words that fall within this line's time window
    const whisperWordsInLine: typeof whisperWords = []

    while (whisperIndex < whisperWords.length) {
      const w = whisperWords[whisperIndex]
      const wordMidpoint = (w.startMs + w.endMs) / 2

      if (wordMidpoint >= lineStartMs && wordMidpoint < lineEndMs) {
        whisperWordsInLine.push(w)
        whisperIndex++
      } else if (wordMidpoint < lineStartMs) {
        whisperIndex++
      } else {
        break
      }
    }

    // If no Whisper words found for this line, try to distribute timing evenly
    if (whisperWordsInLine.length === 0 && originalWords.length > 0) {
      const duration = lineEndMs - lineStartMs
      const wordDuration = duration / originalWords.length

      for (let i = 0; i < originalWords.length; i++) {
        lineWords.push({
          text: originalWords[i],
          startTimeMs: Math.round(lineStartMs + i * wordDuration),
          endTimeMs: Math.round(lineStartMs + (i + 1) * wordDuration),
          confidence: 0.5, // Low confidence for estimated timing
        })
      }
    } else {
      // Match original words with Whisper timestamps
      // Strategy: assign timestamps proportionally based on word position
      for (let i = 0; i < originalWords.length; i++) {
        const originalWord = originalWords[i]

        // Find best matching Whisper word by position ratio
        const positionRatio = originalWords.length > 1 ? i / (originalWords.length - 1) : 0
        const whisperIdx = Math.min(
          Math.round(positionRatio * (whisperWordsInLine.length - 1)),
          whisperWordsInLine.length - 1
        )

        if (whisperIdx >= 0 && whisperWordsInLine[whisperIdx]) {
          const whisperWord = whisperWordsInLine[whisperIdx]

          // Calculate timing: interpolate between adjacent Whisper words for smoother timing
          let startMs: number
          let endMs: number

          if (whisperWordsInLine.length === 1) {
            // Only one Whisper word, distribute evenly
            const totalDuration = whisperWord.endMs - whisperWord.startMs
            const wordDuration = totalDuration / originalWords.length
            startMs = whisperWord.startMs + i * wordDuration
            endMs = startMs + wordDuration
          } else {
            // Interpolate timing based on position
            const firstWord = whisperWordsInLine[0]
            const lastWord = whisperWordsInLine[whisperWordsInLine.length - 1]
            const totalDuration = lastWord.endMs - firstWord.startMs
            const wordDuration = totalDuration / originalWords.length

            startMs = firstWord.startMs + i * wordDuration
            endMs = startMs + wordDuration
          }

          lineWords.push({
            text: originalWord, // Use ORIGINAL text, not Whisper transcription
            startTimeMs: Math.round(startMs),
            endTimeMs: Math.round(endMs),
            confidence: whisperWord.confidence,
          })
        } else {
          // Fallback: estimate timing from line boundaries
          const duration = lineEndMs - lineStartMs
          const wordDuration = duration / originalWords.length

          lineWords.push({
            text: originalWord,
            startTimeMs: Math.round(lineStartMs + i * wordDuration),
            endTimeMs: Math.round(lineStartMs + (i + 1) * wordDuration),
            confidence: 0.3,
          })
        }
      }
    }

    result.push({
      id: `line-${lineIndex}`,
      text: line.text, // Keep original line text
      startTime: lineStartMs / 1000,
      endTime: line.endTimeMs ? line.endTimeMs / 1000 : undefined,
      words: lineWords.length > 0 ? lineWords : undefined,
    })
  }

  return result
}

/**
 * Parse raw lyrics into structured LyricLine array.
 * Handles synced lines, word-level lines, and plain text lyrics.
 *
 * When both syncedLines and wordLines are available, merges them:
 * - Uses syncedLines for line structure (proper phrase grouping)
 * - Uses wordLines for word-level timestamps (karaoke highlighting)
 */
function parseLyrics(
  lyrics: string,
  syncedLines?: SyncedLyricLine[] | null,
  wordLines?: WordLine[] | null
): LyricLineType[] {
  // Priority 1: Merge word timestamps with synced lines (best quality)
  // This uses the original line structure but adds word-level timing
  if (syncedLines && syncedLines.length > 0 && wordLines && wordLines.length > 0) {
    return mergeWordTimestampsWithSyncedLines(syncedLines, wordLines)
  }

  // Priority 2: Use word-level lines directly (Whisper-only segmentation)
  // Note: Whisper's segments may not match natural phrase boundaries
  if (wordLines && wordLines.length > 0) {
    return wordLines.map((line, index) => ({
      id: `line-${index}`,
      text: line.text,
      startTime: line.startMs / 1000,
      endTime: line.endMs / 1000,
      words: line.words.map((word): LyricWord => ({
        text: word.word,
        startTimeMs: word.startMs,
        endTimeMs: word.endMs,
        confidence: word.confidence,
      })),
    }))
  }

  // Priority 3: Use line-synced lines (no word-level timing)
  if (syncedLines && syncedLines.length > 0) {
    return syncedLines.map((line, index) => ({
      id: `line-${index}`,
      text: line.text,
      startTime: line.startTimeMs / 1000,
      endTime: line.endTimeMs ? line.endTimeMs / 1000 : undefined,
      words: undefined,
    }))
  }

  // Fallback: Plain text parsing — no timestamps available.
  // startTime: Infinity ensures binarySearchLineIndex always returns -1,
  // so no line is highlighted as "active" (static display, no sync).
  if (!lyrics) return []

  return lyrics
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text, index) => ({
      id: `line-${index}`,
      text,
      startTime: Infinity,
      endTime: undefined,
      words: undefined,
    }))
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Professional lyrics display with all features.
 *
 * @example
 * ```tsx
 * <LyricsDisplayPro
 *   lyrics={plainTextLyrics}
 *   syncedLines={syncedLyricLines}
 *   currentTime={playbackTime}
 *   isPlaying={isPlaying}
 *   displayMode="karaoke"
 *   offset={offset}
 *   onOffsetChange={setOffset}
 *   onAutoSync={handleAutoSync}
 * />
 * ```
 */
export const LyricsDisplayPro = memo(function LyricsDisplayPro({
  lyrics,
  syncedLines,
  wordLines,
  currentTime = 0,
  isPlaying = false,
  displayMode = 'line',
  offset = 0,
  onOffsetChange,
  showOffsetControls = true,
  onLineChange,
  onLineTap,
  showDebug = false,
  className,
  scrollAreaClassName,
}: LyricsDisplayProProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const { useLandscapeMobileLayout, width } = useOrientation()

  // Parse lyrics into structured format (wordLines take priority for karaoke mode)
  const lines = useMemo(
    () => parseLyrics(lyrics, syncedLines, wordLines),
    [lyrics, syncedLines, wordLines]
  )

  // Check if we have word-level data (for automatic mode switching)
  // Use lines.some() to handle cases where the first line has no words
  // (e.g. instrumental intro) but subsequent lines do
  const hasWordData = useMemo(
    () => lines.some(line => line.words && line.words.length > 0),
    [lines]
  )

  // Effective display mode: teleprompter overrides auto-switch,
  // otherwise auto-switch to karaoke when word data is available
  const effectiveDisplayMode = displayMode === 'teleprompter'
    ? 'teleprompter'
    : hasWordData && displayMode === 'line' ? 'karaoke' : displayMode

  // Determine if we have timestamps (Infinity = plain text fallback, no sync)
  const hasSyncedTimestamps = useMemo(
    () => lines.length > 0 && lines[0].startTime > 0 && isFinite(lines[0].startTime),
    [lines]
  )

  // Use sync hook for line/word tracking
  const {
    currentLineIndex,
    currentWordIndex,
    wordProgress,
    isLineVisible,
    adjustedTime,
  } = useLyricsSync({
    lines,
    currentTime,
    offset,
    displayMode: effectiveDisplayMode,
    enableWordTracking: effectiveDisplayMode === 'karaoke' || effectiveDisplayMode === 'word',
  })

  // Responsive scroll position:
  // - Mobile landscape: 40% (half screen, center more)
  // - Desktop (>=1024px): 35% (more space, comfortable reading)
  // - Teleprompter: 45% (near center, pro feel)
  // - Default (mobile portrait): 30%
  const scrollPosition = useMemo(() => {
    if (effectiveDisplayMode === 'teleprompter') return 0.45
    if (useLandscapeMobileLayout) return 0.40
    if (width >= 1024) return 0.35
    return 0.30
  }, [effectiveDisplayMode, useLandscapeMobileLayout, width])

  // Use scroll hook for smart auto-scrolling
  // Scrolls current line to 'start' position - CSS padding handles vertical offset
  const { currentLineRef, scrollTargetRef, scrollTargetIndex, enableAutoScroll, autoScrollEnabled } = useLyricsScroll({
    currentLineIndex,
    totalLines: lines.length,
    isPlaying,
    containerRef: containerRef as React.RefObject<HTMLElement | null>,
    block: 'start',
    scrollPosition,
    reducedMotion,
  })

  // Pre-roll: time remaining until the next line activates (null if no next line)
  const timeToNextLine = useMemo(() => {
    if (currentLineIndex < 0 || currentLineIndex >= lines.length - 1) return null
    const nextStart = lines[currentLineIndex + 1]?.startTime
    if (nextStart === undefined) return null
    return nextStart - adjustedTime
  }, [lines, currentLineIndex, adjustedTime])

  // Pre-roll flag: next line is <2s away — triggers anticipatory glow
  const isPreRoll = timeToNextLine !== null && timeToNextLine > 0 && timeToNextLine < 2

  // Interlude detection: gap >5s between current line end and next line start.
  // Uses endTime if available, otherwise assumes line lasts up to 4s.
  // When true, interlude dots are shown between current and next lines.
  const isInInterlude = useMemo(() => {
    if (currentLineIndex < 0 || currentLineIndex >= lines.length - 1) return false
    const currentLine = lines[currentLineIndex]
    const nextLine = lines[currentLineIndex + 1]
    if (!currentLine || !nextLine) return false
    // Estimate line end: use stored endTime, or cap at 4s after start (won't exceed next start)
    const lineEnd = currentLine.endTime ?? Math.min(
      currentLine.startTime + 4,
      nextLine.startTime - 0.1
    )
    const gap = nextLine.startTime - lineEnd
    return gap > 5 && adjustedTime > lineEnd
  }, [lines, currentLineIndex, adjustedTime])

  // Notify parent of line changes
  React.useEffect(() => {
    if (currentLineIndex >= 0) {
      onLineChange?.(currentLineIndex)
    }
  }, [currentLineIndex, onLineChange])

  // Handle tap-to-sync: clicking a line sets offset to align that line with current time
  // When user taps a line, they're saying "THIS line should be playing NOW"
  // So we need: adjustedTime = line.startTime when currentTime = now
  // Since adjustedTime = currentTime + offset, we need offset = line.startTime - currentTime
  const handleLineTap = useCallback(
    (index: number) => {
      const line = lines[index]
      if (!line || !onOffsetChange) return

      // Calculate offset to align this line with current playback time
      const newOffset = line.startTime - currentTime
      const clampedOffset = Math.max(
        OFFSET_CONFIG.MIN,
        Math.min(OFFSET_CONFIG.MAX, newOffset)
      )

      onOffsetChange(clampedOffset)
      enableAutoScroll()

      // Notify parent
      onLineTap?.(index, line.startTime)
    },
    [lines, currentTime, onOffsetChange, onLineTap, enableAutoScroll]
  )

  // Handle manual sync (first line to current time)
  // When user presses Sync, they're saying "the lyrics START NOW in the video"
  // So we need: adjustedTime = firstLine.startTime when currentTime = now
  // Since adjustedTime = currentTime + offset, we need offset = firstLine.startTime - currentTime
  const handleManualSync = useCallback(() => {
    if (lines.length === 0 || !onOffsetChange) return

    const firstLine = lines[0]
    const newOffset = firstLine.startTime - currentTime
    const clampedOffset = Math.max(
      OFFSET_CONFIG.MIN,
      Math.min(OFFSET_CONFIG.MAX, newOffset)
    )

    onOffsetChange(clampedOffset)
    enableAutoScroll()
  }, [lines, currentTime, onOffsetChange, enableAutoScroll])

  // Navigate to specific line
  const goToLine = useCallback(
    (index: number) => {
      if (index >= 0 && index < lines.length) {
        handleLineTap(index)
      }
    },
    [lines.length, handleLineTap]
  )

  // Progress percentage
  const progressPercent = useMemo(
    () => ((currentLineIndex + 1) / Math.max(1, lines.length)) * 100,
    [currentLineIndex, lines.length]
  )

  // Empty state
  if (lines.length === 0) {
    return (
      <Card className={cn('bg-card/50 border-border/30', className)}>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground text-lg">Paroles non disponibles</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={cn(
        'overflow-hidden bg-card/80 backdrop-blur border-border/50 shadow-xl',
        className
      )}
    >
      {/* Debug Timeline UI */}
      {showDebug && (
        <TimelineDebug
          currentTime={currentTime}
          offset={offset}
          firstLineStartTime={isFinite(lines[0]?.startTime ?? 0) ? (lines[0]?.startTime ?? 0) : 0}
          currentLineStartTime={lines[currentLineIndex]?.startTime ?? 0}
          currentLineIndex={currentLineIndex}
          totalLines={lines.length}
          isPlaying={isPlaying}
          className="m-4"
        />
      )}

      {/* Header - Controls */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50 bg-muted/20">
        {/* Offset controls */}
        {showOffsetControls && onOffsetChange && (
          <LyricsControls
            offset={offset}
            onOffsetChange={onOffsetChange}
            onManualSync={handleManualSync}
            hasSyncedTimestamps={hasSyncedTimestamps}
            defaultExpanded={typeof window !== 'undefined' && window.innerWidth >= 1024}
          />
        )}

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            disabled={currentLineIndex <= 0}
            onClick={() => goToLine(currentLineIndex - 1)}
            aria-label="Previous line"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <span className="text-sm text-muted-foreground font-medium min-w-18 text-center tabular-nums">
            {currentLineIndex + 1} / {lines.length}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            disabled={currentLineIndex >= lines.length - 1}
            onClick={() => goToLine(currentLineIndex + 1)}
            aria-label="Next line"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Lyrics - Main content */}
      <ScrollArea
        className={scrollAreaClassName || "h-[300px] md:h-[400px] lg:h-[500px] xl:h-[600px] 2xl:h-[700px]"}
        ref={containerRef as React.RefObject<HTMLDivElement | null>}
      >
        <div
          className="px-6 py-8 md:px-10 md:py-10 space-y-6 md:space-y-8"
          role="region"
          aria-label="Synchronized lyrics"
          aria-live="polite"
        >
          {/* Top padding - provides scroll space before first line */}
          <div className="h-[30%] min-h-[80px]" aria-hidden="true" />

          {lines.map((line, index) => {
            const isActive = index === currentLineIndex
            const isPast = index < currentLineIndex
            const distance = Math.abs(index - currentLineIndex)
            const isScrollTarget = index === scrollTargetIndex
            // Pre-roll applies only to the immediate next line
            const lineIsPreRoll = isPreRoll && index === currentLineIndex + 1

            // Virtualization: only render nearby lines
            if (!isLineVisible(index)) {
              return <div key={line.id} className="h-16" aria-hidden="true" />
            }

            // Determine which ref to attach:
            // - scrollTargetRef on the line 3 ahead (for scroll positioning)
            // - currentLineRef on the active line (for reference)
            const lineRef = isScrollTarget
              ? scrollTargetRef
              : isActive
                ? currentLineRef
                : undefined

            return (
              <React.Fragment key={line.id}>
                <LyricLine
                  ref={lineRef}
                  line={line}
                  index={index}
                  isActive={isActive}
                  isPast={isPast}
                  distance={distance}
                  displayMode={effectiveDisplayMode}
                  currentWordIndex={currentWordIndex}
                  wordProgress={wordProgress}
                  isPreRoll={lineIsPreRoll}
                  reducedMotion={reducedMotion}
                  onClick={() => handleLineTap(index)}
                />
                {/* Interlude dots: shown after the active line during gaps >5s */}
                {isActive && isInInterlude && (
                  <div
                    className="flex justify-center items-center gap-3 py-8"
                    aria-label="Interlude"
                    aria-hidden="true"
                  >
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="block w-2 h-2 rounded-full bg-muted-foreground/40 animate-pulse"
                        style={{ animationDelay: `${i * 0.25}s` }}
                      />
                    ))}
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {/* Bottom padding - allows last lines to scroll up to 30% position */}
          <div className="h-[70%] min-h-[200px]" aria-hidden="true" />
        </div>
      </ScrollArea>

      {/* Auto-scroll indicator — shown when user has manually scrolled and disabled auto-scroll */}
      {!autoScrollEnabled && (
        <div className="flex justify-end px-4 py-1.5 border-t border-border/20 bg-muted/5">
          <button
            onClick={enableAutoScroll}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs',
              'text-muted-foreground hover:text-foreground transition-colors',
              'bg-muted/60 hover:bg-muted border border-border/50',
            )}
            aria-label="Réactiver le défilement automatique"
          >
            <span aria-hidden="true">↺</span>
            <span>Reprendre le défilement</span>
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div className="px-4 py-3 border-t border-border/30 bg-muted/10">
        <Progress
          value={progressPercent}
          className="h-2"
          aria-label={`Progress: ${Math.round(progressPercent)}%`}
        />
      </div>
    </Card>
  )
})

// ============================================================================
// COMPACT DISPLAY
// ============================================================================

interface LyricsDisplayCompactProps {
  /** Plain text lyrics */
  lyrics: string
  /** Synced lines */
  syncedLines?: SyncedLyricLine[] | null
  /** Current line index */
  currentLineIndex?: number
  /** Custom class name */
  className?: string
}

/**
 * Compact single-line + next line display.
 * Useful for overlay or minimal UI.
 */
export const LyricsDisplayCompact = memo(function LyricsDisplayCompact({
  lyrics,
  syncedLines,
  currentLineIndex = 0,
  className,
}: LyricsDisplayCompactProps) {
  const lines = useMemo(
    () => parseLyrics(lyrics, syncedLines),
    [lyrics, syncedLines]
  )

  if (lines.length === 0) return null

  const currentLine = lines[currentLineIndex]?.text || ''
  const nextLine = lines[currentLineIndex + 1]?.text || ''

  return (
    <div className={cn('text-center space-y-2', className)}>
      <p className="text-2xl md:text-3xl font-bold text-foreground truncate px-4">
        {currentLine}
      </p>
      {nextLine && (
        <p className="text-lg md:text-xl text-muted-foreground truncate px-4">
          {nextLine}
        </p>
      )}
    </div>
  )
})

// ============================================================================
// FULLSCREEN MODE
// ============================================================================

interface LyricsDisplayFullscreenProps {
  /** Plain text lyrics */
  lyrics: string
  /** Synced lines */
  syncedLines?: SyncedLyricLine[] | null
  /** Current playback time */
  currentTime: number
  /** Whether playing */
  isPlaying: boolean
  /** Display mode */
  displayMode?: 'line' | 'word' | 'karaoke' | 'compact' | 'teleprompter'
  /** Offset */
  offset?: number
  /** Offset change handler */
  onOffsetChange?: (offset: number) => void
  /** Close fullscreen callback */
  onClose?: () => void
  /** Custom class name */
  className?: string
}

/**
 * Fullscreen karaoke display mode.
 * Maximizes lyrics for immersive experience.
 */
export const LyricsDisplayFullscreen = memo(function LyricsDisplayFullscreen({
  onClose,
  className,
  lyrics,
  syncedLines,
  currentTime,
  isPlaying,
  displayMode,
  offset,
  onOffsetChange,
}: LyricsDisplayFullscreenProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-background/95 backdrop-blur-xl',
        'flex flex-col items-center justify-center',
        className
      )}
    >
      {/* Close button */}
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4"
          onClick={onClose}
          aria-label="Close fullscreen"
        >
          <ChevronLeft className="h-6 w-6 rotate-180" />
        </Button>
      )}

      {/* Lyrics display (larger) */}
      <div className="w-full max-w-4xl px-4">
        <LyricsDisplayPro
          lyrics={lyrics}
          syncedLines={syncedLines}
          currentTime={currentTime}
          isPlaying={isPlaying}
          displayMode={displayMode}
          offset={offset}
          onOffsetChange={onOffsetChange}
          className="border-0 bg-transparent shadow-none"
        />
      </div>
    </div>
  )
})

// ============================================================================
// EXPORTS
// ============================================================================

export default LyricsDisplayPro
