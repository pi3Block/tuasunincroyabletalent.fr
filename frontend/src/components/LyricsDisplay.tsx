/**
 * @fileoverview Lyrics display component - Legacy wrapper.
 *
 * This file maintains backward compatibility with the old API
 * while using the new professional-grade implementation.
 *
 * For new code, prefer importing from '@/components/lyrics':
 * ```tsx
 * import { LyricsDisplayPro } from '@/components/lyrics'
 * ```
 *
 * @deprecated Use LyricsDisplayPro from '@/components/lyrics' instead.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, Target, Wand2, Bug } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SyncedLyricLine } from '@/api/client'
import { TimelineDebug } from './lyrics/TimelineDebug'

// Re-export types for backward compatibility
export interface LyricLine {
  text: string
  startTime?: number
  endTime?: number
}

interface LyricsDisplayProps {
  /** Plain text lyrics (newline separated) */
  lyrics: string
  /** Synced lyrics with timestamps (takes priority over plain text) */
  syncedLines?: SyncedLyricLine[] | null
  /** Current playback time in seconds */
  currentTime?: number
  /** Whether playback is active */
  isPlaying?: boolean
  /** Callback when current line changes */
  onLineChange?: (lineIndex: number) => void
  /** Manual offset in seconds */
  offset?: number
  /** Callback for offset changes */
  onOffsetChange?: (newOffset: number) => void
  /** Show offset adjustment controls */
  showOffsetControls?: boolean
  /** Callback for auto-sync button click */
  onAutoSync?: () => Promise<{ offset: number; confidence: number } | null>
  /** Whether auto-sync is in progress */
  isAutoSyncing?: boolean
  /** Auto-sync confidence (0-1) after calculation */
  autoSyncConfidence?: number | null
}

/**
 * Parse lyrics into LyricLine array.
 * Handles both synced (with timestamps) and plain text lyrics.
 */
function parseLyrics(lyrics: string, syncedLines?: SyncedLyricLine[] | null): LyricLine[] {
  // If synced lines provided, convert to LyricLine format
  if (syncedLines && syncedLines.length > 0) {
    return syncedLines.map((line) => ({
      text: line.text,
      startTime: line.startTimeMs / 1000,
      endTime: line.endTimeMs ? line.endTimeMs / 1000 : undefined,
    }))
  }

  // Fallback to plain text parsing
  if (!lyrics) return []
  return lyrics
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text }))
}

/** Debounce delay for scroll animation (ms) */
const SCROLL_DEBOUNCE_MS = 150

/**
 * Calculate current line index based on timestamps or estimation.
 * Returns the index of the line that should be highlighted.
 */
function calculateCurrentLineIndex(
  lines: LyricLine[],
  adjustedTime: number,
  _currentLineIndex: number
): number {
  if (lines.length === 0) return 0

  // If we have synced lyrics with timestamps
  const hasTimestamps = lines[0]?.startTime !== undefined

  if (hasTimestamps) {
    // Find the line that contains the current time
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineStart = line.startTime ?? 0
      const nextLineStart = lines[i + 1]?.startTime
      const lineEnd = line.endTime ?? nextLineStart ?? lineStart + 10

      if (adjustedTime >= lineStart && adjustedTime < lineEnd) {
        return i
      }
    }
    // If past all lines, return last line
    if (adjustedTime >= (lines[lines.length - 1]?.startTime ?? 0)) {
      return lines.length - 1
    }
    return 0
  }

  // Fallback: estimate ~4 seconds per line
  const estimatedLineTime = 4
  const estimatedIndex = Math.floor(adjustedTime / estimatedLineTime)
  return Math.min(Math.max(0, estimatedIndex), lines.length - 1)
}

/**
 * Main lyrics display component with karaoke-style highlighting.
 * Wrapped with React.memo for performance optimization.
 */
