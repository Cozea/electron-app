export interface GeometryTask<T = unknown> {
  invalidate(): void
  dispose(): void
  readonly _phantom?: (measurement: T) => void
}

export interface GeometryTaskOptions<T> {
  name: string
  read: () => T | null
  write: (measurement: T) => void
}

interface InternalTask<T = any> {
  readonly id: number
  readonly name: string
  readonly read: () => T | null
  readonly write: (measurement: T) => void
  isDisposed: boolean
}

export interface GeometrySchedulerDiagnostics {
  frameCount: number
  invalidationCountByTask: Record<string, number>
  readCountByTask: Record<string, number>
  writeCountByTask: Record<string, number>
  lastFlushDurationMs: number
  maxFlushDurationMs: number
}

const isDev =
  typeof process !== "undefined"
    ? process.env?.NODE_ENV !== "production"
    : true

let nextTaskId = 1
const dirtyTasks = new Set<InternalTask>()
const afterFrameCallbacks = new Set<() => void>()
let pendingRafId: number | null = null

const diagnostics: GeometrySchedulerDiagnostics = {
  frameCount: 0,
  invalidationCountByTask: {},
  readCountByTask: {},
  writeCountByTask: {},
  lastFlushDurationMs: 0,
  maxFlushDurationMs: 0,
}

function getRaf(): (callback: FrameRequestCallback) => number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame
  }
  return (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number
}

function getCaf(): (handle: number) => void {
  if (typeof cancelAnimationFrame === "function") {
    return cancelAnimationFrame
  }
  return (id: number) => clearTimeout(id as unknown as NodeJS.Timeout)
}

function scheduleFrameIfNeeded(): void {
  if (pendingRafId !== null) return
  const rAF = getRaf()
  pendingRafId = rAF(() => {
    pendingRafId = null
    flush()
  })
}

function flush(): void {
  const startTime = typeof performance !== "undefined" ? performance.now() : 0

  // 1. Snapshot dirty tasks
  const tasksToProcess = Array.from(dirtyTasks)
  // 2. Clear dirty set
  dirtyTasks.clear()

  // 3. READ LOOP: call every task.read(), collect results, DO NOT call write yet
  const measurements = new Map<InternalTask, any>()

  for (const task of tasksToProcess) {
    if (task.isDisposed) continue
    try {
      if (isDev) {
        diagnostics.readCountByTask[task.name] =
          (diagnostics.readCountByTask[task.name] ?? 0) + 1
      }
      const measurement = task.read()
      if (measurement !== null) {
        measurements.set(task, measurement)
      }
    } catch (error) {
      console.error(`[geometryScheduler] Error in read for "${task.name}":`, error)
    }
  }

  // 4. WRITE LOOP: call every task.write(measurement)
  for (const [task, measurement] of measurements.entries()) {
    if (task.isDisposed) continue
    try {
      if (isDev) {
        diagnostics.writeCountByTask[task.name] =
          (diagnostics.writeCountByTask[task.name] ?? 0) + 1
      }
      task.write(measurement)
    } catch (error) {
      console.error(`[geometryScheduler] Error in write for "${task.name}":`, error)
    }
  }

  // 5. Run after-frame callbacks
  if (afterFrameCallbacks.size > 0) {
    const callbacks = Array.from(afterFrameCallbacks)
    afterFrameCallbacks.clear()
    for (const callback of callbacks) {
      try {
        callback()
      } catch (error) {
        console.error("[geometryScheduler] Error in after-frame callback:", error)
      }
    }
  }

  // Record diagnostics
  if (isDev) {
    diagnostics.frameCount++
    const endTime = typeof performance !== "undefined" ? performance.now() : 0
    const duration = Math.max(0, endTime - startTime)
    diagnostics.lastFlushDurationMs = duration
    diagnostics.maxFlushDurationMs = Math.max(diagnostics.maxFlushDurationMs, duration)
  }

  // 6. If anything invalidated itself during this frame: schedule another frame
  if (dirtyTasks.size > 0 || afterFrameCallbacks.size > 0) {
    scheduleFrameIfNeeded()
  }
}

export function registerGeometryTask<T>(
  options: GeometryTaskOptions<T>,
): GeometryTask<T> {
  const internalTask: InternalTask<T> = {
    id: nextTaskId++,
    name: options.name,
    read: options.read,
    write: options.write,
    isDisposed: false,
  }

  return {
    invalidate() {
      if (internalTask.isDisposed) return
      dirtyTasks.add(internalTask)
      if (isDev) {
        diagnostics.invalidationCountByTask[options.name] =
          (diagnostics.invalidationCountByTask[options.name] ?? 0) + 1
      }
      scheduleFrameIfNeeded()
    },
    dispose() {
      if (internalTask.isDisposed) return
      internalTask.isDisposed = true
      dirtyTasks.delete(internalTask)
    },
  }
}

export function scheduleAfterGeometryFrame(callback: () => void): void {
  afterFrameCallbacks.add(callback)
  scheduleFrameIfNeeded()
}

export function getGeometrySchedulerDiagnostics(): GeometrySchedulerDiagnostics {
  return {
    frameCount: diagnostics.frameCount,
    invalidationCountByTask: { ...diagnostics.invalidationCountByTask },
    readCountByTask: { ...diagnostics.readCountByTask },
    writeCountByTask: { ...diagnostics.writeCountByTask },
    lastFlushDurationMs: diagnostics.lastFlushDurationMs,
    maxFlushDurationMs: diagnostics.maxFlushDurationMs,
  }
}

export function resetGeometrySchedulerDiagnostics(): void {
  diagnostics.frameCount = 0
  diagnostics.invalidationCountByTask = {}
  diagnostics.readCountByTask = {}
  diagnostics.writeCountByTask = {}
  diagnostics.lastFlushDurationMs = 0
  diagnostics.maxFlushDurationMs = 0
}

/** Testing helper to reset scheduler state */
export function _resetGeometrySchedulerForTesting(): void {
  if (pendingRafId !== null) {
    getCaf()(pendingRafId)
    pendingRafId = null
  }
  dirtyTasks.clear()
  afterFrameCallbacks.clear()
  resetGeometrySchedulerDiagnostics()
}
