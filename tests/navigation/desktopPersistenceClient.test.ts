import { describe, it, expect, vi } from 'vitest';
import { DesktopPersistenceClient } from '../../apps/desktop/src/app/model/persistence/desktopPersistenceClient';
import {
  desktopStateRecordKey, type DesktopPersistenceApi, type DesktopStateRecord,
  type PersistenceCommitResult, type PersistenceLoadResult,
} from '@shared/desktopPersistenceTypes';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const records = new Map<string, DesktopStateRecord>();
  let watermark = 0;
  const api: DesktopPersistenceApi = {
    load: vi.fn(async ({ namespace, keys }) => ({
      records: [...records.values()].filter((record) => record.namespace === namespace && (!keys || keys.includes(record.key))), issues: [],
    })),
    commit: vi.fn(async ({ records: proposed }): Promise<PersistenceCommitResult> => {
      const operationWatermark = ++watermark;
      const acknowledgements: PersistenceCommitResult['acknowledgements'] = [];
      for (const record of proposed) {
        const key = desktopStateRecordKey(record.namespace, record.key);
        const current = records.get(key);
        if (current && current.recordRevision === record.recordRevision && current.mutationId === record.mutationId) {
          acknowledgements.push({ namespace: record.namespace, key: record.key, recordRevision: record.recordRevision,
            mutationId: record.mutationId, disposition: 'unchanged' });
          continue;
        }
        if (record.recordRevision !== (current?.recordRevision ?? 0) + 1) return {
          status: 'conflict', acknowledgements, committedRevisions: {}, operationWatermark, serviceEpoch: 'service', errorMessage: 'version conflict',
        };
        records.set(key, structuredClone(record));
        acknowledgements.push({ namespace: record.namespace, key: record.key, recordRevision: record.recordRevision,
          mutationId: record.mutationId, disposition: 'committed' });
      }
      return { status: 'committed', acknowledgements, committedRevisions: {}, operationWatermark, serviceEpoch: 'service' };
    }),
    flush: vi.fn(async () => ({ status: 'flushed', flushedRevision: watermark, serviceEpoch: 'service' })),
    migrateLegacy: vi.fn(async ({ domain }) => ({ domain, importedCount: 0, quarantinedCount: 0, skippedCount: 0, backupPath: 'fixture', sourceChecksum: 'fixture' })),
  };
  const client = new DesktopPersistenceClient({ api: () => api, debounceMs: 60_000, maxDirtyAgeMs: 60_000 });
  return { client, api, records };
}

