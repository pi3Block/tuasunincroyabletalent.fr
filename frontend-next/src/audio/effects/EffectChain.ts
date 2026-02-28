/**
 * EffectChain — manages Tone.js effect nodes for a single track.
 *
 * Inserts between the native StereoPannerNode and AnalyserNode in TrackProcessor.
 * Tone.js is loaded lazily on first enable (dynamic import, ~150KB).
 *
 * Signal path when effects are active:
 *   PannerNode → [bridgeIn] → [PitchShift?] → [Reverb?] → [Compressor?] → [bridgeOut] → AnalyserNode
 *
 * bridgeIn / bridgeOut are Tone.Gain(1) nodes whose .input/.output are native
 * GainNodes created from the same AudioContext — this is how we cross between
 * the native Web Audio world and the Tone.js world without "Overload resolution
 * failed" errors.  Native AudioNode.connect() only accepts AudioNode | AudioParam,
 * NOT Tone.js ToneAudioNode wrappers.
 *
 * When all effects are disabled:
 *   PannerNode → AnalyserNode  (direct, zero overhead)
 */
import type {
  EffectType,
  EffectParams,
  PitchShiftParams,
  ReverbParams,
  CompressorParams,
} from './types'

// Tone.js types (lazy loaded)
type ToneModule = typeof import('tone')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToneEffect = any // PitchShift | Reverb | Compressor instances

let toneModule: ToneModule | null = null
let toneLoadPromise: Promise<ToneModule> | null = null

async function ensureToneLoaded(context: AudioContext): Promise<ToneModule> {
  if (toneModule) return toneModule
  if (!toneLoadPromise) {
    toneLoadPromise = import('tone').then((mod) => {
      mod.setContext(context)
      toneModule = mod
      return mod
    })
  }
  return toneLoadPromise
}

export class EffectChain {
  private context: AudioContext
  private inputNode: StereoPannerNode   // panner output
  private outputNode: AnalyserNode      // analyser input

  private pitchShift: ToneEffect | null = null
  private reverb: ToneEffect | null = null
  private compressor: ToneEffect | null = null

  // Bridge gains for native ↔ Tone.js interop.
  // Tone.Gain wraps a native GainNode (.input/.output are native GainNodes)
  // created from the same AudioContext (via Tone.setContext), so native
  // connect() works on both sides.
  private bridgeIn: ToneEffect | null = null
  private bridgeOut: ToneEffect | null = null

  private enabledEffects = new Set<EffectType>()
  private disposed = false

  constructor(
    context: AudioContext,
    inputNode: StereoPannerNode,
    outputNode: AnalyserNode,
  ) {
    this.context = context
    this.inputNode = inputNode
    this.outputNode = outputNode
  }

  /** Enable an effect and apply initial parameters. */
  async enable(type: EffectType, params: EffectParams): Promise<void> {
    if (this.disposed) return
    const Tone = await ensureToneLoaded(this.context)

    // Create bridge gains on first enable (lazy, only when Tone.js is loaded)
    if (!this.bridgeIn) {
      this.bridgeIn = new Tone.Gain(1)
      this.bridgeOut = new Tone.Gain(1)
    }

    if (type === 'pitchShift' && !this.pitchShift) {
      const p = params as PitchShiftParams
      this.pitchShift = new Tone.PitchShift({ pitch: p.semitones })
    }

    if (type === 'reverb' && !this.reverb) {
      const p = params as ReverbParams
      this.reverb = new Tone.Reverb({ decay: p.decay })
      this.reverb.wet.value = p.wet
      // Reverb needs to generate its impulse response
      await this.reverb.generate()
    }

    if (type === 'compressor' && !this.compressor) {
      const p = params as CompressorParams
      this.compressor = new Tone.Compressor({
        threshold: p.threshold,
        ratio: p.ratio,
      })
    }

    this.enabledEffects.add(type)
    this.rebuildChain()
  }

