import { describe, expect, it, vi } from 'vitest'
import { createLocalSnapshot } from '../../apps/desktop/src/lib/localSnapshot'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('device presentation snapshots', () => {
  it('joins simultaneous reads and reuses a loaded snapshot on return', async () => {
    const response = deferred<string[]>()
    const read = vi.fn(() => response.promise)
    const store = createLocalSnapshot({ read })
    const first = store.ensure()
    expect(store.ensure()).toBe(first)
    response.resolve(['installed'])
    await first
    expect(await store.ensure()).toEqual(['installed'])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not let a slow read replace a newer installation event or mutation', async () => {
    const response = deferred<string[]>()
    const store = createLocalSnapshot({ read: () => response.promise })
    const request = store.refresh()
    store.publish(['new'])
    response.resolve(['old'])
    expect(await request).toEqual(['new'])
    expect(store.getSnapshot().data).toEqual(['new'])
  })

  it('retains usable data on refresh failure and allows retry', async () => {
    const read = vi.fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(['updated'])
    const store = createLocalSnapshot({ read })
    store.publish(['cached'])
    await expect(store.refresh()).rejects.toThrow('offline')
    expect(store.getSnapshot()).toEqual({ data: ['cached'], error: 'offline', refreshing: false })
    await store.refresh()
    expect(store.getSnapshot()).toEqual({ data: ['updated'], error: null, refreshing: false })
  })

  it('does not attach a stale error to newer data', async () => {
    const response = deferred<string[]>()
    const store = createLocalSnapshot({ read: () => response.promise })
    const request = store.refresh()
    store.publish(['new'])
    response.reject(new Error('old request failed'))
    await expect(request).rejects.toThrow()
    expect(store.getSnapshot().error).toBeNull()
    expect(store.getSnapshot().data).toEqual(['new'])
  })

  it('shares one native event listener across consumers and retains it across navigation', () => {
    const disconnect = vi.fn()
    const connect = vi.fn(() => disconnect)
    const store = createLocalSnapshot({ read: async () => [] as string[], connect })
    const a = store.subscribe(() => undefined)
    const b = store.subscribe(() => undefined)
    a(); b()
    store.subscribe(() => undefined)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
    store.dispose()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous snapshot visible while a stale cache refreshes', async () => {
    const response = deferred<string[]>()
    const store = createLocalSnapshot({ read: () => response.promise, maxAgeMs: 0 })
    store.publish(['cached'])
    const request = store.ensure()
    expect(store.getSnapshot()).toEqual({ data: ['cached'], error: null, refreshing: true })
    response.resolve(['fresh'])
    await request
    expect(store.getSnapshot().data).toEqual(['fresh'])
  })
})