describe('Renderer persistence hydration and write barriers', () => {
  it('joins hydration and never treats a failed load as empty state', async () => {
    const { client, api } = fixture();
    const response = deferred<PersistenceLoadResult>();
    vi.mocked(api.load).mockReturnValueOnce(response.promise);
    const a = client.hydrateNamespace('workbenchModel', ['a']);
    expect(client.hydrateNamespace('workbenchModel', ['a'])).toBe(a);
    expect(client.isHydrated('workbenchModel', 'a')).toBe(false);
    expect(() => client.queueDirtyRecord('workbenchModel', 'a', {})).toThrow('not hydrated');
    response.reject(new Error('disk unreadable'));
    await expect(a).rejects.toThrow('disk unreadable');
    expect(client.isHydrated('workbenchModel', 'a')).toBe(false);
    await client.hydrateNamespace('workbenchModel', ['a']);
    expect(client.isHydrated('workbenchModel', 'a')).toBe(true);
    await client.dispose();
  });
  it('notifies subscribers when hydration changes a layout and readiness', async () => {
    const { client, records } = fixture();
    records.set(desktopStateRecordKey('workbenchLayout', 'a'), { schemaVersion: 1, namespace: 'workbenchLayout',
      key: 'a', recordRevision: 8, updatedAt: 1, data: { layout: { saved: true }, layoutResetKey: 4 } });
    const notify = vi.fn();
    client.subscribeNamespace('workbenchLayout', notify);
    await client.hydrateNamespace('workbenchLayout', ['a']);
    expect(client.peekLayout('a', 4)).toEqual({ saved: true });
    expect(client.isHydrated('workbenchLayout', 'a')).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    await client.dispose();
  });
  it('a fresh query arriving during load wins over the old disk value and learns its version', async () => {
    const { client, api, records } = fixture();
    const old: DesktopStateRecord = { schemaVersion: 1, namespace: 'queryCache', key: 'q', recordRevision: 8, updatedAt: 1, data: 'old' };
    records.set(desktopStateRecordKey('queryCache', 'q'), old);
    const response = deferred<PersistenceLoadResult>();
    vi.mocked(api.load).mockReturnValueOnce(response.promise);
    const hydration = client.hydrateNamespace('queryCache', ['q']);
    client.queueDirtyRecord('queryCache', 'q', 'new');
    response.resolve({ records: [old], issues: [] });
    await hydration;
    expect(client.peekQuery('q')).toBe('new');
    await client.flush();
    expect(records.get(desktopStateRecordKey('queryCache', 'q'))?.recordRevision).toBe(9);
    await client.dispose();
  });
  it('coalesces changes before assigning a committed version, with no skipped record revisions', async () => {
    const { client, api, records } = fixture();
    await client.hydrateNamespace('workbenchModel', ['a']);
    for (let value = 1; value <= 100; value++) client.queueDirtyRecord('workbenchModel', 'a', { value });
    await client.flush();
    expect(api.commit).toHaveBeenCalledOnce();
    expect(records.get(desktopStateRecordKey('workbenchModel', 'a'))?.recordRevision).toBe(1);
    expect(client.peekModel('a')).toEqual({ value: 100 });
    await client.dispose();
  });
  it('concurrent flush callers join, and edits during a slow commit are drained afterward', async () => {
    const { client, api, records } = fixture();
    await client.hydrateNamespace('workbenchModel', ['a']);
    const realCommit = api.commit;
    const delayed = deferred<PersistenceCommitResult>();
    const started = deferred<void>();
    api.commit = vi.fn(async (request) => {
      const result = await realCommit(request);
      if (result.operationWatermark === 1) { started.resolve(); await delayed.promise; }
      return result;
    });
    client.queueDirtyRecord('workbenchModel', 'a', { value: 1 });
    const a = client.flush();
    expect(client.flush()).toBe(a);
    await started.promise;
    client.queueDirtyRecord('workbenchModel', 'a', { value: 2 });
    delayed.resolve({ status: 'committed', acknowledgements: [], committedRevisions: {}, operationWatermark: 1 });
    await a;
    expect(records.get(desktopStateRecordKey('workbenchModel', 'a'))?.data).toEqual({ value: 2 });
    expect(client.getSnapshot().pendingRecords).toBe(0);
    await client.dispose();
  });
  it('lost acknowledgement retries the exact immutable mutation before a newer edit', async () => {
    const { client, api, records } = fixture();
    await client.hydrateNamespace('workbenchModel', ['a']);
    const realCommit = api.commit;
    let fail = true;
    api.commit = vi.fn(async (request) => {
      const result = await realCommit(request);
      if (fail) { fail = false; throw new Error('response lost after write'); }
      return result;
    });
    client.queueDirtyRecord('workbenchModel', 'a', { value: 1 });
    await expect(client.flush()).rejects.toThrow('response lost');
    await Promise.resolve(); await Promise.resolve();
    client.queueDirtyRecord('workbenchModel', 'a', { value: 2 });
    await client.flush();
    expect(records.get(desktopStateRecordKey('workbenchModel', 'a'))?.recordRevision).toBe(2);
    expect(records.get(desktopStateRecordKey('workbenchModel', 'a'))?.data).toEqual({ value: 2 });
    const calls = vi.mocked(api.commit).mock.calls;
    expect(calls[0]?.[0].records[0]?.mutationId).toBe(calls[1]?.[0].records[0]?.mutationId);
    await client.dispose();
  });
  it('flush failure is surfaced, not converted into a successful shutdown barrier', async () => {
    const { client, api } = fixture();
    vi.mocked(api.flush).mockResolvedValueOnce({ status: 'error', flushedRevision: 0, errorMessage: 'write not durable' });
    await expect(client.flush()).rejects.toThrow('write not durable');
    await Promise.resolve(); await Promise.resolve();
    await client.dispose();
  });
  it('a corrupt neighbor does not make a valid loaded scope unusable or an absent scope writable', async () => {
    const { api, records } = fixture();
    records.set(desktopStateRecordKey('workbenchModel', 'valid'), { schemaVersion: 1, namespace: 'workbenchModel', key: 'valid', recordRevision: 1, updatedAt: 1, data: { saved: true } });
    const client = new DesktopPersistenceClient({ api: () => api, beforeHydrate: async () => { throw new Error('legacy neighbor invalid'); } });
    await client.hydrateNamespace('workbenchModel', ['valid']);
    expect(client.isHydrated('workbenchModel', 'valid')).toBe(true);
    await expect(client.hydrateNamespace('workbenchModel', ['absent'])).rejects.toThrow('neighbor invalid');
    expect(client.isHydrated('workbenchModel', 'absent')).toBe(false);
    await client.dispose();
  });
  it('new dirty state arriving during flush IPC is not stranded', async () => {
    const { client, api, records } = fixture();
    await client.hydrateNamespace('workbenchModel', ['a']);
    const realFlush = api.flush;
    let first = true;
    api.flush = vi.fn(async (request) => {
      if (first) { first = false; client.queueDirtyRecord('workbenchModel', 'a', { value: 2 }); }
      return realFlush(request);
    });
    client.queueDirtyRecord('workbenchModel', 'a', { value: 1 });
    await client.flush();
    expect(records.get(desktopStateRecordKey('workbenchModel', 'a'))?.data).toEqual({ value: 2 });
    expect(client.getSnapshot().pendingRecords).toBe(0);
    await client.dispose();
  });
});
