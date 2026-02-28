/**
 * Multi-track mixer panel.
 */
import { useState, useCallback } from 'react'
import { useAudioStore, useTracks, useMasterVolume } from '@/stores/audioStore'
import { AudioTrack } from './AudioTrack'
import { VolumeSlider } from './VolumeSlider'
import { getTrackKey } from '../core/AudioPlayerFactory'
import { useMixerPreferences } from '../hooks/useMixerPreferences'
import { cn } from '@/lib/utils'
import type { TrackId } from '../types'

/** Download an audio track from its URL */
async function downloadAudioTrack(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('Échec du téléchargement')
    }
    const blob = await response.blob()
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(downloadUrl)
  } catch (error) {
    console.error('Download failed:', error)
    throw error
  }
}

/** Generate a meaningful filename for download */
const TRACK_FILENAMES: Record<string, string> = {
  'ref:vocals': 'voix_originale.wav',
  'ref:instrumentals': 'instrumental.wav',
  'ref:original': 'original.wav',
  'user:vocals': 'ma_voix.wav',
  'user:instrumentals': 'mon_instrumental.wav',
  'user:original': 'mon_enregistrement.wav',
}

interface TrackMixerProps {
  compact?: boolean
  showMaster?: boolean
  showDownload?: boolean
  /** Spotify track ID for persisting mixer preferences */
  spotifyTrackId?: string | null
  className?: string
}

export function TrackMixer({
  compact = false,
  showMaster = true,
  showDownload = false,
  spotifyTrackId = null,
  className,
}: TrackMixerProps) {
  const tracks = useTracks()
  const masterVolume = useMasterVolume()
  const { setTrackVolume, setTrackMuted, setTrackSolo, setMasterVolume } =
    useAudioStore()
  const { save: saveMixerPrefs } = useMixerPreferences(spotifyTrackId)

  const trackEntries = Object.entries(tracks)

  // Group by source
  const refTracks = trackEntries.filter(([key]) => key.startsWith('ref:'))
  const userTracks = trackEntries.filter(([key]) => key.startsWith('user:'))

  const handleVolumeChange = (id: TrackId) => (volume: number) => {
    setTrackVolume(id, volume)
    saveMixerPrefs()
  }

  const handleMuteToggle = (id: TrackId) => () => {
    const key = getTrackKey(id)
    const track = tracks[key]
    if (track) {
      setTrackMuted(id, !track.muted)
      saveMixerPrefs()
    }
  }

  const handleSoloToggle = (id: TrackId) => () => {
    const key = getTrackKey(id)
    const track = tracks[key]
    if (track) {
      setTrackSolo(id, !track.solo)
      saveMixerPrefs()
    }
  }

  const handleDownload = (id: TrackId, url: string) => () => {
    const key = getTrackKey(id)
    const filename = TRACK_FILENAMES[key] || `${key.replace(':', '_')}.wav`
    downloadAudioTrack(url, filename)
  }

  // FX panel toggle — only one track's FX panel open at a time
  const [fxOpenTrack, setFxOpenTrack] = useState<string | null>(null)

  const handleFxToggle = useCallback(
    (id: TrackId) => () => {
      const key = getTrackKey(id)
      setFxOpenTrack((prev) => (prev === key ? null : key))
    },
    []
  )

  const hasActiveEffects = useCallback(
    (state: { effects?: Record<string, { enabled: boolean }> }) =>
      state.effects
        ? Object.values(state.effects).some((e) => e.enabled)
        : false,
    []
  )

  if (trackEntries.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card/80 backdrop-blur border border-border/50',
          'p-6 text-center',
          className
        )}
      >
        <p className="text-muted-foreground">Aucune piste audio chargée</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-xl bg-card/80 backdrop-blur border border-border/50',
        className
      )}
    >
      {/* Header with Master Volume */}
      {showMaster && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground">Mixer</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Master</span>
            <div className="w-24 lg:w-48 xl:w-64">
              <VolumeSlider
                value={masterVolume}
                onChange={setMasterVolume}
                size="sm"
                showIcon={true}
              />
            </div>
          </div>
        </div>
      )}

      <div className={cn('p-3 space-y-4', compact && 'p-2 space-y-3')}>
        <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-4 lg:space-y-0">
          {/* Reference tracks */}
          {refTracks.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                Référence
              </h4>
              <div className="space-y-2">
                {refTracks.map(([key, state]) => (
                  <AudioTrack
                    key={key}
                    id={state.id}
                    state={state}
                    onVolumeChange={handleVolumeChange(state.id)}
                    onMuteToggle={handleMuteToggle(state.id)}
                    onSoloToggle={handleSoloToggle(state.id)}
                    onDownload={showDownload ? handleDownload(state.id, state.url) : undefined}
                    onFxToggle={handleFxToggle(state.id)}
                    fxActive={hasActiveEffects(state)}
                    fxOpen={fxOpenTrack === key}
                    compact={compact}
                  />
                ))}
              </div>
            </div>
          )}

          {/* User tracks */}
          {userTracks.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                Votre enregistrement
              </h4>
              <div className="space-y-2">
                {userTracks.map(([key, state]) => (
                  <AudioTrack
                    key={key}
                    id={state.id}
                    state={state}
                    onVolumeChange={handleVolumeChange(state.id)}
                    onMuteToggle={handleMuteToggle(state.id)}
                    onSoloToggle={handleSoloToggle(state.id)}
                    onDownload={showDownload ? handleDownload(state.id, state.url) : undefined}
                    onFxToggle={handleFxToggle(state.id)}
                    fxActive={hasActiveEffects(state)}
                    fxOpen={fxOpenTrack === key}
                    compact={compact}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
