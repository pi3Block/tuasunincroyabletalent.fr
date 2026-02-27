"use client";

/**
 * AppBottomBar — Barre de contrôle sticky en bas de l'interface.
 * Inclut un panneau mixer expandable au-dessus du transport.
 * Gauche : transport studio (play/pause/seek) avec bouton mixer.
 * Centre : indicateur de statut (prêt, enregistrement, analyse...).
 * Droite : bouton CTA principal (Enregistrer / Arrêter / Recommencer).
 */

import React, { memo } from "react";
import { Mic, Square, RotateCcw, Loader2, CheckCircle2, X, SlidersHorizontal } from "lucide-react";
import { TransportBar } from "@/audio/components/TransportBar";
import { StudioMode } from "@/audio";
import { useAudioStore } from "@/stores/audioStore";
import { cn } from "@/lib/utils";
import type { Track } from "@/api/client";
import type { StudioTransportControls, StudioContext } from "@/audio/types";

type AppStatus =
  | "idle"
  | "selecting"
  | "preparing"
  | "needs_fallback"
  | "downloading"
  | "ready"
  | "recording"
  | "uploading"
  | "analyzing"
  | "results";

interface AnalysisProgress {
  step: string;
  progress: number;
  detail?: string;
}

interface AppBottomBarProps {
  status: AppStatus;
  selectedTrack: Track | null;
  /** Fourni par StudioMode via onTransportReady, disponible après analyse */
  studioControls: StudioTransportControls | null;
  recordingDuration: number;
  onRecord: () => void;
  onStopRecording: () => void;
  onReset: () => void;
  /** Annuler l'action en cours (recording → back to ready ; autres → back to selecting) */
  onCancel?: () => void;
  analysisProgress: AnalysisProgress | null;
  /** Override playing state for TransportBar (e.g. from YouTube) */
  isPlaying?: boolean;
  /** Override current time for TransportBar (e.g. from YouTube) */
  currentTime?: number;
  /** Override duration for TransportBar (e.g. from YouTube) */
  duration?: number;
  /** Whether the mixer panel is open */
  mixerOpen?: boolean;
  /** Toggle the mixer panel */
  onMixerToggle?: () => void;
  /** Session ID for StudioMode (required for mixer) */
  sessionId?: string | null;
  /** Studio context for StudioMode */
  studioContext?: StudioContext;
  /** Callback when StudioMode transport is ready */
  onTransportReady?: (controls: StudioTransportControls) => void;
  /** Current audio source indicator */
  audioSource?: 'youtube' | 'multitrack' | null;
  /** Spotify track ID for persisting mixer preferences */
  spotifyTrackId?: string | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const AppBottomBar = memo(function AppBottomBar({
  status,
  // selectedTrack: kept in interface for potential future use
  studioControls,
  recordingDuration,
  onRecord,
  onStopRecording,
  onReset,
  onCancel,
  analysisProgress,
  isPlaying,
  currentTime,
  duration,
  mixerOpen = false,
  onMixerToggle,
  sessionId,
  studioContext = "practice",
  onTransportReady,
  audioSource,
  spotifyTrackId,
}: AppBottomBarProps) {
  // Fallback direct sur l'audioStore si studioControls pas encore prêt (chargement async).
  // Les callbacks de studioControls proviennent du même store — fonctionnellement identiques.
  const audioPlay = useAudioStore((s) => s.play);
  const audioPause = useAudioStore((s) => s.pause);
  const audioStop = useAudioStore((s) => s.stop);
  const audioSeek = useAudioStore((s) => s.seek);
  const effectiveControls: StudioTransportControls = studioControls ?? {
    play: async () => { audioPlay(); },
    pause: audioPause,
    stop: audioStop,
    seek: audioSeek,
  };

  return (
    <div className="shrink-0 flex flex-col bg-card/90 backdrop-blur-md">
      {/* Panneau Mixer expandable — au-dessus du transport */}
      {sessionId && (
        <div
          className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            mixerOpen ? "max-h-[280px] border-t border-border/50" : "max-h-0"
          )}
        >
          <div className="p-3">
            {/* Header mixer */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Mixer</span>
              </div>
              <button
                type="button"
                onClick={onMixerToggle}
                className={cn(
                  "h-7 w-7 rounded-md flex items-center justify-center",
                  "text-muted-foreground hover:text-foreground hover:bg-muted",
                  "transition-colors touch-manipulation active:scale-95"
                )}
                aria-label="Fermer le mixer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* StudioMode — toujours monté pour le lifecycle des pistes */}
            <StudioMode
              key={`${sessionId}-${studioContext}`}
              sessionId={sessionId}
              context={studioContext}
              onTransportReady={onTransportReady}
              showTransport={false}
              spotifyTrackId={spotifyTrackId}
            />
          </div>
        </div>
      )}

      {/* Transport row */}
      <div
        className={cn(
          "h-16 flex items-center gap-3 px-4",
          "border-t border-border/50",
          // Gradient accent sur le bord supérieur
          "relative",
          "before:absolute before:inset-x-0 before:top-0 before:h-px",
          "before:bg-linear-to-r before:from-transparent before:via-primary/40 before:to-transparent"
        )}
      >
      {/* Zone GAUCHE — Transport (toujours visible, fallback audioStore si pistes pas encore prêtes) */}
      <div className="flex-1 min-w-0 flex items-center">
        <TransportBar
          onPlay={effectiveControls.play}
          onPause={effectiveControls.pause}
          onStop={effectiveControls.stop}
          onSeek={effectiveControls.seek}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          compact
          onMixerToggle={sessionId ? onMixerToggle : undefined}
          mixerOpen={mixerOpen}
          audioSource={audioSource}
          className="max-w-sm"
        />
      </div>

      {/* Zone CENTRE — Statut contextuel */}
      <div className="shrink-0 flex items-center justify-center">
        {(status === "preparing" || status === "downloading") && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="hidden sm:inline">Préparation...</span>
          </div>
        )}

        {status === "ready" && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Prêt à enregistrer</span>
          </div>
        )}

