/**
 * Effect wiring: adapt assistant-runtime `GitCore` into substrate `GitVcsDriver`.
 */

import { Effect } from "effect";

import { GitCore, type GitCoreShape } from "../git/Services/GitCore.ts";
import {
  createGitVcsDriver,
  type GitCorePort,
  type GitVcsCheckpointBackend,
  type GitVcsDriver,
} from "../../substrate/vcs/GitVcsDriver.ts";
import { getChangesCheckpointReads } from "../../substrate/vcs/checkpointsFacade.ts";
import { isSubstrateVcsEnabled } from "../../substrate/flags.ts";

function runGit<T>(effect: Effect.Effect<T, unknown, never>): Promise<T> {
  return Effect.runPromise(effect as Effect.Effect<T, never, never>);
}

function createGitCorePort(git: GitCoreShape): GitCorePort {
  return {
    statusDetails: (cwd) =>
      runGit(
        git.statusDetails(cwd).pipe(
          Effect.map((details) => ({
            branch: details.branch,
            upstreamRef: details.upstreamRef,
            hasUpstream: details.hasUpstream,
            aheadCount: details.aheadCount,
            behindCount: details.behindCount,
            hasWorkingTreeChanges: details.hasWorkingTreeChanges,
            isRepo: true,
          })),
        ),
      ),
    push: (input) =>
      runGit(
        Effect.gen(function* () {
          if (input.remoteName && input.refspec) {
            const args = input.setUpstream
              ? ["push", "-u", input.remoteName, input.refspec]
              : ["push", input.remoteName, input.refspec];
            yield* git.execute({
              operation: "GitVcsDriver.push",
              cwd: input.cwd,
              args,
            });
            const branch = input.branch ?? "HEAD";
            return {
              status: "pushed" as const,
              branch,
              upstreamBranch: input.refspec.includes(":")
                ? `${input.remoteName}/${input.refspec.split(":").at(-1)?.replace(/^refs\/heads\//, "") ?? branch}`
                : undefined,
              setUpstream: input.setUpstream,
            };
          }
          return yield* git.pushCurrentBranch(input.cwd, input.branch ?? null);
        }),
      ),
    pullCurrentBranch: (cwd) =>
      runGit(
        git.pullCurrentBranch(cwd).pipe(
          Effect.map((result) => ({
            status: result.status,
            branch: result.branch,
          })),
        ),
      ),
    listBranches: (input) => runGit(git.listBranches(input)),
    createWorktree: (input) => runGit(git.createWorktree(input as never)),
    createBranch: (input) => runGit(git.createBranch(input as never)),
    checkoutBranch: (input) => runGit(Effect.scoped(git.checkoutBranch(input as never))),
    initRepo: (input) => runGit(git.initRepo(input as never)),
    removeWorktree: (input) =>
      runGit(
        git.removeWorktree({
          cwd: input.cwd,
          path: input.worktreePath,
          force: input.force,
        }),
      ),
  };
}

function createCheckpointBackendFromFacade(): GitVcsCheckpointBackend {
  const reads = getChangesCheckpointReads();
  return {
    readChanges: (input) => reads.readChanges(input),
    getHeadDiffStats: (input) => reads.getHeadDiffStats(input),
    captureCheckpoint: async (input) => {
      const { CheckpointWorkerClient } = await import("../../services/CheckpointWorkerClient.ts");
      const result = await CheckpointWorkerClient.getInstance().captureCheckpoint({
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
      const { CheckpointWorkerClient } = await import("../../services/CheckpointWorkerClient.ts");
      const result = await CheckpointWorkerClient.getInstance().diffCheckpoints({
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
      const { CheckpointWorkerClient } = await import("../../services/CheckpointWorkerClient.ts");
      const result = await CheckpointWorkerClient.getInstance().deleteCheckpointRefs({
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

export function createGitVcsDriverFromGitCore(
  git: GitCoreShape,
  env: NodeJS.ProcessEnv = process.env,
): GitVcsDriver | null {
  if (!isSubstrateVcsEnabled(env)) {
    return null;
  }
  return createGitVcsDriver({
    git: createGitCorePort(git),
    checkpoints: createCheckpointBackendFromFacade(),
    capabilities: {
      status: true,
      push: true,
      worktrees: true,
      checkpoints: true,
      refs: true,
      ignore: false,
      init: true,
    },
  });
}

export const resolveFlaggedGitVcsDriver = Effect.gen(function* () {
  const git = yield* GitCore;
  return createGitVcsDriverFromGitCore(git);
});
