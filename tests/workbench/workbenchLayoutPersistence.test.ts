import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key)! : null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

describe('workbench layout persistence', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('migrates legacy workbench layouts into the dedicated layout store', async () => {
    const localStorage = new MemoryStorage()
    const layout = {
      grid: { root: 'root-grid' },
      panels: { 'assistant-1': { id: 'assistant-1' } },
    }

    localStorage.setItem(
      'cozea:project-workbench',
      JSON.stringify({
        state: {
          workbenches: {
            'project-1::collab': {
              layout,
              layoutResetKey: 7,
            },
          },
        },
      }),
    )

    ;(globalThis as { window?: unknown }).window = { localStorage }

    const persistence = await import('../../src/features/projects/lib/workbenchLayoutPersistence')
    persistence.ensureWorkbenchLayoutPersistenceReady()

    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::collab', 7),
    ).toEqual(layout)
  })

  it('returns null when the stored layout reset key does not match', async () => {
    const localStorage = new MemoryStorage()
    ;(globalThis as { window?: unknown }).window = { localStorage }

    const persistence = await import('../../src/features/projects/lib/workbenchLayoutPersistence')
    persistence.writePersistedWorkbenchLayout('project-1::collab', 7, {
      grid: { root: 'root-grid' },
      panels: {},
    } as never)

    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::collab', 9),
    ).toBeNull()
  })
})
