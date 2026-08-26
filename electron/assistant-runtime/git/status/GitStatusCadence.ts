/**
 * Local vs remote git status refresh cadence (Wave 0 Track F prep).
 *
 * ADR: This is a temporary, local-first split of the agent status path so local
 * porcelain reads stay snappy while upstream fetch / ahead-behind refresh is
 * slower or demand-gated. In Phase 4c this collapses into T3
 * `VcsStatusBroadcaster.streamStatus` — do **not** grow a permanent second
 * broadcaster or checkpoint stack here. Prefer adapting callers onto the
 * substrate status stream when 4c lands.
 *
 * @see docs/git-status-local-remote-prep.md
 */

export type GitStatusInvalidationScope = "local" | "remote" | "all";

/** Local working-tree reads are always eligible; no throttle. */
export const DEFAULT_LOCAL_STATUS_REFRESH_MS = 0;

/**
 * Remote upstream fetch / ahead-behind refresh interval.
 * Matches T3 VcsStatusBroadcaster default (30s) — slower than the previous
 * monolithic 15s fetch-on-every-status path.
 */
export const DEFAULT_REMOTE_STATUS_REFRESH_MS = 30_000;

export interface GitStatusCadenceOptions {
  readonly remoteRefreshIntervalMs?: number;
  readonly now?: () => number;
}

export interface GitStatusCadenceSnapshot {
  readonly remoteLastRefreshByCwd: ReadonlyMap<string, number>;
  readonly remoteInvalidatedCwds: ReadonlySet<string>;
  readonly localInvalidatedCwds: ReadonlySet<string>;
}

function normalizeCwdKey(cwd: string): string {
  // Keep keys stable without requiring fs.realpath — callers may invalidate
  // before a repo path exists. Realpath normalization can land with VcsDriver.
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "") || cwd;
}

/**
 * Pure cadence controller: decides when remote status may refresh and records
 * invalidations other services (journal/sync in 4c) can trigger.
 */
export class GitStatusCadenceController {
  private readonly remoteRefreshIntervalMs: number;
  private readonly now: () => number;
  private readonly remoteLastRefreshByCwd = new Map<string, number>();
  private readonly remoteInvalidatedCwds = new Set<string>();
  private readonly localInvalidatedCwds = new Set<string>();

  constructor(options?: GitStatusCadenceOptions) {
    this.remoteRefreshIntervalMs =
      options?.remoteRefreshIntervalMs ?? DEFAULT_REMOTE_STATUS_REFRESH_MS;
    this.now = options?.now ?? Date.now;
  }

  /** Local status is always refreshable (fast path). */
  shouldRefreshLocal(_cwd: string): boolean {
    return true;
  }

  /**
   * Remote refresh when never fetched, interval elapsed, or explicitly invalidated.
   * Pass `{ force: true }` for demand-gated refresh (user action / explicit RPC).
   */
  shouldRefreshRemote(cwd: string, options?: { force?: boolean; nowMs?: number }): boolean {
    if (options?.force) {
      return true;
    }
    const key = normalizeCwdKey(cwd);
    if (this.remoteInvalidatedCwds.has(key)) {
      return true;
    }
    const last = this.remoteLastRefreshByCwd.get(key);
    if (last === undefined) {
      return true;
    }
    const nowMs = options?.nowMs ?? this.now();
    return nowMs - last >= this.remoteRefreshIntervalMs;
  }

  markRemoteRefreshed(cwd: string, nowMs?: number): void {
    const key = normalizeCwdKey(cwd);
    this.remoteLastRefreshByCwd.set(key, nowMs ?? this.now());
    this.remoteInvalidatedCwds.delete(key);
  }

  /**
   * Mark local cache stale. Track F does not cache local porcelain yet; the
   * flag exists so Phase 4c / journal callers have a stable API.
   */
  markLocalInvalidated(cwd: string): void {
    this.localInvalidatedCwds.add(normalizeCwdKey(cwd));
  }

  clearLocalInvalidation(cwd: string): void {
    this.localInvalidatedCwds.delete(normalizeCwdKey(cwd));
  }

  isLocalInvalidated(cwd: string): boolean {
    return this.localInvalidatedCwds.has(normalizeCwdKey(cwd));
  }

  invalidate(cwd: string, scope: GitStatusInvalidationScope = "all"): void {
    const key = normalizeCwdKey(cwd);
    if (scope === "local" || scope === "all") {
      this.localInvalidatedCwds.add(key);
    }
    if (scope === "remote" || scope === "all") {
      this.remoteInvalidatedCwds.add(key);
      // Drop last-refresh so the next shouldRefreshRemote is true even if
      // interval has not elapsed.
      this.remoteLastRefreshByCwd.delete(key);
    }
  }

  snapshot(): GitStatusCadenceSnapshot {
    return {
      remoteLastRefreshByCwd: new Map(this.remoteLastRefreshByCwd),
      remoteInvalidatedCwds: new Set(this.remoteInvalidatedCwds),
      localInvalidatedCwds: new Set(this.localInvalidatedCwds),
    };
  }

  /** Test helper: reset all cadence state. */
  reset(): void {
    this.remoteLastRefreshByCwd.clear();
    this.remoteInvalidatedCwds.clear();
    this.localInvalidatedCwds.clear();
  }
}
