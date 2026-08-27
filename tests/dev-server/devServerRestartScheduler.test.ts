import { describe, expect, it, vi } from 'vitest'

import { createDevServerRestartScheduler } from '../../apps/desktop/src/hooks/devServerRestartScheduler'

describe('devServerRestartScheduler', () => {
  it('cancels the previous restart before scheduling a new one', () => {
    vi.useFakeTimers()

    const scheduler = createDevServerRestartScheduler(500)
    const callback = vi.fn()

    scheduler.schedule(callback)
    scheduler.schedule(callback)

    vi.advanceTimersByTime(499)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('cancels a pending restart', () => {
    vi.useFakeTimers()

    const scheduler = createDevServerRestartScheduler(500)
    const callback = vi.fn()

    scheduler.schedule(callback)
    scheduler.cancel()
    vi.advanceTimersByTime(500)

    expect(callback).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})
