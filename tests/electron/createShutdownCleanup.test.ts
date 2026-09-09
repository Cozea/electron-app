import { describe, expect, it, vi } from 'vitest'

import { createShutdownCleanup } from '../../apps/desktop/electron/createShutdownCleanup'

describe('application service shutdown', () => {
  it('starts owners once in order, including reentrant shutdown', () => {
    const calls: string[] = []
    const cleanup = createShutdownCleanup([
      { name: 'workers', run: () => { calls.push('workers'); cleanup() } },
      { name: 'runtime', run: () => { calls.push('runtime') } },
    ], vi.fn())
    cleanup()
    cleanup()
    expect(calls).toEqual(['workers', 'runtime'])
  })

  it('continues after synchronous failure and reports asynchronous failure', async () => {
    const syncError = new Error('sync')
    const asyncError = new Error('async')
    const report = vi.fn()
    const last = vi.fn()
    const cleanup = createShutdownCleanup([
      { name: 'sync owner', run: () => { throw syncError } },
      { name: 'async owner', run: () => Promise.reject(asyncError) },
      { name: 'last owner', run: last },
    ], report)
    cleanup()
    await Promise.resolve()
    expect(last).toHaveBeenCalledOnce()
    expect(report.mock.calls).toEqual([
      ['sync owner', syncError],
      ['async owner', asyncError],
    ])
  })
})
