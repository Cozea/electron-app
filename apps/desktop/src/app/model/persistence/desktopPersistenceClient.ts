/**
 * Renderer Desktop State Persistence Client
 * Conforms to Section 10.3 & 10.4 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Pure in-memory reads (peekLayout, peekModel): zero synchronous localStorage calls on hot path (Invariant I08)
 * - Coalesces dirty records before serialization; dispatches in batches to Electron IPC (Section 10.3)
 * - Safe async flush-through-revision contract (Section 10.6, M18)
 * - Monotonic per-key revision tracking
 */

import type {
  DesktopStateNamespace,
  DesktopStateRecord,
} from '@shared/desktopPersistenceTypes';
import { navigationMetrics } from '@/lib/performance/navigationMetrics';

interface LayoutRecordData {
  layout: unknown;
  layoutResetKey: number;
}

class DesktopPersistenceClient {
  // In-memory hydrated mirrors
  private layoutMirror = new Map<string, LayoutRecordData>();
  private modelMirror = new Map<string, unknown>();
  private queryCacheMirror = new Map<string, unknown>();
  private routeMirror = new Map<string, string>();

  // Dirty queues
  private dirtyRecords = new Map<string, DesktopStateRecord>();
  private keyRevisions = new Map<string, number>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private oldestDirtyAt = 0;
  private isFlushing = false;

  private DEBOUNCE_MS = 500;
  private MAX_DIRTY_AGE_MS = 2000;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        void this.flush();
      });
    }
  }

  // --- 1. Synchronous in-memory peeks (Section 10.4, F06) ---
  peekLayout(scopeKey: string, layoutResetKey: number): unknown | null {
    const entry = this.layoutMirror.get(scopeKey);
    if (!entry || entry.layoutResetKey !== layoutResetKey) {
      return null;
    }
    return entry.layout;
  }

  setLayoutInMemory(scopeKey: string, layoutResetKey: number, layout: unknown): void {
    this.layoutMirror.set(scopeKey, { layout, layoutResetKey });
  }

  clearLayoutsForProject(projectId: string): void {
    const prefix = `${projectId}::`;
    for (const key of Array.from(this.layoutMirror.keys())) {
      if (key.startsWith(prefix)) {
        this.layoutMirror.delete(key);
        this.queueDirtyRecord('workbenchLayout', key, { layout: null, layoutResetKey: 0 });
      }
    }
  }

  peekModel(scopeKey: string): unknown | null {
    return this.modelMirror.get(scopeKey) ?? null;
  }

  setModelInMemory(scopeKey: string, model: unknown): void {
    this.modelMirror.set(scopeKey, model);
  }

  peekQuery(key: string): unknown | null {
    return this.queryCacheMirror.get(key) ?? null;
  }

  setQueryInMemory(key: string, data: unknown): void {
    this.queryCacheMirror.set(key, data);
  }

  // --- 2. Asynchronous Hydration (Section 10.5) ---
  async hydrateNamespace(namespace: DesktopStateNamespace, keys?: string[]): Promise<void> {
    const api = typeof window !== 'undefined' ? window.electronAPI?.desktopPersistence : undefined;
    if (!api) return;

    try {
      const result = await api.load({ namespace, keys });
      for (const rec of result.records) {
        this.keyRevisions.set(`${rec.namespace}::${rec.key}`, rec.recordRevision);
        if (rec.namespace === 'workbenchLayout') {
          const data = rec.data as LayoutRecordData;
          this.layoutMirror.set(rec.key, data);
        } else if (rec.namespace === 'workbenchModel') {
          this.modelMirror.set(rec.key, rec.data);
        } else if (rec.namespace === 'queryCache') {
          this.queryCacheMirror.set(rec.key, rec.data);
        } else if (rec.namespace === 'lastWorkbenchRoute') {
          this.routeMirror.set(rec.key, String(rec.data));
        }
      }
    } catch (err) {
      console.warn(`[DesktopPersistenceClient] Hydration failed for ${namespace}:`, err);
    }
  }

  // --- 3. Queue dirty changes (Section 10.3) ---
  queueDirtyRecord<T>(
    namespace: DesktopStateNamespace,
    key: string,
    data: T,
    bindingRevision?: number
  ): void {
    const fullKey = `${namespace}::${key}`;
    const nextRevision = (this.keyRevisions.get(fullKey) ?? 0) + 1;
    this.keyRevisions.set(fullKey, nextRevision);

    const record: DesktopStateRecord<T> = {
      schemaVersion: 1,
      namespace,
      key,
      recordRevision: nextRevision,
      updatedAt: Date.now(),
      bindingRevision,
      data,
    };

    // Update in-memory mirror immediately
    if (namespace === 'workbenchLayout') {
      this.layoutMirror.set(key, data as unknown as LayoutRecordData);
    } else if (namespace === 'workbenchModel') {
      this.modelMirror.set(key, data);
    } else if (namespace === 'queryCache') {
      this.queryCacheMirror.set(key, data);
    }

    this.dirtyRecords.set(fullKey, record as DesktopStateRecord);
    navigationMetrics.increment('dirtyRecordCount');

    if (this.oldestDirtyAt === 0) {
      this.oldestDirtyAt = Date.now();
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      const age = Date.now() - this.oldestDirtyAt;
      if (age < this.MAX_DIRTY_AGE_MS) {
        return; // debounce window active
      }
      // Force flush if oldest dirty exceeds 2s
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.DEBOUNCE_MS);
  }

  async flush(targetRevision?: number): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.oldestDirtyAt = 0;

    const api = typeof window !== 'undefined' ? window.electronAPI?.desktopPersistence : undefined;
    if (!api) return;

    if (this.dirtyRecords.size === 0) {
      await api.flush({ targetRevision }).catch(() => {});
      return;
    }

    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      const recordsToCommit = Array.from(this.dirtyRecords.values());
      const startTime = performance.now();

      const result = await api.commit({ records: recordsToCommit });

      const duration = performance.now() - startTime;
      navigationMetrics.increment('rendererDispatchMs', duration);

      if (result.status === 'committed') {
        for (const rec of recordsToCommit) {
          const fullKey = `${rec.namespace}::${rec.key}`;
          // Only remove if not dirtied again with a newer revision while awaiting commit
          const currentQueued = this.dirtyRecords.get(fullKey);
          if (currentQueued && currentQueued.recordRevision <= rec.recordRevision) {
            this.dirtyRecords.delete(fullKey);
          }
        }
      }

      await api.flush({ targetRevision });
    } catch (err) {
      console.warn('[DesktopPersistenceClient] Commit/flush failed:', err);
      navigationMetrics.increment('persistenceFailures');
    } finally {
      this.isFlushing = false;
    }
  }
}

export const desktopPersistenceClient = new DesktopPersistenceClient();
