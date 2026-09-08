import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import type { Worker } from 'node:worker_threads';
import { DesktopStatePersistenceService, resolveDesktopPersistenceWorkerPath } from '../../../apps/desktop/electron/services/DesktopStatePersistenceService';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => { throw new Error('Tests must provide isolated userData'); } } }));
let root: string;
let workerPath: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-worker-test-'));
  await build({ configFile: false, logLevel: 'silent', publicDir: false,
    resolve: { alias: { '@shared': path.resolve('shared') } },
    build: { outDir: path.join(root, 'compiled'), emptyOutDir: true, target: 'node22', minify: false,
      lib: { entry: path.resolve('apps/desktop/electron/workers/desktopStatePersistenceWorker.ts'), formats: ['cjs'], fileName: () => 'worker.cjs' },
      rollupOptions: { external: (id) => id.startsWith('node:'), output: { inlineDynamicImports: true } },
    },
  });
  workerPath = path.join(root, 'compiled', 'worker.cjs');
}, 30_000);
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('Real Node persistence worker transport', () => {
  it('executes serialization in a distinct worker thread, not a class instantiated in main', async () => {
    const service = new DesktopStatePersistenceService(path.join(root, 'thread'), { workerPath });
    try {
      const info = await service.diagnostics();
      expect(info.isMainThread).toBe(false);
      expect(info.threadId).toBeGreaterThan(0);
      const result = await service.commit([{ schemaVersion: 1, namespace: 'queryCache', key: 'scoped-query',
        recordRevision: 1, updatedAt: 1, mutationId: 'first', data: { value: 42 } }]);
      expect(result.status).toBe('committed');
      expect((await service.load('queryCache', ['scoped-query'])).records[0]?.data).toEqual({ value: 42 });
      expect((await service.flush(result.operationWatermark, result.serviceEpoch)).status).toBe('flushed');
      expect((await service.diagnostics()).serializeCount).toBe(1);
    } finally { await service.dispose(); }
  });
  it('rejects a stale service epoch rather than interpreting its watermark in a new service', async () => {
    const service = new DesktopStatePersistenceService(path.join(root, 'epoch'), { workerPath });
    expect((await service.flush(0, 'foreign-epoch')).status).toBe('error');
    await service.dispose();
  });
  it('can restart a terminated worker without changing committed state', async () => {
    const service = new DesktopStatePersistenceService(path.join(root, 'restart'), { workerPath });
    try {
      await service.commit([{ schemaVersion: 1, namespace: 'queryCache', key: 'saved', recordRevision: 1,
        updatedAt: 1, mutationId: 'saved:1', data: 'preserved' }]);
      const first = await service.diagnostics();
      const worker = (service as unknown as { worker: Worker }).worker;
      await worker.terminate();
      const second = await service.diagnostics();
      expect(second.threadId).not.toBe(first.threadId);
      expect((await service.load('queryCache', ['saved'])).records[0]?.data).toBe('preserved');
    } finally { await service.dispose(); }
  });
  it('uses the unpacked standalone entry in a packaged application', () => {
    const directory = path.join('/resources', 'app.asar', 'out', 'main');
    expect(resolveDesktopPersistenceWorkerPath(directory, true)).toBe(path.join('/resources', 'app.asar.unpacked', 'out', 'main', 'desktop-state-persistence.js'));
  });
});