        {status === "recording" && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-xs font-mono font-bold text-red-400 tabular-nums">
              {formatDuration(recordingDuration)}
            </span>
          </div>
        )}

        {status === "uploading" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Envoi...</span>
          </div>
        )}

        {status === "analyzing" && analysisProgress && (
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="hidden sm:inline">{analysisProgress.step}</span>
              <span className="text-primary font-medium">
                {analysisProgress.progress}%
              </span>
            </div>
            <div className="w-32 h-0.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${analysisProgress.progress}%` }}
              />
            </div>
          </div>
        )}

        {status === "analyzing" && !analysisProgress && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Analyse en cours...</span>
          </div>
        )}
      </div>

      {/* Zone DROITE — Bouton CTA + Annuler/Recommencer */}
      <div className="flex-1 flex items-center justify-end gap-2">
        {/* Bouton Annuler — visible sur tous les états actifs sauf results */}
        {(status === "preparing" ||
          status === "downloading" ||
          status === "ready" ||
          status === "recording" ||
          status === "analyzing") && (
            <button
              type="button"
              onClick={status === "recording" ? onCancel ?? onReset : onReset}
              className={cn(
                "flex items-center gap-1.5 px-3 h-8 rounded-full",
                "text-muted-foreground hover:text-foreground",
                "text-sm border border-border/60 hover:border-border",
                "bg-transparent hover:bg-muted/60",
                "transition-all duration-200 touch-manipulation active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              title="Annuler et recommencer"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Annuler</span>
            </button>
          )}

        {(status === "preparing" || status === "downloading") && (
          <button
            type="button"
            disabled
            className={cn(
              "flex items-center gap-2 px-4 h-9 rounded-full",
              "bg-muted/50 text-muted-foreground",
              "font-semibold text-sm",
              "cursor-not-allowed opacity-60"
            )}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Préparation...</span>
          </button>
        )}

        {status === "ready" && (
          <button
            type="button"
            onClick={onRecord}
            className={cn(
              "flex items-center gap-2 px-4 h-9 rounded-full",
              "bg-red-500 hover:bg-red-600 text-white",
              "font-semibold text-sm",
              "shadow-lg shadow-red-500/25",
              "transition-all duration-200 touch-manipulation active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              "ring-2 ring-red-500/30 ring-offset-1 ring-offset-background"
            )}
          >
            <Mic className="h-4 w-4" />
            <span>Enregistrer</span>
          </button>
        )}

        {status === "recording" && (
          <button
            type="button"
            onClick={onStopRecording}
            className={cn(
              "flex items-center gap-2 px-4 h-9 rounded-full",
              "bg-muted hover:bg-muted/80 text-foreground",
              "font-semibold text-sm border border-border",
              "transition-all duration-200 touch-manipulation active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Square className="h-4 w-4 fill-current" />
            <span>Arrêter</span>
          </button>
        )}

        {(status === "uploading" || status === "analyzing") && (
          <button
            type="button"
            disabled
            className={cn(
              "flex items-center gap-2 px-4 h-9 rounded-full",
              "bg-muted/50 text-muted-foreground",
              "font-semibold text-sm",
              "cursor-not-allowed opacity-60"
            )}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Traitement...</span>
          </button>
        )}

        {status === "results" && (
          <button
            type="button"
            onClick={onReset}
            className={cn(
              "flex items-center gap-2 px-4 h-9 rounded-full",
              "bg-muted hover:bg-muted/80 text-foreground",
              "font-semibold text-sm border border-border",
              "transition-all duration-200 touch-manipulation active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <RotateCcw className="h-4 w-4" />
            <span>Recommencer</span>
          </button>
        )}
      </div>
      </div>
    </div>
  );
});
