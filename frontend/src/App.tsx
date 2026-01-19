import { useCallback, useEffect, useState, useRef } from 'react'
import { useSessionStore } from '@stores/sessionStore'
import { TrackSearch } from '@/components/TrackSearch'
import { YouTubePlayer } from '@/components/YouTubePlayer'
import { PitchIndicator } from '@/components/PitchIndicator'
import { LyricsDisplay } from '@/components/LyricsDisplay'
import { api, type Track } from '@/api/client'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { usePitchDetection } from '@/hooks/usePitchDetection'

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getProgressLabel(step: string): string {
  const labels: Record<string, string> = {
    'loading_model': '🔄 Préparation du studio d\'analyse...',
    'separating_user': '🎤 Isolation de ta voix en cours...',
    'separating_user_done': '✅ Ta voix a été isolée !',
    'separating_reference': '🎵 Préparation de la version originale...',
    'separating_reference_done': '✅ Référence prête !',
    'separating_reference_cached': '✅ Référence déjà prête !',
    'extracting_pitch_user': '📊 Analyse de ta justesse...',
    'extracting_pitch_ref': '📊 Analyse de la référence...',
    'extracting_pitch_done': '✅ Justesse analysée !',
    'transcribing': '📝 Transcription de tes paroles...',
    'transcribing_done': '✅ Paroles transcrites !',
    'calculating_scores': '🧮 Calcul de tes scores...',
    'jury_deliberation': '👨‍⚖️ Le jury se réunit en coulisses...',
    'jury_voting': '🗳️ Les jurés votent...',
    'completed': '🎉 Verdict rendu !',
  }
  return labels[step] || '⏳ Traitement en cours...'
}

