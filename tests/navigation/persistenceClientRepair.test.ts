import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopPersistenceClient, type DesktopPersistenceAPI } from '@/app/model/persistence/desktopPersistenceClient'
import type { DesktopStateRecord, PersistenceCommitResult, PersistenceLoadResult } from '@shared/desktopPersistenceTypes'

describe('renderer persistence barriers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
  function makeAPI(): DesktopPersistenceAPI {
    return { load: vi.fn(async () => ({ records: [] })), commit: vi.fn(async () => ({ status: 'committed' as const, committedRevisions: {}, watermark: 1 })), flush: vi.fn(async () => ({ status: 'flushed' as const, flushedRevision: 1 })) }
  }
  it('concurrent flush calls join the same promise and drain edits made during commit', async () => {
    const api = makeAPI()
    let release!: (value: PersistenceCommitResult) => void
    vi.mocked(api.commit).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const client = new DesktopPersistenceClient(() => api, async () => undefined)
    client.queueDirtyRecord('workbenchModel', 'scope', { version: 1 })
    const first = client.flush()
    const second = client.flush()
    expect(second).toBe(first)
    client.queueDirtyRecord('workbenchModel', 'scope', { version: 2 })
    release({ status: 'committed', committedRevisions: { scope: 1 }, watermark: 1 })
    await vi.runAllTimersAsync()
    await first
    expect(api.commit).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.commit).mock.calls[1][0].records[0].data).toEqual({ version: 2 })
  })
  it('a failed commit rejects its barrier and keeps the record available for retry', async () => {
    const api = makeAPI()
    vi.mocked(api.commit).mockResolvedValueOnce({ status: 'error', committedRevisions: {}, errorMessage: 'disk full' })
    const client = new DesktopPersistenceClient(() => api, async () => undefined)
    client.queueDirtyRecord('workbenchLayout', 'scope', { layout: {}, layoutResetKey: 0 })
    await expect(client.flush()).rejects.toThrow('disk full')
    await expect(client.flush()).resolves.toBeUndefined()
    expect(api.commit).toHaveBeenCalledTimes(2)
  })
  it('late hydration cannot overwrite an edit made after loading began', async () => {
    const api = makeAPI()
    let release!: (value: PersistenceLoadResult) => void
    vi.mocked(api.load).mockImplementation(() => new Promise(resolve => { release = resolve }))
    const client = new DesktopPersistenceClient(() => api, async () => undefined)
    const loading = client.hydrateNamespace('workbenchModel', ['scope'])
    await Promise.resolve()
    client.queueDirtyRecord('workbenchModel', 'scope', { version: 'local' })
    const stored: DesktopStateRecord = { schemaVersion: 1, namespace: 'workbenchModel', key: 'scope', recordRevision: 12, updatedAt: 1, data: { version: 'disk' } }
    release({ records: [stored] })
    await loading
    expect(client.peekModel('scope')).toEqual({ version: 'local' })
  })
  it('loading failures stay failures, and retry notifies hydration subscribers', async () => {
    const api = makeAPI()
    vi.mocked(api.load).mockRejectedValueOnce(new Error('corrupt record'))
    const client = new DesktopPersistenceClient(() => api, async () => undefined)
    const listener = vi.fn()
    client.subscribe(listener)
    await expect(client.hydrateNamespace('workbenchLayout', ['scope'])).rejects.toThrow('corrupt record')
    expect(client.isHydrated('workbenchLayout', 'scope')).toBe(false)
    await client.hydrateNamespace('workbenchLayout', ['scope'])
    expect(client.isHydrated('workbenchLayout', 'scope')).toBe(true)
    expect(listener).toHaveBeenCalled()
  })
  it('load joins are single-flight and absent records remain distinct from null data', async () => {
    const api = makeAPI()
    const client = new DesktopPersistenceClient(() => api, async () => undefined)
    const first = client.hydrateNamespace('queryCache', ['query'])
    expect(client.hydrateNamespace('queryCache', ['query'])).toBe(first)
    await first
    expect(api.load).toHaveBeenCalledTimes(1)
    expect(client.peek('queryCache', 'query')).toBeUndefined()
    client.queueDirtyRecord('queryCache', 'query', null)
    expect(client.peek('queryCache', 'query')).toBeNull()
  })
})
