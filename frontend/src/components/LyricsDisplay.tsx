/**
 * Lyrics display component for karaoke-style lyrics during recording.
 * Shows current line highlighted with previous/next lines for context.
 */
import { useState, useEffect, useMemo, useRef } from 'react'

export interface LyricLine {
  text: string
  startTime?: number  // Optional: timestamp in seconds
  endTime?: number
}

interface LyricsDisplayProps {
  lyrics: string           // Raw lyrics text (newline separated)
  currentTime?: number     // Current playback time in seconds
  isPlaying?: boolean      // Is the song playing?
  onLineChange?: (lineIndex: number) => void
}

// Parse raw lyrics into lines
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
}: LyricsDisplayProps) {
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentLineRef = useRef<HTMLDivElement>(null)

  // Parse lyrics into lines
  const lines = useMemo(() => parseLyrics(lyrics), [lyrics])

  // Auto-advance lyrics (simple time-based estimation if no timestamps)
  useEffect(() => {
    if (!isPlaying || lines.length === 0) return

    // Simple auto-advance: estimate ~4 seconds per line
    const estimatedLineTime = 4
    const estimatedIndex = Math.floor(currentTime / estimatedLineTime)
    const newIndex = Math.min(estimatedIndex, lines.length - 1)

    if (newIndex !== currentLineIndex) {
      setCurrentLineIndex(newIndex)
      onLineChange?.(newIndex)
    }
  }, [currentTime, isPlaying, lines.length, currentLineIndex, onLineChange])

  // Manual navigation
  const goToLine = (index: number) => {
    if (index >= 0 && index < lines.length) {
      setCurrentLineIndex(index)
      setAutoScrollEnabled(false)
      onLineChange?.(index)
    }
  }

  const nextLine = () => goToLine(currentLineIndex + 1)
  const prevLine = () => goToLine(currentLineIndex - 1)

  // Auto-scroll to current line
  useEffect(() => {
    if (autoScrollEnabled && currentLineRef.current) {
      currentLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [currentLineIndex, autoScrollEnabled])

  // Re-enable auto-scroll when playing restarts
  useEffect(() => {
    if (isPlaying) {
      setAutoScrollEnabled(true)
    }
  }, [isPlaying])

  if (lines.length === 0) {
    return (
      <div className="w-full bg-gray-800/50 backdrop-blur rounded-2xl p-4 text-center">
        <p className="text-gray-500 italic">Paroles non disponibles</p>
      </div>
    )
  }

  // Get visible lines (current + context)
  const visibleRange = {
    start: Math.max(0, currentLineIndex - 2),
    end: Math.min(lines.length, currentLineIndex + 4),
  }

  return (
    <div className="w-full bg-gray-800/50 backdrop-blur rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-lg">📝</span>
          <span className="text-sm text-gray-400">Paroles</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={prevLine}
            disabled={currentLineIndex === 0}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs text-gray-500 min-w-[3rem] text-center">
            {currentLineIndex + 1}/{lines.length}
          </span>
          <button
            onClick={nextLine}
            disabled={currentLineIndex >= lines.length - 1}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Lyrics content */}
      <div
        ref={containerRef}
        className="p-4 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600"
      >
        <div className="space-y-2">
          {lines.slice(visibleRange.start, visibleRange.end).map((line, i) => {
            const actualIndex = visibleRange.start + i
            const isCurrent = actualIndex === currentLineIndex
            const isPast = actualIndex < currentLineIndex
            const isFuture = actualIndex > currentLineIndex

            return (
              <div
                key={actualIndex}
                ref={isCurrent ? currentLineRef : undefined}
                onClick={() => goToLine(actualIndex)}
                className={`
                  py-2 px-3 rounded-lg cursor-pointer transition-all duration-300
                  ${isCurrent
                    ? 'bg-primary-500/30 border border-primary-500/50 scale-105'
                    : 'hover:bg-gray-700/50'
                  }
                `}
              >
                <p
                  className={`
                    text-center transition-all duration-300
                    ${isCurrent
                      ? 'text-xl font-bold text-white'
                      : isPast
                        ? 'text-sm text-gray-500'
                        : isFuture
                          ? 'text-sm text-gray-400'
                          : ''
                    }
                  `}
                >
                  {line.text}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Quick navigation dots */}
      <div className="px-4 py-2 bg-gray-900/30 border-t border-gray-700/50">
        <div className="flex justify-center gap-1 flex-wrap max-h-6 overflow-hidden">
          {lines.map((_, i) => (
            <button
              key={i}
              onClick={() => goToLine(i)}
              className={`
                w-2 h-2 rounded-full transition-all
                ${i === currentLineIndex
                  ? 'bg-primary-500 scale-125'
                  : i < currentLineIndex
                    ? 'bg-gray-600'
                    : 'bg-gray-700'
                }
              `}
            />
          ))}
        </div>
      </div>
    </div>
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

  if (lines.length === 0) {
    return null
  }

  const currentLine = lines[currentLineIndex]?.text || ''
  const nextLine = lines[currentLineIndex + 1]?.text || ''

  return (
    <div className="text-center space-y-1">
      <p className="text-lg font-semibold text-white truncate px-4">
        {currentLine}
      </p>
      {nextLine && (
        <p className="text-sm text-gray-500 truncate px-4">
          {nextLine}
        </p>
      )}
    </div>
  )
}
