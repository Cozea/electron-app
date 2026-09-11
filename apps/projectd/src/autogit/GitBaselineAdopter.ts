/**
 * Controlled local Git baseline advancement after AutoGit checkpoint.
 *
 * Master Specification: Section 16.1 - 16.2
 * Advances local Git HEAD and index to match published checkpoint commit
 * while strictly preserving working-tree bytes.
 */

import type { GitService } from "../git/GitService"

export interface BaselineAdoptionResult {
  success: boolean
  oldHeadOid: string
  newHeadOid: string
  dirtyCountAfter: number
  error?: string
}

export class GitBaselineAdopter {
  readonly gitService: GitService

  constructor(gitService: GitService) {
    this.gitService = gitService
  }

  /**
   * Section 16.1: Safely advances local Git baseline to checkpoint commit.
   *
   * 1. Verifies no unresolved git transition in progress.
   * 2. Updates ref and index to checkpoint commit without touching working tree.
   * 3. Queries refreshed git status.
   */
  async advanceBaseline(params: {
    cwd: string
    branchName: string
    checkpointOid: string
  }): Promise<BaselineAdoptionResult> {
    const { cwd, branchName, checkpointOid } = params

    // 1. Inspect current status
    const currentStatus = await this.gitService.getStatus(cwd)
    const oldHeadOid = currentStatus.headOid ?? ""

    if (currentStatus.isConflicted) {
      return {
        success: false,
        oldHeadOid,
        newHeadOid: oldHeadOid,
        dirtyCountAfter: currentStatus.files.length,
        error: "Cannot advance baseline: active git conflicts in progress",
      }
    }

    if (oldHeadOid === checkpointOid) {
      return {
        success: true,
        oldHeadOid,
        newHeadOid: checkpointOid,
        dirtyCountAfter: currentStatus.files.filter((f) => !f.isIgnored).length,
      }
    }

    try {
      // 2. Update branch ref and mixed reset index to checkpoint commit (leaves working tree untouched)
      await this.gitService.process.execute(["update-ref", `refs/heads/${branchName}`, checkpointOid], {
        cwd,
      })

      // Reset index to checkpoint commit while preserving working tree bytes (--mixed is default)
      await this.gitService.process.execute(["reset", "--mixed", checkpointOid], { cwd })

      // 3. Refresh status
      const updatedStatus = await this.gitService.getStatus(cwd)
      const dirtyCountAfter = updatedStatus.files.filter((f) => !f.isIgnored).length

      return {
        success: true,
        oldHeadOid,
        newHeadOid: checkpointOid,
        dirtyCountAfter,
      }
    } catch (err: any) {
      // Section 16.2: Failure policy: Never hard reset live project
      console.warn("[GitBaselineAdopter] Baseline advancement failed, leaving Git metadata behind:", err)
      return {
        success: false,
        oldHeadOid,
        newHeadOid: oldHeadOid,
        dirtyCountAfter: currentStatus.files.length,
        error: err.message,
      }
    }
  }
}