export const LyricsDisplay = React.memo(function LyricsDisplay({
  lyrics,
  syncedLines,
  currentTime = 0,
  isPlaying = false,
  onLineChange,
  offset = 0,
  onOffsetChange,
  showOffsetControls = true,
  onAutoSync,
  isAutoSyncing = false,
  autoSyncConfidence,
}: LyricsDisplayProps) {
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const currentLineRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track the offset that was applied during last sync
  const lastSyncOffsetRef = useRef<number | null>(null)

  // Memoize parsed lyrics
  const lines = useMemo(
    () => parseLyrics(lyrics, syncedLines),
    [lyrics, syncedLines]
  )

  // Memoize adjusted time to prevent unnecessary recalculations
  const adjustedTime = useMemo(
    () => currentTime + offset,
    [currentTime, offset]
  )

  // Auto-advance lyrics based on timestamps or estimation
  useEffect(() => {
    if (!isPlaying || lines.length === 0) return

    // If we just synced, wait for the offset prop to be updated
    if (lastSyncOffsetRef.current !== null) {
      if (Math.abs(offset - lastSyncOffsetRef.current) < 0.01) {
        lastSyncOffsetRef.current = null
      } else {
        return
      }
    }

    const newIndex = calculateCurrentLineIndex(lines, adjustedTime, currentLineIndex)
    if (newIndex !== currentLineIndex) {
      setCurrentLineIndex(newIndex)
      onLineChange?.(newIndex)
    }
  }, [adjustedTime, offset, isPlaying, lines, currentLineIndex, onLineChange])

  // Debounced auto-scroll to current line
  useEffect(() => {
    if (!autoScrollEnabled || !currentLineRef.current) return

    // Clear previous timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Debounce scroll to prevent animation conflicts
    scrollTimeoutRef.current = setTimeout(() => {
      currentLineRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, SCROLL_DEBOUNCE_MS)

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [currentLineIndex, autoScrollEnabled])

  // Re-enable auto-scroll when playback starts
  useEffect(() => {
    if (isPlaying) setAutoScrollEnabled(true)
  }, [isPlaying])

  // Sync button handler - aligns the first line to current playback time
  // When user presses Sync, they're saying "the lyrics START NOW in the video"
  // Since adjustedTime = currentTime + offset, we need:
  // adjustedTime = firstLineStart (so first line shows now)
  // Therefore: offset = firstLineStart - currentTime
  const handleSync = useCallback(() => {
    if (lines.length === 0) return

    // Get the start time of the first line (in seconds)
    const firstLineStart = lines[0]?.startTime ?? 0

    // Calculate offset so that adjustedTime = firstLineStart
    // adjustedTime = currentTime + offset = firstLineStart
    // offset = firstLineStart - currentTime
    const newOffset = firstLineStart - currentTime
    const clampedOffset = Math.max(-300, Math.min(300, newOffset))

    console.log('[Sync] currentTime:', currentTime, 'firstLineStart:', firstLineStart, 'newOffset:', newOffset)

    lastSyncOffsetRef.current = clampedOffset
    setCurrentLineIndex(0)
    setAutoScrollEnabled(true)
    onLineChange?.(0)
    onOffsetChange?.(clampedOffset)
  }, [currentTime, lines, onLineChange, onOffsetChange])

  // Navigate to specific line
  const goToLine = useCallback((index: number) => {
    if (index >= 0 && index < lines.length) {
      setCurrentLineIndex(index)
      setAutoScrollEnabled(false)
      onLineChange?.(index)
    }
  }, [lines.length, onLineChange])

  // Handle offset decrease (fine: 0.5s)
  const handleOffsetDecrease = useCallback(() => {
    onOffsetChange?.(Math.max(-300, offset - 0.5))
  }, [offset, onOffsetChange])

  // Handle offset increase (fine: 0.5s)
  const handleOffsetIncrease = useCallback(() => {
    onOffsetChange?.(Math.min(300, offset + 0.5))
  }, [offset, onOffsetChange])

  // Handle quick offset adjustments
  const handleQuickOffset = useCallback((delta: number) => {
    onOffsetChange?.(Math.max(-300, Math.min(300, offset + delta)))
  }, [offset, onOffsetChange])

  // Handle offset reset
  const handleOffsetReset = useCallback(() => {
    onOffsetChange?.(0)
  }, [onOffsetChange])

  // Empty state
  if (lines.length === 0) {
    return (
      <Card className="bg-card/50 border-border/30">
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground text-lg">Paroles non disponibles</p>
        </CardContent>
      </Card>
    )
  }

  const progressPercent = ((currentLineIndex + 1) / lines.length) * 100
  const hasSyncedTimestamps = lines[0]?.startTime !== undefined

  return (
    <Card className="overflow-hidden bg-card/80 backdrop-blur border-border/50 shadow-xl">
      {/* Debug Timeline UI */}
      {showDebug && (
        <TimelineDebug
          currentTime={currentTime}
          offset={offset}
          firstLineStartTime={lines[0]?.startTime ?? 0}
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
          <div className="flex items-center gap-1.5">
            {/* Auto-sync button */}
            {onAutoSync && (
              <Button
                variant="default"
                size="sm"
                className="h-9 gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
                onClick={onAutoSync}
                disabled={isAutoSyncing}
                title={autoSyncConfidence != null ? `Confidence: ${Math.round(autoSyncConfidence * 100)}%` : 'Auto-detect lyrics offset'}
              >
                {isAutoSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Auto</span>
                {autoSyncConfidence != null && autoSyncConfidence > 0 && (
                  <span className="text-xs opacity-75">
                    {Math.round(autoSyncConfidence * 100)}%
                  </span>
                )}
              </Button>
            )}

            {/* Sync button - align first line to current time */}
            <Button
              variant="default"
              size="sm"
              className="h-9 gap-1.5 bg-green-600 hover:bg-green-500"
              onClick={handleSync}
              title="Sync: Align first line to current playback time"
            >
              <Target className="h-4 w-4" />
              <span className="hidden sm:inline">Sync</span>
            </Button>

            {/* Quick offset buttons - large adjustments */}
            <div className="hidden md:flex items-center gap-1 ml-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2 text-xs font-mono"
                onClick={() => handleQuickOffset(-30)}
                title="-30 seconds"
              >
                -30s
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2 text-xs font-mono"
                onClick={() => handleQuickOffset(-5)}
                title="-5 seconds"
              >
                -5s
              </Button>
            </div>

            {/* Fine adjustment: -0.5s */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={handleOffsetDecrease}
              title="-0.5 seconds"
            >
              <Minus className="h-4 w-4" />
            </Button>

            {/* Current offset display - click to reset */}
            <Button
              variant={offset === 0 ? "outline" : "secondary"}
              size="sm"
              className="h-9 min-w-[80px] font-mono text-sm"
              onClick={handleOffsetReset}
              title="Click to reset offset to 0"
            >
              {offset >= 0 ? '+' : ''}{offset.toFixed(1)}s
            </Button>

            {/* Fine adjustment: +0.5s */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={handleOffsetIncrease}
              title="+0.5 seconds"
            >
              <Plus className="h-4 w-4" />
            </Button>

            {/* Quick offset buttons - large adjustments */}
            <div className="hidden md:flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2 text-xs font-mono"
                onClick={() => handleQuickOffset(5)}
                title="+5 seconds"
              >
                +5s
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2 text-xs font-mono"
                onClick={() => handleQuickOffset(30)}
                title="+30 seconds"
              >
                +30s
              </Button>
            </div>

            {/* Sync indicator */}
            {hasSyncedTimestamps && (
              <span className="ml-2 text-xs text-green-500 font-medium">
                ⚡ Synced
              </span>
            )}

            {/* Debug toggle button */}
            <Button
              variant={showDebug ? "default" : "ghost"}
              size="icon"
              className={cn("h-9 w-9 ml-2", showDebug && "bg-yellow-600 hover:bg-yellow-500")}
              onClick={() => setShowDebug(!showDebug)}
              title="Toggle debug timeline"
            >
              <Bug className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            disabled={currentLineIndex === 0}
            onClick={() => goToLine(currentLineIndex - 1)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <span className="text-sm text-muted-foreground font-medium min-w-[4.5rem] text-center tabular-nums">
            {currentLineIndex + 1} / {lines.length}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            disabled={currentLineIndex >= lines.length - 1}
            onClick={() => goToLine(currentLineIndex + 1)}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Lyrics - Main content */}
      <ScrollArea className="h-[300px] md:h-[400px] lg:h-[450px]">
        <div className="px-6 py-6 md:px-10 md:py-8 space-y-4 md:space-y-5">
          {lines.map((line, i) => {
            const isCurrent = i === currentLineIndex
            const isPast = i < currentLineIndex
            const distance = Math.abs(i - currentLineIndex)

            // Only render nearby lines (performance optimization)
            if (distance > 6) return null

            // Calculate blur for depth effect
            const blur = distance === 0 ? 0 : Math.min(distance * 0.8, 3)
            const opacity = distance === 0 ? 1 : Math.max(0.3, 1 - distance * 0.15)

            return (
              <div
                key={i}
                ref={isCurrent ? currentLineRef : undefined}
                onClick={() => goToLine(i)}
                className={cn(
                  "cursor-pointer transition-all duration-300 ease-out",
                  isCurrent && "scale-100",
                  !isCurrent && "scale-[0.95] hover:scale-[0.97] hover:opacity-80"
                )}
                style={{
                  filter: blur > 0 ? `blur(${blur}px)` : undefined,
                  opacity,
                }}
              >
                <p
                  className={cn(
                    "text-center leading-relaxed transition-all duration-300",
                    // Current line - bright white, large, with subtle glow for visibility
                    isCurrent && "text-xl sm:text-2xl md:text-2xl lg:text-3xl font-bold text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]",
                    // Past lines - dimmed gray (already sung)
                    !isCurrent && isPast && "text-base md:text-lg lg:text-xl text-gray-500",
                    // Future lines - lighter gray (upcoming)
                    !isCurrent && !isPast && "text-base md:text-lg lg:text-xl text-gray-400"
                  )}
                >
                  {line.text}
                </p>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      {/* Progress bar */}
      <div className="px-4 py-3 border-t border-border/30 bg-muted/10">
        <Progress value={progressPercent} className="h-2" />
      </div>
    </Card>
  )
})

/**
 * Compact single-line lyrics display
 */
export const LyricsDisplayCompact = React.memo(function LyricsDisplayCompact({
  lyrics,
  syncedLines,
  currentLineIndex = 0,
}: {
  lyrics: string
  syncedLines?: SyncedLyricLine[] | null
  currentLineIndex?: number
}) {
  const lines = useMemo(
    () => parseLyrics(lyrics, syncedLines),
    [lyrics, syncedLines]
  )

  if (lines.length === 0) return null

  const currentLine = lines[currentLineIndex]?.text || ''
  const nextLine = lines[currentLineIndex + 1]?.text || ''

  return (
    <div className="text-center space-y-2">
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
