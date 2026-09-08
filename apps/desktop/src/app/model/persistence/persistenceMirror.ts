import {
  desktopStateRecordKey, type DesktopPersistenceApi, type DesktopStateNamespace, type DesktopStateRecord,
} from '@shared/desktopPersistenceTypes';

interface MirrorOptions {
  api: () => DesktopPersistenceApi;
  beforeHydrate?: (namespace: DesktopStateNamespace) => Promise<void>;
  isDirty: (key: string) => boolean;
}

/** Reactive memory mirror. Absence is usable only after a successful load of that scope. */
export class PersistenceMirror {
  private readonly records = new Map<string, DesktopStateRecord>();
  private readonly committedVersions = new Map<string, number>();
  private readonly readyKeys = new Set<string>();
  private readonly readyNamespaces = new Set<DesktopStateNamespace>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly versions = new Map<DesktopStateNamespace, number>();
  private readonly listeners = new Map<DesktopStateNamespace, Set<() => void>>();

  constructor(private readonly options: MirrorOptions) {}

  subscribe(namespace: DesktopStateNamespace, listener: () => void): () => void {
    let listeners = this.listeners.get(namespace);
    if (!listeners) { listeners = new Set(); this.listeners.set(namespace, listeners); }
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
  version(namespace: DesktopStateNamespace): number { return this.versions.get(namespace) ?? 0; }
  private emit(namespace: DesktopStateNamespace): void {
    this.versions.set(namespace, this.version(namespace) + 1);
    for (const listener of this.listeners.get(namespace) ?? []) listener();
  }
  isHydrated(namespace: DesktopStateNamespace, key?: string): boolean {
    return this.readyNamespaces.has(namespace) || (key !== undefined && this.readyKeys.has(desktopStateRecordKey(namespace, key)));
  }
  committedVersion(namespace: DesktopStateNamespace, key: string): number {
    return this.committedVersions.get(desktopStateRecordKey(namespace, key)) ?? 0;
  }
  acknowledge(namespace: DesktopStateNamespace, key: string, revision: number): void {
    const fullKey = desktopStateRecordKey(namespace, key);
    this.committedVersions.set(fullKey, Math.max(revision, this.committedVersion(namespace, key)));
    this.readyKeys.add(fullKey);
    const current = this.records.get(fullKey);
    if (current) this.records.set(fullKey, { ...current, recordRevision: revision });
    // An acknowledgement changes durability, not rendered data. No UI broadcast.
  }
  peek<T>(namespace: DesktopStateNamespace, key: string): DesktopStateRecord<T> | null {
    const record = this.records.get(desktopStateRecordKey(namespace, key));
    return (record && !record.deleted ? record : null) as DesktopStateRecord<T> | null;
  }
  entries<T>(namespace: DesktopStateNamespace): ReadonlyMap<string, DesktopStateRecord<T>> {
    const result = new Map<string, DesktopStateRecord<T>>();
    for (const record of this.records.values()) {
      if (record.namespace === namespace && !record.deleted) result.set(record.key, record as DesktopStateRecord<T>);
    }
    return result;
  }
  publish(record: DesktopStateRecord): void {
    this.records.set(desktopStateRecordKey(record.namespace, record.key), record);
    this.emit(record.namespace);
  }

  hydrate(namespace: DesktopStateNamespace, keys?: string[]): Promise<void> {
    if (keys?.length === 0 || this.readyNamespaces.has(namespace)) return Promise.resolve();
    if (keys && keys.every((key) => this.isHydrated(namespace, key))) return Promise.resolve();
    const wholeKey = JSON.stringify(['namespace', namespace]);
    const wholeLoad = this.pending.get(wholeKey);
    if (keys && wholeLoad) return wholeLoad;
    if (keys && keys.length > 1) return Promise.all(keys.map((key) => this.hydrate(namespace, [key]))).then(() => undefined);
    const loadKey = keys ? desktopStateRecordKey(namespace, keys[0]!) : wholeKey;
    const existing = this.pending.get(loadKey);
    if (existing) return existing;

    const operation = Promise.resolve().then(async () => {
      let migrationError: unknown;
      try { await this.options.beforeHydrate?.(namespace); } catch (error) { migrationError = error; }
      const result = await this.options.api().load({ namespace, keys });
      const loaded = new Set<string>();
      for (const record of result.records) {
        if (record.namespace !== namespace || (keys && !keys.includes(record.key))) {
          throw new Error('Persistence returned a record outside the requested scope.');
        }
        loaded.add(record.key);
        const fullKey = desktopStateRecordKey(namespace, record.key);
        const knownRevision = this.committedVersion(namespace, record.key);
        if (record.recordRevision < knownRevision) continue;
        this.committedVersions.set(fullKey, record.recordRevision);
        // A fresh query result or user edit can arrive while disk is loading.
        // Its immutable in-memory value wins, while the committed version is learned.
        if (!this.options.isDirty(fullKey)) this.records.set(fullKey, record);
        this.readyKeys.add(fullKey);
      }
      for (const key of keys ?? []) {
        const hasIssue = result.issues.some((issue) => issue.key === null || issue.key === key);
        if (!loaded.has(key) && !migrationError && !hasIssue) {
          this.readyKeys.add(desktopStateRecordKey(namespace, key));
          // Never lower a version already acknowledged by an overlapping write.
          if (!this.committedVersions.has(desktopStateRecordKey(namespace, key))) {
            this.committedVersions.set(desktopStateRecordKey(namespace, key), 0);
          }
        }
      }
      if (!keys && !migrationError && result.issues.length === 0) this.readyNamespaces.add(namespace);
      this.emit(namespace);
      if (result.issues.length > 0) throw new Error(result.issues.map((issue) => issue.message).join('; '));
      // Confirmed valid neighbors remain usable after a partially corrupt legacy
      // import. An absent scope is NOT confirmed empty when migration failed.
      if (migrationError && (!keys || keys.some((key) => !loaded.has(key)))) throw migrationError;
    });
    this.pending.set(loadKey, operation);
    void operation.finally(() => { if (this.pending.get(loadKey) === operation) this.pending.delete(loadKey); }).catch(() => undefined);
    return operation;
  }
}
