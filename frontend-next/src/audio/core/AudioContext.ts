/**
 * Singleton AudioContext manager.
 * Ensures single AudioContext instance across the app.
 * Handles browser autoplay policy by resuming context on user interaction.
 */

let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null

/**
 * Get or create the shared AudioContext instance.
 */
export function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    masterGain = audioContext.createGain()
    masterGain.connect(audioContext.destination)
  }
  return audioContext
}

/**
 * Get the master gain node for global volume control.
 */
export function getMasterGain(): GainNode {
  if (!masterGain) {
    getAudioContext()
  }
  return masterGain!
}

/**
 * Set master volume (0-1).
 */
export function setMasterVolume(volume: number): void {
  const gain = getMasterGain()
  const ctx = getAudioContext()
  gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), ctx.currentTime)
}

/**
 * Ensure AudioContext is running (handles autoplay policy).
 * Must be called from a user gesture handler.
 */
export async function ensureAudioContextRunning(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
}

/**
 * Check if AudioContext is available and running.
 */
export function isAudioContextRunning(): boolean {
  return audioContext !== null && audioContext.state === 'running'
}

/**
 * Get current AudioContext state.
 */
export function getAudioContextState(): AudioContextState | 'uninitialized' {
  return audioContext ? audioContext.state : 'uninitialized'
}

/**
 * Close and cleanup AudioContext.
 */
export function closeAudioContext(): void {
  if (audioContext) {
    audioContext.close()
    audioContext = null
    masterGain = null
  }
}
