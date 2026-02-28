"use client";

/**
 * Interactive app page — 100% Client-Side Rendering
 * Unified layout: split center (Video | Lyrics) + sticky bottom bar with expandable mixer.
 * Mobile portrait: vertical stack layout preserved.
 * Mobile landscape: LandscapeRecordingLayout fixed overlay preserved.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { TrackSearch } from "@/components/app/TrackSearch";
import { YouTubePlayer, type YouTubePlayerControls } from "@/components/app/YouTubePlayer";
import { PitchIndicator } from "@/components/app/PitchIndicator";
import { LyricsDisplayPro } from "@/components/lyrics/LyricsDisplayPro";
import { LandscapeRecordingLayout } from "@/components/app/LandscapeRecordingLayout";
import { AppBottomBar } from "@/components/app/AppBottomBar";
import { api, type Track } from "@/api/client";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { usePitchDetection } from "@/hooks/usePitchDetection";
import { useWordTimestamps } from "@/hooks/useWordTimestamps";
import { useFlowEnvelope } from "@/hooks/useFlowEnvelope";
import { useFlowVisualization } from "@/hooks/useFlowVisualization";
import { useOrientation } from "@/hooks/useOrientation";
import { useSSE, type SSEEvent } from "@/hooks/useSSE";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAudioStore, useTransport, useMasterVolume } from "@/stores/audioStore";
import { cn, formatSeconds } from "@/lib/utils";
import type { StudioTransportControls, StudioContext } from "@/audio/types";
import Image from "next/image";
import Link from "next/link";


function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getProgressLabel(step: string): string {
  const labels: Record<string, string> = {
    loading_model: "Préparation du studio d'analyse...",
    separating_user: "Isolation de ta voix en cours...",
    separating_user_done: "Ta voix a été isolée !",
    analyzing_parallel: "Analyse approfondie en cours...",
    separating_reference: "Préparation de la version originale...",
    separating_reference_done: "Référence prête !",
    separating_reference_cached: "Référence déjà prête !",
    user_tracks_ready: "Ta voix est prête à écouter !",
    sync_and_pitch_ref: "Synchronisation et analyse des tonalités...",
    computing_sync: "Synchronisation automatique...",
    extracting_pitch_user: "Analyse de ta justesse...",
    extracting_pitch_ref: "Analyse de la référence...",
    extracting_pitch_done: "Justesse analysée !",
    transcribing: "Transcription de tes paroles...",
    transcribing_done: "Paroles transcrites !",
    analysis_done: "Analyse terminée !",
    calculating_scores: "Calcul de tes scores...",
    jury_deliberation: "Le jury se réunit en coulisses...",
    jury_voting: "Les jurés votent...",
    completed: "Verdict rendu !",
  };
  return labels[step] || "Traitement en cours...";
}

function TrackCard({ track }: { track: Track }) {
  return (
    <div className="flex items-center gap-4 bg-card border border-border rounded-xl p-4">
      {track.album.image ? (
        <Image
          src={track.album.image}
          alt={track.album.name || ""}
          width={80}
          height={80}
          className="w-20 h-20 rounded-lg object-cover"
        />
      ) : (
        <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center">
          <span className="text-3xl">🎵</span>
        </div>
      )}
      <div className="text-left">
        <p className="font-semibold text-lg">{track.name}</p>
        <p className="text-muted-foreground">{track.artists.join(", ")}</p>
        <p className="text-sm text-muted-foreground">
          {formatDuration(track.duration_ms)}
        </p>
      </div>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  const getColor = (v: number) => {
    if (v >= 80) return "text-green-400";
    if (v >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className={`text-2xl font-bold ${getColor(value)}`}>
        {Math.round(value)}%
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Slim track info banner for the unified desktop layout */
function TrackBannerSlim({
  track,
  onReset,
}: {
  track: Track | null;
  onReset: () => void;
}) {
  if (!track) return null;
  return (
    <div className="shrink-0 h-12 flex items-center gap-3 px-4 border-b border-border/50 bg-card/60 backdrop-blur-sm">
      {track.album.image && (
        <Image
          src={track.album.image}
          alt={track.album.name || ""}
          width={32}
          height={32}
          className="w-8 h-8 rounded-md object-cover shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate leading-tight">
          {track.name}
        </p>
        <p className="text-xs text-muted-foreground truncate leading-none">
          {track.artists.join(", ")}
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
      >
        Changer
      </button>
    </div>
  );
}

export default function AppPage() {
  const {
    status,
    sessionId,
    selectedTrack,
    youtubeMatch,
    results,
    analysisProgress,
    lyrics,
    lyricsLines,
    lyricsStatus,
    error,
    playbackTime,
    isVideoPlaying,
    selectTrack,
    setSessionId,
    setYoutubeMatch,
    setReferenceStatus,
    setStatus,
    setResults,
    setAnalysisProgress,
    setLyrics,
    setLyricsLines,
    setLyricsSyncType,
    setLyricsSource,
    setLyricsStatus,
    setError,
    setPlaybackTime,
    setIsVideoPlaying,
    lyricsOffset,
    lyricsOffsetStatus,
    setLyricsOffset,
    setLyricsOffsetStatus,
    userTracksReady,
    setUserTracksReady,
    reset,
  } = useSessionStore();

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [submittingFallback, setSubmittingFallback] = useState(false);
  const [studioControls, setStudioControls] =
    useState<StudioTransportControls | null>(null);
  const [multiTrackReady, setMultiTrackReady] = useState(false);
  const [karaokeMode, setKaraokeMode] = useState(true);
  const [teleprompterMode, setTeleprompterMode] = useState(false);
  const [usePollingFallback, setUsePollingFallback] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);

  const { useLandscapeMobileLayout, width } = useOrientation();
  const isDesktopViewport = width >= 1024;

  // Derived studio context for mixer
  const studioContext: StudioContext =
    status === "results"
      ? "results"
      : status === "analyzing"
        ? "analyzing"
        : "practice";

  const {
    duration: recordingDuration,
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    resetRecording,
  } = useAudioRecorder({
    onError: (err) => setError(`Erreur micro: ${err.message}`),
    // Le stream est fourni ici dès qu'il est prêt — évite un double getUserMedia
    onStreamReady: (stream) => {
      mediaStreamRef.current = stream;
      startPitchAnalysis(stream);
    },
  });

  const {
    pitchData,
    startAnalysis: startPitchAnalysis,
    stopAnalysis: stopPitchAnalysis,
  } = usePitchDetection();

  const {
    wordLines,
    isGenerating: isGeneratingWordTimestamps,
    status: wordTimestampsStatus,
    regenerate: regenerateWordTimestamps,
  } = useWordTimestamps({
    spotifyTrackId: selectedTrack?.id || null,
    youtubeVideoId: youtubeMatch?.id || null,
    artistName: selectedTrack?.artists?.[0],
    trackName: selectedTrack?.name,
    autoGenerate: true,
    referenceReady:
      status === "ready" || status === "recording" || status === "results",
  });

  // Flow visualization — vocal energy envelope
  const { status: flowEnvelopeStatus, getEnergyAtTime } = useFlowEnvelope(youtubeMatch?.id || null);
  const flowState = useFlowVisualization({
    getEnergyAtTime,
    envelopeReady: flowEnvelopeStatus === 'found',
    currentTime: playbackTime,
    isPlaying: isVideoPlaying,
  });

  // YouTube player imperative controls (for TransportBar sync)
  const [youtubeControls, setYoutubeControls] =
    useState<YouTubePlayerControls | null>(null);

  const transport = useTransport();
  const masterVolume = useMasterVolume();
  const play = useAudioStore((s) => s.play);
  const pause = useAudioStore((s) => s.pause);
  const seek = useAudioStore((s) => s.seek);
  const setMasterVolume = useAudioStore((s) => s.setMasterVolume);

  // YouTube duration tracked locally — NOT synced to audioStore to avoid useMultiTrack conflicts
  const [youtubeDuration, setYoutubeDuration] = useState(0);

  // Callback wrapping setStudioControls + multiTrackReady flag
  const handleStudioTransportReady = useCallback(
    (controls: StudioTransportControls) => {
      setStudioControls(controls);
      setMultiTrackReady(true);
    },
    [],
  );

  // Is multi-track audio the active source? (ref stems loaded during pre-recording phases)
  const useMultiTrackAudio =
    multiTrackReady &&
    ["preparing", "downloading", "ready", "recording"].includes(status);

  // Is YouTube the active video source? (visible across all pre-results states)
  const youtubeActive =
    ["preparing", "downloading", "ready", "recording", "uploading", "analyzing"].includes(status) &&
    !!youtubeControls;

  useKeyboardShortcuts({
    enabled: status === "ready" || status === "results",
    onPlayPause: () => {
      if (effectiveStudioControls) {
        // Use effective controls (handles multi-track + YouTube sync)
        if (useMultiTrackAudio ? transport.playing : isVideoPlaying) {
          effectiveStudioControls.pause();
        } else {
          effectiveStudioControls.play();
        }
      } else if (youtubeActive) {
        if (isVideoPlaying) youtubeControls!.pause();
        else youtubeControls!.play();
      } else {
        if (transport.playing) pause();
        else play();
      }
    },
    onSeekBack: () => {
      const cur = useMultiTrackAudio ? transport.currentTime : youtubeActive ? playbackTime : transport.currentTime;
      const t = Math.max(0, cur - 10);
      if (effectiveStudioControls) effectiveStudioControls.seek(t);
      else if (youtubeActive) youtubeControls!.seekTo(t);
      else seek(t);
    },
    onSeekForward: () => {
      const d = useMultiTrackAudio ? transport.duration : youtubeActive ? youtubeDuration : transport.duration;
      const cur = useMultiTrackAudio ? transport.currentTime : youtubeActive ? playbackTime : transport.currentTime;
      const t = Math.min(d, cur + 10);
      if (effectiveStudioControls) effectiveStudioControls.seek(t);
      else if (youtubeActive) youtubeControls!.seekTo(t);
      else seek(t);
    },
    onVolumeUp: () => setMasterVolume(Math.min(1, masterVolume + 0.05)),
    onVolumeDown: () => setMasterVolume(Math.max(0, masterVolume - 0.05)),
  });

  // ── YouTube time sync ──
  // Do NOT sync anything to audioStore (play/pause, currentTime, duration).
  // Writing to audioStore.transport triggers useMultiTrack.syncPlayback which
  // moves/plays multi-track audio elements → double audio fighting with YouTube.
  // Instead, YouTube state is passed as override props to TransportBar.
  const lastYtTimeRef = useRef(0);
  const handleYoutubeTimeUpdate = useCallback(
    (time: number) => {
      // Detect YouTube manual seek: large jump between consecutive onTimeUpdate ticks
      // (ticks fire every ~250ms, so normal delta is ~0.25s; a jump > 2s = manual seek)
      const prev = lastYtTimeRef.current;
      lastYtTimeRef.current = time;
      if (Math.abs(time - prev) > 2 && studioControls && useMultiTrackAudio) {
        studioControls.seek(time);
      }
      // When multi-track is active, 6g bridge handles playbackTime from audioStore.
      // Only update playbackTime from YouTube when it's the sole audio source.
      if (!useMultiTrackAudio) {
        setPlaybackTime(time);
      }
      // NOT calling setCurrentTime — that would trigger useMultiTrack.syncPlayback
    },
    [setPlaybackTime, studioControls, useMultiTrackAudio],
  );

  const handleYoutubeStateChange = useCallback(
    (isPlaying: boolean) => {
      setIsVideoPlaying(isPlaying);
      // When multi-track is active, forward YouTube user interactions to multi-track
      if (useMultiTrackAudio && studioControls) {
        if (isPlaying) studioControls.play();
        else studioControls.pause();
      }
      // When NOT using multi-track, do NOT call audioStore.play()/pause()
      // — that would make useMultiTrack play its tracks and fight with YouTube audio.
    },
    [setIsVideoPlaying, useMultiTrackAudio, studioControls],
  );

  const handleYoutubeDurationChange = useCallback(
    (duration: number) => {
      if (duration > 0) {
        setYoutubeDuration(duration);
        // NOT calling audioStore.setDuration — keep YouTube state isolated
      }
    },
    [],
  );

  const handleYoutubeControlsReady = useCallback(
    (controls: YouTubePlayerControls) => {
      setYoutubeControls(controls);
    },
    [],
  );

  // If the active YouTube player instance changes (song/layout switch),
  // drop stale imperative controls until the new player reports ready.
  useEffect(() => {
    setYoutubeControls(null);
    setIsVideoPlaying(false);
    setYoutubeDuration(0);
    lastYtTimeRef.current = 0;
  }, [youtubeMatch?.id, isDesktopViewport, setIsVideoPlaying]);

  // ── 6c. Crossfade YouTube → Multi-Track when ref stems load ──
  // Once multi-track has loaded, YouTube stays permanently muted (no unmute on status change).
  // Only unmute if multi-track was never loaded (initial YouTube-only phase or after full reset).
  useEffect(() => {
    if (!youtubeControls) return;

    if (useMultiTrackAudio) {
      // Fade out YouTube audio over 500ms (10 steps of 50ms)
      const startVolume = youtubeControls.getVolume();
      const steps = 10;
      const stepMs = 500 / steps;
      let step = 0;
      const fadeOut = setInterval(() => {
        step++;
        const volume = Math.round(startVolume * (1 - step / steps));
        youtubeControls.setVolume(Math.max(0, volume));
        if (step >= steps) {
          clearInterval(fadeOut);
          youtubeControls.mute();
        }
      }, stepMs);
      return () => clearInterval(fadeOut);
    } else if (!multiTrackReady) {
      // Only restore YouTube audio if multi-track was never loaded
      youtubeControls.unMute();
      youtubeControls.setVolume(100);
    }
  }, [useMultiTrackAudio, multiTrackReady, youtubeControls]);

  // ── 6d. Sync multi-track to YouTube position on first load ──
  const prevMultiTrackReady = useRef(false);
  useEffect(() => {
    if (multiTrackReady && !prevMultiTrackReady.current && studioControls) {
      // Rising edge: multi-track just became ready
      studioControls.seek(playbackTime);
      if (isVideoPlaying) {
        studioControls.play();
      }
    }
    prevMultiTrackReady.current = multiTrackReady;
  }, [multiTrackReady, studioControls, playbackTime, isVideoPlaying]);

  // ── 6e. Effective transport controls (3 modes) ──
  const effectiveStudioControls: StudioTransportControls | null =
    useMultiTrackAudio && studioControls
      ? {
          // Multi-track is audio source — YouTube video follows (muted)
          play: async () => {
            await studioControls.play();
            youtubeControls?.play();
          },
          pause: () => {
            studioControls.pause();
            youtubeControls?.pause();
          },
          stop: () => {
            studioControls.stop();
            youtubeControls?.seekTo(0);
            youtubeControls?.pause();
          },
          seek: (time: number) => {
            studioControls.seek(time);
            youtubeControls?.seekTo(time);
          },
        }
      : youtubeActive
        ? {
            play: async () => {
              youtubeControls!.play();
            },
            pause: () => {
              youtubeControls!.pause();
            },
            stop: () => {
              youtubeControls!.seekTo(0);
              youtubeControls!.pause();
            },
            seek: (time: number) => {
              youtubeControls!.seekTo(time);
            },
          }
        : studioControls;

  // ── 6f. Forward YouTube user interactions to multi-track ──
  // (already handled via handleYoutubeStateChange — enhanced below)

  // ── 6g. Bridge multi-track time → sessionStore (for lyrics sync) ──
  // YouTube seek detection is handled in handleYoutubeTimeUpdate (jump > 2s).
  // Drift correction (YouTube follows multi-track) is handled in 6h.
  useEffect(() => {
    if (!useMultiTrackAudio) return;
    const id = setInterval(() => {
      const mtTime = useAudioStore.getState().transport.currentTime;
      setPlaybackTime(mtTime);
    }, 250);
    return () => clearInterval(id);
  }, [useMultiTrackAudio, setPlaybackTime]);

  // ── 6h. Drift correction: sync YouTube video to multi-track every 5s ──
  useEffect(() => {
    if (!useMultiTrackAudio || !youtubeControls) return;
    const id = setInterval(() => {
      const mtTime = useAudioStore.getState().transport.currentTime;
      const ytTime = youtubeControls.getCurrentTime();
      if (Math.abs(mtTime - ytTime) > 1.0) {
        youtubeControls.seekTo(mtTime);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [useMultiTrackAudio, youtubeControls]);

  // If user started multi-track before YouTube controls were ready,
  // force a one-shot catch-up when controls finally become available.
  useEffect(() => {
    if (!useMultiTrackAudio || !youtubeControls) return;
    const { currentTime, playing } = useAudioStore.getState().transport;
    youtubeControls.seekTo(currentTime);
    if (playing) {
      youtubeControls.play();
    } else {
      youtubeControls.pause();
    }
  }, [useMultiTrackAudio, youtubeControls]);

  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const saveOffsetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Auto-transition from 'idle' to 'selecting' when landing on /app
  useEffect(() => {
    if (status === "idle") {
      setStatus("selecting");
    }
  }, [status, setStatus]);

  // SSE event handler — replaces both session status and analysis polling
  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case "session_status":
          setReferenceStatus(event.data.reference_status as string);
          if (event.data.reference_status === "ready") {
            setStatus("ready");
          } else if (event.data.reference_status === "needs_fallback") {
            setStatus("needs_fallback");
          } else if (event.data.reference_status === "error") {
            setError(
              (event.data.error as string) || "Reference preparation failed",
            );
            setStatus("needs_fallback");
          } else if (event.data.reference_status === "downloading") {
            setStatus("downloading");
          }
          break;

        case "user_tracks_ready":
          // User stems (vocals + instrumentals) are uploaded and accessible.
          // Auto-open the mixer so the user can listen immediately.
          if (event.data.source === "user") {
            setUserTracksReady(true);
            setMixerOpen(true);
          }
          break;

        case "analysis_progress":
          setAnalysisProgress({
            step: event.data.step as string,
            progress: event.data.progress as number,
            detail: event.data.detail as string,
          });
          break;

        case "analysis_complete":
          setResults(event.data.results);
          setAnalysisTaskId(null);
          break;

        case "analysis_error":
          setError((event.data.error as string) || "Analyse échouée");
          setStatus("ready");
          setAnalysisTaskId(null);
          break;

        case "error":
          console.warn("[SSE] Server error:", event.data.message);
          break;
      }
    },
    [setReferenceStatus, setStatus, setError, setAnalysisProgress, setResults, setUserTracksReady],
  );

  // SSE connection — active during preparing/downloading/analyzing
  useSSE({
    sessionId,
    enabled:
      !usePollingFallback &&
      (status === "preparing" ||
        status === "downloading" ||
        status === "analyzing"),
    onEvent: handleSSEEvent,
    onFallback: () => setUsePollingFallback(true),
  });

  // Fallback: poll session status (only if SSE failed)
  useEffect(() => {
    if (
      !usePollingFallback ||
      !sessionId ||
      (status !== "preparing" && status !== "downloading")
    ) {
      return;
    }

    const pollStatus = async () => {
      try {
        const sessionStatus = await api.getSessionStatus(sessionId);
        setReferenceStatus(sessionStatus.reference_status);

        if (sessionStatus.reference_status === "ready") {
          setStatus("ready");
        } else if (sessionStatus.reference_status === "needs_fallback") {
          setStatus("needs_fallback");
        } else if (sessionStatus.reference_status === "error") {
          setError(
            sessionStatus.error || "Reference preparation failed",
          );
          setStatus("needs_fallback");
        } else if (sessionStatus.reference_status === "downloading") {
          setStatus("downloading");
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    };

    const interval = setInterval(pollStatus, 2000);
    pollStatus();

    return () => clearInterval(interval);
  }, [usePollingFallback, sessionId, status, setReferenceStatus, setStatus, setError]);

  // Fetch lyrics as soon as session exists (preparing/downloading/ready/...)
  // Don't wait for reference to be ready — lyrics are independent of audio processing
  useEffect(() => {
    if (
      !sessionId ||
      ["idle", "selecting", "needs_fallback"].includes(status) ||
      lyricsStatus !== "idle"
    ) {
      return;
    }

    const fetchLyrics = async () => {
      setLyricsStatus("loading");
      try {
        const response = await api.getLyrics(sessionId);
        if (response.status === "found") {
          setLyrics(response.lyrics);
          if (response.lines && response.lines.length > 0) {
            setLyricsLines(response.lines);
            setLyricsSyncType(response.syncType || "synced");
          } else {
            setLyricsLines(null);
            setLyricsSyncType(response.syncType || "unsynced");
          }
          setLyricsSource(response.source || "genius");
          setLyricsStatus("found");
        } else {
          setLyrics(null);
          setLyricsLines(null);
          setLyricsSyncType("none");
          setLyricsSource("none");
          setLyricsStatus("not_found");
        }
      } catch (err) {
        console.error("Failed to fetch lyrics:", err);
        setLyricsStatus("error");
      }
    };

    fetchLyrics();
  }, [
    sessionId,
    status,
    lyricsStatus,
    setLyrics,
    setLyricsLines,
    setLyricsSyncType,
    setLyricsSource,
    setLyricsStatus,
  ]);

  // Fetch lyrics offset (same timing as lyrics — fire early)
  useEffect(() => {
    if (
      !sessionId ||
      ["idle", "selecting", "needs_fallback"].includes(status) ||
      lyricsOffsetStatus !== "idle"
    ) {
      return;
    }

    const fetchOffset = async () => {
      setLyricsOffsetStatus("loading");
      try {
        const response = await api.getLyricsOffset(sessionId);
        setLyricsOffset(response.offset_seconds);
        setLyricsOffsetStatus("loaded");
      } catch (err) {
        console.error("Failed to fetch lyrics offset:", err);
        setLyricsOffsetStatus("error");
        setLyricsOffset(0);
      }
    };

    fetchOffset();
  }, [
    sessionId,
    status,
    lyricsOffsetStatus,
    setLyricsOffset,
    setLyricsOffsetStatus,
  ]);

  const handleOffsetChange = useCallback(
    (newOffset: number) => {
      setLyricsOffset(newOffset);

      if (saveOffsetTimeoutRef.current) {
        clearTimeout(saveOffsetTimeoutRef.current);
      }

      saveOffsetTimeoutRef.current = setTimeout(async () => {
        if (!sessionId) return;
        try {
          await api.setLyricsOffset(sessionId, newOffset);
        } catch (err) {
          console.error("Failed to save lyrics offset:", err);
        }
      }, 1000);
    },
    [sessionId, setLyricsOffset],
  );

  useEffect(() => {
    return () => {
      if (saveOffsetTimeoutRef.current) {
        clearTimeout(saveOffsetTimeoutRef.current);
      }
    };
  }, []);

  // Safety-net polling: ALWAYS poll during "analyzing" regardless of SSE.
  // SSE may silently lose events (proxy buffering, Traefik, connection drops).
  // Poll at 3s when SSE is active (safety net), 2s when SSE failed (primary).
  useEffect(() => {
    if (!sessionId || status !== "analyzing") {
      return;
    }

    const pollInterval = usePollingFallback ? 2000 : 3000;

    const pollAnalysis = async () => {
      try {
        const analysisStatus = await api.getAnalysisStatus(sessionId);

        if (analysisStatus.progress) {
          setAnalysisProgress(analysisStatus.progress);
        }

        if (
          analysisStatus.analysis_status === "SUCCESS" &&
          analysisStatus.results
        ) {
          setResults(analysisStatus.results);
          setAnalysisTaskId(null);
        } else if (analysisStatus.analysis_status === "FAILURE") {
          setError(analysisStatus.error || "Analyse échouée");
          setStatus("ready");
          setAnalysisTaskId(null);
        }
      } catch (err) {
        console.error("Failed to poll analysis:", err);
      }
    };

    // Delay first poll slightly to let SSE deliver first if it can
    const firstPollDelay = usePollingFallback ? 0 : 2000;
    const firstPollTimeout = setTimeout(pollAnalysis, firstPollDelay);
    const interval = setInterval(pollAnalysis, pollInterval);

    return () => {
      clearTimeout(firstPollTimeout);
      clearInterval(interval);
    };
  }, [
    usePollingFallback,
    sessionId,
    status,
    setAnalysisProgress,
    setResults,
    setError,
    setStatus,
  ]);

  const handleTrackSelect = useCallback(
    async (track: Track) => {
      selectTrack(track);

      try {
        const response = await api.startSession(track.id, track.name);
        setSessionId(response.session_id);
        setYoutubeMatch(response.youtube_match || null);

        if (response.reference_status === "needs_fallback") {
          setStatus("needs_fallback");
          return;
        }

        setStatus("preparing");

        // Immediately check if reference is already ready.
        // startSession always returns reference_status="pending" (background task runs after response),
        // but with Optimization A + cache HIT, the backend sets "ready" in Redis within ~100ms.
        // This avoids showing "Préparation..." when the reference was already cached.
        try {
          const current = await api.getSessionStatus(response.session_id);
          if (current.reference_status === "ready") {
            setStatus("ready");
          } else if (current.reference_status === "needs_fallback") {
            setStatus("needs_fallback");
          }
          // Otherwise stay in "preparing" — SSE/polling will handle the transition
        } catch {
          // SSE/polling will handle the transition
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to start session",
        );
        setStatus("selecting");
      }
    },
    [selectTrack, setSessionId, setYoutubeMatch, setStatus, setError],
  );

  const handleFallbackSubmit = useCallback(async () => {
    if (!sessionId || !youtubeUrl.trim()) return;

    setSubmittingFallback(true);
    try {
      await api.setFallbackSource(sessionId, youtubeUrl.trim());
      setStatus("downloading");
      setYoutubeUrl("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid YouTube URL",
      );
    } finally {
      setSubmittingFallback(false);
    }
  }, [sessionId, youtubeUrl, setStatus, setError]);

  const handleStartRecording = useCallback(async () => {
    try {
      // startAudioRecording appelle getUserMedia en interne,
      // puis déclenche onStreamReady → startPitchAnalysis + mediaStreamRef
      await startAudioRecording();
      setStatus("recording");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de démarrer l'enregistrement",
      );
    }
  }, [startAudioRecording, setStatus, setError]);

  const handleStopRecording = useCallback(async () => {
    if (!sessionId) return;

    stopPitchAnalysis();

    // Pause all audio BEFORE status change to avoid crossfade unmuting YouTube
    studioControls?.stop();
    youtubeControls?.pause();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    try {
      setStatus("uploading");
      const audioBlob = await stopAudioRecording();

      if (!audioBlob) {
        setError("Aucun enregistrement capturé");
        setStatus("ready");
        return;
      }

      await api.uploadRecording(sessionId, audioBlob);
      setStatus("analyzing");
      const analysisResponse = await api.startAnalysis(sessionId);
      setAnalysisTaskId(analysisResponse.task_id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erreur lors de l'envoi",
      );
      setStatus("ready");
    }
  }, [
    sessionId,
    stopAudioRecording,
    stopPitchAnalysis,
    studioControls,
    youtubeControls,
    setStatus,
    setError,
  ]);

  const handleReset = useCallback(() => {
    stopPitchAnalysis();
    resetRecording();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setAnalysisTaskId(null);
    setAnalysisProgress(null);
    setStudioControls(null);
    setMultiTrackReady(false);
    setYoutubeControls(null);
    setYoutubeDuration(0);
    reset();
    setStatus("selecting");
  }, [
    stopPitchAnalysis,
    resetRecording,
    setAnalysisProgress,
    reset,
    setStatus,
  ]);

  // Annuler sans tout réinitialiser :
  // - pendant recording → stop sans upload → retour à "ready" (garde la chanson/session)
  // - sinon → même que handleReset
  const handleCancel = useCallback(() => {
    if (status === "recording") {
      stopPitchAnalysis();
      stopAudioRecording();
      resetRecording();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      setStatus("ready");
    } else {
      handleReset();
    }
  }, [
    status,
    stopPitchAnalysis,
    stopAudioRecording,
    resetRecording,
    handleReset,
    setStatus,
  ]);

  const handleMixerToggle = useCallback(() => {
    setMixerOpen((v) => !v);
  }, []);

  // Shared lyrics display props
  const displayMode = teleprompterMode
    ? "teleprompter"
    : karaokeMode && wordLines
      ? "karaoke"
      : "line";
  const lyricsDisplayProps = {
    lyrics: lyrics || "",
    syncedLines: lyricsLines,
    wordLines: karaokeMode && !teleprompterMode ? wordLines : null,
    currentTime: playbackTime,
    isPlaying: isVideoPlaying,
    displayMode: displayMode as "karaoke" | "line" | "teleprompter",
    offset: lyricsOffset,
    onOffsetChange: handleOffsetChange,
    showOffsetControls: true,
    flowState,
  };

  // Reusable lyrics mode toggle (karaoke / line / teleprompter)
  const lyricsModeToggle = wordTimestampsStatus === "found" && wordLines ? (
    <div className="flex items-center justify-center gap-2 px-3 py-1.5">
      <button
        onClick={() => {
          setKaraokeMode(!karaokeMode);
          if (teleprompterMode) setTeleprompterMode(false);
        }}
        className={cn(
          "flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-colors",
          karaokeMode && !teleprompterMode
            ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
            : "bg-muted/50 text-muted-foreground hover:bg-muted",
        )}
      >
        <span>{karaokeMode && !teleprompterMode ? "🎤" : "📝"}</span>
        <span>{karaokeMode && !teleprompterMode ? "Karaoké" : "Ligne"}</span>
      </button>
      <button
        onClick={() => setTeleprompterMode(!teleprompterMode)}
        className={cn(
          "flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-colors",
          teleprompterMode
            ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
            : "bg-muted/50 text-muted-foreground hover:bg-muted",
        )}
        title="Mode téléprompeur : texte uniforme, sans effets"
      >
        <span>📜</span>
        <span>Prompteur</span>
      </button>
      <button
        onClick={regenerateWordTimestamps}
        disabled={isGeneratingWordTimestamps}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Régénérer les timestamps karaoké"
      >
        <span>🔄</span>
      </button>
    </div>
  ) : null;

  // ─── NON-UNIFIED STATES (selecting / needs_fallback) ────────────────────────
  // "preparing" and "downloading" are now unified: show full UI immediately with
  // record button disabled, so the YouTube player and lyrics load right away.
  const isUnifiedState = [
    "preparing",
    "downloading",
    "ready",
    "recording",
    "uploading",
    "analyzing",
    "results",
  ].includes(status);

  if (!isUnifiedState) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] flex flex-col items-center justify-center p-4 md:p-8">
        {error && (
          <div className="w-full max-w-md md:max-w-2xl mb-4 bg-destructive/20 border border-destructive rounded-lg p-3 text-destructive-foreground text-sm text-center">
            {error}
          </div>
        )}

        {/* SELECTING */}
        {status === "selecting" && (
          <div className="w-full max-w-md md:max-w-2xl lg:max-w-4xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Choisis ta chanson</h2>
              <Link
                href="/"
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                Retour
              </Link>
            </div>
            <TrackSearch onSelect={handleTrackSelect} />
          </div>
        )}

        {/* PREPARING / DOWNLOADING — now handled by unified state below */}

        {/* NEEDS_FALLBACK */}
        {status === "needs_fallback" && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl">
            <TrackCard track={selectedTrack} />
            <div className="bg-yellow-500/20 border border-yellow-500 rounded-lg p-4 text-left">
              <p className="text-yellow-300 font-medium mb-2">
                Référence audio non trouvée
              </p>
              <p className="text-yellow-400/80 text-sm">
                Le Jury ne trouve pas ta version de référence. Colle un lien
                YouTube (Karaoké ou Original) pour qu&apos;on puisse te juger
                équitablement !
              </p>
            </div>
            <div className="space-y-3">
              <div className="md:flex md:gap-3">
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleFallbackSubmit}
                  disabled={!youtubeUrl.trim() || submittingFallback}
                  className="w-full md:w-auto md:whitespace-nowrap mt-3 md:mt-0 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-bold py-3 px-6 rounded-xl transition"
                >
                  {submittingFallback ? "Vérification..." : "Utiliser ce lien"}
                </button>
              </div>
            </div>
            <button
              onClick={() => handleReset()}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Changer de chanson
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── UNIFIED STATES (ready / recording / uploading / analyzing / results) ────

  return (
    <>
      {/* ── Mobile landscape overlay (fixed, preserved as-is) ── */}
      {useLandscapeMobileLayout &&
        (status === "ready" || status === "recording") && (
          <LandscapeRecordingLayout
            youtubeMatch={youtubeMatch}
            lyrics={lyrics}
            lyricsLines={lyricsLines}
            wordLines={karaokeMode && !teleprompterMode ? wordLines : null}
            playbackTime={playbackTime}
            isVideoPlaying={isVideoPlaying}
            displayMode={displayMode as "karaoke" | "line" | "teleprompter"}
            lyricsOffset={lyricsOffset}
            onOffsetChange={handleOffsetChange}
            onTimeUpdate={handleYoutubeTimeUpdate}
            onStateChange={handleYoutubeStateChange}
            onControlsReady={handleYoutubeControlsReady}
            onDurationChange={handleYoutubeDurationChange}
            flowState={flowState}
            isRecording={status === "recording"}
            recordingDuration={
              status === "recording" ? recordingDuration : undefined
            }
            actionButton={
              status === "ready" ? (
                <button
                  onClick={handleStartRecording}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-full text-base shadow-lg transform transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                >
                  <span className="text-xl">🎙️</span>
                  Enregistrer
                </button>
              ) : (
                <button
                  onClick={handleStopRecording}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-full text-base shadow-lg transform transition hover:scale-105 active:scale-95"
                >
                  Arrêter
                </button>
              )
            }
          />
        )}

      {/* ── Desktop unified layout (>= lg) ── */}
      {isDesktopViewport && (
      <div className="flex flex-col h-[calc(100dvh-3.5rem)] overflow-hidden">
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Slim track banner */}
          <TrackBannerSlim track={selectedTrack} onReset={handleReset} />

          {/* Error banner — desktop */}
          {error && (
            <div className="shrink-0 mx-4 mt-2 bg-destructive/20 border border-destructive/60 rounded-lg px-3 py-2 text-destructive-foreground text-sm text-center truncate">
              {error}
            </div>
          )}

          {/* Center zone: left content + right lyrics */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* LEFT — main content zone */}
            <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-3">
              {/* Video (preparing / downloading / ready / recording) */}
              {/* Video — persists through uploading/analyzing (shrinks + progress aside) */}
              {["preparing", "downloading", "ready", "recording", "uploading", "analyzing"].includes(
                status,
              ) && youtubeMatch && (
                (status === "uploading" || status === "analyzing") ? (
                  <div className="flex gap-4 items-start">
                    <div className="w-1/2 shrink-0">
                      <YouTubePlayer
                        video={youtubeMatch}
                        onTimeUpdate={handleYoutubeTimeUpdate}
                        onStateChange={handleYoutubeStateChange}
                        onDurationChange={handleYoutubeDurationChange}
                        onControlsReady={handleYoutubeControlsReady}
                      />
                    </div>

                    {status === "uploading" && (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                        <div className="w-10 h-10 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <div className="text-center">
                          <p className="font-semibold text-sm">
                            Envoi en cours...
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Préparation de l&apos;analyse
                          </p>
                        </div>
                      </div>
                    )}

                    {status === "analyzing" && (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                        {userTracksReady ? (
                          /* Voix prête — invitation à ouvrir le mixer */
                          <div className="text-center space-y-2">
                            <div className="text-3xl">🎤</div>
                            <p className="font-bold text-green-400 text-sm">
                              Ta voix est isolée !
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Écoute dans le mixer pendant que le jury délibère...
                            </p>
                          </div>
                        ) : (
                          /* Toujours en cours de séparation */
                          <div className="relative">
                            <div className="w-14 h-14 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xl">👨‍⚖️</span>
                            </div>
                          </div>
                        )}
                        {!userTracksReady && (
                          <div className="text-center">
                            <p className="font-bold text-primary text-sm">
                              Le jury délibère...
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Analyse en cours
                            </p>
                          </div>
                        )}
                        {analysisProgress && (
                          <div className="w-full space-y-1">
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-700 ease-out"
                                style={{ width: `${analysisProgress.progress}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                              {getProgressLabel(analysisProgress.step)} (
                              {analysisProgress.progress}%)
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <YouTubePlayer
                      video={youtubeMatch}
                      onTimeUpdate={handleYoutubeTimeUpdate}
                      onStateChange={handleYoutubeStateChange}
                      onDurationChange={handleYoutubeDurationChange}
                      onControlsReady={handleYoutubeControlsReady}
                    />
                    {status === "recording" && (
                      <PitchIndicator pitchData={pitchData} />
                    )}
                  </>
                )
              )}

              {/* Results */}
              {status === "results" && results && (
                <div className="space-y-5">
                  {/* Score */}
                  <div className="text-center">
                    <div className="w-24 h-24 mx-auto rounded-full bg-linear-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg">
                      <span className="text-4xl font-bold text-gray-900">
                        {results.score}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm">
                      Score global
                    </p>
                  </div>

                  {/* Sub-scores */}
                  <div className="grid grid-cols-3 gap-3">
                    <ScoreCard label="Justesse" value={results.pitch_accuracy} />
                    <ScoreCard label="Rythme" value={results.rhythm_accuracy} />
                    <ScoreCard
                      label="Paroles"
                      value={results.lyrics_accuracy}
                    />
                  </div>

                  {/* Auto-sync info */}
                  {results.auto_sync && results.auto_sync.confidence > 0.3 && (
                    <div className="text-center text-xs text-muted-foreground">
                      Sync auto:{" "}
                      {results.auto_sync.offset_seconds > 0 ? "+" : ""}
                      {results.auto_sync.offset_seconds.toFixed(1)}s
                      {results.auto_sync.confidence < 0.5 &&
                        " (faible confiance)"}
                    </div>
                  )}

                  {/* Jury votes */}
                  <div className="flex justify-center gap-4">
                    {Array.isArray(results.jury_comments) &&
                      results.jury_comments.map((jury, i) => (
                        <div
                          key={i}
                          className={cn(
                            "w-12 h-12 rounded-full flex items-center justify-center text-xl",
                            jury.vote === "yes"
                              ? "bg-green-500/20 border-2 border-green-500"
                              : "bg-red-500/20 border-2 border-red-500",
                          )}
                        >
                          {jury.vote === "yes" ? "👍" : "👎"}
                        </div>
                      ))}
                  </div>

                  {/* Jury comments */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3">
                      Le jury a dit :
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      {Array.isArray(results.jury_comments) &&
                        results.jury_comments.map((jury, i) => (
                          <div
                            key={i}
                            className="bg-card border border-border rounded-xl p-3 text-left"
                          >
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="font-medium text-yellow-400 text-xs">
                                {jury.persona}
                              </span>
                              <span
                                className={cn(
                                  "text-xs",
                                  jury.vote === "yes"
                                    ? "text-green-400"
                                    : "text-red-400",
                                )}
                              >
                                ({jury.vote === "yes" ? "OUI" : "NON"})
                              </span>
                            </div>
                            <p className="text-muted-foreground text-xs italic">
                              &ldquo;{jury.comment}&rdquo;
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Full results link */}
                  {sessionId && (
                    <div className="flex justify-center">
                      <Link
                        href={`/results/${sessionId}`}
                        className="text-sm text-primary hover:text-primary/80 underline"
                      >
                        Voir les résultats détaillés →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT — Lyrics column */}
            <div className="w-[55%] min-w-[320px] border-l border-border/30 overflow-hidden flex flex-col">
              {lyricsStatus === "loading" && (
                <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                  <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                  <span>Chargement des paroles...</span>
                </div>
              )}
              {lyricsStatus === "not_found" && (
                <div className="flex-1 flex items-center justify-center text-yellow-400 text-sm gap-1.5">
                  <span>⚠</span>
                  <span>Paroles non disponibles</span>
                </div>
              )}
              {lyrics && lyricsStatus === "found" && (
                <>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <LyricsDisplayPro
                      {...lyricsDisplayProps}
                      className="h-full"
                    />
                  </div>
                  {/* Karaoke mode controls */}
                  {lyricsModeToggle && (
                    <div className="shrink-0 border-t border-border/30">
                      {lyricsModeToggle}
                    </div>
                  )}
                  {isGeneratingWordTimestamps && (
                    <div className="shrink-0 flex items-center justify-center gap-2 text-blue-400 text-xs px-3 py-1.5 border-t border-border/30">
                      <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span>Génération karaoké...</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Sticky bottom bar with expandable mixer */}
          <AppBottomBar
            status={status as "ready" | "recording" | "uploading" | "analyzing" | "results" | "idle" | "selecting" | "preparing" | "needs_fallback" | "downloading"}
            selectedTrack={selectedTrack}
            studioControls={effectiveStudioControls}
            recordingDuration={recordingDuration}
            onRecord={handleStartRecording}
            onStopRecording={handleStopRecording}
            onReset={handleReset}
            onCancel={handleCancel}
            analysisProgress={analysisProgress}
            isPlaying={useMultiTrackAudio ? undefined : youtubeActive ? isVideoPlaying : undefined}
            currentTime={useMultiTrackAudio ? undefined : youtubeActive ? playbackTime : undefined}
            duration={useMultiTrackAudio ? undefined : youtubeActive ? youtubeDuration : undefined}
            audioSource={useMultiTrackAudio ? 'multitrack' : youtubeActive ? 'youtube' : null}
            mixerOpen={mixerOpen}
            onMixerToggle={handleMixerToggle}
            sessionId={sessionId}
            studioContext={studioContext}
            onTransportReady={handleStudioTransportReady}
            spotifyTrackId={selectedTrack?.id || null}
          />
        </div>
      </div>
      )}

      {/* ── Mobile portrait layout (< lg) ── */}
      {!isDesktopViewport && (
      <div
        className={cn(
          "min-h-[calc(100dvh-3.5rem)] flex flex-col",
          // Hide behind landscape overlay on mobile landscape
          useLandscapeMobileLayout &&
            (status === "ready" || status === "recording")
            ? "invisible pointer-events-none"
            : "",
        )}
      >
        {error && (
          <div className="mx-4 mt-4 bg-destructive/20 border border-destructive rounded-lg p-3 text-destructive-foreground text-sm text-center">
            {error}
          </div>
        )}

        <main className="flex flex-col items-center justify-center p-4 gap-4 flex-1">
          {selectedTrack && <TrackCard track={selectedTrack} />}

          {/* PREPARING / DOWNLOADING — mobile: show player immediately, record button loading */}
          {(status === "preparing" || status === "downloading") && (
            <div className="w-full max-w-md space-y-4">
              {youtubeMatch && (
                <YouTubePlayer
                  video={youtubeMatch}
                  onTimeUpdate={handleYoutubeTimeUpdate}
                  onStateChange={handleYoutubeStateChange}
                  onDurationChange={handleYoutubeDurationChange}
                  onControlsReady={handleYoutubeControlsReady}
                />
              )}

              <div className="bg-muted/30 border border-border/50 rounded-lg p-3 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin shrink-0" />
                <span>Préparation de la référence audio...</span>
              </div>

              <button
                disabled
                className="w-full bg-muted text-muted-foreground font-bold py-5 px-10 rounded-full text-xl opacity-50 cursor-not-allowed flex items-center justify-center gap-3"
              >
                <div className="w-6 h-6 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" />
                Préparation...
              </button>

              {lyrics && lyricsStatus === "found" && (
                <>
                  {lyricsModeToggle}
                  <LyricsDisplayPro {...lyricsDisplayProps} />
                </>
              )}

              <button
                onClick={handleReset}
                className="w-full text-muted-foreground hover:text-foreground text-sm"
              >
                Changer de chanson
              </button>
            </div>
          )}

          {/* READY — mobile */}
          {status === "ready" && (
            <div className="w-full max-w-md space-y-4">
              {youtubeMatch && (
                <YouTubePlayer
                  video={youtubeMatch}
                  onTimeUpdate={handleYoutubeTimeUpdate}
                  onStateChange={handleYoutubeStateChange}
                  onDurationChange={handleYoutubeDurationChange}
                  onControlsReady={handleYoutubeControlsReady}
                />
              )}

              <div className="bg-green-500/20 border border-green-500 rounded-lg p-4 text-center">
                <p className="text-green-300 font-medium">
                  Prêt à enregistrer !
                </p>
                <p className="text-green-400/80 text-sm mt-1">
                  Lance la vidéo et appuie sur Enregistrer quand tu es prêt
                </p>
              </div>

              <button
                onClick={handleStartRecording}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-5 px-10 rounded-full text-xl shadow-lg transform transition hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
              >
                <span className="text-2xl">🎙️</span>
                Enregistrer
              </button>

              {lyrics && lyricsStatus === "found" && (
                <>
                  {lyricsModeToggle}
                  <LyricsDisplayPro {...lyricsDisplayProps} />
                </>
              )}

              <button
                onClick={handleReset}
                className="w-full text-muted-foreground hover:text-foreground text-sm"
              >
                Changer de chanson
              </button>
            </div>
          )}

          {/* RECORDING — mobile */}
          {status === "recording" && (
            <div className="w-full max-w-md space-y-4">
              <div className="flex items-center justify-center gap-3 bg-red-500/20 border border-red-500 rounded-lg p-3">
                <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" />
                <p className="text-red-400 font-bold">
                  Enregistrement en cours...{" "}
                  {formatSeconds(recordingDuration)}
                </p>
              </div>

              <PitchIndicator pitchData={pitchData} />

              {youtubeMatch && (
                <YouTubePlayer
                  video={youtubeMatch}
                  onTimeUpdate={handleYoutubeTimeUpdate}
                  onStateChange={handleYoutubeStateChange}
                  onDurationChange={handleYoutubeDurationChange}
                  onControlsReady={handleYoutubeControlsReady}
                />
              )}

              <button
                onClick={handleStopRecording}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
              >
                Arrêter l&apos;enregistrement
              </button>

              {lyrics && (
                <>
                  {lyricsModeToggle}
                  <LyricsDisplayPro {...lyricsDisplayProps} />
                </>
              )}
            </div>
          )}

          {/* UPLOADING — mobile (video persists + compact indicator) */}
          {status === "uploading" && (
            <div className="w-full max-w-md space-y-4">
              {youtubeMatch && (
                <YouTubePlayer
                  video={youtubeMatch}
                  onTimeUpdate={handleYoutubeTimeUpdate}
                  onStateChange={handleYoutubeStateChange}
                  onDurationChange={handleYoutubeDurationChange}
                  onControlsReady={handleYoutubeControlsReady}
                />
              )}
              <div className="flex items-center justify-center gap-3 bg-muted/30 border border-border/50 rounded-lg p-3">
                <div className="w-5 h-5 border-2 border-primary/40 border-t-primary rounded-full animate-spin shrink-0" />
                <div>
                  <p className="font-semibold text-sm">
                    Envoi en cours...
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Préparation de l&apos;analyse
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ANALYZING — mobile (video persists + compact progress) */}
          {status === "analyzing" && (
            <div className="w-full max-w-md space-y-4">
              {youtubeMatch && (
                <YouTubePlayer
                  video={youtubeMatch}
                  onTimeUpdate={handleYoutubeTimeUpdate}
                  onStateChange={handleYoutubeStateChange}
                  onDurationChange={handleYoutubeDurationChange}
                  onControlsReady={handleYoutubeControlsReady}
                />
              )}
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  {userTracksReady ? (
                    /* Voix prête — invitation à ouvrir le mixer */
                    <>
                      <span className="text-2xl">🎤</span>
                      <div className="text-left">
                        <p className="font-bold text-green-400 text-sm">
                          Ta voix est isolée !
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Ouvre le mixer pour écouter
                        </p>
                      </div>
                    </>
                  ) : (
                    /* Toujours en séparation */
                    <>
                      <div className="relative">
                        <div className="w-10 h-10 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm">👨‍⚖️</span>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-primary text-sm">
                          Le jury délibère...
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Analyse en cours
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {analysisProgress && (
                  <div className="space-y-1">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-700 ease-out"
                        style={{ width: `${analysisProgress.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {getProgressLabel(analysisProgress.step)} (
                      {analysisProgress.progress}%)
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RESULTS — mobile */}
          {status === "results" && results && sessionId && (
            <div className="space-y-6 w-full max-w-md md:max-w-2xl">
              <div className="text-center">
                <div className="w-28 h-28 mx-auto rounded-full bg-linear-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg">
                  <span className="text-4xl font-bold text-gray-900">
                    {results.score}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2">Score global</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <ScoreCard label="Justesse" value={results.pitch_accuracy} />
                <ScoreCard label="Rythme" value={results.rhythm_accuracy} />
                <ScoreCard label="Paroles" value={results.lyrics_accuracy} />
              </div>

              {results.auto_sync && results.auto_sync.confidence > 0.3 && (
                <div className="text-center text-xs text-muted-foreground">
                  Sync auto:{" "}
                  {results.auto_sync.offset_seconds > 0 ? "+" : ""}
                  {results.auto_sync.offset_seconds.toFixed(1)}s
                  {results.auto_sync.confidence < 0.5 &&
                    " (faible confiance)"}
                </div>
              )}

              <div className="flex justify-center gap-4">
                {Array.isArray(results.jury_comments) &&
                  results.jury_comments.map((jury, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-14 h-14 rounded-full flex items-center justify-center text-2xl",
                        jury.vote === "yes"
                          ? "bg-green-500/20 border-2 border-green-500"
                          : "bg-red-500/20 border-2 border-red-500",
                      )}
                    >
                      {jury.vote === "yes" ? "👍" : "👎"}
                    </div>
                  ))}
              </div>

              <div>
                <h3 className="text-lg font-semibold text-center mb-3">
                  Le jury a dit :
                </h3>
                <div className="space-y-3 md:grid md:grid-cols-3 md:gap-6 md:space-y-0">
                  {Array.isArray(results.jury_comments) &&
                    results.jury_comments.map((jury, i) => (
                      <div
                        key={i}
                        className="bg-card border border-border rounded-xl p-4 text-left"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-yellow-400">
                            {jury.persona}
                          </span>
                          <span
                            className={
                              jury.vote === "yes"
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            ({jury.vote === "yes" ? "OUI" : "NON"})
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm italic">
                          &ldquo;{jury.comment}&rdquo;
                        </p>
                      </div>
                    ))}
                </div>
              </div>

              <Link
                href={`/results/${sessionId}`}
                className="block text-center text-sm text-primary hover:text-primary/80 underline"
              >
                Voir les résultats détaillés →
              </Link>

              <button
                onClick={handleReset}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
              >
                Recommencer
              </button>
            </div>
          )}
        </main>
      </div>
      )}
    </>
  );
}
