import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DesktopStatePersistenceWorkerCore } from '../../apps/desktop/electron/workers/desktopStatePersistenceWorkerCore'
import type { DesktopStateNamespace, DesktopStateRecord } from '../../shared/desktopPersistenceTypes'

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
  let root: string | undefined
  let core: DesktopStatePersistenceWorkerCore | undefined
  async function installDurableAPI(localStorage: MemoryStorage): Promise<void> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-layout-persistence-'))
    core = new DesktopStatePersistenceWorkerCore({ userDataPath: root })
    const backing = core
    ;(globalThis as { window?: unknown }).window = {
      localStorage,
      addEventListener: vi.fn(),
      electronAPI: {
        desktopPersistence: {
          load: ({ namespace, keys }: { namespace: DesktopStateNamespace; keys?: string[] }) => backing.load(namespace, keys),
          commit: ({ records }: { records: DesktopStateRecord[] }) => backing.commit(records),
          flush: () => backing.flush(),
          migrateLegacy: ({ domain, rawPayload }: { domain: string; rawPayload: string }) => backing.migrateLegacyDomain(domain, rawPayload),
        },
      },
    }
  }
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(async () => {
    delete (globalThis as { window?: unknown }).window
    if (core) await core.flush()
    if (root) await fs.rm(root, { recursive: true, force: true })
    core = undefined
    root = undefined
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

    await installDurableAPI(localStorage)

    const persistence = await import('@/features/workbench/model/workbenchLayoutPersistence')
    expect(persistence.peekPersistedWorkbenchLayout('project-1::collab', 7)).toBeNull()
    await persistence.ensureWorkbenchLayoutPersistenceReady()
    // The original envelope is recoverable; migration does not erase it.
    expect(localStorage.getItem('cozea:project-workbench')).not.toBeNull()

    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::collab', 7),
    ).toEqual(layout)
  })

  it('returns null when the stored layout reset key does not match', async () => {
    const localStorage = new MemoryStorage()
    ;(globalThis as { window?: unknown }).window = {
      localStorage,
      addEventListener: vi.fn(),
    }

    const persistence = await import('@/features/workbench/model/workbenchLayoutPersistence')
    persistence.writePersistedWorkbenchLayout('project-1::collab', 7, {
      grid: { root: 'root-grid' },
      panels: {},
    } as never)

    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::collab', 9),
    ).toBeNull()
  })

  it('preserves the source binding revision when cloning a layout', async () => {
    const localStorage = new MemoryStorage()
    ;(globalThis as { window?: unknown }).window = {
      localStorage,
      addEventListener: vi.fn(),
    }
    const persistence = await import('@/features/workbench/model/workbenchLayoutPersistence')
    const layout = { grid: { root: 'root-grid' }, panels: {} } as never
    persistence.writePersistedWorkbenchLayout('project-1::collab::source::v1', 3, layout, 7)

    expect(
      persistence.clonePersistedWorkbenchLayout(
        'project-1::collab::source::v1',
        'project-1::collab::target::v1',
        3,
      ),
    ).toBe(true)
    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::collab::target::v1', 3, 7),
    ).toEqual(layout)
    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::collab::target::v1', 3, 8),
    ).toBeNull()
  })

  it('removes every workspace and lane layout for only the deleted project', async () => {
    const localStorage = new MemoryStorage()
    ;(globalThis as { window?: unknown }).window = {
      localStorage,
      addEventListener: vi.fn(),
    }

    const persistence = await import('@/features/workbench/model/workbenchLayoutPersistence')
    const layout = { grid: { root: 'root-grid' }, panels: {} } as never
    persistence.writePersistedWorkbenchLayout('project-1::collab', 1, layout)
    persistence.writePersistedWorkbenchLayout('project-1::feature::workspace-1', 1, layout)
    persistence.writePersistedWorkbenchLayout('project-2::collab', 1, layout)

    await persistence.clearPersistedWorkbenchLayoutsForProject('project-1')

    expect(persistence.peekPersistedWorkbenchLayout('project-1::collab', 1)).toBeNull()
    expect(
      persistence.peekPersistedWorkbenchLayout('project-1::feature::workspace-1', 1),
    ).toBeNull()
    expect(persistence.peekPersistedWorkbenchLayout('project-2::collab', 1)).toEqual(layout)
  })
})
