/**
 * Sound Wave Candles Audio Visualizer.
 *
 * Symmetrical 4-candle audio visualizer designed for microphone pills.
 * Expands and contracts from the vertical center axis with rounded pill caps.
 *
 * Directly driven by real frequency bin data from the Web Audio AnalyserNode.
 * Zero procedural math simulation, zero fake fallbacks.
 * Directly updates CSS custom properties via requestAnimationFrame.
 */

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export interface SoundWaveCandlesProps {
  analyser?: AnalyserNode | null
  isMuted?: boolean
  isSpeaking?: boolean
  className?: string
}

export function SoundWaveCandles({
  analyser = null,
  isMuted = false,
  className,
}: SoundWaveCandlesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const smoothedHeightsRef = useRef<number[]>([3, 3, 3, 3])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const MIN_HEIGHT = 3
    const MAX_HEIGHT = 14
    const LERP_FACTOR = 0.28 // Smooth organic decay for natural voice physics

    if (isMuted || !analyser) {
      // Idle / muted / no hardware analyser: strictly set all candles to resting baseline dots
      smoothedHeightsRef.current = [MIN_HEIGHT, MIN_HEIGHT, MIN_HEIGHT, MIN_HEIGHT]
      el.style.setProperty("--h0", `${MIN_HEIGHT}px`)
      el.style.setProperty("--h1", `${MIN_HEIGHT}px`)
      el.style.setProperty("--h2", `${MIN_HEIGHT}px`)
      el.style.setProperty("--h3", `${MIN_HEIGHT}px`)
      return
    }

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    // Voice frequency bands (~100Hz - 3kHz):
    // Band 0: Lows (~100–250 Hz)
    // Band 1: Low-mids (~250–800 Hz)
    // Band 2: Mid-highs (~800–2000 Hz)
    // Band 3: Highs (~2000–3500 Hz)
    const bandSlices = [
      [2, 8],
      [8, 20],
      [20, 48],
      [48, 96],
    ] as const

    const renderFrame = () => {
      const targetHeights = [MIN_HEIGHT, MIN_HEIGHT, MIN_HEIGHT, MIN_HEIGHT]

      analyser.getByteFrequencyData(dataArray)

      for (let i = 0; i < 4; i++) {
        const [start, end] = bandSlices[i]
        let sum = 0
        let count = 0
        for (let j = start; j < end && j < dataArray.length; j++) {
          sum += dataArray[j]
          count++
        }
        const avg = count > 0 ? sum / count : 0
        // Real acoustic threshold: ignore noise floor (< 15 out of 255)
        const normalized = Math.min(1, Math.max(0, (avg - 15) / 140))
        targetHeights[i] = MIN_HEIGHT + normalized * (MAX_HEIGHT - MIN_HEIGHT)
      }

      // Apply lerp smoothing directly from live hardware frequency data
      for (let i = 0; i < 4; i++) {
        smoothedHeightsRef.current[i] += (targetHeights[i] - smoothedHeightsRef.current[i]) * LERP_FACTOR
        el.style.setProperty(`--h${i}`, `${smoothedHeightsRef.current[i].toFixed(1)}px`)
      }

      animFrameRef.current = requestAnimationFrame(renderFrame)
    }

    animFrameRef.current = requestAnimationFrame(renderFrame)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [analyser, isMuted])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-soundwave-candles
      className={cn("flex items-center justify-center gap-[2.5px] h-3.5 px-0.5", className)}
      style={
        {
          "--h0": "3px",
          "--h1": "3px",
          "--h2": "3px",
          "--h3": "3px",
        } as React.CSSProperties
      }
    >
      <span
        className="w-[2px] rounded-full bg-current opacity-90 transition-[height] duration-75 ease-out shrink-0"
        style={{ height: "var(--h0, 3px)" }}
      />
      <span
        className="w-[2px] rounded-full bg-current transition-[height] duration-75 ease-out shrink-0"
        style={{ height: "var(--h1, 3px)" }}
      />
      <span
        className="w-[2px] rounded-full bg-current transition-[height] duration-75 ease-out shrink-0"
        style={{ height: "var(--h2, 3px)" }}
      />
      <span
        className="w-[2px] rounded-full bg-current opacity-90 transition-[height] duration-75 ease-out shrink-0"
        style={{ height: "var(--h3, 3px)" }}
      />
    </div>
  )
}
