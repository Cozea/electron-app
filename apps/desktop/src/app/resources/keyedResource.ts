/**
 * Minimal Keyed Resource State Machine
 * Conforms to Section 6.1 & 6.2 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Pure TypeScript state machine; zero React / Router / Electron runtime dependencies
 * - Stable snapshots: getSnapshot() / read() returns the same reference until data or status actually changes
 * - Single in-flight promise per generation (N01, N02)
 * - Invalidation increments generation immediately; older in-flight requests cannot publish or overwrite (N03)
 * - Refresh failure retains cached data while exposing refresh state (N04)
 * - Authoritative null / error terminates valid status (N05)
 */

export type ResourceSnapshot<T> =
  | { status: 'empty'; generation: number }
  | { status: 'loading'; generation: number }
  | {
      status: 'ready';
      generation: number;
      data: T;
      refreshing: boolean;
      error: Error | null;
    }
  | { status: 'error'; generation: number; error: Error };

export class ResourceSupersededError extends Error {
  constructor(message = 'Resource request superseded by a newer generation or invalidation') {
    super(message);
    this.name = 'ResourceSupersededError';
  }
}

export type ResourceReason = 'prefetch' | 'navigation' | 'refresh' | 'resume';

export type DemandKind = 'foreground' | 'expanded-sidebar' | 'background';

export interface ResourceHandle<T> {
  read(): ResourceSnapshot<T>;
  subscribe(listener: () => void): () => void;
  ensure(reason: 'prefetch' | 'navigation' | 'refresh' | 'resume'): Promise<T>;
  invalidate(reason: string): void;
  acquireDemand(kind: DemandKind): () => void;
  getDemand(kind: DemandKind): number;
}

export interface KeyedResourceOptions<T> {
  key: string;
  fetcher: (reason: ResourceReason) => Promise<T>;
  ttlMs?: number;
  equalityFn?: (a: T, b: T) => boolean;
}

export class KeyedResource<T> implements ResourceHandle<T> {
  public readonly key: string;
  private readonly fetcher: (reason: ResourceReason) => Promise<T>;
  private readonly ttlMs: number;
  private readonly equalityFn?: (a: T, b: T) => boolean;

  private lastAccessedAt = Date.now();
  private generation = 0;
  private snapshot: ResourceSnapshot<T>;
  private inflight: Promise<T> | null = null;
  private inflightGeneration = -1;
  private lastSuccessfulReadAt = 0;
  private listeners = new Set<() => void>();
  private demandCounts: Record<DemandKind, number> = {
    foreground: 0,
    'expanded-sidebar': 0,
    background: 0,
  };

  constructor(options: KeyedResourceOptions<T>) {
    this.key = options.key;
    this.fetcher = options.fetcher;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.equalityFn = options.equalityFn;
    this.snapshot = { status: 'empty', generation: 0 };
  }

  read(): ResourceSnapshot<T> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.lastAccessedAt = Date.now();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.lastAccessedAt = Date.now();
    };
  }

  acquireDemand(kind: DemandKind): () => void {
    this.lastAccessedAt = Date.now();
    this.demandCounts[kind]++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.demandCounts[kind] = Math.max(0, this.demandCounts[kind] - 1);
      this.lastAccessedAt = Date.now();
    };
  }

  getDemand(kind: DemandKind): number {
    return this.demandCounts[kind];
  }

  invalidate(_reason: string): void {
    this.generation++;
    // If we had an in-flight promise for the previous generation, decouple it
    this.inflight = null;
    this.inflightGeneration = -1;

    // Reset snapshot to empty or invalidate cached state
    this.snapshot = { status: 'empty', generation: this.generation };
    this.notify();
  }

  get idle(): boolean {
    return this.inflight === null && this.listeners.size === 0 && Object.values(this.demandCounts).every(count => count === 0);
  }

  get lastAccessTime(): number { return this.lastAccessedAt; }

  touch(): void { this.lastAccessedAt = Date.now(); }

  /** Seed an unused handle from an already validated in-memory catalog entry. */
  prime(data: T): void {
    if (this.snapshot.status !== 'empty' || this.inflight) return;
    this.lastSuccessfulReadAt = Date.now();
    this.snapshot = { status: 'ready', generation: this.generation, data, refreshing: false, error: null };
    this.notify();
  }

  ensure(reason: ResourceReason): Promise<T> {
    const now = Date.now();
    this.lastAccessedAt = now;

    // 1. If valid cached data exists and TTL has not expired, return cached data unless explicit refresh
    if (
      this.snapshot.status === 'ready' &&
      reason !== 'refresh' &&
      now - this.lastSuccessfulReadAt < this.ttlMs
    ) {
      return Promise.resolve(this.snapshot.data);
    }

    // 2. If an in-flight operation exists for the current generation, share it (Invariants I06, N01, N02)
    if (this.inflight !== null && this.inflightGeneration === this.generation) {
      return this.inflight;
    }

    // 3. Start a new request for the current generation
    const requestGen = this.generation;
    this.inflightGeneration = requestGen;
    // Publish the shared promise BEFORE notifying subscribers or invoking a
    // fetcher. Reentrant subscribers and synchronous throws must not create a
    // second request or leave a settled request installed as in-flight.
    let resolveRequest!: (value: T) => void;
    let rejectRequest!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    this.inflight = promise;

    // Update snapshot to loading or refreshing
    if (this.snapshot.status === 'ready') {
      this.snapshot = {
        ...this.snapshot,
        refreshing: true,
      };
      this.notify();
    } else {
      this.snapshot = { status: 'loading', generation: requestGen };
      this.notify();
    }

    const perform = async () => {
      try {
        const result = await this.fetcher(reason);

        // If generation changed while awaiting, reject with ResourceSupersededError (N03)
        if (this.generation !== requestGen) {
          throw new ResourceSupersededError();
        }

        this.lastSuccessfulReadAt = Date.now();

        // Check equality to preserve object identity if unchanged (Section 6.2, N10)
        let dataToSet: T = result as T;
        if (this.snapshot.status === 'ready' && this.equalityFn && this.equalityFn(this.snapshot.data, result as T)) {
          dataToSet = this.snapshot.data;
        }

        this.snapshot = {
          status: 'ready',
          generation: requestGen,
          data: dataToSet,
          refreshing: false,
          error: null,
        };
        this.notify();
        return dataToSet;
      } catch (err) {
        if (this.generation !== requestGen) {
          throw new ResourceSupersededError();
        }

        const error = err instanceof Error ? err : new Error(String(err));

        // Background refresh failure: cached display survives; error visible as refresh state (N04)
        if (this.snapshot.status === 'ready') {
          this.snapshot = {
            ...this.snapshot,
            refreshing: false,
            error,
          };
          this.notify();
          return this.snapshot.data;
        } else {
          this.snapshot = {
            status: 'error',
            generation: requestGen,
            error,
          };
          this.notify();
          throw error;
        }
      } finally {
        // Clear in-flight reference only if it matches this request generation
        if (this.inflightGeneration === requestGen) {
          this.inflight = null;
          this.inflightGeneration = -1;
        }
      }
    };
    void perform().then(resolveRequest, rejectRequest);
    return promise;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error('[KeyedResource] Listener error:', e);
      }
    }
  }
}
