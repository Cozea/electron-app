from pathlib import Path
import subprocess


def replace(path, old, new):
    target = Path(path)
    source = target.read_text()
    assert source.count(old) == 1, f'Expected one anchor in {path}'
    target.write_text(source.replace(old, new, 1))

replace('shared/desktopPersistenceTypes.ts', "['cozea-query-cache', 'cozea:project-workbench', 'cozea:project-workbench-layouts']", "['cozea-query-cache', 'cozea:project-workbench-layouts', 'cozea:project-workbench']")
replace('apps/desktop/electron/workers/desktopStatePersistenceWorkerCore.ts', '`v2-${domainHash}-${sourceHash}.json`', '`v3-${domainHash}-${sourceHash}.json`')
replace('apps/desktop/electron/workers/desktopStatePersistenceWorkerCore.ts',
    '    // v2 intentionally ignores erroneous markers from the reviewed implementation.',
    '    // v3 also imports layouts embedded in older Zustand model envelopes.')
replace('apps/desktop/electron/workers/desktopStatePersistenceWorkerCore.ts',
    """      const validLayout = namespace === 'workbenchLayout' && isPlainRecord(data) && isPlainRecord(data.layout) && 'grid' in data.layout && 'panels' in data.layout && Number.isInteger(data.layoutResetKey)
      const validModel = namespace === 'workbenchModel' && isPlainRecord(data) && isPlainRecord(data.tiles) && Array.isArray(data.order) && typeof data.projectId === 'string'
      if ((!validLayout && !validModel) || key.length > 8192 || !key.includes('::')) { quarantinedCount++; continue }
      const existing = await this.readRecord(namespace, key)
      if (existing) continue // a resumed import never overwrites a newer record, including a tombstone
      const record: DesktopStateRecord = { schemaVersion: 1, namespace, key, recordRevision: 1, updatedAt: Date.now(), data }
      const result = await this.commit([record])
      if (result.status !== 'committed') throw new Error(result.errorMessage ?? 'Legacy import write failed')
      const verified = await this.readRecord(namespace, key)
      if (!verified || verified.recordRevision !== 1) throw new Error('Legacy import verification failed')
      importedCount++""",
    """      const hasLayout = isPlainRecord(data) && isPlainRecord(data.layout) && 'grid' in data.layout && 'panels' in data.layout && Number.isInteger(data.layoutResetKey)
      const validModel = namespace === 'workbenchModel' && isPlainRecord(data) && isPlainRecord(data.tiles) && Array.isArray(data.order) && typeof data.projectId === 'string'
      if ((!hasLayout && !validModel) || key.length > 8192 || !key.includes('::')) { quarantinedCount++; continue }
      const candidates: Array<{ namespace: DesktopStateNamespace; data: unknown }> = []
      if (validModel) candidates.push({ namespace: 'workbenchModel', data })
      if (hasLayout) candidates.push({ namespace: 'workbenchLayout', data: { layout: data.layout, layoutResetKey: data.layoutResetKey } })
      for (const candidate of candidates) {
        const existing = await this.readRecord(candidate.namespace, key)
        // Dedicated layout-domain migration runs first. Embedded legacy layouts
        // only fill a missing record; neither can resurrect a durable tombstone.
        if (existing) continue
        const record: DesktopStateRecord = { schemaVersion: 1, namespace: candidate.namespace, key, recordRevision: 1, updatedAt: Date.now(), data: candidate.data }
        const result = await this.commit([record])
        if (result.status !== 'committed') throw new Error(result.errorMessage ?? 'Legacy import write failed')
        const verified = await this.readRecord(candidate.namespace, key)
        if (!verified || verified.recordRevision !== 1) throw new Error('Legacy import verification failed')
        importedCount++
      }""")
replace('apps/desktop/src/features/workbench/model/workbenchLayoutPersistence.ts',
    """  await ensureWorkbenchLayoutPersistenceReady()
  desktopPersistenceClient.clearLayoutsForProject(projectId.trim())""",
    """  // Hide known layouts immediately, then tombstone disk-only scopes too.
  // Local tombstones cannot be replaced by the hydration result.
  desktopPersistenceClient.clearLayoutsForProject(projectId.trim())
  await ensureWorkbenchLayoutPersistenceReady()
  desktopPersistenceClient.clearLayoutsForProject(projectId.trim())""")
p = Path('tests/workbench/workbenchLayoutPersistence.test.ts')
s = p.read_text()
s = s.replace("import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'", """import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DesktopStatePersistenceWorkerCore } from '../../apps/desktop/electron/workers/desktopStatePersistenceWorkerCore'
import type { DesktopStateNamespace, DesktopStateRecord } from '../../shared/desktopPersistenceTypes'""")
s = s.replace("describe('workbench layout persistence', () => {", """describe('workbench layout persistence', () => {
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
  }""")
s = s.replace("  afterEach(() => {\n    delete (globalThis as { window?: unknown }).window\n  })", """  afterEach(async () => {
    delete (globalThis as { window?: unknown }).window
    if (core) await core.flush()
    if (root) await fs.rm(root, { recursive: true, force: true })
    core = undefined
    root = undefined
  })""")
old = """    ;(globalThis as { window?: unknown }).window = {
      localStorage,
      addEventListener: vi.fn(),
    }

    const persistence = await import('@/features/workbench/model/workbenchLayoutPersistence')
    persistence.ensureWorkbenchLayoutPersistenceReady()"""
new = """    await installDurableAPI(localStorage)

    const persistence = await import('@/features/workbench/model/workbenchLayoutPersistence')
    expect(persistence.peekPersistedWorkbenchLayout('project-1::collab', 7)).toBeNull()
    await persistence.ensureWorkbenchLayoutPersistenceReady()
    // The original envelope is recoverable; migration does not erase it.
    expect(localStorage.getItem('cozea:project-workbench')).not.toBeNull()"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
s = s.replace("    persistence.clearPersistedWorkbenchLayoutsForProject('project-1')", "    await persistence.clearPersistedWorkbenchLayoutsForProject('project-1')")
p.write_text(s)

print('Embedded layout migration, explicit durable hydration, and immediate known-layout deletion patched.')
print('Nested instructions:')
print(subprocess.check_output(['git', 'ls-files', '*AGENTS.md'], text=True))
print('Workbench persist compatibility callers:')
result = subprocess.run(['git', 'grep', '-n', '-E', 'useProjectWorkbenchStore\\.persist|flushWorkbenchStorage|ensureWorkbenchLayoutPersistenceReady', '--', 'apps', 'tests'], capture_output=True, text=True)
print(result.stdout)
