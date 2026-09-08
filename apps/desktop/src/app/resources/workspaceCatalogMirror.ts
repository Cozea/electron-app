import type { WorkspaceCatalogSnapshot, WorkspaceCatalogSnapshotEntry } from '@shared/workspaceTypes';

interface CatalogBridge {
  getCatalogSnapshot(): Promise<WorkspaceCatalogSnapshot>;
  onCatalogSnapshotChanged(listener: (snapshot: WorkspaceCatalogSnapshot) => void): () => void;
}

export class WorkspaceCatalogMirror {
  private snapshot: WorkspaceCatalogSnapshot | null = null;
  private pending: Promise<WorkspaceCatalogSnapshot> | null = null;
  private disconnect: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly changes = new Set<(previous: WorkspaceCatalogSnapshot | null, next: WorkspaceCatalogSnapshot) => void>();

  private readonly bridge: () => CatalogBridge | undefined;
  constructor(bridge: () => CatalogBridge | undefined) { this.bridge = bridge; }
  getSnapshot = (): WorkspaceCatalogSnapshot | null => this.snapshot;
  getEntry(projectId: string): WorkspaceCatalogSnapshotEntry | null { return this.snapshot?.entries[projectId] ?? null; }
  getWorkspace(workspaceId: string): WorkspaceCatalogSnapshotEntry | null {
    return Object.values(this.snapshot?.entries ?? {}).find((entry) => entry.workspace.workspaceId === workspaceId) ?? null;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.ensure().catch(() => undefined);
    return () => { this.listeners.delete(listener); };
  };
  onChange(listener: (previous: WorkspaceCatalogSnapshot | null, next: WorkspaceCatalogSnapshot) => void): () => void {
    this.changes.add(listener);
    void this.ensure().catch(() => undefined);
    return () => { this.changes.delete(listener); };
  }
  publish(next: WorkspaceCatalogSnapshot): void {
    if (this.snapshot && next.revision <= this.snapshot.revision) return;
    const previous = this.snapshot;
    const entries: WorkspaceCatalogSnapshot['entries'] = {};
    for (const [projectId, entry] of Object.entries(next.entries)) {
      const old = previous?.entries[projectId];
      entries[projectId] = old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry;
    }
    this.snapshot = { ...next, entries };
    for (const listener of this.changes) listener(previous, this.snapshot);
    for (const listener of this.listeners) listener();
  }
  ensure(): Promise<WorkspaceCatalogSnapshot> {
    if (this.snapshot && this.disconnect) return Promise.resolve(this.snapshot);
    if (this.pending) return this.pending;
    const bridge = this.bridge();
    if (!bridge) return Promise.reject(new Error('Workspace catalog bridge is unavailable.'));
    // Subscribe BEFORE requesting so a newer push wins a racing initial response.
    this.disconnect ??= bridge.onCatalogSnapshotChanged((snapshot) => this.publish(snapshot));
    const request = Promise.resolve().then(() => bridge.getCatalogSnapshot()).then((snapshot) => {
      this.publish(snapshot);
      return this.snapshot ?? snapshot;
    });
    this.pending = request;
    void request.finally(() => { if (this.pending === request) this.pending = null; }).catch(() => undefined);
    return request;
  }
  dispose(): void {
    this.disconnect?.();
    this.disconnect = null;
    this.listeners.clear();
    this.changes.clear();
  }
}

export const workspaceCatalogMirror = new WorkspaceCatalogMirror(() => {
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI?.workspace;
  return bridge;
});
