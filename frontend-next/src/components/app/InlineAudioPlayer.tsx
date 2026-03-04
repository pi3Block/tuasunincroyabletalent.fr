"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Music, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineAudioPlayerProps {
  mixUrl: string | null;
  vocalsUrl: string | null;
  className?: string;
}

export function InlineAudioPlayer({
  mixUrl,
  vocalsUrl,
  className,
}: InlineAudioPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<"mix" | "vocals">("mix");
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentUrl = mode === "mix" ? mixUrl : vocalsUrl;

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (!currentUrl) return;

    if (!audioRef.current || audioRef.current.src !== currentUrl) {
      audioRef.current?.pause();
      const audio = new Audio(currentUrl);
      audio.ontimeupdate = () => {
        setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
      };
      audio.onended = () => setPlaying(false);
      audioRef.current = audio;
    }

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }, [currentUrl, playing]);

  const switchMode = useCallback((m: "mix" | "vocals") => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setProgress(0);
    setMode(m);
  }, []);

  if (!mixUrl && !vocalsUrl) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        onClick={togglePlay}
        className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/30 transition-colors shrink-0"
      >
        {playing ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex gap-1 shrink-0">
        {mixUrl && (
          <button
            onClick={() => switchMode("mix")}
            className={cn(
              "p-1.5 rounded transition-colors",
              mode === "mix"
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Mix (voix + instrumental)"
          >
            <Music className="w-3.5 h-3.5" />
          </button>
        )}
        {vocalsUrl && (
          <button
            onClick={() => switchMode("vocals")}
            className={cn(
              "p-1.5 rounded transition-colors",
              mode === "vocals"
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Voix seule"
          >
            <Mic className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
