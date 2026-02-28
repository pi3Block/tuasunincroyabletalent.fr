/**
 * @fileoverview Landscape mobile layout for recording mode.
 * Optimized for mobile phones in landscape orientation with video on left, lyrics on right.
 */

import { memo } from 'react'
import { YouTubePlayer, type YouTubePlayerControls } from '@/components/app/YouTubePlayer'
import { LyricsDisplayPro } from '@/components/lyrics/LyricsDisplayPro'
import { FlowBar } from '@/components/lyrics/FlowBar'
import { formatSeconds } from '@/lib/utils'
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
  displayMode: 'line' | 'karaoke' | 'teleprompter'
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
  /** Called when YouTube player controls are ready */
  onControlsReady?: (controls: YouTubePlayerControls) => void
  /** Called when YouTube player duration changes */
  onDurationChange?: (duration: number) => void
  /** O(1) energy lookup for FlowBar */
  getEnergyAtTime?: (t: number) => number
  /** Whether flow envelope is ready */
  flowEnvelopeReady?: boolean
  /** Reduced motion preference */
  reducedMotion?: boolean
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
  onControlsReady,
  onDurationChange,
  getEnergyAtTime,
  flowEnvelopeReady = false,
  reducedMotion = false,
}: LandscapeRecordingLayoutProps) {
  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-row z-50">
      {/* Left side: Video + FlowBar + Controls (50%) */}
      <div className="w-1/2 h-full flex flex-col p-2 gap-2">
        {/* Video container - takes most of the space */}
        <div className="flex-1 min-h-0 relative">
          {youtubeMatch ? (
            <div className="absolute inset-0 [&_iframe]:!h-full [&_iframe]:!w-full [&>div]:!h-full">
              <YouTubePlayer
                video={youtubeMatch}
                onTimeUpdate={onTimeUpdate}
                onStateChange={onStateChange}
                onControlsReady={onControlsReady}
                onDurationChange={onDurationChange}
                disableInteraction={isRecording}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded-lg">
              <span className="text-gray-500">Pas de vidéo</span>
            </div>
          )}
        </div>

        {/* Flow visualization bar — under video */}
        {flowEnvelopeReady && getEnergyAtTime && (
          <FlowBar
            getEnergyAtTime={getEnergyAtTime}
            envelopeReady
            currentTime={playbackTime}
            isPlaying={isVideoPlaying}
            reducedMotion={reducedMotion}
          />
        )}

        {/* Recording indicator + Action button */}
        <div className="shrink-0 space-y-2">
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
            getEnergyAtTime={flowEnvelopeReady ? getEnergyAtTime : undefined}
            className="h-full flex flex-col"
            scrollAreaClassName="h-full"
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
