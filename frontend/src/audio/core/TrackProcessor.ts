/**
 * TrackProcessor - Web Audio API node chain for a single track.
 *
 * Signal chain:
 * Source -> GainNode (volume) -> StereoPannerNode -> AnalyserNode -> MasterGain -> Destination
 */
import { getAudioContext, getMasterGain } from './AudioContext'

export class TrackProcessor {
  private context: AudioContext
  private sourceNode: MediaElementAudioSourceNode | null = null
  private gainNode: GainNode
  private pannerNode: StereoPannerNode
  private analyserNode: AnalyserNode
  private audioElement: HTMLAudioElement | null = null
  private connected: boolean = false
  private currentVolume: number = 1

  constructor() {
    this.context = getAudioContext()

    // Create nodes
    this.gainNode = this.context.createGain()
    this.pannerNode = this.context.createStereoPanner()
    this.analyserNode = this.context.createAnalyser()
    this.analyserNode.fftSize = 256

    // Connect basic chain: gain -> panner -> analyser -> master
    this.gainNode.connect(this.pannerNode)
    this.pannerNode.connect(this.analyserNode)
    this.analyserNode.connect(getMasterGain())

    this.connected = true
  }

  /**
   * Connect an HTML Audio Element as source.
   * Used with Wavesurfer.js or direct audio playback.
   */
  connectAudioElement(audio: HTMLAudioElement): void {
    if (this.sourceNode) {
      // Already connected, skip
      return
    }

    this.audioElement = audio
    this.sourceNode = this.context.createMediaElementSource(audio)
    this.sourceNode.connect(this.gainNode)
  }

  /**
   * Get the connected audio element.
   */
  getAudioElement(): HTMLAudioElement | null {
    return this.audioElement
  }

  /**
   * Set volume control (0-1).
   */
  setVolume(value: number): void {
    this.currentVolume = Math.max(0, Math.min(1, value))
    this.gainNode.gain.setValueAtTime(this.currentVolume, this.context.currentTime)
  }

  /**
   * Get current volume.
   */
  getVolume(): number {
    return this.currentVolume
  }

  /**
   * Set pan control (-1 to 1).
   */
  setPan(value: number): void {
    this.pannerNode.pan.setValueAtTime(
      Math.max(-1, Math.min(1, value)),
      this.context.currentTime
    )
  }

  /**
   * Mute (sets gain to 0 without changing volume state).
   */
  mute(): void {
    this.gainNode.gain.setValueAtTime(0, this.context.currentTime)
  }

  /**
   * Unmute (restores previous volume).
   */
  unmute(): void {
    this.gainNode.gain.setValueAtTime(this.currentVolume, this.context.currentTime)
  }

  /**
   * Get frequency data for visualization.
   */
  getFrequencyData(): Uint8Array {
    const data = new Uint8Array(this.analyserNode.frequencyBinCount)
    this.analyserNode.getByteFrequencyData(data)
    return data
  }

  /**
   * Get time domain data for waveform.
   */
  getTimeDomainData(): Uint8Array {
    const data = new Uint8Array(this.analyserNode.fftSize)
    this.analyserNode.getByteTimeDomainData(data)
    return data
  }

  /**
   * Get average volume level (for meters).
   */
  getAverageLevel(): number {
    const data = this.getFrequencyData()
    const sum = data.reduce((a, b) => a + b, 0)
    return sum / data.length / 255
  }

  /**
   * Check if processor is connected.
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Cleanup and dispose of all nodes.
   */
  dispose(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    this.gainNode.disconnect()
    this.pannerNode.disconnect()
    this.analyserNode.disconnect()
    this.audioElement = null
    this.connected = false
  }
}
