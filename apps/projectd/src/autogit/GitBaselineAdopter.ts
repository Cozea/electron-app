/**
 * Moves this folder's Git branch to a published AutoGit checkpoint.
 *
 * Master Specification: Section 16.1 - 16.2
 * Phase: P18
 *
 * The session already delivered the checkpoint's bytes, so nothing is pulled into the
 * working tree. The branch and the index move to the checkpoint and the working tree
 * stays as it is, so Git reports only what changed after the checkpoint. The move
 * happens only when it loses nothing: the folder has the session branch checked out,
 * no merge or rebase is under way, and every commit on the branch is in the
 * checkpoint's history. Staged-but-uncommitted state is reset to the checkpoint; the
 * bytes stay.
 */

import fs from "node:fs/promises"
import path from "node:path"

import type { GitService } from "../git/GitService"

const FETCH_TIMEOUT_MS = 60_000
const TRANSITION_MARKERS: Array<[string, string]> = [
  ["MERGE_HEAD", "merge"],
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
]

export type BaselineAdoptionState = "adopted" | "current" | "skipped"

export interface BaselineAdoptionResult {
  success: boolean
  state: BaselineAdoptionState
  oldHeadOid: string
  newHeadOid: string
  dirtyCountAfter: number
  /** Why the baseline stayed where it was, for the user. */
  reason?: string
  error?: string
}

export class GitBaselineAdopter {
  readonly gitService: GitService

  constructor(gitService: GitService) {
    this.gitService = gitService
  }

