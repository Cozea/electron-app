export type ResourceReason = 'prefetch' | 'navigation' | 'refresh' | 'resume';
export type DemandKind = 'foreground' | 'expanded-sidebar' | 'background';
export type ResourceSnapshot<T> =
  | { status: 'empty'; generation: number }
  | { status: 'loading'; generation: number }
  | { status: 'ready'; generation: number; data: T; refreshing: boolean; error: Error | null }
  | { status: 'error'; generation: number; error: Error };

export class ResourceSupersededError extends Error {
  constructor() { super('Resource request superseded by invalidation or disposal'); this.name = 'ResourceSupersededError'; }
}
export class ResourceAccessError extends Error {
  constructor(message: string) { super(message); this.name = 'ResourceAccessError'; }
}
export interface ResourceHandle<T> {
  read(): ResourceSnapshot<T>;
  subscribe(listener: () => void): () => void;
  ensure(reason: ResourceReason): Promise<T>;
  invalidate(reason: string): void;
  acquireDemand(kind: DemandKind): () => void;
  getDemand(kind: DemandKind): number;
}
export interface KeyedResourceOptions<T> {
  key: string;
  fetcher: (context: { signal: AbortSignal; reason: ResourceReason }) => Promise<T>;
  ttlMs?: number;
  equalityFn?: (a: T, b: T) => boolean;
  onDemandChange?: () => void;
  retainOnError?: (error: Error) => boolean;
}

/** Shared reads only: no route activation, persistence or service ownership. */
export class KeyedResource<T> implements ResourceHandle<T> {
  readonly key: string;
  private generation = 0;
  private snapshot: ResourceSnapshot<T> = { status: 'empty', generation: 0 };
  private inflight: Promise<T> | null = null;
  private abort: AbortController | null = null;
  private lastSuccessAt = 0;
  private touchedAt = Date.now();
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly demands: Record<DemandKind, number> = { foreground: 0, 'expanded-sidebar': 0, background: 0 };

  constructor(private readonly options: KeyedResourceOptions<T>) { this.key = options.key; }
  read(): ResourceSnapshot<T> { return this.snapshot; }
  get lastTouchedAt(): number { return this.touchedAt; }
  get isIdle(): boolean { return !this.inflight && this.listeners.size === 0 && Object.values(this.demands).every((count) => count === 0); }
  get isPending(): boolean { return this.inflight !== null; }
  getDemand(kind: DemandKind): number { return this.demands[kind]; }
  private touch(): void { this.touchedAt = Date.now(); }
  subscribe(listener: () => void): () => void {
    if (this.disposed) throw new Error('A disposed resource cannot acquire subscribers.');
    this.touch();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); this.touch(); this.options.onDemandChange?.(); };
  }
  acquireDemand(kind: DemandKind): () => void {
    if (this.disposed) throw new Error('A disposed resource cannot acquire demand.');
    this.touch();
    this.demands[kind]++;
    this.options.onDemandChange?.();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.demands[kind]--;
      this.touch();
      this.options.onDemandChange?.();
    };
  }
  invalidate(_reason: string): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.inflight = null;
    this.snapshot = { status: 'empty', generation: this.generation };
    this.notify();
  }
  dispose(): void {
    if (!this.isIdle) throw new Error('Cannot dispose a resource with subscribers, requests or demand.');
    this.disposed = true;
    this.invalidate('dispose');
  }

  ensure(reason: ResourceReason): Promise<T> {
    if (this.disposed) return Promise.reject(new ResourceSupersededError());
    this.touch();
    // Join before considering TTL: a navigation during a refresh shares the exact read.
    if (this.inflight) return this.inflight;
    if (this.snapshot.status === 'ready' && reason !== 'refresh' && Date.now() - this.lastSuccessAt < (this.options.ttlMs ?? 60_000)) {
      return Promise.resolve(this.snapshot.data);
    }
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.snapshot = this.snapshot.status === 'ready'
      ? { ...this.snapshot, refreshing: true }
      : { status: 'loading', generation };
    // Install the promise before notifying listeners or invoking the fetcher.
    // Synchronous subscribers cannot cause a second read through re-entry.
    const request = Promise.resolve().then(() => this.options.fetcher({ signal: abort.signal, reason })).then((result) => {
      if (this.disposed || generation !== this.generation) throw new ResourceSupersededError();
      const data = this.snapshot.status === 'ready' && this.options.equalityFn?.(this.snapshot.data, result)
        ? this.snapshot.data : result;
      this.lastSuccessAt = Date.now();
      this.snapshot = { status: 'ready', generation, data, refreshing: false, error: null };
      this.notify();
      return data;
    }, (reason: unknown) => {
      if (this.disposed || generation !== this.generation) throw new ResourceSupersededError();
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const retain = !(error instanceof ResourceAccessError) && (this.options.retainOnError?.(error) ?? true);
      if (this.snapshot.status === 'ready' && retain) {
        this.snapshot = { ...this.snapshot, refreshing: false, error };
        this.notify();
        return this.snapshot.data;
      }
      this.snapshot = { status: 'error', generation, error };
      this.notify();
      throw error;
    });
    this.inflight = request;
    void request.finally(() => {
      if (this.inflight === request) { this.inflight = null; this.abort = null; }
    }).catch(() => undefined);
    this.notify();
    return request;
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
