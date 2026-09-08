import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DesktopStatePersistenceWorkerCore } from '../../../apps/desktop/electron/workers/desktopStatePersistenceWorkerCore';
import type { DesktopStateRecord } from '@shared/desktopPersistenceTypes';

describe('DesktopStatePersistence (M10-M20, P03)', () => {
  let tmpUserData: string;
  let core: DesktopStatePersistenceWorkerCore;

  beforeEach(() => {
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-persistence-test-'));
    core = new DesktopStatePersistenceWorkerCore({ userDataPath: tmpUserData });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpUserData, { recursive: true, force: true });
    } catch {}
  });

  it('M10: Atomically commits records and reads them back', async () => {
    const record: DesktopStateRecord = {
      schemaVersion: 1,
      namespace: 'workbenchLayout',
      key: 'p1::collab::w1',
      recordRevision: 1,
      updatedAt: Date.now(),
      data: { type: 'grid', orientation: 'HORIZONTAL' },
    };

    const commitResult = await core.commit([record]);
    expect(commitResult.status).toBe('committed');
    expect(commitResult.committedRevisions[record.key]).toBe(1);

    const loadResult = await core.load('workbenchLayout', [record.key]);
    expect(loadResult.records.length).toBe(1);
    expect(loadResult.records[0].data).toEqual({ type: 'grid', orientation: 'HORIZONTAL' });
  });

  it('M11: Monotonic revision protection prevents older revision 5 from overwriting revision 6', async () => {
    const rev6: DesktopStateRecord = {
      schemaVersion: 1,
      namespace: 'workbenchModel',
      key: 'p1::collab::w1',
      recordRevision: 6,
      updatedAt: Date.now(),
      data: { layout: 'v6' },
    };

    const rev5: DesktopStateRecord = {
      schemaVersion: 1,
      namespace: 'workbenchModel',
      key: 'p1::collab::w1',
      recordRevision: 5,
      updatedAt: Date.now() - 100,
      data: { layout: 'v5' },
    };

    // Commit revision 6 first
    await core.commit([rev6]);

    // Attempt to commit older revision 5
    await core.commit([rev5]);

    // Data must remain revision 6!
    const loadResult = await core.load('workbenchModel', [rev6.key]);
    expect(loadResult.records[0].recordRevision).toBe(6);
    expect((loadResult.records[0].data as any).layout).toBe('v6');
  });

  it('M13: Migration is idempotent; rerunning does not overwrite newer v2 state', async () => {
    const legacyPayload = JSON.stringify({
      'p1::collab': { orientation: 'LEGACY_VERTICAL' },
    });

    // First migration
    const res1 = await core.migrateLegacyDomain('cozea:project-workbench-layouts', legacyPayload);
    expect(res1.importedCount).toBe(1);

    // User updates layout to revision 2 in v2
    await core.commit([
      {
        schemaVersion: 1,
        namespace: 'workbenchLayout',
        key: 'p1::collab',
        recordRevision: 2,
        updatedAt: Date.now(),
        data: { orientation: 'MODERN_HORIZONTAL' },
      },
    ]);

    // Migration reruns (e.g. on restart)
    const res2 = await core.migrateLegacyDomain('cozea:project-workbench-layouts', legacyPayload);
    expect(res2.importedCount).toBe(1);

    // Data in storage must still be the newer v2 state
    const loadResult = await core.load('workbenchLayout', ['p1::collab']);
    expect((loadResult.records[0].data as any).orientation).toBe('MODERN_HORIZONTAL');
  });

  it('M14: Preserves backup and quarantines corrupt legacy record without destructive clear', async () => {
    const corruptPayload = "{ 'invalid_json': true "; // Malformed JSON

    const result = await core.migrateLegacyDomain('cozea:project-workbench-layouts', corruptPayload);
    expect(result.quarantinedCount).toBe(1);
    expect(fs.existsSync(result.backupPath)).toBe(true);

    const backupContent = fs.readFileSync(result.backupPath, 'utf8');
    expect(backupContent).toBe(corruptPayload);
  });

  it('M18: Flush awaits active write queues through target revision', async () => {
    const record: DesktopStateRecord = {
      schemaVersion: 1,
      namespace: 'lastWorkbenchRoute',
      key: 'last-route',
      recordRevision: 42,
      updatedAt: Date.now(),
      data: { path: '/projects/p1/workbench' },
    };

    await core.commit([record]);
    const flushResult = await core.flush(42);

    expect(flushResult.status).toBe('flushed');
    expect(flushResult.flushedRevision).toBeGreaterThanOrEqual(42);
  });

  it('M20: Rejects oversized query cache entry exceeding 1 MiB cap', async () => {
    const hugeString = 'x'.repeat(1024 * 1024 + 10); // > 1 MiB
    const record: DesktopStateRecord = {
      schemaVersion: 1,
      namespace: 'queryCache',
      key: 'huge-query',
      recordRevision: 1,
      updatedAt: Date.now(),
      data: { result: hugeString },
    };

    const commitResult = await core.commit([record]);
    expect(commitResult.status).toBe('error');
    expect(commitResult.errorMessage).toContain('1 MiB limit');

    // Verify it was NOT persisted
    const loadResult = await core.load('queryCache', ['huge-query']);
    expect(loadResult.records.length).toBe(0);
  });
});
