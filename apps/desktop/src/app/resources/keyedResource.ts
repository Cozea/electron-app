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

export type DemandKind = 'foreground' | 'expanded-sidebar' | 'background';
export type ResourceEnsureReason = 'prefetch' | 'navigation' | 'refresh' | 'resume';

export interface ResourceHandle<T> {
  read(): ResourceSnapshot<T>;
  subscribe(listener: () => void): () => void;
  ensure(reason: ResourceEnsureReason): Promise<T>;
  invalidate(reason: string): void;
  acquireDemand(kind: DemandKind): () => void;
  getDemand(kind: DemandKind): number;
  getTotalDemand(): number;
  hasInFlightRequest(): boolean;
}

export interface KeyedResourceOptions<T> {
  key: string;
  fetcher: (reason: ResourceEnsureReason) => Promise<T>;
  ttlMs?: number;
  equalityFn?: (a: T, b: T) => boolean;
}

export class KeyedResource<T> implements ResourceHandle<T> {
  public readonly key: string;
  private readonly fetcher: (reason: ResourceEnsureReason) => Promise<T>;
  private readonly ttlMs: number;
  private readonly equalityFn?: (a: T, b: T) => boolean;

  private generation = 0;
  private snapshot: ResourceSnapshot<T>;
  private inflight: Promise<T> | null = null;
  private inflightGeneration = -1;
  private inflightReason: ResourceEnsureReason | null = null;
  private activeRequestCount = 0;
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
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  acquireDemand(kind: DemandKind): () => void {
    this.demandCounts[kind]++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.demandCounts[kind] = Math.max(0, this.demandCounts[kind] - 1);
    };
  }

  getDemand(kind: DemandKind): number {
    return this.demandCounts[kind];
  }

  getTotalDemand(): number {
    return Object.values(this.demandCounts).reduce((total, count) => total + count, 0);
  }

  hasInFlightRequest(): boolean {
    return this.activeRequestCount > 0;
  }

  invalidate(_reason: string): void {
    const previous = this.snapshot;
    const demanded = this.getTotalDemand() > 0;
    this.generation++;
    // If we had an in-flight promise for the previous generation, decouple it
    this.inflight = null;
    this.inflightGeneration = -1;
    this.inflightReason = null;

    if (previous.status === 'ready' && demanded) {
      this.snapshot = {
        ...previous,
        generation: this.generation,
        refreshing: true,
        error: null,
      };
    } else {
      this.snapshot = { status: 'empty', generation: this.generation };
    }
    this.notify();
    if (demanded) {
      void this.ensure('refresh').catch(() => undefined);
    }
  }

  async ensure(reason: ResourceEnsureReason): Promise<T> {
    const now = Date.now();

    // An explicit refresh supersedes an older navigation/prefetch request, but
    // simultaneous refresh callers still share the same refresh operation.
    if (
      reason === 'refresh' &&
      this.inflight !== null &&
      this.inflightGeneration === this.generation &&
      this.inflightReason !== 'refresh'
    ) {
      this.generation++;
      this.inflight = null;
      this.inflightGeneration = -1;
      this.inflightReason = null;
    }

    // 1. If valid cached data exists and TTL has not expired, return cached data unless explicit refresh
    if (
      this.snapshot.status === 'ready' &&
      reason !== 'refresh' &&
      now - this.lastSuccessfulReadAt < this.ttlMs
    ) {
      return this.snapshot.data;
    }

    // 2. If an in-flight operation exists for the current generation, share it (Invariants I06, N01, N02)
    if (this.inflight !== null && this.inflightGeneration === this.generation) {
      return this.inflight;
    }

    // 3. Start a new request for the current generation
    const requestGen = this.generation;
    this.inflightGeneration = requestGen;
    this.inflightReason = reason;

    // Update snapshot to loading or refreshing
    if (this.snapshot.status === 'ready') {
      this.snapshot = {
        ...this.snapshot,
        generation: requestGen,
        refreshing: true,
        error: null,
      };
      this.notify();
    } else {
      this.snapshot = { status: 'loading', generation: requestGen };
      this.notify();
    }

    this.activeRequestCount++;
    const promise = (async () => {
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
        this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
        // Clear in-flight reference only if it matches this request generation
        if (this.inflightGeneration === requestGen) {
          this.inflight = null;
          this.inflightGeneration = -1;
          this.inflightReason = null;
        }
      }
    })();

    this.inflight = promise;
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
