/**
 * @fileoverview Landscape mobile layout for recording mode.
 * Optimized for mobile phones in landscape orientation with video on left, lyrics on right.
 */

import { memo } from 'react'
import { YouTubePlayer } from '@/components/YouTubePlayer'
import { LyricsDisplayPro } from '@/components/lyrics/LyricsDisplayPro'
import type { YouTubeMatch, SyncedLyricLine, WordLine } from '@/api/client'

interface LandscapeRecordingLayoutProps {
  /** YouTube video match */
  youtubeMatch: YouTubeMatch | null
  /** Plain lyrics text */
  lyrics: string | null
  /** Synced lyric lines */
  lyricsLines: SyncedLyricLine[] | null
  /** Word-level timestamps for karaoke */
  wordLines: WordLine[] | null
  /** Current playback time in seconds */
  playbackTime: number
  /** Whether video is playing */
  isVideoPlaying: boolean
  /** Display mode for lyrics */
  displayMode: 'line' | 'karaoke'
  /** Lyrics offset in seconds */
  lyricsOffset: number
  /** Callback when offset changes */
  onOffsetChange: (offset: number) => void
  /** Callback when playback time updates */
  onTimeUpdate: (time: number) => void
  /** Callback when video state changes */
  onStateChange: (isPlaying: boolean) => void
  /** Whether currently recording */
  isRecording?: boolean
  /** Recording duration in seconds */
  recordingDuration?: number
  /** Action button (start/stop recording) */
  actionButton: React.ReactNode
}

/**
 * Landscape layout with video (50%) on left and lyrics (50%) on right.
 * Designed for mobile landscape orientation.
 */
export const LandscapeRecordingLayout = memo(function LandscapeRecordingLayout({
  youtubeMatch,
  lyrics,
  lyricsLines,
  wordLines,
  playbackTime,
  isVideoPlaying,
  displayMode,
  lyricsOffset,
  onOffsetChange,
  onTimeUpdate,
  onStateChange,
  isRecording = false,
  recordingDuration = 0,
  actionButton,
}: LandscapeRecordingLayoutProps) {
  const formatSeconds = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-row z-50">
      {/* Left side: Video + Controls (50%) */}
      <div className="w-1/2 h-full flex flex-col p-2 gap-2">
        {/* Video container - takes most of the space */}
        <div className="flex-1 min-h-0 relative">
          {youtubeMatch ? (
            <div className="absolute inset-0 [&_iframe]:!h-full [&_iframe]:!w-full [&>div]:!h-full">
              <YouTubePlayer
                video={youtubeMatch}
                onTimeUpdate={onTimeUpdate}
                onStateChange={onStateChange}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded-lg">
              <span className="text-gray-500">Pas de vidéo</span>
            </div>
          )}
        </div>

        {/* Recording indicator + Action button */}
        <div className="flex-shrink-0 space-y-2">
          {isRecording && (
            <div className="flex items-center justify-center gap-2 bg-red-500/20 border border-red-500 rounded-lg px-3 py-1.5">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 font-bold text-sm">
                {formatSeconds(recordingDuration)}
              </span>
            </div>
          )}
          {actionButton}
        </div>
      </div>

      {/* Right side: Lyrics (50%) */}
      <div className="w-1/2 h-full flex flex-col p-2 overflow-hidden">
        {lyrics ? (
          <LyricsDisplayPro
            lyrics={lyrics}
            syncedLines={lyricsLines}
            wordLines={wordLines}
            currentTime={playbackTime}
            isPlaying={isVideoPlaying}
            displayMode={displayMode}
            offset={lyricsOffset}
            onOffsetChange={onOffsetChange}
            showOffsetControls={true}
            className="h-full flex flex-col [&_.h-\\[300px\\]]:!h-full [&_.md\\:h-\\[400px\\]]:!h-full [&_.lg\\:h-\\[450px\\]]:!h-full"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-800/50 rounded-lg">
            <span className="text-gray-500">Paroles non disponibles</span>
          </div>
        )}
      </div>
    </div>
  )
})

export default LandscapeRecordingLayout
