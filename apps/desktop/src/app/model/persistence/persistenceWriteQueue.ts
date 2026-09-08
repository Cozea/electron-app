import {
  desktopStateRecordKey, type DesktopPersistenceApi, type DesktopStateNamespace,
  type DesktopStateRecord, type PersistenceCommitResult,
} from '@shared/desktopPersistenceTypes';
import type { PersistenceMirror } from './persistenceMirror';

interface DirtyRecord {
  namespace: DesktopStateNamespace;
  key: string;
  data: unknown;
  deleted: boolean;
  bindingRevision?: number;
  localVersion: number;
  updatedAt: number;
  mutationId: string;
}
interface DispatchRecord { record: DesktopStateRecord; localVersion: number }
export interface PersistenceQueueSnapshot { pendingRecords: number; flushing: boolean; error: string | null }
interface QueueOptions {
  api: () => DesktopPersistenceApi;
  mirror: PersistenceMirror;
  onError?: (error: Error) => void;
  debounceMs?: number;
  maxDirtyAgeMs?: number;
}

/** Coalesce immutable records BEFORE serialization, retaining exact unacknowledged writes for retry. */
export class PersistenceWriteQueue {
  private readonly dirty = new Map<string, DirtyRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly writerId = globalThis.crypto?.randomUUID?.() ?? `writer-${Date.now()}-${Math.random()}`;
  private localVersion = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private oldestDirtyAt = 0;
  private flushPromise: Promise<void> | null = null;
  private retryBatch: DispatchRecord[] = [];
  private retryDelayMs = 1000;
  private lastReceipt: Pick<PersistenceCommitResult, 'operationWatermark' | 'serviceEpoch'> | null = null;
  private state: PersistenceQueueSnapshot = { pendingRecords: 0, flushing: false, error: null };
  private stopped = false;