  /**
   * Section 16.1: Safely advances local Git baseline to checkpoint commit. With a
   * remote, a checkpoint this repository does not have yet is fetched first.
   */
  async advanceBaseline(params: {
    cwd: string
    branchName: string
    checkpointOid: string
    remote?: string
    /** An explicit rebase rewrote the branch, replacing this commit (Section 21.9). */
    rewrittenFrom?: string | null
  }): Promise<BaselineAdoptionResult> {
    const { cwd, branchName, checkpointOid, remote } = params

    const status = await this.gitService.getStatus(cwd)
    const oldHeadOid = status.headOid ?? ""
    const countDirty = (files: typeof status.files) => files.filter((file) => !file.isIgnored).length
    const skip = (reason: string): BaselineAdoptionResult => ({
      success: false,
      state: "skipped",
      oldHeadOid,
      newHeadOid: oldHeadOid,
      dirtyCountAfter: countDirty(status.files),
      reason,
      error: reason,
    })

    if (status.files.some((file) => file.isConflicted)) {
      return skip("Git has unresolved conflicts in this folder.")
    }
    const transition = await this.transitionInProgress(cwd)
    if (transition) return skip(`Git is in the middle of a ${transition} in this folder.`)
    const headRef = status.headRef && !status.headRef.startsWith("(") ? status.headRef : null
    if (headRef !== branchName) {
      return skip(
        headRef ? `This folder has ${headRef} checked out, not ${branchName}.` : "This folder has no branch checked out.",
      )
    }
    if (oldHeadOid === checkpointOid) {
      return {
        success: true,
        state: "current",
        oldHeadOid,
        newHeadOid: checkpointOid,
        dirtyCountAfter: countDirty(status.files),
      }
    }

    if (!(await this.hasCommit(cwd, checkpointOid)) && remote) {
      // Into FETCH_HEAD, never a constructed ref: remote may be a name, a URL
      // or a local path, and only branch heads are fetched here.
      await this.gitService.process.execute(
        ["fetch", "--no-tags", remote, `refs/heads/${branchName}`],
        { cwd, allowNonZeroExit: true, timeoutMs: FETCH_TIMEOUT_MS },
      )
    }
    if (!(await this.hasCommit(cwd, checkpointOid))) {
      return skip(`Git here does not have the checkpoint ${checkpointOid.slice(0, 7)} yet.`)
    }
    if (oldHeadOid && !(await this.isAncestor(cwd, oldHeadOid, checkpointOid))) {
      // After an explicit rebase the branch here may still be on the history it replaced;
      // it follows only when it holds nothing beyond that history.
      const rewrittenFrom = params.rewrittenFrom
      const onReplacedHistory =
        rewrittenFrom !== undefined &&
        rewrittenFrom !== null &&
        (await this.hasCommit(cwd, rewrittenFrom)) &&
        (await this.isAncestor(cwd, oldHeadOid, rewrittenFrom))
      if (!onReplacedHistory) {
        return skip(`${branchName} has commits in this folder that are not in the session's history.`)
      }
    }

    let refUpdated = false
    try {
      // Compare and swap: a commit made since the checks above leaves the branch alone.
      const updateArgs = ["update-ref", "-m", "cozea: adopt session checkpoint", `refs/heads/${branchName}`, checkpointOid]
      if (oldHeadOid) updateArgs.push(oldHeadOid)
      const updateRes = await this.gitService.process.execute(updateArgs, { cwd })
      if (!updateRes.success) {
        return skip(`Git could not move ${branchName} to the checkpoint: ${updateRes.stderr.trim()}`)
      }
      refUpdated = true

      // Recheck HEAD: if a terminal commit landed immediately after CAS, HEAD
      // has already moved forward on top of checkpointOid. Preserve the user's commit
      // and do not clobber it with index synchronization.
      const currentHead = await this.gitService.getCommitOid(cwd, `refs/heads/${branchName}`)
      if (currentHead && currentHead !== checkpointOid) {
        const updatedStatus = await this.gitService.getStatus(cwd)
        return {
          success: true,
          state: "adopted",
          oldHeadOid,
          newHeadOid: currentHead,
          dirtyCountAfter: countDirty(updatedStatus.files),
          reason: "Concurrent local commit preserved after checkpoint ref update.",
        }
      }

      // Synchronize index using read-tree: sets index to match the checkpoint tree
      // without moving the branch ref or touching working-tree files.
      await this.gitService.process.execute(["read-tree", `${checkpointOid}^{tree}`], { cwd })

      const updatedStatus = await this.gitService.getStatus(cwd)
      return {
        success: true,
        state: "adopted",
        oldHeadOid,
        newHeadOid: checkpointOid,
        dirtyCountAfter: countDirty(updatedStatus.files),
      }
    } catch (err) {
      // Section 16.2: never hard-reset the live folder; leave Git where it was.
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[GitBaselineAdopter] Baseline advancement failed, leaving Git metadata behind:", message)
      if (refUpdated) {
        const actualHead = (await this.gitService.getCommitOid(cwd, `refs/heads/${branchName}`).catch(() => null)) ?? checkpointOid
        return {
          success: false,
          state: "skipped",
          oldHeadOid,
          newHeadOid: actualHead,
          dirtyCountAfter: -1,
          reason: `Git branch moved to ${actualHead.slice(0, 7)}, but index synchronization failed: ${message}`,
          error: message,
        }
      }
      return { ...skip(`Git could not move ${branchName} to the checkpoint.`), error: message }
    }
  }

  private async isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.gitService.process.execute(["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      allowNonZeroExit: true,
    })
    return result.exitCode === 0
  }

  private async hasCommit(cwd: string, oid: string): Promise<boolean> {
    const result = await this.gitService.process.execute(["cat-file", "-e", `${oid}^{commit}`], {
      cwd,
      allowNonZeroExit: true,
    })
    return result.success
  }

  /** The Git operation under way in this folder, if any. */
  private async transitionInProgress(cwd: string): Promise<string | null> {
    const gitDir = await this.gitService.process.execute(["rev-parse", "--absolute-git-dir"], {
      cwd,
      allowNonZeroExit: true,
    })
    if (!gitDir.success) return null
    for (const [marker, label] of TRANSITION_MARKERS) {
      const present = await fs
        .stat(path.join(gitDir.stdout.trim(), marker))
        .then(() => true)
        .catch(() => false)
      if (present) return label
    }
    return null
  }
}
