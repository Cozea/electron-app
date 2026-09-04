/**
 * Helpers for detecting orphan git worktrees after assistant thread deletion.
 *
 * Mirrors T3 `apps/web/src/worktreeCleanup.ts`. Keep this pure so Phase 4e can
 * reuse the same detection when VcsDriver owns prune/remove.
 */

export interface ThreadWorktreeRef {
  readonly id: string;
  readonly worktreePath: string | null;
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
