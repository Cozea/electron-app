/**
 * Shared git status invalidation entrypoint (Wave 0 Track F).
 *
 * Other services (sync journal, GitSyncService pull/replay in Phase 4c) should
 * call `invalidateGitStatus(cwd)` after mutating a repo cwd so agent status
 * subscribers refresh. Do not invent parallel invalidation buses.
 *
 * ADR: Collapses into `VcsStatusBroadcaster` / workflow.invalidateStatus in
 * Phase 4c — keep this helper thin.
 *
 * @see docs/git-status-local-remote-prep.md
 */

import {
  GitStatusCadenceController,
  type GitStatusInvalidationScope,
} from "./GitStatusCadence.ts";

const sharedCadence = new GitStatusCadenceController();

/** Process-wide cadence used by GitCore remote refresh gating. */
export function getGitStatusCadence(): GitStatusCadenceController {
  return sharedCadence;
}

/**
 * Invalidate cached / cadence-gated status for a repository path.
 * Safe to call from Electron services outside the Effect GitCore layer.
 */
export function invalidateGitStatus(
  cwd: string,
  scope: GitStatusInvalidationScope = "all",
): void {
  sharedCadence.invalidate(cwd, scope);
}

/** @internal test helper */
export function resetGitStatusCadenceForTests(): void {
  sharedCadence.reset();
}
