/**
 * Lyrics display component for karaoke-style lyrics.
 * Uses shadcn/ui for polished, accessible UI.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight, Minus, Plus, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LyricLine {
  text: string
  startTime?: number
  endTime?: number
}

interface LyricsDisplayProps {
  lyrics: string
  currentTime?: number
  isPlaying?: boolean
  onLineChange?: (lineIndex: number) => void
  offset?: number
  onOffsetChange?: (newOffset: number) => void
  showOffsetControls?: boolean
}

function parseLyrics(lyrics: string): LyricLine[] {
  if (!lyrics) return []
  return lyrics
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text }))
}

export function LyricsDisplay({
  lyrics,
  currentTime = 0,
  isPlaying = false,
  onLineChange,
  offset = 0,
  onOffsetChange,
  showOffsetControls = true,
}: LyricsDisplayProps) {
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const currentLineRef = useRef<HTMLDivElement>(null)

  // Track the offset that was applied during last sync, to detect when parent has updated
  const lastSyncOffsetRef = useRef<number | null>(null)

  const lines = useMemo(() => parseLyrics(lyrics), [lyrics])
  const adjustedTime = currentTime + offset

  // Auto-advance lyrics
  useEffect(() => {
    if (!isPlaying || lines.length === 0) return

    // If we just synced, wait for the offset prop to be updated before resuming auto-advance
    if (lastSyncOffsetRef.current !== null) {
      // Check if the parent has applied our requested offset
      if (Math.abs(offset - lastSyncOffsetRef.current) < 0.01) {
        // Offset has been applied, clear the sync flag and continue
        lastSyncOffsetRef.current = null
      } else {
        // Still waiting for offset update, don't advance yet
        return
      }
    }

    const estimatedLineTime = 4
    const estimatedIndex = Math.floor(adjustedTime / estimatedLineTime)
    const newIndex = Math.min(Math.max(0, estimatedIndex), lines.length - 1)
    if (newIndex !== currentLineIndex) {
      setCurrentLineIndex(newIndex)
      onLineChange?.(newIndex)
    }
  }, [adjustedTime, offset, isPlaying, lines.length, currentLineIndex, onLineChange])

  // Sync button handler
  const handleSync = () => {
    const newOffset = -currentTime
    const clampedOffset = Math.max(-60, Math.min(60, newOffset))

    // Store the offset we're requesting - we'll wait for it to be applied
    lastSyncOffsetRef.current = clampedOffset

    // Reset to line 0 first
    setCurrentLineIndex(0)
    setAutoScrollEnabled(true)
    onLineChange?.(0)

    // Request the offset change from parent
    onOffsetChange?.(clampedOffset)
  }

  // Auto-scroll to current line
  useEffect(() => {
    if (autoScrollEnabled && currentLineRef.current) {
      currentLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [currentLineIndex, autoScrollEnabled])

  useEffect(() => {
    if (isPlaying) setAutoScrollEnabled(true)
  }, [isPlaying])

  const goToLine = (index: number) => {
    if (index >= 0 && index < lines.length) {
      setCurrentLineIndex(index)
      setAutoScrollEnabled(false)
      onLineChange?.(index)
    }
  }

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

  return (
    <Card className="overflow-hidden bg-card/80 backdrop-blur border-border/50 shadow-xl">
      {/* Header - Controls */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50 bg-muted/20">
        {/* Offset controls */}
        {showOffsetControls && onOffsetChange && (
          <div className="flex items-center gap-1.5">
            {/* Sync button */}
            <Button
              variant="default"
              size="sm"
              className="h-9 gap-1.5 bg-green-600 hover:bg-green-500"
              onClick={handleSync}
            >
              <Target className="h-4 w-4" />
              <span className="hidden sm:inline">Sync</span>
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => onOffsetChange(Math.max(-30, offset - 0.5))}
            >
              <Minus className="h-4 w-4" />
            </Button>

            <Button
              variant={offset === 0 ? "outline" : "secondary"}
              size="sm"
              className="h-9 min-w-[72px] font-mono text-sm"
              onClick={() => onOffsetChange(0)}
            >
              {offset >= 0 ? '+' : ''}{offset.toFixed(1)}s
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => onOffsetChange(Math.min(30, offset + 0.5))}
            >
              <Plus className="h-4 w-4" />
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
        <div className="px-6 py-8 md:px-10 md:py-10 space-y-6 md:space-y-8">
          {lines.map((line, i) => {
            const isCurrent = i === currentLineIndex
            const isPast = i < currentLineIndex
            const distance = Math.abs(i - currentLineIndex)

            // Only render nearby lines
            if (distance > 5) return null

            return (
              <div
                key={i}
                ref={isCurrent ? currentLineRef : undefined}
                onClick={() => goToLine(i)}
                className={cn(
                  "cursor-pointer transition-all duration-500 ease-out",
                  isCurrent && "scale-100",
                  !isCurrent && "scale-[0.92] hover:scale-[0.96]"
                )}
              >
                <p
                  className={cn(
                    "text-center leading-relaxed transition-all duration-500",
                    // Current line - prominent
                    isCurrent && "text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground",
                    // Past lines
                    !isCurrent && isPast && "text-lg md:text-xl lg:text-2xl text-muted-foreground/40",
                    // Future lines
                    !isCurrent && !isPast && "text-lg md:text-xl lg:text-2xl text-muted-foreground/60"
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
}

/**
 * Compact single-line lyrics display
 */
export function LyricsDisplayCompact({
  lyrics,
  currentLineIndex = 0,
}: {
  lyrics: string
  currentLineIndex?: number
}) {
  const lines = useMemo(() => parseLyrics(lyrics), [lyrics])

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
}
