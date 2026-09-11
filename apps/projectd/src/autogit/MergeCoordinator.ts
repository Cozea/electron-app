/**
 * Merge and PR coordinator.
 *
 * Master Specification: Section 22.1 - 22.4
 * Invariants:
 * - C28: Merge operates on immutable reviewed Git checkpoint, not moving CRDT state.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { BranchName } from "@shared/collaboration"
import type { GitService } from "../git/GitService"

export type MergeStrategy = "merge" | "squash"

export interface MergePreviewResult {
  canMergeCleanly: boolean
  mergeTreeOid: string | null
  conflictingFiles: string[]
  aheadCount: number
  behindCount: number
  sessionCheckpointOid: string
  targetOid: string
}

export interface MergeExecutionResult {
  success: boolean
  strategy: MergeStrategy
  mergeCommitOid?: string
  conflicts?: string[]
  error?: string
}

export class MergeCoordinator {
  readonly gitService: GitService

  constructor(gitService: GitService) {
    this.gitService = gitService
  }

  /**
   * Section 22.1: Preflight isolated merge preview.
   */
  async computeMergePreview(params: {
    repoPath: string
    sessionBranch: BranchName
    targetBranch: BranchName
  }): Promise<MergePreviewResult> {
    const { repoPath, sessionBranch, targetBranch } = params

    const sessionOid = await this.gitService.getCommitOid(repoPath, String(sessionBranch))
    const targetOid = await this.gitService.getCommitOid(repoPath, String(targetBranch))

    if (!sessionOid || !targetOid) {
      throw new Error("Could not resolve session or target commit OID")
    }

    // Ahead / behind metrics
    const revCountRes = await this.gitService.process.execute(
      ["rev-list", "--count", "--left-right", `${targetOid}...${sessionOid}`],
      { cwd: repoPath, allowNonZeroExit: true },
    )
    const match = revCountRes.stdout.trim().match(/^(\d+)\s+(\d+)$/)
    const behindCount = match ? Number(match[1]) : 0
    const aheadCount = match ? Number(match[2]) : 0

    // git merge-tree --write-tree exits 0 for a clean merge and 1 for conflicts; with
    // --name-only -z it prints the tree OID and then every conflicted path, whatever
    // the conflict kind (content, modify/delete, rename, add/add, file/directory).
    const mergeTreeRes = await this.gitService.process.execute(
      ["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", targetOid, sessionOid],
      { cwd: repoPath, allowNonZeroExit: true },
    )
    if (mergeTreeRes.exitCode !== 0 && mergeTreeRes.exitCode !== 1) {
      throw new Error(`git merge-tree failed: ${mergeTreeRes.stderr.trim() || `exit code ${mergeTreeRes.exitCode}`}`)
    }

    const [treeOid, ...conflictedPaths] = mergeTreeRes.stdout.split("\0")
    const canMergeCleanly = mergeTreeRes.exitCode === 0

    return {
      canMergeCleanly,
      mergeTreeOid: canMergeCleanly ? treeOid.trim() : null,
      conflictingFiles: canMergeCleanly ? [] : [...new Set(conflictedPaths.filter(Boolean))],
      aheadCount,
      behindCount,
      sessionCheckpointOid: sessionOid,
      targetOid,
    }
  }

  /**
   * Section 22.2: Executes direct merge into target branch in isolated worktree.
   *
   * Merges the previewed session commit, not whatever the branch points at by then,
   * and moves the target ref only if it still points at the previewed target commit.
   */
  async executeDirectMerge(params: {
    repoPath: string
    sessionBranch: BranchName
    targetBranch: BranchName
    strategy?: MergeStrategy
    message?: string
    /** The checkpoint the user reviewed; the merge refuses if the session branch moved since. */
    reviewedCheckpointOid?: string
  }): Promise<MergeExecutionResult> {
    const { repoPath, sessionBranch, targetBranch, strategy = "merge", message } = params

    const preview = await this.computeMergePreview({ repoPath, sessionBranch, targetBranch })
    if (params.reviewedCheckpointOid && preview.sessionCheckpointOid !== params.reviewedCheckpointOid) {
      return {
        success: false,
        strategy,
        error: `'${sessionBranch}' moved since it was reviewed; preview the merge again`,
      }
    }
    if (!preview.canMergeCleanly) {
      return {
        success: false,
        strategy,
        conflicts: preview.conflictingFiles,
        error: "Merge conflicts prevent direct merge",
      }
    }

    // Advancing a branch that is checked out here would leave the working tree
    // behind, so that case fast-forwards the checkout instead, and only when it has
    // no tracked changes.
    const status = await this.gitService.getStatus(repoPath)
    const targetCheckedOut = status.headRef === String(targetBranch)
    if (targetCheckedOut && status.files.some((file) => !file.isUntracked && !file.isIgnored)) {
      return {
        success: false,
        strategy,
        error: `'${targetBranch}' is checked out in ${repoPath} with uncommitted changes; commit or stash them first`,
      }
    }

    const isolatedWorktree = path.join(
      os.tmpdir(),
      `merge_wt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    )

    try {
      // Checkout target branch in detached isolated worktree to avoid 'already checked out' collision
      await this.gitService.process.execute(
        ["worktree", "add", "--detach", isolatedWorktree, preview.targetOid],
        { cwd: repoPath },
      )

      const commitMsg = message ?? `Merge branch '${sessionBranch}' into ${targetBranch}`

      if (strategy === "squash") {
        await this.gitService.process.execute(
          ["merge", "--squash", preview.sessionCheckpointOid],
          { cwd: isolatedWorktree },
        )
        await this.gitService.process.execute(["commit", "-m", commitMsg], {
          cwd: isolatedWorktree,
        })
      } else {
        await this.gitService.process.execute(
          ["merge", "--no-ff", "-m", commitMsg, preview.sessionCheckpointOid],
          { cwd: isolatedWorktree },
        )
      }

      const mergeOid = (
        await this.gitService.process.execute(["rev-parse", "HEAD"], {
          cwd: isolatedWorktree,
        })
      ).stdout.trim()

      if (targetCheckedOut) {
        await this.gitService.process.execute(["merge", "--ff-only", mergeOid], { cwd: repoPath })
      } else {
        // The old-value argument makes the update fail if the target moved meanwhile.
        await this.gitService.process.execute(
          ["update-ref", `refs/heads/${targetBranch}`, mergeOid, preview.targetOid],
          { cwd: repoPath },
        )
      }

      return {
        success: true,
        strategy,
        mergeCommitOid: mergeOid,
      }
    } finally {
      try {
        await this.gitService.process.execute(
          ["worktree", "remove", "--force", isolatedWorktree],
          { cwd: repoPath, allowNonZeroExit: true },
        )
        if (fs.existsSync(isolatedWorktree)) {
          fs.rmSync(isolatedWorktree, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  }
}
