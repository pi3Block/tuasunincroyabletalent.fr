import { useEffect } from "react";

interface KeyboardShortcutsOptions {
  onPlayPause?: () => void;
  onSeekBack?: (seconds: number) => void;
  onSeekForward?: (seconds: number) => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

/**
 * Hook for keyboard shortcuts in the studio/player context.
 *
 * Shortcuts:
 * - Space: play/pause
 * - ArrowLeft: seek -10s
 * - ArrowRight: seek +10s
 * - ArrowUp: volume +5%
 * - ArrowDown: volume -5%
 * - Escape: back/close overlay
 *
 * Does NOT intercept when focus is on an input or textarea.
 */
export function useKeyboardShortcuts({
  onPlayPause,
  onSeekBack,
  onSeekForward,
  onVolumeUp,
  onVolumeDown,
  onEscape,
  enabled = true,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          onPlayPause?.();
          break;
        case "ArrowLeft":
          e.preventDefault();
          onSeekBack?.(10);
          break;
        case "ArrowRight":
          e.preventDefault();
          onSeekForward?.(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          onVolumeUp?.();
          break;
        case "ArrowDown":
          e.preventDefault();
          onVolumeDown?.();
          break;
        case "Escape":
          onEscape?.();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPlayPause, onSeekBack, onSeekForward, onVolumeUp, onVolumeDown, onEscape, enabled]);
}
