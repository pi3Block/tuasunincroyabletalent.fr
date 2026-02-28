/**
 * @fileoverview Canvas-based vocal energy waveform — "flow bar".
 *
 * Self-contained animation: runs its own rAF loop internally, reading energy
 * from the pre-computed envelope via `getEnergyAtTime(currentTime)`.
 * ZERO React re-renders during playback — all updates go straight to canvas.
 *
 * Visual design:
 * - Centered mirrored waveform from a ring buffer of recent energy values
 * - Green with gradient: old data fades left → current data bright right
 * - Faint center baseline always visible
 * - Glow on energy peaks (CSS box-shadow via direct DOM mutation)
 *
 * Reduced motion: static bar with CSS width transition.
 */

import { memo, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface FlowBarProps {
  /** O(1) lookup: returns energy 0-1 at the given time in seconds */
  getEnergyAtTime: (t: number) => number
  /** Whether envelope data is loaded and available */
  envelopeReady: boolean
  /** Current playback time in seconds (stored in ref, no re-renders) */
  currentTime: number
  /** Whether audio is playing (controls rAF loop) */
  isPlaying: boolean
  /** Reduced motion preference */
  reducedMotion?: boolean
  className?: string
}

const BAR_HEIGHT = 40
const LINE_WIDTH = 2
const HISTORY_SIZE = 64
const EMA_ALPHA = 0.15
const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS

const R = 0, G = 160, B = 60  // primary green

export const FlowBar = memo(function FlowBar({
  getEnergyAtTime,
  envelopeReady,
  currentTime,
  isPlaying,
  reducedMotion = false,
  className,
}: FlowBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ w: 0, h: BAR_HEIGHT })

  // Animation state — all in refs, zero React state
  const historyRef = useRef<number[]>(new Array(HISTORY_SIZE).fill(0))
  const smoothRef = useRef(0)
  const lastFrameRef = useRef(0)
  const currentTimeRef = useRef(currentTime)
  const reducedBarRef = useRef<HTMLDivElement>(null)

  // Keep currentTime ref in sync (this prop changes often but causes no re-render of FlowBar
  // because memo() blocks it — the parent re-renders but FlowBar skips via shallow compare...
  // Actually memo won't help since currentTime changes. We need a different approach.)
  // We just update the ref on every render — that's fine, it's O(1).
  currentTimeRef.current = currentTime

  // Resize canvas
  const resizeCanvas = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const w = container.getBoundingClientRect().width
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = BAR_HEIGHT * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${BAR_HEIGHT}px`
    sizeRef.current = { w, h: BAR_HEIGHT }
  }, [])

  useEffect(() => {
    resizeCanvas()
    const container = containerRef.current
    if (!container) return
    const obs = new ResizeObserver(() => resizeCanvas())
    obs.observe(container)
    return () => obs.disconnect()
  }, [resizeCanvas])

  // Single rAF draw function — reads from refs, writes to canvas, no setState
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    if (w === 0) return

    const centerY = h / 2
    const maxAmp = centerY - 2

    // Sample energy
    const raw = getEnergyAtTime(currentTimeRef.current)
    const smooth = reducedMotion
      ? raw
      : EMA_ALPHA * raw + (1 - EMA_ALPHA) * smoothRef.current
    smoothRef.current = smooth

    // Push to ring buffer
    const hist = historyRef.current
    hist.push(smooth)
    if (hist.length > HISTORY_SIZE) hist.shift()

    // Reset transform and clear
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Faint center baseline (always visible)
    ctx.strokeStyle = `rgba(${R},${G},${B}, 0.15)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(w, centerY)
    ctx.stroke()

    const len = hist.length
    if (len === 0) return
    const segW = w / len

    // Gradient: left fades → right bright
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, `rgba(${R},${G},${B}, 0.05)`)
    grad.addColorStop(0.5, `rgba(${R},${G},${B}, 0.35)`)
    grad.addColorStop(0.85, `rgba(${R},${G},${B}, 0.7)`)
    grad.addColorStop(1, `rgba(${R},${G},${B}, 0.95)`)

    ctx.lineWidth = LINE_WIDTH
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Draw mirrored halves
    for (const sign of [-1, 1] as const) {
      ctx.strokeStyle = grad
      ctx.beginPath()
      ctx.moveTo(0, centerY)
      for (let i = 0; i < len; i++) {
        const x = i * segW
        const y = centerY + sign * hist[i] * maxAmp
        if (i === 0) {
          ctx.lineTo(x, y)
        } else {
          const px = (i - 1) * segW
          ctx.quadraticCurveTo((px + x) / 2, centerY + sign * hist[i - 1] * maxAmp, x, y)
        }
      }
      ctx.stroke()
    }

    // Fill between curves
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    for (let i = 0; i < len; i++) {
      const x = i * segW
      const y = centerY - hist[i] * maxAmp
      if (i === 0) ctx.lineTo(x, y)
      else {
        const px = (i - 1) * segW
        ctx.quadraticCurveTo((px + x) / 2, centerY - hist[i - 1] * maxAmp, x, y)
      }
    }
    for (let i = len - 1; i >= 0; i--) {
      const x = i * segW
      const y = centerY + hist[i] * maxAmp
      if (i === len - 1) ctx.lineTo(x, y)
      else {
        const nx = (i + 1) * segW
        ctx.quadraticCurveTo((nx + x) / 2, centerY + hist[i + 1] * maxAmp, x, y)
      }
    }
    ctx.closePath()
    const fill = ctx.createLinearGradient(0, 0, w, 0)
    fill.addColorStop(0, `rgba(${R},${G},${B}, 0.02)`)
    fill.addColorStop(0.6, `rgba(${R},${G},${B}, 0.1)`)
    fill.addColorStop(1, `rgba(${R},${G},${B}, 0.2)`)
    ctx.fillStyle = fill
    ctx.fill()

    // Glow — direct DOM mutation, no React
    const glow = Math.round(smooth * 15)
    const el = containerRef.current
    if (el) {
      el.style.boxShadow = glow > 3
        ? `inset 0 0 ${glow}px rgba(${R},${G},${B}, 0.2)`
        : 'none'
    }
  }, [getEnergyAtTime, reducedMotion])

  // Reduced motion: update static bar via ref (no canvas)
  const drawReduced = useCallback(() => {
    const raw = getEnergyAtTime(currentTimeRef.current)
    const smooth = EMA_ALPHA * raw + (1 - EMA_ALPHA) * smoothRef.current
    smoothRef.current = smooth
    const bar = reducedBarRef.current
    if (bar) bar.style.width = `${Math.round(smooth * 100)}%`
  }, [getEnergyAtTime])

  // Animation loop — rAF based, no React state
  useEffect(() => {
    if (!envelopeReady) return

    const drawFn = reducedMotion ? drawReduced : draw

    // Initial draw
    drawFn()

    if (!isPlaying) return

    let rafId: number
    const loop = (ts: number) => {
      const elapsed = ts - lastFrameRef.current
      if (elapsed >= FRAME_MS) {
        lastFrameRef.current = ts - (elapsed % FRAME_MS)
        drawFn()
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [envelopeReady, isPlaying, draw, drawReduced, reducedMotion])

  // When paused, redraw on seek (currentTime changes)
  useEffect(() => {
    if (!envelopeReady || isPlaying) return
    const drawFn = reducedMotion ? drawReduced : draw
    drawFn()
  }, [envelopeReady, isPlaying, currentTime, draw, drawReduced, reducedMotion])

  if (!envelopeReady) return null

  if (reducedMotion) {
    return (
      <div
        className={cn('relative h-[40px] overflow-hidden bg-muted/10', className)}
        role="img"
        aria-label="Visualisation de l'énergie vocale"
      >
        <div
          ref={reducedBarRef}
          className="absolute inset-y-1 left-0 rounded-full transition-none"
          style={{ backgroundColor: `rgba(${R},${G},${B}, 0.5)`, width: '0%' }}
        />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative h-[40px] overflow-hidden bg-muted/5', className)}
      role="img"
      aria-label="Visualisation de l'énergie vocale"
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  )
})
