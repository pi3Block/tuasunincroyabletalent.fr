/**
 * Hook for recording audio from the microphone.
 * Uses MediaRecorder API for browser compatibility.
 */
import { useState, useRef, useCallback } from 'react'

export interface UseAudioRecorderOptions {
  onDataAvailable?: (blob: Blob) => void
  onError?: (error: Error) => void
  mimeType?: string
}

export interface UseAudioRecorderReturn {
  isRecording: boolean
  isPaused: boolean
  duration: number
  audioBlob: Blob | null
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  pauseRecording: () => void
  resumeRecording: () => void
  resetRecording: () => void
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const {
    onDataAvailable,
    onError,
    mimeType = 'audio/webm;codecs=opus',
  } = options

  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const pausedDurationRef = useRef<number>(0)

  const getSupportedMimeType = useCallback(() => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    return ''
  }, [])

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now() - pausedDurationRef.current * 1000
    timerRef.current = window.setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 100)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startRecording = useCallback(async () => {
    try {
      // Reset state
      chunksRef.current = []
      setAudioBlob(null)
      setDuration(0)
      pausedDurationRef.current = 0

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      streamRef.current = stream

      // Create MediaRecorder
      const selectedMimeType = getSupportedMimeType() || mimeType
      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        audioBitsPerSecond: 128000,
      })

      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
          onDataAvailable?.(event.data)
        }
      }

      recorder.onerror = (event) => {
        const error = new Error('Recording error')
        onError?.(error)
        console.error('MediaRecorder error:', event)
      }

      recorder.start(1000) // Collect data every second
      setIsRecording(true)
      setIsPaused(false)
      startTimer()
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to start recording')
      onError?.(err)
      throw err
    }
  }, [getSupportedMimeType, mimeType, onDataAvailable, onError, startTimer])

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current

      if (!recorder || recorder.state === 'inactive') {
        resolve(null)
        return
      }

      recorder.onstop = () => {
        // Create final blob
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)

        // Stop all tracks
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        mediaRecorderRef.current = null

        setIsRecording(false)
        setIsPaused(false)
        stopTimer()

        resolve(blob)
      }

      recorder.stop()
    })
  }, [stopTimer])

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === 'recording') {
      recorder.pause()
      setIsPaused(true)
      pausedDurationRef.current = duration
      stopTimer()
    }
  }, [duration, stopTimer])

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === 'paused') {
      recorder.resume()
      setIsPaused(false)
      startTimer()
    }
  }, [startTimer])

  const resetRecording = useCallback(() => {
    // Stop any ongoing recording
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }

    // Stop all tracks
    streamRef.current?.getTracks().forEach((track) => track.stop())

    // Reset refs
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []

    // Reset state
    setIsRecording(false)
    setIsPaused(false)
    setDuration(0)
    setAudioBlob(null)
    pausedDurationRef.current = 0
    stopTimer()
  }, [stopTimer])

  return {
    isRecording,
    isPaused,
    duration,
    audioBlob,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
  }
}
