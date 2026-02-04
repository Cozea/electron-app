const HISTOGRAM_BUCKETS_MS = [16, 32, 50, 100, 200, 500, 1000, 2000, 5000]
const FLUSH_INTERVAL_MS = 30000
const EVENT_SAMPLE_RATE = 0.2
const LONG_TASK_SAMPLE_RATE = 1
const MEASURE_SAMPLE_RATE = 1

interface PerfHistogram {
  buckets: number[]
  counts: number[]
  count: number
  sum: number
  max: number
}

interface PerfMetric {
  name: string
  unit: 'ms'
  histogram: PerfHistogram
  tags?: Record<string, string>
}

interface PerfBatch {
  sessionId: string
  source: 'renderer'
  timestamp: number
  metrics: PerfMetric[]
  context?: Record<string, string>
}

const EVENT_TYPES_TO_TRACK = new Set(['click', 'pointerdown', 'keydown', 'input'])

let initialized = false
let metrics = new Map<string, PerfMetric>()
const sessionId = createSessionId()

function createSessionId(): string {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function createHistogram(): PerfHistogram {
  return {
    buckets: [...HISTOGRAM_BUCKETS_MS],
    counts: new Array(HISTOGRAM_BUCKETS_MS.length + 1).fill(0),
    count: 0,
    sum: 0,
    max: 0,
  }
}

function buildMetricKey(name: string, tags?: Record<string, string>): string {
  if (!tags) return name
  const entries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))
  return `${name}|${entries.map(([key, value]) => `${key}=${value}`).join(',')}`
}

function getMetric(name: string, tags?: Record<string, string>): PerfMetric {
  const key = buildMetricKey(name, tags)
  const existing = metrics.get(key)
  if (existing) return existing
  const metric: PerfMetric = {
    name,
    unit: 'ms',
    histogram: createHistogram(),
    tags,
  }
  metrics.set(key, metric)
  return metric
}

function recordValue(metric: PerfMetric, value: number): void {
  const normalized = Math.max(0, value)
  const histogram = metric.histogram
  histogram.count += 1
  histogram.sum += normalized
  histogram.max = Math.max(histogram.max, normalized)

  let bucketIndex = HISTOGRAM_BUCKETS_MS.findIndex((bucket) => normalized <= bucket)
  if (bucketIndex === -1) bucketIndex = HISTOGRAM_BUCKETS_MS.length
  histogram.counts[bucketIndex] += 1
}

function shouldSample(rate: number): boolean {
  if (rate >= 1) return true
  if (rate <= 0) return false
  return Math.random() < rate
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function recordMetric(name: string, value: number, tags?: Record<string, string>): void {
  const metric = getMetric(name, tags)
  recordValue(metric, value)
}

function flushMetrics(reason?: string): void {
  if (metrics.size === 0) return
  const metricsSnapshot = Array.from(metrics.values())
  metrics = new Map()

  const payload: PerfBatch = {
    sessionId,
    source: 'renderer',
    timestamp: Date.now(),
    metrics: metricsSnapshot,
    context: {
      route: window.location.pathname,
      ...(reason ? { reason } : {}),
    },
  }

  if (window.electronAPI?.performance?.report) {
    window.electronAPI.performance.report(payload).catch(() => {})
  }
}

function observeEvents(): void {
  if (!PerformanceObserver.supportedEntryTypes.includes('event')) return
  if (typeof PerformanceEventTiming === 'undefined') return
  const observer = new PerformanceObserver((list) => {
    if (!shouldSample(EVENT_SAMPLE_RATE)) return
    for (const entry of list.getEntries()) {
      if (!(entry instanceof PerformanceEventTiming)) continue
      if (!EVENT_TYPES_TO_TRACK.has(entry.name)) continue
      const inputDelay = entry.processingStart
        ? entry.processingStart - entry.startTime
        : entry.duration
      recordMetric('input.delay', inputDelay, { event: entry.name })
    }
  })

  const eventObserverOptions: PerformanceObserverInit & { durationThreshold?: number } = {
    type: 'event',
    buffered: true,
    durationThreshold: 16,
  }
  observer.observe(eventObserverOptions)
}

function observeLongTasks(): void {
  if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return
  const observer = new PerformanceObserver((list) => {
    if (!shouldSample(LONG_TASK_SAMPLE_RATE)) return
    for (const entry of list.getEntries()) {
      recordMetric('longtask.duration', entry.duration)
    }
  })

  observer.observe({ type: 'longtask', buffered: true })
}

function observeMeasures(): void {
  if (!PerformanceObserver.supportedEntryTypes.includes('measure')) return
  const observer = new PerformanceObserver((list) => {
    if (!shouldSample(MEASURE_SAMPLE_RATE)) return
    for (const entry of list.getEntries()) {
      recordMetric(`measure.${sanitizeMetricName(entry.name)}`, entry.duration)
    }
  })

  observer.observe({ type: 'measure', buffered: true })
}

export function initPerformanceMonitoring(): void {
  if (initialized) return
  initialized = true

  if (!('PerformanceObserver' in window)) return

  observeEvents()
  observeLongTasks()
  observeMeasures()

  window.setInterval(() => flushMetrics('interval'), FLUSH_INTERVAL_MS)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushMetrics('visibility-hidden')
    }
  })
  window.addEventListener('beforeunload', () => flushMetrics('unload'))
}

export function markAppRendered(): void {
  if (!('performance' in window)) return
  performance.mark('app.rendered')
  try {
    performance.measure('app.startup.to_render', 'app.render.start', 'app.rendered')
  } catch {
    // Ignore missing marks
  }
}
