import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('granular workbench model persistence', () => {
  beforeEach(() => { vi.resetModules() })

  it('queues only the changed model and never serializes the aggregate store', async () => {
    const { desktopPersistenceClient: persistence } = await import('@/app/model/persistence/desktopPersistenceClient')
    const queue = vi.spyOn(persistence, 'queueDirtyRecord').mockReturnValue(1)
    const { useProjectWorkbenchStore: store } = await import('@/lib/workbenchStore')
    store.getState().actions.ensureWorkbench('project-a', 'collab', 'workspace-a')
    store.getState().actions.ensureWorkbench('project-b', 'collab', 'workspace-b')
    const bench = Object.values(store.getState().workbenches).find(model => model.projectId === 'project-a')!
    queue.mockClear()
    store.getState().actions.updateTileTitle('project-a', 'collab', bench.order[0], 'Renamed', 'workspace-a')
    expect(queue).toHaveBeenCalledTimes(1)
    const [namespace, key, model] = queue.mock.calls[0]
    expect(namespace).toBe('workbenchModel')
    expect(key).toContain('project-a::')
    expect(model).not.toHaveProperty('workbenches')
    expect(model).toHaveProperty('layout', null)
    queue.mockRestore()
  })

  it('does not persist navigation-only changes or a no-op ensure', async () => {
    const { desktopPersistenceClient: persistence } = await import('@/app/model/persistence/desktopPersistenceClient')
    const queue = vi.spyOn(persistence, 'queueDirtyRecord').mockReturnValue(1)
    const { useProjectWorkbenchStore: store } = await import('@/lib/workbenchStore')
    store.getState().actions.ensureWorkbench('project-a', 'collab', 'workspace-a')
    store.getState().actions.ensureWorkbench('project-b', 'collab', 'workspace-b')
    queue.mockClear()
    store.getState().actions.ensureWorkbench('project-a', 'collab', 'workspace-a')
    store.getState().actions.ensureWorkbench('project-a', 'collab', 'workspace-a')
    expect(queue).not.toHaveBeenCalled()
    queue.mockRestore()
  })

  it('tombstones only the deleted project models', async () => {
    const { desktopPersistenceClient: persistence } = await import('@/app/model/persistence/desktopPersistenceClient')
    const queue = vi.spyOn(persistence, 'queueDirtyRecord').mockReturnValue(1)
    const remove = vi.spyOn(persistence, 'deleteRecord').mockImplementation(() => {})
    const { useProjectWorkbenchStore: store } = await import('@/lib/workbenchStore')
    store.getState().actions.ensureWorkbench('project-a', 'collab', 'workspace-a')
    store.getState().actions.ensureWorkbench('project-b', 'collab', 'workspace-b')
    remove.mockClear()
    store.getState().actions.removeProject('project-a')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0][0]).toBe('workbenchModel')
    expect(remove.mock.calls[0][1]).toContain('project-a::')
    expect(Object.values(store.getState().workbenches).map(model => model.projectId)).toEqual(['project-b'])
    queue.mockRestore()
    remove.mockRestore()
  })
})