  /** Disable an effect (node kept for quick re-enable). */
  disable(type: EffectType): void {
    if (!this.enabledEffects.has(type)) return
    this.enabledEffects.delete(type)
    this.rebuildChain()
  }

  /** Update parameters on a live effect. */
  async updateParams(type: EffectType, params: EffectParams): Promise<void> {
    if (this.disposed) return

    if (type === 'pitchShift' && this.pitchShift) {
      const p = params as PitchShiftParams
      this.pitchShift.pitch = p.semitones
    }

    if (type === 'reverb' && this.reverb) {
      const p = params as ReverbParams
      const decayChanged = this.reverb.decay !== p.decay
      this.reverb.wet.value = p.wet
      if (decayChanged) {
        this.reverb.decay = p.decay
        await this.reverb.generate()
      }
    }

    if (type === 'compressor' && this.compressor) {
      const p = params as CompressorParams
      this.compressor.threshold.value = p.threshold
      this.compressor.ratio.value = p.ratio
    }
  }

  /** Whether any effect is currently enabled. */
  get hasActiveEffects(): boolean {
    return this.enabledEffects.size > 0
  }

  /**
   * Rebuild the audio routing between inputNode and outputNode.
   * Only enabled effects are inserted; disabled ones are bypassed.
   *
   * Bridge pattern for native ↔ Tone.js interop:
   *   nativePanner.connect(bridgeIn.input)   — both native GainNodes, same context
   *   bridgeIn.connect(effect1)              — Tone→Tone (Tone's .connect handles this)
   *   effect1.connect(effect2)               — Tone→Tone
   *   effectN.connect(bridgeOut)             — Tone→Tone
   *   bridgeOut.output.connect(nativeAnalyser) — both native GainNodes, same context
   */
  private rebuildChain(): void {
    // Disconnect everything from inputNode
    try { this.inputNode.disconnect() } catch { /* already disconnected */ }

    // Disconnect existing Tone nodes from each other
    for (const node of [this.bridgeIn, this.pitchShift, this.reverb, this.compressor, this.bridgeOut]) {
      if (node) try { node.disconnect() } catch { /* ok */ }
    }

    // Collect enabled effects in order
    const chain: ToneEffect[] = []
    if (this.enabledEffects.has('pitchShift') && this.pitchShift) chain.push(this.pitchShift)
    if (this.enabledEffects.has('reverb') && this.reverb) chain.push(this.reverb)
    if (this.enabledEffects.has('compressor') && this.compressor) chain.push(this.compressor)

    if (chain.length === 0 || !this.bridgeIn || !this.bridgeOut) {
      // No effects or bridges not ready — direct connection (zero overhead)
      this.inputNode.connect(this.outputNode)
      return
    }

    // 1) Native panner → bridge input (native GainNode → native GainNode)
    this.inputNode.connect(this.bridgeIn.input)

    // 2) Bridge input → first Tone.js effect (Tone→Tone)
    this.bridgeIn.connect(chain[0])

    // 3) Chain Tone.js effects together (Tone→Tone)
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].connect(chain[i + 1])
    }

    // 4) Last effect → bridge output (Tone→Tone)
    chain[chain.length - 1].connect(this.bridgeOut)

    // 5) Bridge output → native analyser (native GainNode → native AnalyserNode)
    this.bridgeOut.output.connect(this.outputNode)
  }

  /** Clean up all Tone.js nodes. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    try { this.inputNode.disconnect() } catch { /* ok */ }

    for (const node of [this.bridgeIn, this.pitchShift, this.reverb, this.compressor, this.bridgeOut]) {
      if (node) {
        try { node.disconnect() } catch { /* ok */ }
        try { node.dispose() } catch { /* ok */ }
      }
    }

    this.bridgeIn = null
    this.bridgeOut = null
    this.pitchShift = null
    this.reverb = null
    this.compressor = null
    this.enabledEffects.clear()

    // Restore direct connection
    try { this.inputNode.connect(this.outputNode) } catch { /* ok */ }
  }
}
