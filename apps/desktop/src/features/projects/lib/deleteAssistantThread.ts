/**
 * Delete an assistant thread and optionally prune an orphan worktree.
 *
 * Prompt happens before `thread.delete` so the UI never freezes waiting on
 * post-delete cleanup. Provider/session artifacts are cleaned by the server
 * ThreadDeletionReactor on `thread.deleted` (Track B → Phase 4e).
 */
import type { CommandId, NativeApi, ThreadId } from "@cozea/assistant-contracts";

import {
  buildOrphanWorktreePromptMessage,
  getOrphanedWorktreePathForThread,
  type ThreadWorktreeRef,
} from "./worktreeCleanup";

export interface DeleteAssistantThreadProject {
  readonly workspaceRoot: string;
}

export interface DeleteAssistantThreadDeps {
  readonly confirm: (message: string) => Promise<boolean>;
  readonly dispatchDelete: (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
  }) => Promise<unknown>;
  readonly removeWorktree: NativeApi["git"]["removeWorktree"];
  readonly newCommandId: () => CommandId;
  readonly stopSession?: (threadId: ThreadId) => Promise<void>;
  readonly closeTerminals?: (threadId: ThreadId) => Promise<void>;
}

export type DeleteAssistantThreadResult =
  | { readonly status: "deleted"; readonly prunedWorktree: boolean }
  | { readonly status: "deleted_worktree_failed"; readonly worktreePath: string; readonly error: unknown }
  | { readonly status: "cancelled" };

export async function deleteAssistantThread(input: {
  readonly threadId: ThreadId;
  readonly threads: ReadonlyArray<ThreadWorktreeRef>;
  readonly project: DeleteAssistantThreadProject | null;
  readonly deletedThreadIds?: ReadonlySet<string>;
  readonly deps: DeleteAssistantThreadDeps;
}): Promise<DeleteAssistantThreadResult> {
  const survivingThreads =
    input.deletedThreadIds && input.deletedThreadIds.size > 0
      ? input.threads.filter(
          (entry) => entry.id === input.threadId || !input.deletedThreadIds?.has(entry.id),
        )
      : input.threads;

  const orphanedWorktreePath = getOrphanedWorktreePathForThread(
    survivingThreads,
    input.threadId,
  );

  let shouldDeleteWorktree = false;
  if (orphanedWorktreePath !== null && input.project !== null) {
    shouldDeleteWorktree = await input.deps.confirm(
      buildOrphanWorktreePromptMessage(orphanedWorktreePath),
    );
  }

  if (input.deps.stopSession) {
    await input.deps.stopSession(input.threadId);
  }
  if (input.deps.closeTerminals) {
    await input.deps.closeTerminals(input.threadId);
  }

  await input.deps.dispatchDelete({
    threadId: input.threadId,
    commandId: input.deps.newCommandId(),
  });

  if (!shouldDeleteWorktree || !orphanedWorktreePath || !input.project) {
    return { status: "deleted", prunedWorktree: false };
  }

  try {
    await input.deps.removeWorktree({
      cwd: input.project.workspaceRoot,
      path: orphanedWorktreePath,
      force: true,
    });
    return { status: "deleted", prunedWorktree: true };
  } catch (error) {
    return {
      status: "deleted_worktree_failed",
      worktreePath: orphanedWorktreePath,
      error,
    };
  }
}
