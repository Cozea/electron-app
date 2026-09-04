import { describe, expect, it } from 'vitest'
import {
  initialDevServerLifecycle,
  isStaleDevServerRun,
  transitionDevServerLifecycle,
} from '@/features/dev-server/model/devServerLifecycle'

describe('devServerLifecycle', () => {
  it('moves from start to ready for the same run', () => {
    const started = transitionDevServerLifecycle(initialDevServerLifecycle(), {
      type: 'start_requested',
      runId: 'run-1',
      command: 'npm run dev',
      at: 100,
    })

    expect(started.next.state).toBe('starting')
    expect(started.next.runId).toBe('run-1')

    const ready = transitionDevServerLifecycle(started.next, {
      type: 'ready',
      runId: 'run-1',
      at: 200,
    })

    expect(ready.next.state).toBe('ready')
    expect(ready.next.readyAt).toBe(200)
  })

  it('rejects stale events from previous runs', () => {
    const started = transitionDevServerLifecycle(initialDevServerLifecycle(), {
      type: 'start_requested',
      runId: 'run-new',
      at: 100,
    })

    const stale = transitionDevServerLifecycle(started.next, {
      type: 'error',
      runId: 'run-old',
      reason: 'stale event',
      at: 110,
    })

    expect(stale.applied).toBe(false)
    expect(stale.stale).toBe(true)
    expect(stale.next).toEqual(started.next)
  })

  it('marks unhealthy and then stopped for active run', () => {
    const started = transitionDevServerLifecycle(initialDevServerLifecycle(), {
      type: 'start_requested',
      runId: 'run-2',
      at: 100,
    })

    const unhealthy = transitionDevServerLifecycle(started.next, {
      type: 'unhealthy',
      runId: 'run-2',
      reason: 'probe failed',
      at: 150,
    })

    expect(unhealthy.next.state).toBe('unhealthy')
    expect(unhealthy.next.unhealthyReason).toBe('probe failed')

    const stopped = transitionDevServerLifecycle(unhealthy.next, {
      type: 'stopped',
      runId: 'run-2',
      at: 180,
    })

    expect(stopped.next.state).toBe('stopped')
    expect(stopped.next.stoppedAt).toBe(180)
  })

  it('detects stale run helper', () => {
    const snapshot = transitionDevServerLifecycle(initialDevServerLifecycle(), {
      type: 'start_requested',
      runId: 'active-run',
      at: 1,
    }).next

    expect(isStaleDevServerRun(snapshot, 'active-run')).toBe(false)
    expect(isStaleDevServerRun(snapshot, 'old-run')).toBe(true)
  })
})
