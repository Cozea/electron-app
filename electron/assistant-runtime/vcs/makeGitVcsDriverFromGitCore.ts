/**
 * Effect wiring: adapt assistant-runtime `GitCore` into substrate `GitVcsDriver`.
 *
 * GitCore is **not** deleted — this is the Phase 4a adapter path behind
 * `cozea.substrate.vcs`. Full WS/RPC cutover lands in later 4a work.
 */

import { Effect } from "effect";

import { GitCore, type GitCoreShape } from "../git/Services/GitCore.ts";
import {
  createGitVcsDriver,
  type GitCorePort,
  type GitVcsDriver,
} from "../../substrate/vcs/GitVcsDriver.ts";
import { isSubstrateVcsEnabled } from "../../substrate/flags.ts";

function createGitCorePort(git: GitCoreShape): GitCorePort {
  return {
    statusDetails: (cwd) =>
      Effect.runPromise(
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
      Effect.runPromise(
        Effect.gen(function* () {
          // When the substrate driver already applied push-safety, prefer the
          // explicit refspec / -u publish path via execute. Fallback: legacy
          // pushCurrentBranch for unconfigured cases.
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
    removeWorktree: (input) =>
      Effect.runPromise(
        git.removeWorktree({
          cwd: input.cwd,
          path: input.worktreePath,
          force: input.force,
        }),
      ),
  };
}

/**
 * Build a `GitVcsDriver` from the live Effect `GitCore` service.
 * Returns null when the Phase 4 flag is off.
 */
export function createGitVcsDriverFromGitCore(
  git: GitCoreShape,
  env: NodeJS.ProcessEnv = process.env,
): GitVcsDriver | null {
  if (!isSubstrateVcsEnabled(env)) {
    return null;
  }
  return createGitVcsDriver({
    git: createGitCorePort(git),
    capabilities: {
      status: true,
      push: true,
      worktrees: true,
      checkpoints: false,
      refs: false,
      ignore: false,
      init: false,
    },
  });
}

/**
 * Effect helper: resolve optional flagged driver from the GitCore service tag.
 */
export const resolveFlaggedGitVcsDriver = Effect.gen(function* () {
  const git = yield* GitCore;
  return createGitVcsDriverFromGitCore(git);
});