function App() {
  const {
    status,
    sessionId,
    selectedTrack,
    youtubeMatch,
    results,
    analysisProgress,
    lyrics,
    lyricsStatus,
    error,
    playbackTime,
    isVideoPlaying,
    startSession,
    selectTrack,
    setSessionId,
    setYoutubeMatch,
    setReferenceStatus,
    setStatus,
    setResults,
    setAnalysisProgress,
    setLyrics,
    setLyricsStatus,
    setError,
    setPlaybackTime,
    setIsVideoPlaying,
    lyricsOffset,
    lyricsOffsetStatus,
    setLyricsOffset,
    setLyricsOffsetStatus,
    reset,
  } = useSessionStore()

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [submittingFallback, setSubmittingFallback] = useState(false)

  // Audio recorder hook
  const {
    duration: recordingDuration,
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    resetRecording,
  } = useAudioRecorder({
    onError: (err) => setError(`Erreur micro: ${err.message}`),
  })

  // Pitch detection hook for real-time feedback
  const {
    pitchData,
    startAnalysis: startPitchAnalysis,
    stopAnalysis: stopPitchAnalysis,
  } = usePitchDetection()

  // Track analysis task ID
  const analysisTaskIdRef = useRef<string | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const saveOffsetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Poll session status when preparing/downloading
  useEffect(() => {
    if (!sessionId || (status !== 'preparing' && status !== 'downloading')) {
      return
    }

    const pollStatus = async () => {
      try {
        const sessionStatus = await api.getSessionStatus(sessionId)
        setReferenceStatus(sessionStatus.reference_status)

        if (sessionStatus.reference_status === 'ready') {
          setStatus('ready')
        } else if (sessionStatus.reference_status === 'needs_fallback') {
          setStatus('needs_fallback')
        } else if (sessionStatus.reference_status === 'error') {
          setError(sessionStatus.error || 'Reference preparation failed')
          setStatus('needs_fallback')
        } else if (sessionStatus.reference_status === 'downloading') {
          setStatus('downloading')
        }
      } catch (err) {
        console.error('Failed to poll status:', err)
      }
    }

    const interval = setInterval(pollStatus, 2000)
    pollStatus() // Initial check

    return () => clearInterval(interval)
  }, [sessionId, status, setReferenceStatus, setStatus, setError])

  // Fetch lyrics when session is ready
  useEffect(() => {
    if (!sessionId || status !== 'ready' || lyricsStatus !== 'idle') {
      return
    }

    const fetchLyrics = async () => {
      setLyricsStatus('loading')
      try {
        const response = await api.getLyrics(sessionId)
        if (response.status === 'found') {
          setLyrics(response.lyrics)
          setLyricsStatus('found')
        } else {
          setLyrics(null)
          setLyricsStatus('not_found')
        }
      } catch (err) {
        console.error('Failed to fetch lyrics:', err)
        setLyricsStatus('error')
      }
    }

    fetchLyrics()
  }, [sessionId, status, lyricsStatus, setLyrics, setLyricsStatus])

  // Fetch lyrics offset when session is ready
  useEffect(() => {
    if (!sessionId || status !== 'ready' || lyricsOffsetStatus !== 'idle') {
      return
    }

    const fetchOffset = async () => {
      setLyricsOffsetStatus('loading')
      try {
        const response = await api.getLyricsOffset(sessionId)
        setLyricsOffset(response.offset_seconds)
        setLyricsOffsetStatus('loaded')
      } catch (err) {
        console.error('Failed to fetch lyrics offset:', err)
        setLyricsOffsetStatus('error')
        setLyricsOffset(0)
      }
    }

    fetchOffset()
  }, [sessionId, status, lyricsOffsetStatus, setLyricsOffset, setLyricsOffsetStatus])

  // Handler for offset changes (debounced save to backend)
  const handleOffsetChange = useCallback((newOffset: number) => {
    // Immediate local update
    setLyricsOffset(newOffset)

    // Clear previous timeout
    if (saveOffsetTimeoutRef.current) {
      clearTimeout(saveOffsetTimeoutRef.current)
    }

    // Debounced save to backend (after 1s of no changes)
    saveOffsetTimeoutRef.current = setTimeout(async () => {
      if (!sessionId) return
      try {
        await api.setLyricsOffset(sessionId, newOffset)
        console.log(`[LyricsOffset] Saved offset: ${newOffset}s`)
      } catch (err) {
        console.error('Failed to save lyrics offset:', err)
      }
    }, 1000)
  }, [sessionId, setLyricsOffset])

  // Cleanup offset save timeout on unmount
  useEffect(() => {
    return () => {
      if (saveOffsetTimeoutRef.current) {
        clearTimeout(saveOffsetTimeoutRef.current)
      }
    }
  }, [])

  // Poll analysis status when analyzing
  useEffect(() => {
    if (!sessionId || status !== 'analyzing' || !analysisTaskIdRef.current) {
      return
    }

    const pollAnalysis = async () => {
      try {
        const analysisStatus = await api.getAnalysisStatus(sessionId)

        if (analysisStatus.progress) {
          setAnalysisProgress(analysisStatus.progress)
        }

        if (analysisStatus.analysis_status === 'SUCCESS' && analysisStatus.results) {
          setResults(analysisStatus.results)
          analysisTaskIdRef.current = null
        } else if (analysisStatus.analysis_status === 'FAILURE') {
          setError(analysisStatus.error || 'Analyse échouée')
          setStatus('ready')
          analysisTaskIdRef.current = null
        }
      } catch (err) {
        console.error('Failed to poll analysis:', err)
      }
    }

    const interval = setInterval(pollAnalysis, 2000)
    pollAnalysis() // Initial check

    return () => clearInterval(interval)
  }, [sessionId, status, setAnalysisProgress, setResults, setError, setStatus])

  const handleTrackSelect = useCallback(async (track: Track) => {
    selectTrack(track)

    try {
      const response = await api.startSession(track.id, track.name)
      setSessionId(response.session_id)
      setYoutubeMatch(response.youtube_match || null)

      if (response.reference_status === 'needs_fallback') {
        setStatus('needs_fallback')
      } else {
        setStatus('preparing')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
      setStatus('selecting')
    }
  }, [selectTrack, setSessionId, setYoutubeMatch, setStatus, setError])

  const handleFallbackSubmit = useCallback(async () => {
    if (!sessionId || !youtubeUrl.trim()) return

    setSubmittingFallback(true)
    try {
      await api.setFallbackSource(sessionId, youtubeUrl.trim())
      setStatus('downloading')
      setYoutubeUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid YouTube URL')
    } finally {
      setSubmittingFallback(false)
    }
  }, [sessionId, youtubeUrl, setStatus, setError])

  // Handle recording start
  const handleStartRecording = useCallback(async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      mediaStreamRef.current = stream

      // Start pitch detection with the stream
      startPitchAnalysis(stream)

      // Start audio recording
      await startAudioRecording()
      setStatus('recording')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de démarrer l\'enregistrement')
    }
  }, [startAudioRecording, startPitchAnalysis, setStatus, setError])

  // Handle recording stop and upload
  const handleStopRecording = useCallback(async () => {
    if (!sessionId) return

    // Stop pitch detection
    stopPitchAnalysis()

    // Clean up media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    try {
      setStatus('uploading')
      const audioBlob = await stopAudioRecording()

      if (!audioBlob) {
        setError('Aucun enregistrement capturé')
        setStatus('ready')
        return
      }

      // Upload recording
      await api.uploadRecording(sessionId, audioBlob)

      // Start analysis
      setStatus('analyzing')
      const analysisResponse = await api.startAnalysis(sessionId)
      analysisTaskIdRef.current = analysisResponse.task_id
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi')
      setStatus('ready')
    }
  }, [sessionId, stopAudioRecording, stopPitchAnalysis, setStatus, setError])

  // Reset handler with cleanup
  const handleReset = useCallback(() => {
    stopPitchAnalysis()
    resetRecording()
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    analysisTaskIdRef.current = null
    setAnalysisProgress(null)
    reset()
  }, [stopPitchAnalysis, resetRecording, setAnalysisProgress, reset])

  return (
    <div className="min-h-screen flex flex-col safe-area-top safe-area-bottom">
      {/* Header */}
      <header className="bg-gradient-to-r from-primary-600 to-primary-500 p-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          The AI Voice Jury
        </h1>
        <p className="text-sm text-primary-100 mt-1">
          Fais-toi juger par l'IA !
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

        {/* IDLE - Landing Screen */}
        {status === 'idle' && (
          <div className="text-center space-y-6">
            <div className="w-32 h-32 mx-auto bg-gradient-to-br from-gold-400 to-gold-600 rounded-full flex items-center justify-center shadow-lg">
              <span className="text-6xl">🎤</span>
            </div>

            <h2 className="text-xl font-semibold">
              Prêt à montrer ton talent ?
            </h2>

            <p className="text-gray-400 max-w-xs mx-auto">
              Choisis une chanson, chante, et laisse notre jury IA te donner son verdict !
            </p>

            <button
              onClick={() => startSession()}
              className="bg-primary-500 hover:bg-primary-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
            >
              Commencer
            </button>
          </div>
        )}

        {/* SELECTING - Search Screen */}
        {status === 'selecting' && (
          <div className="w-full max-w-md md:max-w-2xl lg:max-w-4xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Choisis ta chanson
              </h2>
              <button
                onClick={() => reset()}
                className="text-gray-400 hover:text-white text-sm"
              >
                Annuler
              </button>
            </div>

            <TrackSearch onSelect={handleTrackSelect} />
          </div>
        )}

        {/* PREPARING - Searching YouTube */}
        {status === 'preparing' && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">Recherche de la référence audio...</p>
              {youtubeMatch && (
                <p className="text-xs text-gray-500">
                  Trouvé: {youtubeMatch.title}
                </p>
              )}
            </div>
          </div>
        )}

        {/* DOWNLOADING - Downloading from YouTube */}
        {status === 'downloading' && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto border-4 border-primary-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">Téléchargement en cours...</p>
              {youtubeMatch && (
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  <p className="text-white truncate">{youtubeMatch.title}</p>
                  <p className="text-gray-500">{youtubeMatch.channel} • {formatSeconds(youtubeMatch.duration)}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => reset()}
              className="text-gray-400 hover:text-white text-sm"
            >
              Annuler
            </button>
          </div>
        )}

        {/* NEEDS_FALLBACK - Manual YouTube URL required */}
        {status === 'needs_fallback' && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            <div className="bg-yellow-500/20 border border-yellow-500 rounded-lg p-4 text-left">
              <p className="text-yellow-300 font-medium mb-2">
                🔍 Référence audio non trouvée
              </p>
              <p className="text-yellow-400/80 text-sm">
                Le Jury ne trouve pas ta version de référence. Colle un lien YouTube (Karaoké ou Original) pour qu'on puisse te juger équitablement !
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
                {submittingFallback ? 'Vérification...' : 'Utiliser ce lien'}
              </button>
            </div>

            <button
              onClick={() => reset()}
              className="text-gray-400 hover:text-white text-sm"
            >
              Changer de chanson
            </button>
          </div>
        )}

        {/* READY - Ready to record */}
        {status === 'ready' && selectedTrack && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            <TrackCard track={selectedTrack} />

            {/* YouTube Player */}
            {youtubeMatch && (
              <YouTubePlayer
                video={youtubeMatch}
                onTimeUpdate={setPlaybackTime}
                onStateChange={setIsVideoPlaying}
              />
            )}

            {/* Lyrics status indicator */}
            {lyricsStatus === 'loading' && (
              <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <span>Chargement des paroles...</span>
              </div>
            )}
            {lyricsStatus === 'found' && (
              <div className="flex items-center justify-center gap-2 text-green-400 text-sm">
                <span>✓</span>
                <span>Paroles disponibles</span>
              </div>
            )}
            {lyricsStatus === 'not_found' && (
              <div className="flex items-center justify-center gap-2 text-yellow-400 text-sm">
                <span>⚠</span>
                <span>Paroles non disponibles</span>
              </div>
            )}

            {/* Lyrics display - synced with YouTube playback */}
            {lyrics && lyricsStatus === 'found' && (
              <LyricsDisplay
                lyrics={lyrics}
                currentTime={playbackTime}
                isPlaying={isVideoPlaying}
                offset={lyricsOffset}
                onOffsetChange={handleOffsetChange}
                showOffsetControls={true}
              />
            )}

            <div className="bg-green-500/20 border border-green-500 rounded-lg p-4">
              <p className="text-green-300 font-medium">Prêt à enregistrer !</p>
              <p className="text-green-400/80 text-sm mt-1">
                Lance la vidéo et appuie sur Enregistrer quand tu es prêt
              </p>
            </div>

            <button
              onClick={handleStartRecording}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-5 px-10 rounded-full text-xl shadow-lg transform transition hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
            >
              <span className="text-2xl">🎙️</span>
              Enregistrer
            </button>

            <button
              onClick={handleReset}
              className="text-gray-400 hover:text-white text-sm"
            >
              Changer de chanson
            </button>
          </div>
        )}

        {/* RECORDING */}
        {status === 'recording' && (
          <div className="text-center space-y-4 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            {/* Recording indicator */}
            <div className="flex items-center justify-center gap-3 bg-red-500/20 border border-red-500 rounded-lg p-3">
              <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" />
              <p className="text-red-400 font-bold">
                Enregistrement en cours... {formatSeconds(recordingDuration)}
              </p>
            </div>

            {/* Real-time pitch indicator */}
            <PitchIndicator pitchData={pitchData} />

            {/* Lyrics display - synced with YouTube playback */}
            {lyrics && (
              <LyricsDisplay
                lyrics={lyrics}
                currentTime={playbackTime}
                isPlaying={isVideoPlaying}
                offset={lyricsOffset}
                onOffsetChange={handleOffsetChange}
                showOffsetControls={true}
              />
            )}

            {/* YouTube Player - keep playing during recording */}
            {youtubeMatch && (
              <YouTubePlayer
                video={youtubeMatch}
                onTimeUpdate={setPlaybackTime}
                onStateChange={setIsVideoPlaying}
              />
            )}

            <button
              onClick={handleStopRecording}
              className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
            >
              Arrêter l'enregistrement
            </button>
          </div>
        )}

        {/* UPLOADING */}
        {status === 'uploading' && (
          <div className="text-center space-y-4">
            <div className="w-20 h-20 mx-auto border-4 border-primary-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-xl font-semibold">Envoi de ton enregistrement...</p>
            <p className="text-gray-400">Préparation de l'analyse</p>
          </div>
        )}

        {/* ANALYZING */}
        {(status === 'analyzing') && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            {/* Animation du jury */}
            <div className="relative">
              <div className="w-24 h-24 mx-auto border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl">👨‍⚖️</span>
              </div>
            </div>

            <div>
              <p className="text-2xl font-bold bg-gradient-to-r from-gold-400 to-gold-600 bg-clip-text text-transparent">
                Le jury délibère...
              </p>
              <p className="text-gray-400 mt-2">Analyse de ta performance en cours</p>
            </div>

            {/* Progress indicator */}
            {analysisProgress && (
              <div className="space-y-3">
                {/* Progress bar */}
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-gold-400 to-gold-600 transition-all duration-700 ease-out"
                    style={{ width: `${analysisProgress.progress}%` }}
                  />
                </div>

                {/* Percentage */}
                <p className="text-gold-400 font-bold text-lg">
                  {analysisProgress.progress}%
                </p>

                {/* Step label */}
                <p className="text-gray-300">
                  {getProgressLabel(analysisProgress.step)}
                </p>

                {/* Detail (if provided) */}
                {analysisProgress.detail && (
                  <p className="text-sm text-gray-500 italic">
                    {analysisProgress.detail}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* RESULTS */}
        {status === 'results' && results && (
          <div className="text-center space-y-6 w-full max-w-md md:max-w-2xl lg:max-w-4xl">
            {/* Score principal */}
            <div className="relative">
              <div className="w-32 h-32 mx-auto rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center shadow-lg">
                <span className="text-5xl font-bold text-gray-900">{results.score}</span>
              </div>
              <p className="text-gray-400 mt-2">Score global</p>
            </div>

            {/* Détails des scores */}
            <div className="grid grid-cols-3 gap-3">
              <ScoreCard label="Justesse" value={results.pitch_accuracy} />
              <ScoreCard label="Rythme" value={results.rhythm_accuracy} />
              <ScoreCard label="Paroles" value={results.lyrics_accuracy} />
            </div>

            {/* Votes du jury */}
            <div className="flex justify-center gap-4">
              {results.jury_comments.map((jury, i) => (
                <div
                  key={i}
                  className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl ${
                    jury.vote === 'yes'
                      ? 'bg-green-500/20 border-2 border-green-500'
                      : 'bg-red-500/20 border-2 border-red-500'
                  }`}
                >
                  {jury.vote === 'yes' ? '👍' : '👎'}
                </div>
              ))}
            </div>

            {/* Commentaires du jury */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Le jury a dit:</h3>
              {results.jury_comments.map((jury, i) => (
                <div key={i} className="bg-gray-800 rounded-xl p-4 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-gold-400">{jury.persona}</span>
                    <span className={jury.vote === 'yes' ? 'text-green-400' : 'text-red-400'}>
                      ({jury.vote === 'yes' ? 'OUI' : 'NON'})
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm italic">"{jury.comment}"</p>
                </div>
              ))}
            </div>

            <button
              onClick={handleReset}
              className="bg-primary-500 hover:bg-primary-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition hover:scale-105 active:scale-95"
            >
              Recommencer
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-gray-500 text-sm">
        Powered by AI 🤖
      </footer>
    </div>
  )
}

// Reusable Track Card component
function TrackCard({ track }: { track: Track }) {
  return (
    <div className="flex items-center gap-4 bg-gray-800 rounded-xl p-4">
      {track.album.image ? (
        <img
          src={track.album.image}
          alt={track.album.name || ''}
          className="w-20 h-20 rounded-lg object-cover"
        />
      ) : (
        <div className="w-20 h-20 rounded-lg bg-gray-700 flex items-center justify-center">
          <span className="text-3xl">🎵</span>
        </div>
      )}
      <div className="text-left">
        <p className="font-semibold text-lg">{track.name}</p>
        <p className="text-gray-400">{track.artists.join(', ')}</p>
        <p className="text-sm text-gray-500">{formatDuration(track.duration_ms)}</p>
      </div>
    </div>
  )
}

// Score card component for results
function ScoreCard({ label, value }: { label: string; value: number }) {
  const getColor = (v: number) => {
    if (v >= 80) return 'text-green-400'
    if (v >= 60) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <p className={`text-2xl font-bold ${getColor(value)}`}>{Math.round(value)}%</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

export default App
