export type DevServerLifecycleState = 'idle' | 'starting' | 'ready' | 'unhealthy' | 'stopped' | 'error'

export interface DevServerLifecycleSnapshot {
  runId: string | null
  state: DevServerLifecycleState
  command: string | null
  startedAt: number | null
  readyAt: number | null
  lastOutputAt: number | null
  stoppedAt: number | null
  unhealthyReason: string | null
}

export type DevServerLifecycleEvent =
  | { type: 'start_requested'; runId: string; command?: string | null; at?: number }
  | { type: 'output'; runId: string; at?: number }
  | { type: 'ready'; runId: string; at?: number }
  | { type: 'unhealthy'; runId: string; reason: string; at?: number }
  | { type: 'stopped'; runId: string; at?: number }
  | { type: 'error'; runId: string; reason: string; at?: number }
  | { type: 'reset'; at?: number }

export interface DevServerTransitionResult {
  next: DevServerLifecycleSnapshot
  applied: boolean
  stale: boolean
}

export const initialDevServerLifecycle = (): DevServerLifecycleSnapshot => ({
  runId: null,
  state: 'idle',
  command: null,
  startedAt: null,
  readyAt: null,
  lastOutputAt: null,
  stoppedAt: null,
  unhealthyReason: null,
})

export function isStaleDevServerRun(
  snapshot: DevServerLifecycleSnapshot,
  runId: string | undefined | null
): boolean {
  if (!runId) return false
  if (!snapshot.runId) return false
  return snapshot.runId !== runId
}

export function transitionDevServerLifecycle(
  snapshot: DevServerLifecycleSnapshot,
  event: DevServerLifecycleEvent
): DevServerTransitionResult {
  const now = event.at ?? Date.now()

  if (event.type === 'reset') {
    return {
      next: {
        ...initialDevServerLifecycle(),
        state: 'idle',
        stoppedAt: now,
      },
      applied: true,
      stale: false,
    }
  }

  if (isStaleDevServerRun(snapshot, event.runId)) {
    return { next: snapshot, applied: false, stale: true }
  }

  switch (event.type) {
    case 'start_requested':
      return {
        next: {
          runId: event.runId,
          state: 'starting',
          command: event.command ?? null,
          startedAt: now,
          readyAt: null,
          lastOutputAt: null,
          stoppedAt: null,
          unhealthyReason: null,
        },
        applied: true,
        stale: false,
      }
    case 'output':
      return {
        next: {
          ...snapshot,
          runId: snapshot.runId ?? event.runId,
          lastOutputAt: now,
        },
        applied: true,
        stale: false,
      }
    case 'ready':
      return {
        next: {
          ...snapshot,
          runId: snapshot.runId ?? event.runId,
          state: 'ready',
          readyAt: now,
          unhealthyReason: null,
          lastOutputAt: snapshot.lastOutputAt ?? now,
        },
        applied: true,
        stale: false,
      }
    case 'unhealthy':
      return {
        next: {
          ...snapshot,
          runId: snapshot.runId ?? event.runId,
          state: 'unhealthy',
          unhealthyReason: event.reason,
          lastOutputAt: snapshot.lastOutputAt ?? now,
        },
        applied: true,
        stale: false,
      }
    case 'error':
      return {
        next: {
          ...snapshot,
          runId: snapshot.runId ?? event.runId,
          state: 'error',
          unhealthyReason: event.reason,
          stoppedAt: now,
        },
        applied: true,
        stale: false,
      }
    case 'stopped':
      return {
        next: {
          ...snapshot,
          runId: snapshot.runId ?? event.runId,
          state: 'stopped',
          stoppedAt: now,
        },
        applied: true,
        stale: false,
      }
    default:
      return { next: snapshot, applied: false, stale: false }
  }
}
