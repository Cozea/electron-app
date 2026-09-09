import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('query cache durable invalidation', () => {
  beforeEach(() => vi.resetModules())

  it('deletes every known durable record when clearing the cache', async () => {
    const { desktopPersistenceClient } = await import('@/app/model/persistence/desktopPersistenceClient')
    vi.spyOn(desktopPersistenceClient, 'entries').mockReturnValue([
      { schemaVersion: 1, namespace: 'queryCache', key: 'disk-only', recordRevision: 1, updatedAt: 1, data: { data: 1, timestamp: 1 } },
    ])
    const remove = vi.spyOn(desktopPersistenceClient, 'deleteRecord').mockImplementation(() => undefined)
    const { useQueryCache } = await import('@/app/model/queryCache')
    useQueryCache.setState({ cache: { memory: { data: 2, timestamp: Date.now() } } })

    useQueryCache.getState().clear()

    expect(remove).toHaveBeenCalledWith('queryCache', 'memory')
    expect(remove).toHaveBeenCalledWith('queryCache', 'disk-only')
    expect(useQueryCache.getState().get('disk-only')).toBeUndefined()
  })

  it('tombstones durable records evicted by the in-memory entry bound', async () => {
    const { desktopPersistenceClient } = await import('@/app/model/persistence/desktopPersistenceClient')
    const remove = vi.spyOn(desktopPersistenceClient, 'deleteRecord').mockImplementation(() => undefined)
    vi.spyOn(desktopPersistenceClient, 'queueDirtyRecord').mockImplementation(() => 1)
    const { useQueryCache } = await import('@/app/model/queryCache')

    for (let index = 0; index <= 250; index += 1) {
      useQueryCache.getState().set(`query-${index}`, index)
    }

    expect(Object.keys(useQueryCache.getState().cache)).toHaveLength(250)
    expect(remove).toHaveBeenCalledTimes(1)
    const removedKey = remove.mock.calls[0]?.[1]
    expect(remove.mock.calls[0]?.[0]).toBe('queryCache')
    expect(removedKey).toMatch(/^query-/)
    expect(removedKey && removedKey in useQueryCache.getState().cache).toBe(false)
  })

  it('does not restore a durable-only record cleared during hydration', async () => {
    const { desktopPersistenceClient } = await import('@/app/model/persistence/desktopPersistenceClient')
    let hydrated = false
    let finishHydration: (() => void) | undefined
    vi.spyOn(desktopPersistenceClient, 'hydrateNamespace').mockImplementation(
      () => new Promise<void>((resolve) => {
        finishHydration = () => {
          hydrated = true
          resolve()
        }
      }),
    )
    vi.spyOn(desktopPersistenceClient, 'entries').mockImplementation(() => hydrated ? [
      { schemaVersion: 1, namespace: 'queryCache', key: 'disk-only', recordRevision: 1, updatedAt: 1, data: { data: 1, timestamp: Date.now() } },
    ] : [])
    const remove = vi.spyOn(desktopPersistenceClient, 'deleteRecord').mockImplementation(() => undefined)
    const { initializeQueryCache, useQueryCache } = await import('@/app/model/queryCache')

    const hydration = initializeQueryCache()
    useQueryCache.getState().clear()
    finishHydration?.()
    await hydration

    expect(remove).toHaveBeenCalledWith('queryCache', 'disk-only')
    expect(useQueryCache.getState().cache).toEqual({})
  })

  it('commits the final value from a burst after the refresh interval', async () => {
    vi.useFakeTimers()
    const { desktopPersistenceClient } = await import('@/app/model/persistence/desktopPersistenceClient')
    vi.spyOn(desktopPersistenceClient, 'queueDirtyRecord').mockImplementation(() => 1)
    const { queueQueryCacheUpdate, useQueryCache } = await import('@/app/model/queryCache')
    useQueryCache.getState().set('project', { revision: 1 })

    queueQueryCacheUpdate('project', { revision: 2 })
    queueQueryCacheUpdate('project', { revision: 3 })
    await vi.runAllTimersAsync()

    expect(useQueryCache.getState().get<{ revision: number }>('project')).toEqual({ revision: 3 })
    vi.useRealTimers()
  })

  it('does not restore an update cleared while it is pending', async () => {
    vi.useFakeTimers()
    const { queueQueryCacheUpdate, useQueryCache } = await import('@/app/model/queryCache')
    queueQueryCacheUpdate('project', { revision: 1 })
    useQueryCache.getState().clear('project')
    await vi.runAllTimersAsync()

    expect(useQueryCache.getState().get('project')).toBeUndefined()
    vi.useRealTimers()
  })
})
