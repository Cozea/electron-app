import {
  subscribeDesktopInteraction,
  type DesktopInteractionKind,
} from "../desktopInteraction/interactionStore"

export interface InteractionFrameMetrics {
  durationMs: number
  frameCount: number
  estimatedRefreshIntervalMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maximumMs: number
  intervalsOver16ms: number
  intervalsOver25ms: number
  intervalsOver33ms: number
  intervalsOver50ms: number
  estimatedMissedRefreshRatio: number
  activeKinds: DesktopInteractionKind[]
  timestamp: number
}

export interface CozeaInteractionPerfApi {
  getLastSample(): InteractionFrameMetrics | null
  getHistory(): readonly InteractionFrameMetrics[]
  clear(): void
}

declare global {
  interface Window {
    __cozeaInteractionPerf?: CozeaInteractionPerfApi
  }
}

const MAX_HISTORY_LENGTH = 100
const history: InteractionFrameMetrics[] = []
let lastSample: InteractionFrameMetrics | null = null
let initialized = false

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower
  return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(2))
}

function calculateMetrics(
  intervals: number[],
  durationMs: number,
  activeKinds: DesktopInteractionKind[],
): InteractionFrameMetrics {
  const frameCount = intervals.length
  if (frameCount === 0) {
    return {
      durationMs: Number(durationMs.toFixed(2)),
      frameCount: 0,
      estimatedRefreshIntervalMs: 16.67,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maximumMs: 0,
      intervalsOver16ms: 0,
      intervalsOver25ms: 0,
      intervalsOver33ms: 0,
      intervalsOver50ms: 0,
      estimatedMissedRefreshRatio: 0,
      activeKinds,
      timestamp: Date.now(),
    }
  }

  const sorted = intervals.slice().sort((a, b) => a - b)
  const p50 = computePercentile(sorted, 50)
  const p95 = computePercentile(sorted, 95)
  const p99 = computePercentile(sorted, 99)
  const maximum = Number(sorted[sorted.length - 1].toFixed(2))

  // Estimate refresh rate: <= 11ms -> 120Hz (8.33ms), <= 19ms -> 60Hz (16.67ms), otherwise p50
  let estimatedRefreshInterval = 16.67
  if (p50 <= 11) {
    estimatedRefreshInterval = 8.33
  } else if (p50 <= 19) {
    estimatedRefreshInterval = 16.67
  } else {
    estimatedRefreshInterval = Number(p50.toFixed(2))
  }

  let intervalsOver16ms = 0
  let intervalsOver25ms = 0
  let intervalsOver33ms = 0
  let intervalsOver50ms = 0
  let missedFrames = 0

  for (const interval of intervals) {
    if (interval > 16.67) intervalsOver16ms++
    if (interval > 25) intervalsOver25ms++
    if (interval > 33.33) intervalsOver33ms++
    if (interval > 50) intervalsOver50ms++

    if (interval > estimatedRefreshInterval * 1.5) {
      missedFrames += Math.max(0, Math.round(interval / estimatedRefreshInterval) - 1)
    }
  }

  const totalPossibleRefreshes = frameCount + missedFrames
  const estimatedMissedRefreshRatio =
    totalPossibleRefreshes > 0
      ? Number((missedFrames / totalPossibleRefreshes).toFixed(4))
      : 0

  return {
    durationMs: Number(durationMs.toFixed(2)),
    frameCount,
    estimatedRefreshIntervalMs: estimatedRefreshInterval,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    maximumMs: maximum,
    intervalsOver16ms,
    intervalsOver25ms,
    intervalsOver33ms,
    intervalsOver50ms,
    estimatedMissedRefreshRatio,
    activeKinds,
    timestamp: Date.now(),
  }
}

export function initInteractionFrameDiagnostics(): () => void {
  if (initialized) {
    return () => {}
  }
  initialized = true

  const isDev =
    typeof process !== "undefined"
      ? process.env?.NODE_ENV !== "production"
      : true

  const api: CozeaInteractionPerfApi = {
    getLastSample: () => lastSample,
    getHistory: () => history,
    clear: () => {
      history.length = 0
      lastSample = null
    },
  }

  if (typeof window !== "undefined") {
    window.__cozeaInteractionPerf = api
  }

  if (!isDev) {
    return () => {}
  }

  let isTracking = false
  let currentRafId: number | null = null
  let startTime = 0
  let lastFrameTime = 0
  const intervals: number[] = []
  const recordedKinds = new Set<DesktopInteractionKind>()

  const rAF =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number
  const cAF =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : (id: number) => clearTimeout(id as unknown as NodeJS.Timeout)

  function onFrame(now?: number) {
    if (!isTracking) return
    const currentTimestamp =
      typeof now === "number" && !Number.isNaN(now)
        ? now
        : typeof performance !== "undefined"
          ? performance.now()
          : Date.now()
    if (lastFrameTime > 0) {
      const delta = currentTimestamp - lastFrameTime
      if (delta > 0) {
        intervals.push(delta)
      }
    }
    lastFrameTime = currentTimestamp
    currentRafId = rAF(onFrame)
  }

  const unsubscribe = subscribeDesktopInteraction(activeKinds => {
    const active = activeKinds.size > 0

    if (active && !isTracking) {
      // Begin interaction recording
      isTracking = true
      intervals.length = 0
      recordedKinds.clear()
      for (const k of activeKinds) recordedKinds.add(k)
      startTime = typeof performance !== "undefined" ? performance.now() : Date.now()
      lastFrameTime = startTime
      currentRafId = rAF(onFrame)
    } else if (active && isTracking) {
      // Union any additional kinds that became active during this interaction
      for (const k of activeKinds) recordedKinds.add(k)
    } else if (!active && isTracking) {
      // Interaction ended: calculate sample
      isTracking = false
      if (currentRafId !== null) {
        cAF(currentRafId)
        currentRafId = null
      }
      const endTime = typeof performance !== "undefined" ? performance.now() : Date.now()
      const duration = Math.max(0, endTime - startTime)
      const sample = calculateMetrics(
        intervals,
        duration,
        Array.from(recordedKinds),
      )
      lastSample = sample
      history.push(sample)
      if (history.length > MAX_HISTORY_LENGTH) {
        history.shift()
      }
    }
  })

  return () => {
    unsubscribe()
    if (currentRafId !== null) {
      cAF(currentRafId)
      currentRafId = null
    }
    isTracking = false
    initialized = false
    if (typeof window !== "undefined" && window.__cozeaInteractionPerf === api) {
      delete window.__cozeaInteractionPerf
    }
  }
}
