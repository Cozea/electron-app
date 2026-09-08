import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DesktopStatePersistenceWorkerCore } from '../../../apps/desktop/electron/workers/desktopStatePersistenceWorkerCore'

describe('real baseline envelopes and failed import recovery', () => {
  let root: string
  let core: DesktopStatePersistenceWorkerCore
  const key = 'project-a::collab::workspace-a::v1'
  const layout = { grid: { root: {} }, panels: {} }
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-migration-')); core = new DesktopStatePersistenceWorkerCore({ userDataPath: root }) })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
  it('imports nested layout records, not envelope keys, and verifies them after restart', async () => {
    const raw = JSON.stringify({ version: 1, migratedFromLegacy: true, layouts: { [key]: { layout, layoutResetKey: 3 } } })
    const result = await core.migrateLegacyDomain('cozea:project-workbench-layouts', raw)
    expect(result.importedCount).toBe(1)
    expect(await fs.readFile(result.backupPath, 'utf8')).toBe(raw)
    const restored = new DesktopStatePersistenceWorkerCore({ userDataPath: root })
    expect((await restored.load('workbenchLayout', [key])).records[0].data).toEqual({ layout, layoutResetKey: 3 })
    expect((await restored.load('workbenchLayout', ['layouts'])).records).toEqual([])
  })
  it('imports the actual Zustand state.workbenches envelope', async () => {
    const model = { projectId: 'project-a', workspaceId: 'workspace-a', laneId: 'collab', tiles: {}, order: [], activeTileId: null, layout: null, layoutResetKey: 0 }
    await core.migrateLegacyDomain('cozea:project-workbench', JSON.stringify({ state: { workbenches: { [key]: model } }, version: 1 }))
    expect((await core.load('workbenchModel', [key])).records[0].data).toEqual(model)
    expect((await core.load('workbenchModel', ['state'])).records).toEqual([])
  })
  it('never writes a completion marker when commit returns an error; retry imports safely', async () => {
    const raw = JSON.stringify({ version: 1, layouts: { [key]: { layout, layoutResetKey: 0 } } })
    const spy = vi.spyOn(core, 'commit').mockResolvedValueOnce({ status: 'error', committedRevisions: {}, errorMessage: 'injected failure' })
    await expect(core.migrateLegacyDomain('cozea:project-workbench-layouts', raw)).rejects.toThrow('injected failure')
    expect(await fs.readdir(path.join(root, 'desktop-state-v2/migration-markers'))).toEqual([])
    spy.mockRestore()
    expect((await core.migrateLegacyDomain('cozea:project-workbench-layouts', raw)).importedCount).toBe(1)
  })
  it('rejects untrusted migration path components before writing', async () => {
    await expect(core.migrateLegacyDomain('../../outside', '{}')).rejects.toThrow('Unsupported')
    await expect(fs.stat(path.join(root, 'outside.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('backs up but does not attribute an unscoped query cache to the current principal', async () => {
    const result = await core.migrateLegacyDomain('cozea-query-cache', JSON.stringify({ state: { cache: { secret: { data: 'private', timestamp: 1 } } } }))
    expect(result.importedCount).toBe(0)
    expect((await core.load('queryCache')).records).toEqual([])
  })
})
