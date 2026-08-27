/**
 * Phase 4e — thread deletion orphan worktree cleanup (IPC entry).
 */

import { ipcMain } from "electron";

import { isSubstrateVcsEnabled } from "../flags";
import {
  getOrphanedWorktreePathForThread,
  type ThreadWorktreeRef,
} from "./worktreeOrphanCleanup";

const SUBSTRATE_VCS_PRUNE_ORPHAN_WORKTREE = "substrate:vcs:pruneOrphanWorktree" as const;
const SUBSTRATE_VCS_DETECT_ORPHAN_WORKTREE = "substrate:vcs:detectOrphanWorktree" as const;

export interface PruneOrphanWorktreeInput {
  readonly cwd: string;
  readonly worktreePath: string;
  readonly force?: boolean;
}

let registered = false;

export function registerThreadDeletionWorktreeHandlers(
  env: NodeJS.ProcessEnv = process.env,
  pruneImpl: (input: PruneOrphanWorktreeInput) => Promise<void> = async () => {
    throw new Error("pruneOrphanWorktree is not wired");
  },
): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.removeHandler(SUBSTRATE_VCS_DETECT_ORPHAN_WORKTREE);
  ipcMain.handle(
    SUBSTRATE_VCS_DETECT_ORPHAN_WORKTREE,
    (
      _event,
      input: { threads: ThreadWorktreeRef[]; deletedThreadId: string },
    ) => {
      if (!isSubstrateVcsEnabled(env)) {
        return { ok: false as const, reason: "substrate_vcs_disabled" };
      }
      const orphanPath = getOrphanedWorktreePathForThread(input.threads, input.deletedThreadId);
      return { ok: true as const, orphanWorktreePath: orphanPath };
    },
  );

  ipcMain.removeHandler(SUBSTRATE_VCS_PRUNE_ORPHAN_WORKTREE);
  ipcMain.handle(
    SUBSTRATE_VCS_PRUNE_ORPHAN_WORKTREE,
    async (_event, input: PruneOrphanWorktreeInput) => {
      if (!isSubstrateVcsEnabled(env)) {
        return { ok: false as const, reason: "substrate_vcs_disabled" };
      }
      if (!input?.cwd?.trim() || !input?.worktreePath?.trim()) {
        return { ok: false as const, reason: "invalid_input" };
      }
      try {
        await pruneImpl({
          cwd: input.cwd.trim(),
          worktreePath: input.worktreePath.trim(),
          force: input.force,
        });
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}

/** @internal test helper */
export function resetThreadDeletionWorktreeHandlersForTests(): void {
  ipcMain.removeHandler(SUBSTRATE_VCS_DETECT_ORPHAN_WORKTREE);
  ipcMain.removeHandler(SUBSTRATE_VCS_PRUNE_ORPHAN_WORKTREE);
  registered = false;
}

export { SUBSTRATE_VCS_DETECT_ORPHAN_WORKTREE, SUBSTRATE_VCS_PRUNE_ORPHAN_WORKTREE };
