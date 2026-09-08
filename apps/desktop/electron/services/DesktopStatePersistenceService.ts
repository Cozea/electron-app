import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  desktopStateRecordKey, type DesktopStateNamespace, type DesktopStateRecord,
  type PersistenceCommitResult, type PersistenceLoadResult, type PersistenceFlushResult,
  type LegacyDesktopDomain, type LegacyMigrationResult,
} from '@shared/desktopPersistenceTypes';
import { assertPersistenceBatch, assertPersistenceLoad, assertLegacyMigration } from '@shared/desktopPersistenceValidation';
import type { DesktopPersistenceWorkerOperation, DesktopPersistenceWorkerResponse } from '../workers/desktopStatePersistenceProtocol';

interface PendingRequest {
  worker: Worker;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
interface FailedRecord { watermark: number; revision: number; message: string }
interface PersistenceServiceOptions { workerPath?: string; requestTimeoutMs?: number }

export function resolveDesktopPersistenceWorkerPath(mainDirectory: string, packaged: boolean): string {
  const directory = packaged
    ? mainDirectory.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : mainDirectory;
  return path.join(directory, 'desktop-state-persistence.js');
}

/** Main owns authorization and operation receipts; all record processing runs off-thread. */
export class DesktopStatePersistenceService {
  readonly serviceEpoch = randomUUID();
  private readonly userDataPath: string;
  private readonly workerPath: string;
  private readonly requestTimeoutMs: number;
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private lastAcceptedOperation = 0;
  private disposed = false;
  private readonly requests = new Map<number, PendingRequest>();
  private readonly commits = new Map<number, Promise<PersistenceCommitResult>>();
  private readonly failures = new Map<string, FailedRecord>();

  constructor(userDataPath?: string, options: PersistenceServiceOptions = {}) {
    this.userDataPath = userDataPath ?? app.getPath('userData');
    this.workerPath = options.workerPath ?? resolveDesktopPersistenceWorkerPath(__dirname, app.isPackaged);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  private ensureWorker(): Worker {
    if (this.disposed) throw new Error('Desktop persistence service has been disposed.');
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath, { workerData: { userDataPath: this.userDataPath }, name: 'cozea-desktop-state' });
    this.worker = worker;
    worker.on('message', (message: DesktopPersistenceWorkerResponse) => {
      const pending = this.requests.get(message.id);
      if (!pending || pending.worker !== worker) return;
      this.requests.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.success) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    const fail = (error: Error) => {
      if (this.worker === worker) this.worker = null;
      for (const [id, pending] of this.requests) {
        if (pending.worker !== worker) continue;
        this.requests.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
    };
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`Desktop persistence worker exited (${code}). Pending state remains queued for retry.`)));
    return worker;
  }

  private call<T>(operation: DesktopPersistenceWorkerOperation, timeoutMs = this.requestTimeoutMs): Promise<T> {
    let worker: Worker;
    try { worker = this.ensureWorker(); }
    catch (error) { return Promise.reject(error); }
    const id = ++this.nextRequestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('Desktop persistence worker request timed out; its write must be retried idempotently.'));
      }, timeoutMs);
      timeout.unref?.();
      this.requests.set(id, { worker, resolve: (result) => resolve(result as T), reject, timeout });
      try { worker.postMessage({ ...operation, id }); }
      catch (error) {
        this.requests.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  load(namespace: DesktopStateNamespace, keys?: string[], isRenderer = true): Promise<PersistenceLoadResult> {
    assertPersistenceLoad(namespace, keys, isRenderer);
    return this.call({ action: 'load', payload: { namespace, keys } });
  }

  commit(records: DesktopStateRecord[], isRenderer = true): Promise<PersistenceCommitResult> {
    assertPersistenceBatch(records, isRenderer);
    const watermark = ++this.lastAcceptedOperation;
    const request = this.call<PersistenceCommitResult>({ action: 'commit', payload: { records } })
      .then((result) => {
        const acknowledged = new Set<string>();
        for (const acknowledgement of result.acknowledgements) {
          const key = desktopStateRecordKey(acknowledgement.namespace, acknowledgement.key);
          acknowledged.add(key);
          const previousFailure = this.failures.get(key);
          if (previousFailure && previousFailure.revision <= acknowledgement.recordRevision) this.failures.delete(key);
        }
        if (result.status !== 'committed') {
          for (const record of records) {
            const key = desktopStateRecordKey(record.namespace, record.key);
            if (!acknowledged.has(key)) this.failures.set(key, {
              watermark, revision: record.recordRevision, message: result.errorMessage ?? 'Desktop state commit failed.',
            });
          }
        }
        return { ...result, operationWatermark: watermark, serviceEpoch: this.serviceEpoch };
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        for (const record of records) this.failures.set(desktopStateRecordKey(record.namespace, record.key), {
          watermark, revision: record.recordRevision, message,
        });
        throw error;
      });
    this.commits.set(watermark, request);
    void request.finally(() => this.commits.delete(watermark)).catch(() => undefined);
    return request;
  }

  async flush(targetRevision = this.lastAcceptedOperation, serviceEpoch = this.serviceEpoch): Promise<PersistenceFlushResult> {
    if (serviceEpoch !== this.serviceEpoch || !Number.isSafeInteger(targetRevision) || targetRevision < 0 || targetRevision > this.lastAcceptedOperation) {
      return { status: 'error', flushedRevision: 0, serviceEpoch: this.serviceEpoch, errorMessage: 'Unknown persistence epoch or operation watermark.' };
    }
    await Promise.allSettled([...this.commits].filter(([watermark]) => watermark <= targetRevision).map(([, promise]) => promise));
    const failed = [...this.failures.values()].find((failure) => failure.watermark <= targetRevision);
    if (failed) return { status: 'error', flushedRevision: 0, serviceEpoch: this.serviceEpoch, errorMessage: failed.message };
    try {
      const result = await this.call<PersistenceFlushResult>({ action: 'flush', payload: {} });
      return { ...result, flushedRevision: result.status === 'flushed' ? targetRevision : 0, serviceEpoch: this.serviceEpoch };
    } catch (error) {
      return { status: 'error', flushedRevision: 0, serviceEpoch: this.serviceEpoch, errorMessage: error instanceof Error ? error.message : String(error) };
    }
  }

  migrateLegacy(domain: LegacyDesktopDomain, rawPayload: string, isRenderer = true): Promise<LegacyMigrationResult> {
    assertLegacyMigration(domain, rawPayload, isRenderer);
    return this.call({ action: 'migrateLegacy', payload: { domain, rawPayload } }, 120_000);
  }
  importMainRegistry(): Promise<LegacyMigrationResult | null> {
    return this.call({ action: 'importMainRegistry' }, 120_000);
  }
  diagnostics(): Promise<{ isMainThread: boolean; threadId: number; serializeCount: number; writeCount: number }> {
    return this.call({ action: 'diagnostics' });
  }
  async dispose(): Promise<void> {
    const result = await this.flush();
    if (result.status !== 'flushed') throw new Error(result.errorMessage ?? 'Desktop state is not committed.');
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    await worker?.terminate();
  }
}

let persistenceServiceInstance: DesktopStatePersistenceService | null = null;
export function getDesktopStatePersistenceService(userDataPath?: string): DesktopStatePersistenceService {
  persistenceServiceInstance ??= new DesktopStatePersistenceService(userDataPath);
  return persistenceServiceInstance;
}
