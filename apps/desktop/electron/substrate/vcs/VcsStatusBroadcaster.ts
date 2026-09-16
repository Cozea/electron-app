/**
 * Phase 4c — event-driven VCS status stream (replaces 10s GitChangesBroadcaster poll).
 *
 * Subscribers receive snapshots on invalidate + initial subscribe. No background poll.
 */

import path from "node:path";

import type { GitChangesScope, GitChangesSnapshot } from "../../../../../shared/electronApiTypes";
import { getChangesCheckpointReads } from "./checkpointsFacade";
import { countDiffLines } from "./diffStats";

const INVALIDATION_DEBOUNCE_MS = 250;

export type VcsStatusSnapshotListener = (
  projectPath: string,
  scope: GitChangesScope,
  snapshot: GitChangesSnapshot,
) => void;

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

function buildCacheKey(projectPath: string, scope: GitChangesScope): string {
  return `${projectPath}\0${scope}`;
}

export class VcsStatusBroadcaster {
  private static instance: VcsStatusBroadcaster | null = null;

  private readonly listeners = new Set<VcsStatusSnapshotListener>();
  private readonly snapshotsByKey = new Map<string, GitChangesSnapshot>();
  private readonly pendingRefreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly inflightRefreshes = new Map<string, Promise<GitChangesSnapshot>>();
  private readonly workspaceIdByPath = new Map<string, string>();

  static getInstance(): VcsStatusBroadcaster {
    if (!VcsStatusBroadcaster.instance) {
      VcsStatusBroadcaster.instance = new VcsStatusBroadcaster();
    }
    return VcsStatusBroadcaster.instance;
  }

  /** @internal test helper */
  static resetForTests(): void {
    VcsStatusBroadcaster.instance = null;
  }

  /** Register a listener for recomputed status snapshots. */
  subscribe(listener: VcsStatusSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Associate workspace id with project path for snapshot payloads. */
  registerWorkspaceId(projectPath: string, workspaceId: string): void {
    this.workspaceIdByPath.set(normalizeProjectPath(projectPath), workspaceId);
  }

  /** Read cached snapshot if available. */
  getCachedSnapshot(projectPath: string, scope: GitChangesScope): GitChangesSnapshot | null {
    return this.snapshotsByKey.get(buildCacheKey(normalizeProjectPath(projectPath), scope)) ?? null;
  }

  /** Invalidate and schedule refresh for all scopes on a repo path. */
  invalidateProjectPath(projectPath: string): void {
    const normalized = normalizeProjectPath(projectPath);
    for (const scope of ["current", "branch"] as const) {
      this.scheduleRefresh(normalized, scope, INVALIDATION_DEBOUNCE_MS);
    }
  }

  /** Force refresh and return snapshot (used on subscribe). */
  async refresh(projectPath: string, scope: GitChangesScope): Promise<GitChangesSnapshot> {
    const normalized = normalizeProjectPath(projectPath);
    const snapshot = await this.refreshKey(normalized, scope);
    const key = buildCacheKey(normalized, scope);
    this.snapshotsByKey.set(key, snapshot);
    this.notifyListeners(normalized, scope, snapshot);
    return snapshot;
  }

  private scheduleRefresh(projectPath: string, scope: GitChangesScope, delayMs: number): void {
    const key = buildCacheKey(projectPath, scope);
    const existingTimer = this.pendingRefreshTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingRefreshTimers.delete(key);
      void this.refreshKey(projectPath, scope)
        .then((snapshot) => {
          this.snapshotsByKey.set(key, snapshot);
          this.notifyListeners(projectPath, scope, snapshot);
        })
        .catch(() => {
          // best-effort
        });
    }, delayMs);

    this.pendingRefreshTimers.set(key, timer);
  }

  private notifyListeners(
    projectPath: string,
    scope: GitChangesScope,
    snapshot: GitChangesSnapshot,
  ): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(projectPath, scope, snapshot);
      } catch {
        // listener failures must not break others
      }
    }
  }

  private async refreshKey(projectPath: string, scope: GitChangesScope): Promise<GitChangesSnapshot> {
    const key = buildCacheKey(projectPath, scope);
    const inflight = this.inflightRefreshes.get(key);
    if (inflight) {
      return inflight;
    }

    const workspaceId = this.workspaceIdByPath.get(projectPath) ?? projectPath;

    const refreshPromise = (async () => {
      try {
        const reads = getChangesCheckpointReads();
        const result = await reads.readChanges({ cwd: projectPath, scope });
        // The patch is already in hand, so the header's counts are a string
        // scan rather than a second trip through Git. Asking separately also
        // let the working tree move between the two answers, which is how the
        // file list and the line counts could end up describing different
        // moments. Branch scope reported no counts before and still does.
        const stats =
          result.success && scope === "current"
            ? countDiffLines(result.diff ?? "")
            : { additions: 0, deletions: 0 };

        const snapshot: GitChangesSnapshot = {
          workspaceId,
          scope,
          cacheKey: `${key}:${Date.now()}`,
          files: result.success ? [...result.files] : [],
          patch: result.success ? (result.diff ?? "") : "",
          loaded: true,
          error: result.success ? null : (result.error ?? "Failed to compute git changes"),
          baseRef: result.baseRef,
          headRef: result.headRef,
          additions: stats.additions,
          deletions: stats.deletions,
        };

        const existing = this.snapshotsByKey.get(key);
        if (
          existing &&
          existing.patch === snapshot.patch &&
          existing.error === snapshot.error &&
          existing.additions === snapshot.additions &&
          existing.deletions === snapshot.deletions
        ) {
          snapshot.cacheKey = existing.cacheKey;
        }

        return snapshot;
      } catch (error) {
        return {
          workspaceId,
          scope,
          cacheKey: `${key}:${Date.now()}`,
          files: [],
          patch: "",
          loaded: true,
          error: error instanceof Error ? error.message : "Failed to compute git changes",
          additions: 0,
          deletions: 0,
        };
      } finally {
        this.inflightRefreshes.delete(key);
      }
    })();

    this.inflightRefreshes.set(key, refreshPromise);
    return refreshPromise;
  }
}

/** @internal test helper */
export function resetVcsStatusBroadcasterForTests(): void {
  VcsStatusBroadcaster.resetForTests();
}
