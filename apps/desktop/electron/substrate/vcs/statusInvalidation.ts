/**
 * Single status-invalidation API for Phase 4c prep.
 *
 * Agent status, Changes UI (`GitChangesBroadcaster`), and collab overlay hooks
 * (journal / GitSyncService pull-replay / conflict resolve) must share this bus.
 * Do **not** invent a permanent second broadcaster beside `GitChangesBroadcaster`.
 *
 * Collapse plan: becomes T3 `VcsStatusBroadcaster` / workflow.invalidateStatus
 * once Phase 4c streams land.
 *
 * @see docs/substrate-phase4-vcs.md
 */

export type VcsStatusInvalidationScope = "local" | "remote" | "all";

export type VcsStatusInvalidationListener = (
  cwd: string,
  scope: VcsStatusInvalidationScope,
) => void;

function normalizeCwd(cwd: string): string {
  return cwd.trim();
}

const listeners = new Set<VcsStatusInvalidationListener>();

/**
 * Subscribe to status invalidations. Returns an unsubscribe function.
 * Safe for Electron services and assistant-runtime layers.
 */
export function subscribeVcsStatusInvalidation(
  listener: VcsStatusInvalidationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Invalidate cached / cadence-gated VCS status for a repository path.
 * Call after any cwd mutation (agent push/commit/worktree, sync journal write,
 * GitSyncService pull/replay, conflict resolve).
 */
export function invalidateVcsStatus(
  cwd: string,
  scope: VcsStatusInvalidationScope = "all",
): void {
  const normalized = normalizeCwd(cwd);
  if (!normalized) {
    return;
  }
  for (const listener of Array.from(listeners)) {
    try {
      listener(normalized, scope);
    } catch {
      // Listener failures must not break other subscribers.
    }
  }
}

/** @internal test helper */
export function resetVcsStatusInvalidationForTests(): void {
  listeners.clear();
}

/** @internal test helper */
export function getVcsStatusInvalidationListenerCountForTests(): number {
  return listeners.size;
}
