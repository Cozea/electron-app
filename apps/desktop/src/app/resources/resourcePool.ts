import { KeyedResource, type KeyedResourceOptions } from './keyedResource';

/** Bounds idle read-cache memory without evicting a mounted consumer or an in-flight request. */
export class ResourcePool<T, M> {
  private readonly entries = new Map<string, { resource: KeyedResource<T>; metadata: M }>();
  constructor(private readonly options: { maxIdle?: number; idleTtlMs?: number; onDemandChange?: () => void } = {}) {}
  get(key: string, metadata: M, options: Omit<KeyedResourceOptions<T>, 'key' | 'onDemandChange'>): KeyedResource<T> {
    const current = this.entries.get(key);
    if (current) return current.resource;
    // Prune before adding so the just-created handle cannot be immediately evicted.
    this.prune();
    const resource = new KeyedResource({ ...options, key, onDemandChange: () => {
      this.options.onDemandChange?.();
    } });
    this.entries.set(key, { resource, metadata });
    return resource;
  }
  values(): Array<{ resource: KeyedResource<T>; metadata: M }> { return [...this.entries.values()]; }
  invalidate(matches: (metadata: M) => boolean, reason: string): void {
    for (const entry of this.entries.values()) if (matches(entry.metadata)) entry.resource.invalidate(reason);
  }
  prune(now = Date.now()): void {
    const idle = [...this.entries].filter(([, entry]) => entry.resource.isIdle)
      .sort(([, a], [, b]) => a.resource.lastTouchedAt - b.resource.lastTouchedAt);
    const maxIdle = this.options.maxIdle ?? 128;
    const ttl = this.options.idleTtlMs ?? 10 * 60_000;
    for (let index = 0; index < idle.length; index++) {
      const [key, entry] = idle[index]!;
      if (idle.length - index <= maxIdle && now - entry.resource.lastTouchedAt <= ttl) break;
      entry.resource.dispose();
      this.entries.delete(key);
    }
  }
  get size(): number { return this.entries.size; }
}
