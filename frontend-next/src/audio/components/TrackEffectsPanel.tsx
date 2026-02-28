/**
 * Per-track audio effects controls panel.
 * Renders inside AudioTrack when the FX button is toggled.
 */
import React, { useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import type { TrackId } from '../types'
import type { EffectType, TrackEffectsState, PitchShiftParams, ReverbParams, CompressorParams } from '../effects/types'
import { useAudioStore } from '@/stores/audioStore'

interface TrackEffectsPanelProps {
  id: TrackId
  effects: TrackEffectsState
}

const EFFECT_CONFIG = {
  pitchShift: {
    label: 'Hauteur',
    icon: '🎵',
    color: 'violet',
  },
  reverb: {
    label: 'Réverb',
    icon: '🏛️',
    color: 'blue',
  },
  compressor: {
    label: 'Compresseur',
    icon: '📊',
    color: 'amber',
  },
} as const

export const TrackEffectsPanel = React.memo(function TrackEffectsPanel({
  id,
  effects,
}: TrackEffectsPanelProps) {
  const setEffectEnabled = useAudioStore((s) => s.setTrackEffectEnabled)
  const setEffectParams = useAudioStore((s) => s.setTrackEffectParams)

  const toggleEffect = useCallback(
    (type: EffectType) => {
      setEffectEnabled(id, type, !effects[type].enabled)
    },
    [id, effects, setEffectEnabled]
  )

  const pitchParams = effects.pitchShift.params as PitchShiftParams
  const reverbParams = effects.reverb.params as ReverbParams
  const compressorParams = effects.compressor.params as CompressorParams

  return (
    <div className="space-y-3 pt-2 pb-1">
      {/* Pitch Shift */}
      <EffectRow
        type="pitchShift"
        enabled={effects.pitchShift.enabled}
        onToggle={() => toggleEffect('pitchShift')}
      >
        <div className="flex items-center gap-3 flex-1">
          <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
            {pitchParams.semitones > 0 ? '+' : ''}{pitchParams.semitones}
          </span>
          <Slider
            min={-12}
            max={12}
            step={1}
            value={[pitchParams.semitones]}
            disabled={!effects.pitchShift.enabled}
            onValueChange={([v]) =>
              setEffectParams(id, 'pitchShift', { type: 'pitchShift', semitones: v })
            }
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-6">dt</span>
        </div>
      </EffectRow>

      {/* Reverb */}
      <EffectRow
        type="reverb"
        enabled={effects.reverb.enabled}
        onToggle={() => toggleEffect('reverb')}
      >
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
              {Math.round(reverbParams.wet * 100)}%
            </span>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[Math.round(reverbParams.wet * 100)]}
              disabled={!effects.reverb.enabled}
              onValueChange={([v]) =>
                setEffectParams(id, 'reverb', { type: 'reverb', decay: reverbParams.decay, wet: v / 100 })
              }
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-6">mix</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
              {reverbParams.decay.toFixed(1)}s
            </span>
            <Slider
              min={1}
              max={100}
              step={1}
              value={[Math.round(reverbParams.decay * 10)]}
              disabled={!effects.reverb.enabled}
              onValueChange={([v]) =>
                setEffectParams(id, 'reverb', { type: 'reverb', decay: v / 10, wet: reverbParams.wet })
              }
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-12">decay</span>
          </div>
        </div>
      </EffectRow>

      {/* Compressor */}
      <EffectRow
        type="compressor"
        enabled={effects.compressor.enabled}
        onToggle={() => toggleEffect('compressor')}
      >
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
              {compressorParams.threshold}dB
            </span>
            <Slider
              min={-60}
              max={0}
              step={1}
              value={[compressorParams.threshold]}
              disabled={!effects.compressor.enabled}
              onValueChange={([v]) =>
                setEffectParams(id, 'compressor', { type: 'compressor', threshold: v, ratio: compressorParams.ratio })
              }
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-10">seuil</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
              {compressorParams.ratio}:1
            </span>
            <Slider
              min={1}
              max={20}
              step={1}
              value={[compressorParams.ratio]}
              disabled={!effects.compressor.enabled}
              onValueChange={([v]) =>
                setEffectParams(id, 'compressor', { type: 'compressor', threshold: compressorParams.threshold, ratio: v })
              }
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-10">ratio</span>
          </div>
        </div>
      </EffectRow>
    </div>
  )
})

// ── Single effect row ───────────────────────────────────────────────────────

interface EffectRowProps {
  type: EffectType
  enabled: boolean
  onToggle: () => void
  children: React.ReactNode
}

function EffectRow({ type, enabled, onToggle, children }: EffectRowProps) {
  const config = EFFECT_CONFIG[type]

  const activeColors: Record<string, string> = {
    violet: 'bg-violet-500 text-white shadow-md shadow-violet-500/30',
    blue: 'bg-blue-500 text-white shadow-md shadow-blue-500/30',
    amber: 'bg-amber-500 text-white shadow-md shadow-amber-500/30',
  }

  return (
    <div className={cn(
      'flex items-start gap-2 rounded-md px-2 py-1.5 transition-all',
      enabled && 'bg-white/5',
    )}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'shrink-0 h-8 min-w-[44px] px-2.5 rounded-md text-xs font-bold transition-all',
          'flex items-center justify-center gap-1.5',
          'touch-manipulation active:scale-95',
          'border-2',
          enabled
            ? activeColors[config.color]
            : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground hover:border-muted-foreground/60 hover:bg-muted/50',
          enabled && 'border-transparent',
        )}
        aria-pressed={enabled}
        title={`${enabled ? 'Désactiver' : 'Activer'} ${config.label}`}
      >
        <span>{config.icon}</span>
        <span className="hidden sm:inline">{config.label}</span>
      </button>
      <div className={cn('flex-1 transition-opacity', !enabled && 'opacity-40 pointer-events-none')}>
        {children}
      </div>
    </div>
  )
}
