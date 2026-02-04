import { app, contentTracing } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface PerfHistogram {
  buckets: number[]
  counts: number[]
  count: number
  sum: number
  max: number
}

export interface PerfMetric {
  name: string
  unit: 'ms'
  histogram: PerfHistogram
  tags?: Record<string, string>
}

export interface PerfBatch {
  sessionId: string
  source: 'renderer' | 'main'
  timestamp: number
  metrics: PerfMetric[]
  context?: Record<string, string>
}

interface PerfEnvelope extends PerfBatch {
  app: {
    name: string
    version: string
    platform: string
    arch: string
  }
  system?: {
    cpuPercent?: number
    memoryWorkingSetKb?: number
  }
}

interface PerfProfileEnvelope {
  sessionId: string
  timestamp: number
  source: 'main'
  traceBase64: string
  traceFormat: 'chromium-trace'
  context?: Record<string, string>
  app: PerfEnvelope['app']
  system?: PerfEnvelope['system']
}

function readEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export class PerformanceService {
  private static instance: PerformanceService
  private sessionId = randomUUID()
  private queue: PerfEnvelope[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isFlushing = false
  private profilingTimer: NodeJS.Timeout | null = null
  private profilingInFlight = false

  private metricsEndpoint = process.env.PERF_METRICS_URL
  private profilesEndpoint = process.env.PERF_PROFILES_URL || process.env.PERF_METRICS_URL
  private flushIntervalMs = readEnvNumber('PERF_METRICS_FLUSH_MS', 30000)
  private maxQueueSize = readEnvNumber('PERF_METRICS_MAX_QUEUE', 20)
  private profilingEnabled = process.env.PERF_PROFILING_ENABLED === 'true'
  private profilingSampleRate = readEnvNumber('PERF_PROFILING_SAMPLE_RATE', 0.02)
  private profilingIntervalMs = readEnvNumber('PERF_PROFILING_INTERVAL_MS', 5 * 60 * 1000)
  private profilingDurationMs = readEnvNumber('PERF_PROFILING_DURATION_MS', 10000)
  private profilingMaxBytes = readEnvNumber('PERF_PROFILING_MAX_BYTES', 10 * 1024 * 1024)

  static getInstance(): PerformanceService {
    if (!PerformanceService.instance) {
      PerformanceService.instance = new PerformanceService()
    }
    return PerformanceService.instance
  }

  start(): void {
    if (this.profilingEnabled) {
      this.startProfilingSampler()
    }
    app.on('before-quit', () => {
      void this.flush(true)
    })
  }

  reportRendererBatch(batch: PerfBatch): { success: boolean } {
    this.enqueue(batch)
    return { success: true }
  }

  recordMainMetric(name: string, value: number, tags?: Record<string, string>): void {
    const metric: PerfMetric = {
      name,
      unit: 'ms',
      histogram: {
        buckets: [],
        counts: [],
        count: 1,
        sum: value,
        max: value,
      },
      tags,
    }
    this.enqueue({
      sessionId: this.sessionId,
      source: 'main',
      timestamp: Date.now(),
      metrics: [metric],
    })
  }

  private enqueue(batch: PerfBatch): void {
    const envelope: PerfEnvelope = {
      ...batch,
      sessionId: batch.sessionId || this.sessionId,
      app: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      },
      system: this.getSystemMetrics(),
    }
    this.queue.push(envelope)
    if (this.queue.length >= this.maxQueueSize) {
      void this.flush()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        void this.flush()
      }, this.flushIntervalMs)
    }
  }

  private getSystemMetrics(): PerfEnvelope['system'] | undefined {
    try {
      const metrics = app.getAppMetrics()
      let cpuPercent = 0
      let memoryWorkingSetKb = 0
      for (const metric of metrics) {
        cpuPercent += metric.cpu?.percentCPUUsage ?? 0
        memoryWorkingSetKb += metric.memory?.workingSetSize ?? 0
      }
      return {
        cpuPercent: Number(cpuPercent.toFixed(2)),
        memoryWorkingSetKb,
      }
    } catch {
      return undefined
    }
  }

  private async flush(force = false): Promise<void> {
    if (this.isFlushing) return
    if (!force && this.queue.length === 0) return
    if (!this.metricsEndpoint) {
      return
    }
    const payload = { batches: this.queue.splice(0, this.queue.length) }

    this.isFlushing = true
    try {
      await fetch(this.metricsEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.warn('[Perf] Failed to flush metrics:', error)
    } finally {
      this.isFlushing = false
    }
  }

  private startProfilingSampler(): void {
    if (this.profilingTimer) return
    this.profilingTimer = setInterval(() => {
      void this.maybeCaptureProfile()
    }, this.profilingIntervalMs)
  }

  private async maybeCaptureProfile(): Promise<void> {
    if (this.profilingInFlight) return
    if (Math.random() > this.profilingSampleRate) return
    this.profilingInFlight = true

    try {
      const categories = await contentTracing.getCategories()
      const preferredCategories = [
        'disabled-by-default-v8.cpu_profiler',
        'disabled-by-default-v8.cpu_profiler.hires',
      ]
      const included = preferredCategories.filter((category) => categories.includes(category))
      if (included.length === 0) {
        included.push('v8')
      }

      await contentTracing.startRecording({
        included_categories: included,
        enable_argument_filter: true,
        recording_mode: 'record-until-full',
      })

      await new Promise((resolve) => setTimeout(resolve, this.profilingDurationMs))
      const tracePath = await contentTracing.stopRecording()
      await this.handleProfile(tracePath)
    } catch (error) {
      console.warn('[Perf] Profiling failed:', error)
    } finally {
      this.profilingInFlight = false
    }
  }

  private async handleProfile(tracePath: string): Promise<void> {
    try {
      const fileStats = await stat(tracePath)
      if (fileStats.size > this.profilingMaxBytes) {
        console.warn('[Perf] Trace skipped (too large):', fileStats.size)
        return
      }

      const traceBuffer = await readFile(tracePath)
      unlink(tracePath).catch(() => {})
      const traceBase64 = traceBuffer.toString('base64')
      const envelope: PerfProfileEnvelope = {
        sessionId: this.sessionId,
        timestamp: Date.now(),
        source: 'main',
        traceBase64,
        traceFormat: 'chromium-trace',
        app: {
          name: app.getName(),
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
        },
        system: this.getSystemMetrics(),
      }

      if (this.profilesEndpoint) {
        await fetch(this.profilesEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(envelope),
        })
        return
      }

      const fallbackDir = path.join(app.getPath('userData'), 'perf-profiles')
      await mkdir(fallbackDir, { recursive: true })
      const fileName = `profile-${Date.now()}.json`
      await writeFile(path.join(fallbackDir, fileName), JSON.stringify(envelope))
    } catch (error) {
      console.warn('[Perf] Failed to handle profile trace:', error)
    }
  }
}
