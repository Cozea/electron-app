/**
 * Worktree orphan cleanup hooks — Phase 4e alignment with Track B
 * (`ThreadDeletionReactor` + client `worktreeCleanup`).
 *
 * Detection stays pure. Prune must eventually go through `VcsDriver.removeWorktree`
 * (no third git owner). Until 4a cutover completes, prune may call existing
 * `GitCore.removeWorktree` / `NativeApi.git.removeWorktree`.
 *
 * @see docs/substrate-phase4-vcs.md
 * @see docs/thread-deletion-cleanup.md (Track B, when merged)
 */

export interface ThreadWorktreeRef {
  readonly id: string;
  readonly worktreePath: string | null;
}

export type WorktreeOrphanPromptChoice = "keep" | "prune";

/**
 * Hook surface for thread-deletion → orphan worktree keep/prune.
 * Track B client code and Phase 4e VcsDriver prune should share this contract.
 */
export interface WorktreeOrphanCleanupHooks {
  /**
   * Returns the worktree path owned solely by `threadId`, or null when shared/missing.
   */
  readonly getOrphanedWorktreePathForThread: (
    threads: ReadonlyArray<ThreadWorktreeRef>,
    threadId: string,
  ) => string | null;

  /**
   * Prompt the user to keep or prune. Implementations typically use native confirm.
   */
  readonly promptKeepOrPrune: (worktreePath: string) => Promise<WorktreeOrphanPromptChoice>;

  /**
   * Destructive remove — must call into VcsDriver / GitCore worktree APIs only.
   */
  readonly pruneWorktree: (input: {
    readonly cwd: string;
    readonly worktreePath: string;
  }) => Promise<void>;
}

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

/**
 * Returns the worktree path owned solely by `threadId`, or null when shared /
 * missing. Callers should prompt keep vs prune before removing it.
 *
 * Mirrors Track B / T3 `worktreeCleanup.getOrphanedWorktreePathForThread`.
 */
export function getOrphanedWorktreePathForThread(
  threads: ReadonlyArray<ThreadWorktreeRef>,
  threadId: string,
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isShared = threads.some((thread) => {
    if (thread.id === threadId) {
      return false;
    }
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}

export function buildOrphanWorktreePromptMessage(worktreePath: string): string {
  const displayPath = formatWorktreePathForDisplay(worktreePath);
  return [
    "This thread is the only one linked to this worktree:",
    displayPath,
    "",
    "Delete the worktree too?",
  ].join("\n");
}

/**
 * Default detection-only hooks. Prompt/prune must be supplied by product layers.
 */
export function createDetectionOnlyWorktreeOrphanHooks(
  overrides: Partial<
    Pick<WorktreeOrphanCleanupHooks, "promptKeepOrPrune" | "pruneWorktree">
  > = {},
): WorktreeOrphanCleanupHooks {
  return {
    getOrphanedWorktreePathForThread,
    promptKeepOrPrune:
      overrides.promptKeepOrPrune ??
      (async () => {
        throw new Error(
          "WorktreeOrphanCleanupHooks.promptKeepOrPrune is not configured.",
        );
      }),
    pruneWorktree:
      overrides.pruneWorktree ??
      (async () => {
        throw new Error(
          "WorktreeOrphanCleanupHooks.pruneWorktree is not configured — wire VcsDriver.removeWorktree.",
        );
      }),
  };
}
