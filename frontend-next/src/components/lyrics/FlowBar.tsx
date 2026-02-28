/**
 * @fileoverview Canvas-based vocal energy waveform — "flow bar".
 *
 * Renders a breathing waveform visualization from the singer's vocal energy.
 * Placed between the lyrics header and ScrollArea in LyricsDisplayPro.
 *
 * Visual design:
 * - Centered waveform (mirrored top/bottom) from energyHistory ring buffer
 * - Primary green color with opacity proportional to energy
 * - Left→right gradient: old data fades out, current data is bright
 * - Smooth curves via quadraticCurveTo
 * - Glow effect on energy peaks (CSS box-shadow)
 *
 * Reduced motion: static horizontal bar with CSS width transition.
 * Accessibility: role="img" with descriptive aria-label.
 */

import { memo, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { FlowVisualizationState } from '@/hooks/useFlowVisualization'

interface FlowBarProps {
  flow: FlowVisualizationState
  className?: string
  reducedMotion?: boolean
}

// Drawing constants
const BAR_HEIGHT = 40
const LINE_WIDTH = 2
// oklch(0.55 0.2 145) ≈ rgb(0, 160, 60) — app's primary green
const WAVE_COLOR_R = 0
const WAVE_COLOR_G = 160
const WAVE_COLOR_B = 60

export const FlowBar = memo(function FlowBar({
  flow,
  className,
  reducedMotion = false,
}: FlowBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Resize canvas to match container width (pixel-perfect)
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = BAR_HEIGHT * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${BAR_HEIGHT}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Draw waveform
  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = BAR_HEIGHT
    const centerY = h / 2
    const history = flow.energyHistory
    if (history.length === 0) return

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Draw mirrored waveform
    const len = history.length
    const segmentWidth = w / len

    // Create gradient for fade-in effect (left transparent → right bright)
    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    gradient.addColorStop(0, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.05)`)
    gradient.addColorStop(0.5, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.3)`)
    gradient.addColorStop(0.85, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.7)`)
    gradient.addColorStop(1, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.9)`)

    ctx.strokeStyle = gradient
    ctx.lineWidth = LINE_WIDTH
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Top half (positive amplitude)
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    for (let i = 0; i < len; i++) {
      const x = i * segmentWidth
      const amplitude = history[i] * (centerY - 2)
      const y = centerY - amplitude
      if (i === 0) {
        ctx.lineTo(x, y)
      } else {
        const prevX = (i - 1) * segmentWidth
        const cpX = (prevX + x) / 2
        ctx.quadraticCurveTo(cpX, centerY - history[i - 1] * (centerY - 2), x, y)
      }
    }
    ctx.stroke()

    // Bottom half (mirrored)
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    for (let i = 0; i < len; i++) {
      const x = i * segmentWidth
      const amplitude = history[i] * (centerY - 2)
      const y = centerY + amplitude
      if (i === 0) {
        ctx.lineTo(x, y)
      } else {
        const prevX = (i - 1) * segmentWidth
        const cpX = (prevX + x) / 2
        ctx.quadraticCurveTo(cpX, centerY + history[i - 1] * (centerY - 2), x, y)
      }
    }
    ctx.stroke()

    // Fill between the two curves (subtle)
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    // Top edge
    for (let i = 0; i < len; i++) {
      const x = i * segmentWidth
      const y = centerY - history[i] * (centerY - 2)
      if (i === 0) ctx.lineTo(x, y)
      else {
        const prevX = (i - 1) * segmentWidth
        ctx.quadraticCurveTo(
          (prevX + x) / 2,
          centerY - history[i - 1] * (centerY - 2),
          x,
          y,
        )
      }
    }
    // Bottom edge (reverse)
    for (let i = len - 1; i >= 0; i--) {
      const x = i * segmentWidth
      const y = centerY + history[i] * (centerY - 2)
      if (i === len - 1) ctx.lineTo(x, y)
      else {
        const nextX = (i + 1) * segmentWidth
        ctx.quadraticCurveTo(
          (nextX + x) / 2,
          centerY + history[i + 1] * (centerY - 2),
          x,
          y,
        )
      }
    }
    ctx.closePath()

    const fillGradient = ctx.createLinearGradient(0, 0, w, 0)
    fillGradient.addColorStop(0, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.01)`)
    fillGradient.addColorStop(0.6, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.08)`)
    fillGradient.addColorStop(1, `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.15)`)
    ctx.fillStyle = fillGradient
    ctx.fill()
  }, [flow.energyHistory, reducedMotion])

  // Glow intensity based on current smooth energy
  const glowIntensity = Math.round(flow.smoothEnergy * 12)

  if (reducedMotion) {
    // Static bar fallback
    return (
      <div
        className={cn('relative h-[40px] overflow-hidden', className)}
        role="img"
        aria-label="Visualisation de l'énergie vocale"
      >
        <div
          className="absolute inset-y-1 left-0 rounded-full transition-[width] duration-300 ease-out"
          style={{
            width: `${Math.round(flow.smoothEnergy * 100)}%`,
            backgroundColor: `rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.5)`,
          }}
        />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative h-[40px] overflow-hidden', className)}
      role="img"
      aria-label="Visualisation de l'énergie vocale"
      style={{
        boxShadow: glowIntensity > 2
          ? `inset 0 0 ${glowIntensity}px rgba(${WAVE_COLOR_R},${WAVE_COLOR_G},${WAVE_COLOR_B}, 0.15)`
          : 'none',
      }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  )
})
