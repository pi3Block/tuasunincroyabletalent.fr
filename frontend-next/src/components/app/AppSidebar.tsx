"use client";

/**
 * AppSidebar — Sidebar gauche rétractable avec icon rail.
 * Panel "Mixer" : contient StudioMode (TrackMixer) pour la session courante.
 */

import React, { useState, useCallback } from "react";
import { SlidersHorizontal, X, ChevronRight } from "lucide-react";
import { StudioMode } from "@/audio";
import { cn } from "@/lib/utils";
import type { StudioContext, StudioTransportControls } from "@/audio/types";

interface AppSidebarProps {
  sessionId: string;
  studioContext?: StudioContext;
  onTransportReady?: (controls: StudioTransportControls) => void;
  className?: string;
}

type ActivePanel = "mixer" | null;

export const AppSidebar = React.memo(function AppSidebar({
  sessionId,
  studioContext = "practice",
  onTransportReady,
  className,
}: AppSidebarProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  const togglePanel = useCallback((panel: "mixer") => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const closePanel = useCallback(() => setActivePanel(null), []);

  const isPanelOpen = activePanel !== null;

  return (
    <div
      className={cn(
        "flex shrink-0 h-full",
        "border-r border-border/50",
        className
      )}
    >
      {/* Icon rail — toujours visible (48px) */}
      <div className="w-12 flex flex-col items-center py-3 gap-1 bg-background/60 backdrop-blur-sm">
        {/* Bouton Mixer */}
        <button
          type="button"
          onClick={() => togglePanel("mixer")}
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center",
            "transition-all duration-200",
            "touch-manipulation active:scale-95",
            activePanel === "mixer"
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title="Mixer audio"
          aria-label="Ouvrir le mixer"
          aria-pressed={activePanel === "mixer"}
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>

        {/* Indicateur d'expansion */}
        {isPanelOpen && (
          <div className="mt-auto mb-2">
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground/50 transition-transform duration-300",
                "rotate-180"
              )}
            />
          </div>
        )}
      </div>

      {/* Panel expandable */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out",
          isPanelOpen ? "w-72" : "w-0"
        )}
      >
        <div className="w-72 h-full flex flex-col bg-card/60 backdrop-blur-sm border-l border-border/30">
          {/* Header du panel */}
          {activePanel === "mixer" && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Mixer</span>
              </div>
              <button
                type="button"
                onClick={closePanel}
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
          )}

          {/* StudioMode — monté en permanence pour déclencher le chargement des pistes
              et appeler onTransportReady dès que prêt. Visible seulement quand panel ouvert. */}
          <div className={cn("flex-1 overflow-y-auto p-3", activePanel !== "mixer" && "hidden")}>
            <StudioMode
              key={`${sessionId}-${studioContext}`}
              sessionId={sessionId}
              context={studioContext}
              onTransportReady={onTransportReady}
              showTransport={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
