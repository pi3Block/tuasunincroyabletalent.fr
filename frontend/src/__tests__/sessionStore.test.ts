import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '@stores/sessionStore'

describe('sessionStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useSessionStore.getState().reset()
  })

  it('starts with idle status', () => {
    const state = useSessionStore.getState()
    expect(state.status).toBe('idle')
    expect(state.sessionId).toBeNull()
    expect(state.selectedTrack).toBeNull()
    expect(state.results).toBeNull()
  })

  it('startSession transitions to selecting', () => {
    useSessionStore.getState().startSession()
    expect(useSessionStore.getState().status).toBe('selecting')
    expect(useSessionStore.getState().error).toBeNull()
  })

  it('selectTrack sets track and transitions to preparing', () => {
    const track = {
      id: 'test-id',
      name: 'Test Song',
      artists: ['Test Artist'],
      album: { name: 'Test Album', image: null },
      duration_ms: 180000,
      preview_url: null,
      external_url: null,
    }
    useSessionStore.getState().selectTrack(track)

    const state = useSessionStore.getState()
    expect(state.status).toBe('preparing')
    expect(state.selectedTrack).toEqual(track)
  })

  it('setResults transitions to results status', () => {
    const results = {
      session_id: 'test-session',
      score: 75,
      pitch_accuracy: 80,
      rhythm_accuracy: 70,
      lyrics_accuracy: 75,
      jury_comments: [
        { persona: 'Simon', comment: 'Not bad', vote: 'yes' as const },
      ],
    }
    useSessionStore.getState().setResults(results)

    const state = useSessionStore.getState()
    expect(state.status).toBe('results')
    expect(state.results).toEqual(results)
    expect(state.results!.score).toBe(75)
  })

  it('setError stores error message', () => {
    useSessionStore.getState().setError('Something went wrong')
    expect(useSessionStore.getState().error).toBe('Something went wrong')
  })

  it('reset returns to initial state', () => {
    // Set some state
    useSessionStore.getState().startSession()
    useSessionStore.getState().setSessionId('test-123')
    useSessionStore.getState().setError('test error')
    useSessionStore.getState().setPlaybackTime(42)

    // Reset
    useSessionStore.getState().reset()

    const state = useSessionStore.getState()
    expect(state.status).toBe('idle')
    expect(state.sessionId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.playbackTime).toBe(0)
    expect(state.lyricsOffset).toBe(0)
    expect(state.lyricsStatus).toBe('idle')
  })

  it('setLyricsOffset stores offset value', () => {
    useSessionStore.getState().setLyricsOffset(-2.5)
    expect(useSessionStore.getState().lyricsOffset).toBe(-2.5)
  })

  it('lyrics state transitions work correctly', () => {
    useSessionStore.getState().setLyricsStatus('loading')
    expect(useSessionStore.getState().lyricsStatus).toBe('loading')

    useSessionStore.getState().setLyrics('Test lyrics')
    useSessionStore.getState().setLyricsSyncType('synced')
    useSessionStore.getState().setLyricsSource('genius')
    useSessionStore.getState().setLyricsStatus('found')

    const state = useSessionStore.getState()
    expect(state.lyrics).toBe('Test lyrics')
    expect(state.lyricsSyncType).toBe('synced')
    expect(state.lyricsSource).toBe('genius')
    expect(state.lyricsStatus).toBe('found')
  })

  it('playback state updates independently', () => {
    useSessionStore.getState().setPlaybackTime(10.5)
    useSessionStore.getState().setIsVideoPlaying(true)

    expect(useSessionStore.getState().playbackTime).toBe(10.5)
    expect(useSessionStore.getState().isVideoPlaying).toBe(true)
  })

  it('analysis progress can be set and cleared', () => {
    const progress = { step: 'separating_user', progress: 30 }
    useSessionStore.getState().setAnalysisProgress(progress)
    expect(useSessionStore.getState().analysisProgress).toEqual(progress)

    useSessionStore.getState().setAnalysisProgress(null)
    expect(useSessionStore.getState().analysisProgress).toBeNull()
  })
})
