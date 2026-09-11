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

    // Use git merge-tree --write-tree to compute clean merge preview
    const mergeTreeRes = await this.gitService.process.execute(
      ["merge-tree", "--write-tree", targetOid, sessionOid],
      { cwd: repoPath, allowNonZeroExit: true },
    )

    if (mergeTreeRes.success) {
      const treeOid = mergeTreeRes.stdout.split("\n")[0].trim()
      return {
        canMergeCleanly: true,
        mergeTreeOid: treeOid,
        conflictingFiles: [],
        aheadCount,
        behindCount,
        sessionCheckpointOid: sessionOid,
        targetOid,
      }
    }

    // Conflicted merge preview
    const conflictingFiles: string[] = []
    const lines = mergeTreeRes.stdout.split("\n")
    for (const line of lines) {
      if (line.startsWith("CONFLICT (content): Merge conflict in ")) {
        conflictingFiles.push(line.replace("CONFLICT (content): Merge conflict in ", "").trim())
      }
    }

    return {
      canMergeCleanly: false,
      mergeTreeOid: null,
      conflictingFiles,
      aheadCount,
      behindCount,
      sessionCheckpointOid: sessionOid,
      targetOid,
    }
  }

  /**
   * Section 22.2: Executes direct merge into target branch in isolated worktree.
   */
  async executeDirectMerge(params: {
    repoPath: string
    sessionBranch: BranchName
    targetBranch: BranchName
    strategy?: MergeStrategy
    message?: string
  }): Promise<MergeExecutionResult> {
    const { repoPath, sessionBranch, targetBranch, strategy = "merge", message } = params

    const preview = await this.computeMergePreview({ repoPath, sessionBranch, targetBranch })
    if (!preview.canMergeCleanly) {
      return {
        success: false,
        strategy,
        conflicts: preview.conflictingFiles,
        error: "Merge conflicts prevent direct merge",
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
          ["merge", "--squash", String(sessionBranch)],
          { cwd: isolatedWorktree },
        )
        await this.gitService.process.execute(["commit", "-m", commitMsg], {
          cwd: isolatedWorktree,
        })
      } else {
        await this.gitService.process.execute(
          ["merge", "--no-ff", "-m", commitMsg, String(sessionBranch)],
          { cwd: isolatedWorktree },
        )
      }

      const mergeOid = (
        await this.gitService.process.execute(["rev-parse", "HEAD"], {
          cwd: isolatedWorktree,
        })
      ).stdout.trim()

      // Update target branch ref
      await this.gitService.process.execute(
        ["update-ref", `refs/heads/${targetBranch}`, mergeOid],
        { cwd: repoPath },
      )

      // If repoPath is on targetBranch, mixed reset to advance index
      const status = await this.gitService.getStatus(repoPath)
      if (status.headRef === String(targetBranch)) {
        await this.gitService.process.execute(["reset", "--mixed", mergeOid], {
          cwd: repoPath,
          allowNonZeroExit: true,
        })
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
