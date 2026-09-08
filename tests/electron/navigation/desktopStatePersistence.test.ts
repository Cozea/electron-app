import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopStatePersistenceWorkerCore } from '../../../apps/desktop/electron/workers/desktopStatePersistenceWorkerCore';
import { desktopStateRecordKey, type DesktopStateRecord, type PersistenceCommitResult } from '@shared/desktopPersistenceTypes';

const scope = 'project-a::collab::workspace-a::v1';
const layout = { grid: { width: 800, height: 600, root: { type: 'branch', data: [] } }, panels: {} };
const layoutData = { layout, layoutResetKey: 7 };
const model = {
  projectId: 'project-a', laneId: 'collab', workspaceId: 'workspace-a',
  tiles: { terminal: { id: 'terminal', type: 'terminal', title: 'Retained terminal' } },
  order: ['terminal'], activeTileId: 'terminal', layout: null, layoutResetKey: 7,
};
function record(revision = 1, data: unknown = layoutData, namespace: DesktopStateRecord['namespace'] = 'workbenchLayout', key = scope): DesktopStateRecord {
  return { schemaVersion: 1, namespace, key, recordRevision: revision, updatedAt: 1000 + revision,
    mutationId: `${namespace}:${key}:${revision}`, data };
}

describe('Desktop persistence — actual envelopes, ordering and recovery', () => {
  let root: string;
  let core: DesktopStatePersistenceWorkerCore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-persistence-'));
    core = new DesktopStatePersistenceWorkerCore({ userDataPath: root });
  });
  afterEach(async () => { vi.restoreAllMocks(); await core.flush(); await fs.rm(root, { recursive: true, force: true }); });

  it('M10: commits a complete validated record and returns its namespace-scoped version', async () => {
    const result = await core.commit([record()]);
    expect(result.status).toBe('committed');
    expect(result.committedRevisions[desktopStateRecordKey('workbenchLayout', scope)]).toBe(1);
    expect((await core.load('workbenchLayout', [scope])).records[0]?.data).toEqual(layoutData);
  });
  it('M11: rejects an older or conflicting equal version instead of falsely acknowledging it', async () => {
    await core.commit([record()]);
    await core.commit([record(2, { ...layoutData, layoutResetKey: 8 })]);
    expect((await core.commit([record()])).status).toBe('conflict');
    expect((await core.commit([record(2, layoutData)])).status).toBe('conflict');
    expect((await core.load('workbenchLayout', [scope])).records[0]?.recordRevision).toBe(2);
  });
  it('M11: identical retry is idempotent and performs no replacement', async () => {
    await core.commit([record()]);
    const writes = core.diagnostics().writeCount;
    const result = await core.commit([record()]);
    expect(result.status).toBe('committed');
    expect(result.acknowledgements[0]?.disposition).toBe('unchanged');
    expect(core.diagnostics().writeCount).toBe(writes);
  });
  it('M12: replacement failure preserves the old record, rejects flush and permits retry', async () => {
    let fail = false;
    core = new DesktopStatePersistenceWorkerCore({ userDataPath: root, beforeReplace: async () => {
      if (fail) throw new Error('injected rename failure');
    } });
    await core.commit([record()]);
    fail = true;
    expect((await core.commit([record(2, { ...layoutData, layoutResetKey: 8 })])).status).toBe('error');
    expect((await core.flush()).status).toBe('error');
    expect((await core.load('workbenchLayout', [scope])).records[0]?.recordRevision).toBe(1);
    fail = false;
    expect((await core.commit([record(2, { ...layoutData, layoutResetKey: 8 })])).status).toBe('committed');
    expect((await core.flush()).status).toBe('flushed');
  });
  it('M13: imports the real layouts envelope under scope keys, not the envelope key', async () => {
    const result = await core.migrateLegacyDomain('cozea:project-workbench-layouts', JSON.stringify({
      version: 1, migratedFromLegacy: true, layouts: { [scope]: layoutData },
    }));
    expect(result.importedCount).toBe(1);
    expect((await core.load('workbenchLayout')).records.map((entry) => entry.key)).toEqual([scope]);
    expect((await core.load('workbenchLayout', ['layouts'])).records).toEqual([]);
  });
  it('M13: imports actual Zustand state.workbenches entries, not state', async () => {
    const result = await core.migrateLegacyDomain('cozea:project-workbench', JSON.stringify({
      state: { workbenches: { [scope]: model } }, version: 5,
    }));
    expect(result.importedCount).toBe(1);
    expect((await core.load('workbenchModel', [scope])).records[0]?.data).toEqual(model);
    expect((await core.load('workbenchModel', ['state'])).records).toEqual([]);
  });
  it('M13: restart does not overwrite newer v2 records or count an envelope as imported', async () => {
    const raw = JSON.stringify({ version: 1, migratedFromLegacy: true, layouts: { [scope]: layoutData } });
    await core.migrateLegacyDomain('cozea:project-workbench-layouts', raw);
    await core.commit([record(2, { ...layoutData, layoutResetKey: 11 })]);
    const restarted = new DesktopStatePersistenceWorkerCore({ userDataPath: root });
    await restarted.migrateLegacyDomain('cozea:project-workbench-layouts', raw);
    expect((await restarted.load('workbenchLayout', [scope])).records[0]?.data).toEqual({ ...layoutData, layoutResetKey: 11 });
  });
  it('M13: a returned commit failure never creates a completion marker', async () => {
    vi.spyOn(core, 'commit').mockResolvedValueOnce({ status: 'error', committedRevisions: {}, acknowledgements: [],
      operationWatermark: 1, errorMessage: 'injected failed import' } satisfies PersistenceCommitResult);
    await expect(core.migrateLegacyDomain('cozea:project-workbench-layouts', JSON.stringify({
      version: 1, layouts: { [scope]: layoutData },
    }))).rejects.toThrow('injected failed import');
    expect(await fs.readdir(path.join(root, 'desktop-state-v2', 'migration-markers'))).toEqual([]);
  });
  it('M14: corrupt source is backed up; no successful empty migration is reported', async () => {
    const raw = '{invalid json';
    await expect(core.migrateLegacyDomain('cozea:project-workbench-layouts', raw)).rejects.toThrow();
    const backups = await fs.readdir(path.join(root, 'desktop-state-v2', 'backups'));
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'desktop-state-v2', 'backups', backups[0]!), 'utf8')).toBe(raw);
    expect(await fs.readdir(path.join(root, 'desktop-state-v2', 'migration-markers'))).toEqual([]);
  });
  it('M14: valid neighbors survive a partially corrupt import and the failed domain remains retryable', async () => {
    await expect(core.migrateLegacyDomain('cozea:project-workbench-layouts', JSON.stringify({
      version: 1, layouts: { [scope]: layoutData, corrupt: { layout: false } },
    }))).rejects.toThrow('invalid records');
    expect((await core.load('workbenchLayout', [scope])).records[0]?.data).toEqual(layoutData);
    expect(await fs.readdir(path.join(root, 'desktop-state-v2', 'migration-markers'))).toEqual([]);
  });
  it('M14: repeated load of a corrupt record is an issue, never confirmed absence', async () => {
    await core.commit([record()]);
    const saved = path.join(root, 'desktop-state-v2', 'records', `rec_${core.getRecordHash('workbenchLayout', scope)}.json`);
    await fs.writeFile(saved, '{corrupt');
    expect((await core.load('workbenchLayout', [scope])).issues).toHaveLength(1);
    expect((await core.load('workbenchLayout', [scope])).issues).toHaveLength(1);
  });
  it('M17: unscoped legacy cloud cache is backed up but not assigned to the current principal', async () => {
    const result = await core.migrateLegacyDomain('cozea-query-cache', JSON.stringify({ state: { cache: { secret: { data: 'old principal', timestamp: 1 } } }, version: 0 }));
    expect(result.skippedCount).toBe(1);
    expect((await core.load('queryCache')).records).toEqual([]);
  });
  it('M18: a flush watermark counts operations, not the maximum independent record version', async () => {
    await core.commit([record(1, layoutData, 'workbenchLayout', 'scope-a')]);
    const second = await core.commit([record(1, layoutData, 'workbenchLayout', 'scope-b')]);
    expect(second.operationWatermark).toBe(2);
    expect((await core.flush(2)).status).toBe('flushed');
    expect((await core.flush(42)).status).toBe('error');
  });
  it('M20: oversized query data is not persisted and invalidates any previous disk value', async () => {
    await core.commit([record(1, { result: 'small' }, 'queryCache', 'query')]);
    const result = await core.commit([record(2, { result: 'x'.repeat(1024 * 1024 + 1) }, 'queryCache', 'query')]);
    expect(result.status).toBe('committed');
    expect(result.acknowledgements[0]?.disposition).toBe('not-persisted');
    expect((await core.load('queryCache', ['query'])).records[0]?.deleted).toBe(true);
  });
  it('M20: legitimate model state larger than the query cap is preserved', async () => {
    const large = { ...model, tiles: { terminal: { ...model.tiles.terminal, title: 'x'.repeat(2 * 1024 * 1024) } } };
    expect((await core.commit([record(1, large, 'workbenchModel')])).status).toBe('committed');
    expect((await core.load('workbenchModel', [scope])).records[0]?.data).toEqual(large);
  });
  it('rejects unknown migration domains before creating paths outside the service directory', async () => {
    expect(() => core.migrateLegacyDomain('../escape' as never, '{}')).toThrow('domain');
  });
});
