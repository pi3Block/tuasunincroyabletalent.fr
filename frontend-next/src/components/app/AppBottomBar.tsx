"use client";

/**
 * AppBottomBar — Barre de contrôle sticky en bas de l'interface.
 * Gauche : transport studio (play/pause/seek) ou info chanson.
 * Centre : indicateur de statut (prêt, enregistrement, analyse...).
 * Droite : bouton CTA principal (Enregistrer / Arrêter / Recommencer).
 */

import React, { memo } from "react";
import { Mic, Square, RotateCcw, Loader2, CheckCircle2 } from "lucide-react";
import { TransportBar } from "@/audio/components/TransportBar";
import { cn } from "@/lib/utils";
import type { Track } from "@/api/client";
import type { StudioTransportControls } from "@/audio/types";

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
  analysisProgress: AnalysisProgress | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const AppBottomBar = memo(function AppBottomBar({
  status,
  selectedTrack,
  studioControls,
  recordingDuration,
  onRecord,
  onStopRecording,
  onReset,
  analysisProgress,
}: AppBottomBarProps) {
  return (
    <div
      className={cn(
        "shrink-0 h-16 flex items-center gap-3 px-4",
        "border-t border-border/50",
        "bg-card/90 backdrop-blur-md",
        // Gradient accent sur le bord supérieur
        "relative",
        "before:absolute before:inset-x-0 before:top-0 before:h-px",
        "before:bg-linear-to-r before:from-transparent before:via-primary/40 before:to-transparent"
      )}
    >
      {/* Zone GAUCHE — Transport studio OU info chanson */}
      <div className="flex-1 min-w-0 flex items-center">
        {studioControls ? (
          <TransportBar
            onPlay={studioControls.play}
            onPause={studioControls.pause}
            onStop={studioControls.stop}
            onSeek={studioControls.seek}
            compact
            className="max-w-sm"
          />
        ) : selectedTrack ? (
          <div className="flex items-center gap-2.5 min-w-0">
            {selectedTrack.album?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedTrack.album.image}
                alt={selectedTrack.album.name || selectedTrack.name}
                className="h-9 w-9 rounded-md shrink-0 object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate leading-tight">
                {selectedTrack.name}
              </p>
              <p className="text-xs text-muted-foreground truncate leading-tight">
                {selectedTrack.artists.join(", ")}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Zone CENTRE — Statut contextuel */}
      <div className="shrink-0 flex items-center justify-center">
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

      {/* Zone DROITE — Bouton CTA */}
      <div className="flex-1 flex items-center justify-end gap-2">
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
              // Ring animé quand prêt
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
  );
});
