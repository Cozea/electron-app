from pathlib import Path


def replace(path, old, new):
    target = Path(path)
    source = target.read_text()
    assert source.count(old) == 1, f'Expected one anchor in {path}'
    target.write_text(source.replace(old, new, 1))

p = Path('apps/desktop/src/lib/workbenchStore.ts')
s = p.read_text()
assert 'import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"' in s
s = s.replace('import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"', 'import { desktopPersistenceClient } from "@/app/model/persistence/desktopPersistenceClient"')
start = s.index('const PERSIST_DEBOUNCE_MS = 500')
end = s.index('/**\n * Tile shapes live', start)
s = s[:start] + '''/** Best-effort call sites use this; explicit shutdown uses flushWorkbenchStorageDurably. */
export function flushWorkbenchStorage(): void {
  void flushWorkbenchStorageDurably().catch(error => {
    console.error("[Workbench] Persistence flush failed; dirty records remain queued", error)
  })
}

export function flushWorkbenchStorageDurably(): Promise<void> {
  if (typeof window === "undefined" || !window.electronAPI?.desktopPersistence) {
    return Promise.resolve()
  }
  return desktopPersistenceClient.flush()
}

''' + s[end:]
assert s.count('  persist(\n    immer((set) => ({') == 1
s = s.replace('  persist(\n    immer((set) => ({', '  immer((set) => ({', 1)
start = s.index('    })),\n    {\n      name: "cozea:project-workbench",')
end = s.index('\nif (import.meta.env.DEV', start)
s = s[:start] + '''  })),
)

let applyingWorkbenchHydration = false
let workbenchHydration: Promise<void> | null = null
let workbenchHydrated = false
let workbenchEditSequence = 0
const workbenchEdits = new Map<string, number>()

// Immer preserves untouched record identities. Navigation-only changes therefore
// perform zero persistence work; a tile edit queues exactly its model, never the
// complete workbenches collection. Encoding and disk I/O belong to the worker.
useProjectWorkbenchStore.subscribe((state, previous) => {
  if (applyingWorkbenchHydration || state.workbenches === previous.workbenches) return
  const keys = new Set([...Object.keys(state.workbenches), ...Object.keys(previous.workbenches)])
  for (const key of keys) {
    const model = state.workbenches[key]
    if (model === previous.workbenches[key]) continue
    workbenchEdits.set(key, ++workbenchEditSequence)
    if (!model) {
      desktopPersistenceClient.deleteRecord('workbenchModel', key)
    } else {
      const sanitized = sanitizeWorkbenchState(model)
      // The independent layout namespace is the only layout persistence writer.
      desktopPersistenceClient.queueDirtyRecord('workbenchModel', key, { ...sanitized, layout: null })
    }
  }
})

/** Local boot barrier. It never starts a service or makes a cloud request. */
export function initializeWorkbenchStorage(): Promise<void> {
  if (workbenchHydrated) return Promise.resolve()
  if (workbenchHydration) return workbenchHydration
  if (typeof window === 'undefined' || !window.electronAPI?.desktopPersistence) return Promise.resolve()
  const initialSequence = workbenchEditSequence
  const attempt = (async () => {
    await desktopPersistenceClient.hydrateNamespace('workbenchModel')
    const restored = migratePersistedWorkbenchState({
      workbenches: Object.fromEntries(desktopPersistenceClient.entries('workbenchModel').map(record => [record.key, record.data])),
    })
    applyingWorkbenchHydration = true
    try {
      useProjectWorkbenchStore.setState(state => {
        const workbenches = { ...state.workbenches }
        for (const [key, model] of Object.entries(restored.workbenches ?? {})) {
          // A concurrent edit or deletion always wins over the boot snapshot.
          if ((workbenchEdits.get(key) ?? 0) > initialSequence) continue
          workbenches[key] = model as WorkbenchProjectState
        }
        return { workbenches }
      })
      workbenchHydrated = true
    } finally {
      applyingWorkbenchHydration = false
    }
  })()
  workbenchHydration = attempt
  void attempt.then(
    () => { if (workbenchHydration === attempt) workbenchHydration = null },
    () => { if (workbenchHydration === attempt) workbenchHydration = null },
  )
  return attempt
}
''' + s[end:]
p.write_text(s)
replace('apps/desktop/src/main.tsx',
    '  applyDesktopBootstrapRoute(bootstrap)\n',
    '''  applyDesktopBootstrapRoute(bootstrap)
  // Restore local tile models before any interactive route can ensure an empty
  // workbench. A failed read rejects boot rather than overwriting stored work.
  if (window.electronAPI?.windowContext !== 'settings') {
    const { initializeWorkbenchStorage } = await import('./lib/workbenchStore')
    await initializeWorkbenchStorage()
  }
''')

p = Path('tests/navigation/workbenchModelPersistence.test.ts')
assert not p.exists()
p.write_text('''import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('granular workbench model persistence', () => {
  beforeEach(() => { vi.resetModules() })

  it('queues only the changed model and never serializes the aggregate store', async () => {
    const { desktopPersistenceClient: persistence } = await import('@/app/model/persistence/desktopPersistenceClient')
    const queue = vi.spyOn(persistence, 'queueDirtyRecord').mockImplementation(() => {})
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
    const queue = vi.spyOn(persistence, 'queueDirtyRecord').mockImplementation(() => {})
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
    const queue = vi.spyOn(persistence, 'queueDirtyRecord').mockImplementation(() => {})
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
''')
print('Replaced aggregate localStorage persistence with per-record dirty tracking and an explicit boot barrier.')
