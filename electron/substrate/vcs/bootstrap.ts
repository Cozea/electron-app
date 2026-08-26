/**
 * Electron main bootstrap for Phase 4 VCS substrate (default on).
 *
 * - Registers legacy Changes checkpoint backend (single entry via facade)
 * - When `COZEA_SUBSTRATE_VCS=1`, registers driver checkpoint stubs (delegate, no third stack)
 * - Subscribes `GitChangesBroadcaster` to the shared status invalidation bus
 *
 * Collab overlay (journal / GitSyncService) should call `invalidateVcsStatus`
 * after cwd mutations — documented in docs/substrate-phase4-vcs.md (4c/4d).
 */

import { CheckpointWorkerClient } from "../../services/CheckpointWorkerClient";
import { GitChangesBroadcaster } from "../../services/GitChangesBroadcaster";
import { isSubstrateVcsEnabled } from "../flags";
import {
  createDelegatingCheckpointOps,
  registerDriverCheckpointOps,
  registerLegacyChangesCheckpointBackend,
  type ChangesCheckpointBackend,
} from "./checkpointsFacade";
import { subscribeVcsStatusInvalidation } from "./statusInvalidation";
import { registerThreadDeletionWorktreeHandlers } from "./threadDeletionWorktree";
let bootstrapped = false;
let unsubscribeInvalidation: (() => void) | null = null;

function buildLegacyCheckpointBackend(
  client: CheckpointWorkerClient,
): ChangesCheckpointBackend {
  return {
    readChanges: async (input) => {
      const result = await client.readChanges({
        cwd: input.cwd,
        scope: input.scope,
      });
      return {
        success: result.success,
        scope: result.scope,
        files: result.files,
        ...(result.diff !== undefined ? { diff: result.diff } : {}),
        ...(result.baseRef !== undefined ? { baseRef: result.baseRef } : {}),
        ...(result.headRef !== undefined ? { headRef: result.headRef } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
    getHeadDiffStats: async (input) => {
      const result = await client.getHeadDiffStats({
        cwd: input.cwd,
        authorName: input.authorName,
      });
      return {
        success: result.success,
        additions: result.additions,
        deletions: result.deletions,
        changedFiles: result.changedFiles,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
    captureCheckpoint: async (input) => {
      const result = await client.captureCheckpoint({
        cwd: input.cwd,
        checkpointId: input.checkpointId,
        authorName: input.authorName,
        ...(input.authorEmail !== undefined ? { authorEmail: input.authorEmail } : {}),
      });
      return {
        success: result.success,
        ...(result.ref !== undefined ? { ref: result.ref } : {}),
        ...(result.commitOid !== undefined ? { commitOid: result.commitOid } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
    diffCheckpoints: async (input) => {
      const result = await client.diffCheckpoints({
        cwd: input.cwd,
        fromCheckpointId: input.fromCheckpointId,
        toCheckpointId: input.toCheckpointId,
      });
      return {
        success: result.success,
        ...(result.diff !== undefined ? { diff: result.diff } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
    deleteCheckpointRefs: async (input) => {
      const result = await client.deleteCheckpointRefs({
        cwd: input.cwd,
        checkpointIds: [...input.checkpointIds],
      });
      return {
        success: result.success,
        ...(result.deletedRefs !== undefined ? { deletedRefs: result.deletedRefs } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
  };
}

/**
 * Idempotent bootstrap — safe to call from workspace sync IPC registration.
 */
export function bootstrapSubstrateVcs(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (bootstrapped) {
    return;
  }
  bootstrapped = true;

  const client = CheckpointWorkerClient.getInstance();
  const legacy = buildLegacyCheckpointBackend(client);
  registerLegacyChangesCheckpointBackend(legacy);

  if (isSubstrateVcsEnabled(env)) {
    registerDriverCheckpointOps(createDelegatingCheckpointOps(legacy));
  } else {
    registerDriverCheckpointOps(null);
  }

  const broadcaster = GitChangesBroadcaster.getInstance();
  unsubscribeInvalidation = subscribeVcsStatusInvalidation((cwd) => {
    broadcaster.invalidateProjectPath(cwd);
  });

  registerThreadDeletionWorktreeHandlers(env, async ({ cwd, worktreePath, force }) => {
    const { spawnSync } = await import("node:child_process");
    const args = ["worktree", "remove", ...(force ? ["--force"] : []), worktreePath];
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || "git worktree remove failed");
    }
    const { invalidateVcsStatus: invalidate } = await import("./statusInvalidation");
    invalidate(cwd);
  });
}

/** @internal test helper */
export function resetSubstrateVcsBootstrapForTests(): void {
  unsubscribeInvalidation?.();
  unsubscribeInvalidation = null;
  bootstrapped = false;
}
