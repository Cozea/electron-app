import type { DesktopPersistenceApi, DesktopStateNamespace, DesktopStateRecord } from '@shared/desktopPersistenceTypes';
import { ensureLegacyDesktopNamespace } from './migrateLegacyDesktopState';
import { PersistenceMirror } from './persistenceMirror';
import { PersistenceWriteQueue } from './persistenceWriteQueue';

interface ClientOptions {
  api: () => DesktopPersistenceApi | undefined;
  beforeHydrate?: (namespace: DesktopStateNamespace) => Promise<void>;
  onError?: (error: Error) => void;
  debounceMs?: number;
  maxDirtyAgeMs?: number;
}

export class DesktopPersistenceClient {
  private readonly mirror: PersistenceMirror;
  private readonly queue: PersistenceWriteQueue;

  constructor(options: ClientOptions) {
    const api = () => {
      const bridge = options.api();
      if (!bridge) throw new Error('The desktop persistence bridge is unavailable; local state has not been saved.');
      return bridge;
    };
    this.mirror = new PersistenceMirror({ api, beforeHydrate: options.beforeHydrate,
      isDirty: (key) => this.queue.hasDirty(key) });
    this.queue = new PersistenceWriteQueue({ ...options, api, mirror: this.mirror });
  }
  subscribe = (listener: () => void) => this.queue.subscribe(listener);
  getSnapshot = () => this.queue.getSnapshot();
  subscribeNamespace(namespace: DesktopStateNamespace, listener: () => void): () => void {
    return this.mirror.subscribe(namespace, listener);
  }
  getNamespaceVersion(namespace: DesktopStateNamespace): number { return this.mirror.version(namespace); }
  isHydrated(namespace: DesktopStateNamespace, key?: string): boolean { return this.mirror.isHydrated(namespace, key); }
  hydrateNamespace(namespace: DesktopStateNamespace, keys?: string[]): Promise<void> { return this.mirror.hydrate(namespace, keys); }
  peekRecord<T>(namespace: DesktopStateNamespace, key: string): DesktopStateRecord<T> | null { return this.mirror.peek<T>(namespace, key); }
  peekNamespace<T>(namespace: DesktopStateNamespace): ReadonlyMap<string, DesktopStateRecord<T>> { return this.mirror.entries<T>(namespace); }
  peekLayout(scopeKey: string, layoutResetKey: number): unknown | null {
    const entry = this.mirror.peek<{ layout: unknown; layoutResetKey: number }>('workbenchLayout', scopeKey);
    return entry?.data.layoutResetKey === layoutResetKey ? entry.data.layout : null;
  }
  peekModel(scopeKey: string): unknown | null { return this.mirror.peek('workbenchModel', scopeKey)?.data ?? null; }
  peekQuery(key: string): unknown | null { return this.mirror.peek('queryCache', key)?.data ?? null; }

  /** A memory-only seed never claims hydration or durable persistence. */
  private seed(namespace: DesktopStateNamespace, key: string, data: unknown): void {
    this.mirror.publish({ schemaVersion: 1, namespace, key, data, updatedAt: 0,
      recordRevision: this.mirror.committedVersion(namespace, key) });
  }
  setLayoutInMemory(key: string, layoutResetKey: number, layout: unknown): void { this.seed('workbenchLayout', key, { layout, layoutResetKey }); }
  setModelInMemory(key: string, model: unknown): void { this.seed('workbenchModel', key, model); }
  setQueryInMemory(key: string, data: unknown): void { this.seed('queryCache', key, data); }
  queueDirtyRecord<T>(namespace: DesktopStateNamespace, key: string, data: T, bindingRevision?: number): void {
    this.queue.queue(namespace, key, data, bindingRevision);
  }
  async deleteRecord(namespace: DesktopStateNamespace, key: string): Promise<void> {
    await this.hydrateNamespace(namespace, [key]);
    this.queue.queue(namespace, key, null, undefined, true);
  }
  async clearLayoutsForProject(projectId: string): Promise<void> {
    await this.hydrateNamespace('workbenchLayout');
    for (const key of this.peekNamespace('workbenchLayout').keys()) {
      if (key.startsWith(`${projectId}::`)) this.queue.queue('workbenchLayout', key, null, undefined, true);
    }
  }
  flush(targetRevision?: number): Promise<void> { return this.queue.flush(targetRevision); }
  dispose(): Promise<void> { return this.queue.dispose(); }
}

export const desktopPersistenceClient = new DesktopPersistenceClient({
  api: () => typeof window === 'undefined' ? undefined : window.electronAPI?.desktopPersistence as DesktopPersistenceApi | undefined,
  beforeHydrate: ensureLegacyDesktopNamespace,
  onError: (error) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cozea:persistence-error', { detail: error.message }));
  },
});
