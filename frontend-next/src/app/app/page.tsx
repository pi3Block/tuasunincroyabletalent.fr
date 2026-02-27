"use client";

/**
 * Interactive app page — 100% Client-Side Rendering
 * Unified layout: sidebar (Mixer) + split center (Video | Lyrics) + sticky bottom bar.
 * Mobile portrait: vertical stack layout preserved.
 * Mobile landscape: LandscapeRecordingLayout fixed overlay preserved.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { TrackSearch } from "@/components/app/TrackSearch";
import { YouTubePlayer } from "@/components/app/YouTubePlayer";
import { PitchIndicator } from "@/components/app/PitchIndicator";
import { LyricsDisplayPro } from "@/components/lyrics/LyricsDisplayPro";
import { LandscapeRecordingLayout } from "@/components/app/LandscapeRecordingLayout";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppBottomBar } from "@/components/app/AppBottomBar";
import { api, type Track } from "@/api/client";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { usePitchDetection } from "@/hooks/usePitchDetection";
import { useWordTimestamps } from "@/hooks/useWordTimestamps";
import { useOrientation } from "@/hooks/useOrientation";
import { useSSE, type SSEEvent } from "@/hooks/useSSE";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAudioStore, useTransport, useMasterVolume } from "@/stores/audioStore";
import { cn } from "@/lib/utils";
import type { StudioTransportControls, StudioContext } from "@/audio/types";
import Image from "next/image";
import Link from "next/link";


function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getProgressLabel(step: string): string {
  const labels: Record<string, string> = {
    loading_model: "Préparation du studio d'analyse...",
    separating_user: "Isolation de ta voix en cours...",
    separating_user_done: "Ta voix a été isolée !",
    separating_reference: "Préparation de la version originale...",
    separating_reference_done: "Référence prête !",
    separating_reference_cached: "Référence déjà prête !",
    computing_sync: "Synchronisation automatique...",
    extracting_pitch_user: "Analyse de ta justesse...",
    extracting_pitch_ref: "Analyse de la référence...",
    extracting_pitch_done: "Justesse analysée !",
    transcribing: "Transcription de tes paroles...",
    transcribing_done: "Paroles transcrites !",
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
    reset,
  } = useSessionStore();

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [submittingFallback, setSubmittingFallback] = useState(false);
  const [studioControls, setStudioControls] =
    useState<StudioTransportControls | null>(null);
  const [karaokeMode, setKaraokeMode] = useState(true);
  const [usePollingFallback, setUsePollingFallback] = useState(false);

  const { useLandscapeMobileLayout } = useOrientation();

  // Derived studio context for AppSidebar
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

  const transport = useTransport();
  const masterVolume = useMasterVolume();
  const play = useAudioStore((s) => s.play);
  const pause = useAudioStore((s) => s.pause);
  const seek = useAudioStore((s) => s.seek);
  const setMasterVolume = useAudioStore((s) => s.setMasterVolume);

  useKeyboardShortcuts({
    enabled: status === "ready" || status === "results",
    onPlayPause: () => (transport.playing ? pause() : play()),
    onSeekBack: () => seek(Math.max(0, transport.currentTime - 10)),
    onSeekForward: () =>
      seek(Math.min(transport.duration, transport.currentTime + 10)),
    onVolumeUp: () => setMasterVolume(Math.min(1, masterVolume + 0.05)),
    onVolumeDown: () => setMasterVolume(Math.max(0, masterVolume - 0.05)),
  });

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
    [setReferenceStatus, setStatus, setError, setAnalysisProgress, setResults],
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

  // Fallback: poll analysis status (only if SSE failed)
  useEffect(() => {
    if (
      !usePollingFallback ||
      !sessionId ||
      status !== "analyzing" ||
      !analysisTaskId
    ) {
      return;
    }

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

    const interval = setInterval(pollAnalysis, 2000);
    pollAnalysis();

    return () => clearInterval(interval);
  }, [
    usePollingFallback,
    sessionId,
    status,
    analysisTaskId,
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      startPitchAnalysis(stream);
      await startAudioRecording();
      setStatus("recording");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de démarrer l'enregistrement",
      );
    }
  }, [startAudioRecording, startPitchAnalysis, setStatus, setError]);

  const handleStopRecording = useCallback(async () => {
    if (!sessionId) return;

    stopPitchAnalysis();

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
    reset();
    setStatus("selecting");
  }, [
    stopPitchAnalysis,
    resetRecording,
    setAnalysisProgress,
    reset,
    setStatus,
  ]);

  // Shared lyrics display props
  const displayMode = karaokeMode && wordLines ? "karaoke" : "line";
  const lyricsDisplayProps = {
    lyrics: lyrics || "",
    syncedLines: lyricsLines,
    wordLines: karaokeMode ? wordLines : null,
    currentTime: playbackTime,
    isPlaying: isVideoPlaying,
    displayMode: displayMode as "karaoke" | "line" | "word",
    offset: lyricsOffset,
    onOffsetChange: handleOffsetChange,
    showOffsetControls: true,
  };

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
            wordLines={karaokeMode ? wordLines : null}
            playbackTime={playbackTime}
            isVideoPlaying={isVideoPlaying}
            displayMode={karaokeMode && wordLines ? "karaoke" : "line"}
            lyricsOffset={lyricsOffset}
            onOffsetChange={handleOffsetChange}
            onTimeUpdate={setPlaybackTime}
            onStateChange={setIsVideoPlaying}
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

      {/* ── Desktop unified layout (lg+) ── */}
      <div className="hidden lg:flex h-[calc(100dvh-3.5rem)] overflow-hidden">
        {sessionId && (
          <AppSidebar
            sessionId={sessionId}
            studioContext={studioContext}
            onTransportReady={setStudioControls}
          />
        )}

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Slim track banner */}
          <TrackBannerSlim track={selectedTrack} onReset={handleReset} />

          {/* Center zone: left content + right lyrics */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* LEFT — main content zone */}
            <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-3">
              {/* Video (preparing / downloading / ready / recording) */}
              {["preparing", "downloading", "ready", "recording"].includes(
                status,
              ) && youtubeMatch && (
                  <>
                    <YouTubePlayer
                      video={youtubeMatch}
                      onTimeUpdate={setPlaybackTime}
                      onStateChange={setIsVideoPlaying}
                    />
                    {status === "recording" && (
                      <PitchIndicator pitchData={pitchData} />
                    )}
                  </>
                )}

              {/* Uploading */}
              {status === "uploading" && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <div className="text-center">
                    <p className="text-lg font-semibold">
                      Envoi de ton enregistrement...
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Préparation de l&apos;analyse
                    </p>
                  </div>
                </div>
              )}

              {/* Analyzing */}
              {status === "analyzing" && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-3xl">👨‍⚖️</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-primary">
                      Le jury délibère...
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Analyse de ta performance en cours
                    </p>
                  </div>
                  {analysisProgress && (
                    <div className="w-full max-w-xs space-y-2">
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
                  {wordTimestampsStatus === "found" && wordLines && (
                    <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 border-t border-border/30">
                      <button
                        onClick={() => setKaraokeMode(!karaokeMode)}
                        className={cn(
                          "flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-colors",
                          karaokeMode
                            ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <span>{karaokeMode ? "🎤" : "📝"}</span>
                        <span>{karaokeMode ? "Karaoké" : "Ligne"}</span>
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

          {/* Sticky bottom bar */}
          <AppBottomBar
            status={status as "ready" | "recording" | "uploading" | "analyzing" | "results" | "idle" | "selecting" | "preparing" | "needs_fallback" | "downloading"}
            selectedTrack={selectedTrack}
            studioControls={studioControls}
            recordingDuration={recordingDuration}
            onRecord={handleStartRecording}
            onStopRecording={handleStopRecording}
            onReset={handleReset}
            analysisProgress={analysisProgress}
          />
        </div>
      </div>

      {/* ── Mobile portrait layout (< lg) ── */}
      <div
        className={cn(
          "lg:hidden min-h-[calc(100dvh-3.5rem)] flex flex-col",
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
                  onTimeUpdate={setPlaybackTime}
                  onStateChange={setIsVideoPlaying}
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
                <LyricsDisplayPro {...lyricsDisplayProps} />
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
                  onTimeUpdate={setPlaybackTime}
                  onStateChange={setIsVideoPlaying}
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
                <LyricsDisplayPro {...lyricsDisplayProps} />
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
                  onTimeUpdate={setPlaybackTime}
                  onStateChange={setIsVideoPlaying}
                />
              )}

              <button
                onClick={handleStopRecording}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
              >
                Arrêter l&apos;enregistrement
              </button>

              {lyrics && (
                <LyricsDisplayPro {...lyricsDisplayProps} />
              )}
            </div>
          )}

          {/* UPLOADING — mobile */}
          {status === "uploading" && (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 mx-auto border-4 border-primary/40 border-t-primary rounded-full animate-spin" />
              <p className="text-xl font-semibold">
                Envoi de ton enregistrement...
              </p>
              <p className="text-muted-foreground">
                Préparation de l&apos;analyse
              </p>
            </div>
          )}

          {/* ANALYZING — mobile */}
          {status === "analyzing" && (
            <div className="space-y-6 w-full max-w-md text-center">
              <div className="relative inline-block">
                <div className="w-20 h-20 mx-auto border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl">👨‍⚖️</span>
                </div>
              </div>

              <div>
                <p className="text-xl font-bold text-primary">
                  Le jury délibère...
                </p>
                <p className="text-muted-foreground text-sm mt-1">
                  Analyse de ta performance en cours
                </p>
              </div>

              {analysisProgress && (
                <div className="space-y-2 max-w-xs mx-auto">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-700 ease-out"
                      style={{ width: `${analysisProgress.progress}%` }}
                    />
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {getProgressLabel(analysisProgress.step)} (
                    {analysisProgress.progress}%)
                  </p>
                </div>
              )}
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
    </>
  );
}
