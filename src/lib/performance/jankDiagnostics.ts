import { featureFlags } from '@/lib/featureFlags'

interface LongAnimationFrameScriptAttribution {
  sourceURL?: string
  sourceFunctionName?: string
  duration?: number
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  duration: number
  startTime: number
  scripts?: LongAnimationFrameScriptAttribution[]
}

let initialized = false

function observeLongAnimationFrames(): void {
  if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
    return
  }

  const observer = new PerformanceObserver((list) => {
    const entries = list.getEntries() as LongAnimationFrameEntry[]
    for (const entry of entries) {
      const scripts = (entry.scripts ?? [])
        .slice()
        .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
        .slice(0, 3)
      const route = window.location.pathname
      console.groupCollapsed(
        `[Jank][LoAF] ${entry.duration.toFixed(1)}ms on ${route}`
      )
      console.log('startTime', entry.startTime.toFixed(1))
      console.log('duration', entry.duration.toFixed(1))
      if (scripts.length > 0) {
        console.table(
          scripts.map((script) => ({
            file: script.sourceURL ?? '(unknown)',
            fn: script.sourceFunctionName ?? '(anonymous)',
            duration: Number((script.duration ?? 0).toFixed(1)),
          }))
        )
      }
      console.groupEnd()
    }
  })

  observer.observe({ type: 'long-animation-frame', buffered: true })
}

function observeLongTasks(): void {
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < 50) continue
      console.debug(
        `[Jank][LongTask] ${entry.duration.toFixed(1)}ms route=${window.location.pathname}`
      )
    }
  })
  observer.observe({ type: 'longtask', buffered: true })
}

export function initJankDiagnostics(): void {
  if (initialized) return
  initialized = true

  if (!import.meta.env.DEV) return
  if (!featureFlags.jankDiagnostics) return
  if (!('PerformanceObserver' in window)) return

  observeLongAnimationFrames()
  observeLongTasks()
  console.info('[Jank] Diagnostics enabled (LoAF + longtask)')
}