  constructor(private readonly options: QueueOptions) {}
  hasDirty(key: string): boolean { return this.dirty.has(key); }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): PersistenceQueueSnapshot => this.state;
  private publish(error: string | null = this.state.error): void {
    const next = { pendingRecords: this.dirty.size, flushing: this.flushPromise !== null, error };
    if (next.pendingRecords === this.state.pendingRecords && next.flushing === this.state.flushing && next.error === this.state.error) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  queue(namespace: DesktopStateNamespace, key: string, data: unknown, bindingRevision?: number, deleted = false): void {
    if (this.stopped) throw new Error('The desktop persistence queue is stopped.');
    if (namespace !== 'queryCache' && namespace !== 'branchKnowledge' && !this.options.mirror.isHydrated(namespace, key)) {
      throw new Error(`Saved ${namespace} state is not hydrated; refusing to overwrite an unknown record.`);
    }
    const fullKey = desktopStateRecordKey(namespace, key);
    const previous = this.dirty.get(fullKey);
    if (previous && previous.data === data && previous.deleted === deleted && previous.bindingRevision === bindingRevision) return;
    const localVersion = ++this.localVersion;
    const dirty: DirtyRecord = { namespace, key, data, deleted, bindingRevision, localVersion,
      updatedAt: Date.now(), mutationId: `${this.writerId}:${localVersion}` };
    this.dirty.set(fullKey, dirty);
    this.options.mirror.publish({ schemaVersion: 1, namespace, key, recordRevision: this.options.mirror.committedVersion(namespace, key),
      updatedAt: dirty.updatedAt, bindingRevision, mutationId: dirty.mutationId, deleted, data });
    if (this.oldestDirtyAt === 0) this.oldestDirtyAt = Date.now();
    this.publish();
    this.schedule();
  }

  private schedule(retry = false): void {
    if (this.stopped || this.flushPromise || this.dirty.size === 0) return;
    if (this.timer) clearTimeout(this.timer);
    const age = this.oldestDirtyAt ? Date.now() - this.oldestDirtyAt : 0;
    const delay = retry ? this.retryDelayMs : Math.max(0,
      Math.min(this.options.debounceMs ?? 500, (this.options.maxDirtyAgeMs ?? 2000) - age));
    this.timer = setTimeout(() => {
      this.timer = null;
      // The observable error remains visible and dirty state is retained. Explicit
      // flush callers receive the rejection; timer callbacks do not leak one.
      void this.flush().catch(() => undefined);
    }, delay);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  flush(targetRevision?: number): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.flushPromise) return this.flushPromise;
    const operation = Promise.resolve().then(() => this.drain(targetRevision));
    this.flushPromise = operation;
    this.publish();
    void operation.then(() => {
      this.retryDelayMs = 1000;
      this.publish(null);
    }, (error: unknown) => {
      const actual = error instanceof Error ? error : new Error(String(error));
      this.retryDelayMs = Math.min(30_000, this.retryDelayMs * 2);
      this.publish(actual.message);
      this.options.onError?.(actual);
    }).finally(() => {
      if (this.flushPromise === operation) this.flushPromise = null;
      if (this.dirty.size === 0) this.oldestDirtyAt = 0;
      this.publish();
      this.schedule(this.state.error !== null);
    }).catch(() => undefined);
    return operation;
  }

  private async drain(targetRevision?: number): Promise<void> {
    const api = this.options.api();
    for (;;) {
      if (this.retryBatch.length === 0 && this.dirty.size > 0) {
        const selection = [...this.dirty.values()].slice(0, 16);
        await Promise.all(selection.map((entry) => this.options.mirror.hydrate(entry.namespace, [entry.key])));
        this.retryBatch = selection.map((entry) => ({ localVersion: entry.localVersion, record: {
          schemaVersion: 1, namespace: entry.namespace, key: entry.key,
          recordRevision: this.options.mirror.committedVersion(entry.namespace, entry.key) + 1,
          updatedAt: entry.updatedAt, mutationId: entry.mutationId, bindingRevision: entry.bindingRevision,
          deleted: entry.deleted, data: entry.data,
        } }));
      }
      if (this.retryBatch.length > 0) {
        const dispatched = this.retryBatch;
        const result = await api.commit({ records: dispatched.map((entry) => entry.record) });
        this.lastReceipt = result;
        const acknowledged = new Set<string>();
        for (const ack of result.acknowledgements) {
          const key = desktopStateRecordKey(ack.namespace, ack.key);
          const sent = dispatched.find((entry) => entry.record.namespace === ack.namespace && entry.record.key === ack.key);
          if (!sent || ack.recordRevision !== sent.record.recordRevision || ack.mutationId !== sent.record.mutationId || acknowledged.has(key)) {
            throw new Error('Desktop persistence returned an unexpected acknowledgement.');
          }
          acknowledged.add(key);
          this.options.mirror.acknowledge(ack.namespace, ack.key, ack.recordRevision);
          if (this.dirty.get(key)?.localVersion === sent.localVersion) this.dirty.delete(key);
        }
        this.retryBatch = dispatched.filter((entry) => !acknowledged.has(desktopStateRecordKey(entry.record.namespace, entry.record.key)));
        this.publish();
        if (result.status !== 'committed' || this.retryBatch.length > 0) {
          throw new Error(result.errorMessage ?? 'Desktop state was only partially committed.');
        }
        continue;
      }
      const flush = await api.flush({ targetRevision: targetRevision ?? this.lastReceipt?.operationWatermark,
        serviceEpoch: this.lastReceipt?.serviceEpoch });
      if (flush.status !== 'flushed') throw new Error(flush.errorMessage ?? 'Desktop state flush was not acknowledged.');
      // New writes arriving during the barrier also drain. No timer is allowed to
      // expire behind an in-flight commit and leave its new dirty value stranded.
      if (this.dirty.size === 0) return;
    }
  }

  /** Stop only after a successful barrier. Does not provide a discard-unsaved-data path. */
  async dispose(): Promise<void> {
    await this.flush();
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
