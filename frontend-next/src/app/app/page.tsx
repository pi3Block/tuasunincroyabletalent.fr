"use client";

/**
 * Interactive app page — 100% Client-Side Rendering
 * Migrated from App.tsx (lines 400-993) without the landing page logic.
 * Status 'idle' auto-transitions to 'selecting'.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { TrackSearch } from "@/components/app/TrackSearch";
import { YouTubePlayer } from "@/components/app/YouTubePlayer";
import { PitchIndicator } from "@/components/app/PitchIndicator";
import { LyricsDisplayPro } from "@/components/lyrics/LyricsDisplayPro";
import { LandscapeRecordingLayout } from "@/components/app/LandscapeRecordingLayout";
import { StudioMode } from "@/audio";
import { api, type Track } from "@/api/client";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { usePitchDetection } from "@/hooks/usePitchDetection";
import { useWordTimestamps } from "@/hooks/useWordTimestamps";
import { useOrientation } from "@/hooks/useOrientation";
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
    <div className="flex items-center gap-4 bg-gray-800 rounded-xl p-4">
      {track.album.image ? (
        <img
          src={track.album.image}
          alt={track.album.name || ""}
          className="w-20 h-20 rounded-lg object-cover"
        />
      ) : (
        <div className="w-20 h-20 rounded-lg bg-gray-700 flex items-center justify-center">
          <span className="text-3xl">🎵</span>
        </div>
      )}
      <div className="text-left">
        <p className="font-semibold text-lg">{track.name}</p>
        <p className="text-gray-400">{track.artists.join(", ")}</p>
        <p className="text-sm text-gray-500">
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
    <div className="bg-gray-800 rounded-lg p-3">
      <p className={`text-2xl font-bold ${getColor(value)}`}>
        {Math.round(value)}%
      </p>
      <p className="text-xs text-gray-500">{label}</p>
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
  const [practiceMode, setPracticeMode] = useState(false);
  const [karaokeMode, setKaraokeMode] = useState(true);

  const { useLandscapeMobileLayout } = useOrientation();

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

  // Poll session status when preparing/downloading
  useEffect(() => {
    if (
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
  }, [sessionId, status, setReferenceStatus, setStatus, setError]);

  // Fetch lyrics when session is ready
  useEffect(() => {
    if (!sessionId || status !== "ready" || lyricsStatus !== "idle") {
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

  // Fetch lyrics offset
  useEffect(() => {
    if (
      !sessionId ||
      status !== "ready" ||
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

  // Poll analysis status
  useEffect(() => {
    if (!sessionId || status !== "analyzing" || !analysisTaskId) {
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
        } else {
          setStatus("preparing");
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
    reset();
    setStatus("selecting");
  }, [
    stopPitchAnalysis,
    resetRecording,
    setAnalysisProgress,
    reset,
    setStatus,
  ]);

  return (
    <div className="min-h-screen flex flex-col safe-area-top safe-area-bottom">
      {/* Header */}
      <header className="bg-gradient-to-r from-primary-600 to-primary-500 p-4 text-center">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Kiaraoke
        </Link>
        <p className="text-sm text-primary-100 mt-1">
          Fais-toi juger par l&apos;IA !
        </p>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 lg:p-12">
        {/* Error Banner */}
        {error && (
          <div className="w-full max-w-md md:max-w-2xl lg:max-w-4xl mb-4 bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-300 text-sm text-center">
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
                className="text-gray-400 hover:text-white text-sm"
              >
                Retour
              </Link>
            </div>

            <TrackSearch onSelect={handleTrackSelect} />
          </div>
        )}

        {/* PREPARING */}
        {status === "preparing" && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">
                Recherche de la référence audio...
              </p>
              {youtubeMatch && (
                <p className="text-xs text-gray-500">
                  Trouvé: {youtubeMatch.title}
                </p>
              )}
            </div>
          </div>
        )}

        {/* DOWNLOADING */}
        {status === "downloading" && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto border-4 border-primary-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">Téléchargement en cours...</p>
              {youtubeMatch && (
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  <p className="text-white truncate">
                    {youtubeMatch.title}
                  </p>
                  <p className="text-gray-500">
                    {youtubeMatch.channel} •{" "}
                    {formatSeconds(youtubeMatch.duration)}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => handleReset()}
              className="text-gray-400 hover:text-white text-sm"
            >
              Annuler
            </button>
          </div>
        )}

        {/* NEEDS_FALLBACK */}
        {status === "needs_fallback" && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            <div className="bg-yellow-500/20 border border-yellow-500 rounded-lg p-4 text-left">
              <p className="text-yellow-300 font-medium mb-2">
                Référence audio non trouvée
              </p>
              <p className="text-yellow-400/80 text-sm">
                Le Jury ne trouve pas ta version de référence. Colle un
                lien YouTube (Karaoké ou Original) pour qu&apos;on puisse
                te juger équitablement !
              </p>
            </div>

            <div className="space-y-3">
              <input
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />

              <button
                onClick={handleFallbackSubmit}
                disabled={!youtubeUrl.trim() || submittingFallback}
                className="w-full bg-primary-500 hover:bg-primary-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition"
              >
                {submittingFallback
                  ? "Vérification..."
                  : "Utiliser ce lien"}
              </button>
            </div>

            <button
              onClick={() => handleReset()}
              className="text-gray-400 hover:text-white text-sm"
            >
              Changer de chanson
            </button>
          </div>
        )}

        {/* READY */}
        {status === "ready" && selectedTrack && sessionId && (
          <>
            {useLandscapeMobileLayout && !practiceMode && (
              <LandscapeRecordingLayout
                youtubeMatch={youtubeMatch}
                lyrics={lyrics}
                lyricsLines={lyricsLines}
                wordLines={karaokeMode ? wordLines : null}
                playbackTime={playbackTime}
                isVideoPlaying={isVideoPlaying}
                displayMode={
                  karaokeMode && wordLines ? "karaoke" : "line"
                }
                lyricsOffset={lyricsOffset}
                onOffsetChange={handleOffsetChange}
                onTimeUpdate={setPlaybackTime}
                onStateChange={setIsVideoPlaying}
                isRecording={false}
                actionButton={
                  <button
                    onClick={handleStartRecording}
                    className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-full text-base shadow-lg transform transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                  >
                    <span className="text-xl">🎙️</span>
                    Enregistrer
                  </button>
                }
              />
            )}

            {(!useLandscapeMobileLayout || practiceMode) && (
              <div className="w-full max-w-md md:max-w-4xl lg:max-w-7xl xl:max-w-[90%] 2xl:max-w-[85%] space-y-6">
                <TrackCard track={selectedTrack} />

                <div className="flex justify-center">
                  <div className="inline-flex rounded-lg bg-gray-800 p-1">
                    <button
                      onClick={() => setPracticeMode(false)}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        !practiceMode
                          ? "bg-primary-500 text-white shadow"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      Vidéo + Paroles
                    </button>
                    <button
                      onClick={() => setPracticeMode(true)}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        practiceMode
                          ? "bg-primary-500 text-white shadow"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      Mode Studio
                    </button>
                  </div>
                </div>

                {practiceMode ? (
                  <div className="space-y-4">
                    <StudioMode
                      sessionId={sessionId}
                      context="practice"
                    />

                    <div className="bg-blue-500/20 border border-blue-500 rounded-lg p-4 text-center">
                      <p className="text-blue-300 font-medium">
                        Mode Pratique
                      </p>
                      <p className="text-blue-400/80 text-sm mt-1">
                        Entraîne-toi en ajustant le volume de la voix et
                        de l&apos;instrumental
                      </p>
                    </div>

                    <button
                      onClick={handleStartRecording}
                      className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-5 px-10 rounded-full text-xl shadow-lg transform transition hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
                    >
                      <span className="text-2xl">🎙️</span>
                      Enregistrer
                    </button>

                    <button
                      onClick={handleReset}
                      className="w-full text-gray-400 hover:text-white text-sm"
                    >
                      Changer de chanson
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1 space-y-4">
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
                          Lance la vidéo et appuie sur Enregistrer quand
                          tu es prêt
                        </p>
                      </div>

                      <button
                        onClick={handleStartRecording}
                        className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-5 px-10 rounded-full text-xl shadow-lg transform transition hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
                      >
                        <span className="text-2xl">🎙️</span>
                        Enregistrer
                      </button>

                      <button
                        onClick={handleReset}
                        className="w-full text-gray-400 hover:text-white text-sm"
                      >
                        Changer de chanson
                      </button>
                    </div>

                    <div className="flex-1">
                      {lyricsStatus === "loading" && (
                        <div className="flex items-center justify-center gap-2 text-gray-400 text-sm py-4">
                          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                          <span>Chargement des paroles...</span>
                        </div>
                      )}
                      {lyricsStatus === "found" && (
                        <div className="flex items-center justify-center gap-2 text-green-400 text-sm pb-2">
                          <span>✓</span>
                          <span>Paroles disponibles</span>
                        </div>
                      )}
                      {lyricsStatus === "not_found" && (
                        <div className="flex items-center justify-center gap-2 text-yellow-400 text-sm py-4">
                          <span>⚠</span>
                          <span>Paroles non disponibles</span>
                        </div>
                      )}

                      {lyrics && lyricsStatus === "found" && (
                        <LyricsDisplayPro
                          lyrics={lyrics}
                          syncedLines={lyricsLines}
                          wordLines={karaokeMode ? wordLines : null}
                          currentTime={playbackTime}
                          isPlaying={isVideoPlaying}
                          displayMode={
                            karaokeMode && wordLines ? "karaoke" : "line"
                          }
                          offset={lyricsOffset}
                          onOffsetChange={handleOffsetChange}
                          showOffsetControls={true}
                        />
                      )}
                      {isGeneratingWordTimestamps && (
                        <div className="flex items-center justify-center gap-2 text-blue-400 text-xs mt-2">
                          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          <span>Génération du mode karaoké...</span>
                        </div>
                      )}
                      {wordTimestampsStatus === "found" && wordLines && (
                        <div className="flex items-center justify-center gap-2 mt-2">
                          <button
                            onClick={() => setKaraokeMode(!karaokeMode)}
                            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full transition-colors ${
                              karaokeMode
                                ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                                : "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
                            }`}
                          >
                            <span>
                              {karaokeMode ? "🎤" : "📝"}
                            </span>
                            <span>
                              {karaokeMode
                                ? "Mode karaoké"
                                : "Mode ligne"}
                            </span>
                          </button>
                          <button
                            onClick={regenerateWordTimestamps}
                            disabled={isGeneratingWordTimestamps}
                            className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-full bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Régénérer les timestamps karaoké"
                          >
                            <span>🔄</span>
                            <span>Régénérer</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* RECORDING */}
        {status === "recording" && (
          <>
            {useLandscapeMobileLayout && (
              <LandscapeRecordingLayout
                youtubeMatch={youtubeMatch}
                lyrics={lyrics}
                lyricsLines={lyricsLines}
                wordLines={karaokeMode ? wordLines : null}
                playbackTime={playbackTime}
                isVideoPlaying={isVideoPlaying}
                displayMode={
                  karaokeMode && wordLines ? "karaoke" : "line"
                }
                lyricsOffset={lyricsOffset}
                onOffsetChange={handleOffsetChange}
                onTimeUpdate={setPlaybackTime}
                onStateChange={setIsVideoPlaying}
                isRecording={true}
                recordingDuration={recordingDuration}
                actionButton={
                  <button
                    onClick={handleStopRecording}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-full text-base shadow-lg transform transition hover:scale-105 active:scale-95"
                  >
                    Arrêter
                  </button>
                }
              />
            )}

            {!useLandscapeMobileLayout && (
              <div className="w-full max-w-md md:max-w-4xl lg:max-w-7xl xl:max-w-[90%] 2xl:max-w-[85%] space-y-4">
                <div className="flex items-center justify-center gap-3 bg-red-500/20 border border-red-500 rounded-lg p-3">
                  <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" />
                  <p className="text-red-400 font-bold">
                    Enregistrement en cours...{" "}
                    {formatSeconds(recordingDuration)}
                  </p>
                </div>

                <PitchIndicator pitchData={pitchData} />

                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="flex-1 space-y-4">
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
                  </div>

                  <div className="flex-1">
                    {lyrics && (
                      <LyricsDisplayPro
                        lyrics={lyrics}
                        syncedLines={lyricsLines}
                        wordLines={karaokeMode ? wordLines : null}
                        currentTime={playbackTime}
                        isPlaying={isVideoPlaying}
                        displayMode={
                          karaokeMode && wordLines ? "karaoke" : "line"
                        }
                        offset={lyricsOffset}
                        onOffsetChange={handleOffsetChange}
                        showOffsetControls={true}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* UPLOADING */}
        {status === "uploading" && (
          <div className="text-center space-y-4">
            <div className="w-20 h-20 mx-auto border-4 border-primary-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-xl font-semibold">
              Envoi de ton enregistrement...
            </p>
            <p className="text-gray-400">
              Préparation de l&apos;analyse
            </p>
          </div>
        )}

        {/* ANALYZING */}
        {status === "analyzing" && sessionId && (
          <div className="space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <div className="text-center">
              <div className="relative inline-block">
                <div className="w-20 h-20 mx-auto border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl">👨‍⚖️</span>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xl font-bold bg-gradient-to-r from-gold-400 to-gold-600 bg-clip-text text-transparent">
                  Le jury délibère...
                </p>
                <p className="text-gray-400 text-sm mt-1">
                  Analyse de ta performance en cours
                </p>
              </div>

              {analysisProgress && (
                <div className="mt-4 space-y-2">
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden max-w-xs mx-auto">
                    <div
                      className="h-full bg-gradient-to-r from-gold-400 to-gold-600 transition-all duration-700 ease-out"
                      style={{
                        width: `${analysisProgress.progress}%`,
                      }}
                    />
                  </div>

                  <p className="text-gray-300 text-sm">
                    {getProgressLabel(analysisProgress.step)} (
                    {analysisProgress.progress}%)
                  </p>
                </div>
              )}
            </div>

            <StudioMode sessionId={sessionId} context="analyzing" />
          </div>
        )}

        {/* RESULTS */}
        {status === "results" && results && sessionId && (
          <div className="space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <div className="text-center">
              <div className="relative inline-block">
                <div className="w-28 h-28 mx-auto rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center shadow-lg">
                  <span className="text-4xl font-bold text-gray-900">
                    {results.score}
                  </span>
                </div>
              </div>
              <p className="text-gray-400 mt-2">Score global</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <ScoreCard label="Justesse" value={results.pitch_accuracy} />
              <ScoreCard label="Rythme" value={results.rhythm_accuracy} />
              <ScoreCard
                label="Paroles"
                value={results.lyrics_accuracy}
              />
            </div>

            <div className="flex justify-center gap-4">
              {results.jury_comments.map((jury, i) => (
                <div
                  key={i}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
                    jury.vote === "yes"
                      ? "bg-green-500/20 border-2 border-green-500"
                      : "bg-red-500/20 border-2 border-red-500"
                  }`}
                >
                  {jury.vote === "yes" ? "👍" : "👎"}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-center">
                Le jury a dit:
              </h3>
              {results.jury_comments.map((jury, i) => (
                <div
                  key={i}
                  className="bg-gray-800 rounded-xl p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-gold-400">
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
                  <p className="text-gray-300 text-sm italic">
                    &ldquo;{jury.comment}&rdquo;
                  </p>
                </div>
              ))}
            </div>

            <StudioMode sessionId={sessionId} context="results" />

            <button
              onClick={handleReset}
              className="w-full bg-primary-500 hover:bg-primary-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
            >
              Recommencer
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-gray-500 text-sm">
        Powered by AI et{" "}
        <a
          href="https://pierrelegrand.fr"
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline"
        >
          pierrelegrand.fr
        </a>
      </footer>
    </div>
  );
}
