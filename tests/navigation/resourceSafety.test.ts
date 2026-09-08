import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyedResource } from '../../apps/desktop/src/app/resources/keyedResource'
import { WorkspaceCatalogResource } from '../../apps/desktop/src/app/resources/workspaceCatalogResource'
import type { WorkspaceCatalogSnapshot } from '../../shared/workspaceTypes'

const snapshot = (revision: number): WorkspaceCatalogSnapshot => ({ revision, generatedAt: revision, entries: {} })

describe('resource safety', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns the identical pending promise to every consumer', async () => {
    let finish!: (value: number) => void
    const fetcher = vi.fn(() => new Promise<number>(resolve => { finish = resolve }))
    const resource = new KeyedResource({ key: 'one', fetcher })
    const first = resource.ensure('prefetch')
    const second = resource.ensure('navigation')
    expect(second).toBe(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish(42)
    await expect(first).resolves.toBe(42)
  })

  it('can retry a synchronously throwing transport', async () => {
    const fetcher = vi.fn<() => Promise<number>>().mockImplementationOnce(() => { throw new Error('sync failure') }).mockResolvedValue(7)
    const resource = new KeyedResource({ key: 'sync', fetcher })
    await expect(resource.ensure('navigation')).rejects.toThrow('sync failure')
    await expect(resource.ensure('navigation')).resolves.toBe(7)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not duplicate a request when a loading subscriber reenters ensure', async () => {
    const fetcher = vi.fn(async () => 8)
    const resource = new KeyedResource({ key: 'reentrant', fetcher })
    let joined: Promise<number> | undefined
    const unsubscribe = resource.subscribe(() => {
      if (resource.read().status === 'loading') joined = resource.ensure('navigation')
    })
    const request = resource.ensure('prefetch')
    expect(joined).toBe(request)
    await request
    expect(fetcher).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('attaches one push listener, shares bootstrap, and rejects an older initial snapshot', async () => {
    let push!: (next: WorkspaceCatalogSnapshot) => void
    let finish!: (next: WorkspaceCatalogSnapshot) => void
    const api = {
      onCatalogSnapshotChanged: vi.fn((listener: typeof push) => { push = listener; return vi.fn() }),
      getCatalogSnapshot: vi.fn(() => new Promise<WorkspaceCatalogSnapshot>(resolve => { finish = resolve })),
    }
    const catalog = new WorkspaceCatalogResource(() => api)
    const first = catalog.ensure()
    expect(catalog.ensure()).toBe(first)
    expect(api.onCatalogSnapshotChanged).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    push(snapshot(4))
    finish(snapshot(2))
    await expect(first).resolves.toMatchObject({ revision: 4 })
    expect(api.getCatalogSnapshot).toHaveBeenCalledTimes(1)
    catalog.dispose()
  })

  it('retries failed catalog initialization without leaking push listeners', async () => {
    const api = {
      onCatalogSnapshotChanged: vi.fn(() => vi.fn()),
      getCatalogSnapshot: vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue(snapshot(5)),
    }
    const catalog = new WorkspaceCatalogResource(() => api)
    await expect(catalog.ensure()).rejects.toThrow('not ready')
    await expect(catalog.ensure()).resolves.toMatchObject({ revision: 5 })
    expect(api.onCatalogSnapshotChanged).toHaveBeenCalledTimes(1)
    catalog.dispose()
  })
})
