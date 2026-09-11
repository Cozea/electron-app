/**
 * Target branch divergence tracker and rebase recommendation engine.
 *
 * Master Specification: Section 20.1 - 20.3
 * Invariants:
 * - C25: Rebase is explicit. Suggests rebase when target has meaningfully moved,
 *   but NEVER begins rebase automatically without explicit user action.
 */

import type { BranchName, RebaseStatus, SessionId } from "@shared/collaboration"
import type { GitService } from "../git/GitService"

export interface TargetDivergenceCheckParams {
  sessionId: SessionId
  repositoryBindingId: string
  sessionBranch: BranchName
  targetBranch: BranchName
  remoteUrl?: string
  sessionModifiedPaths?: string[]
  isManualCheck?: boolean
}

export class TargetBranchTracker {
  readonly gitService: GitService
  private lastDismissedAt: number | null = null
  readonly dismissCooldownMs = 3600_000 // 1 hour cooldown for suggestions

  constructor(gitService: GitService) {
    this.gitService = gitService
  }

  dismissRecommendation(): void {
    this.lastDismissedAt = Date.now()
  }

  /**
   * Section 20.1 - 20.3: Inspects target branch and evaluates rebase recommendation.
   */
  async checkTargetDivergence(params: {
    sessionId: SessionId
    repoPath: string
    repositoryBindingId: string
    sessionBranch: BranchName
    targetBranch: BranchName
    sessionModifiedPaths?: string[]
    isManualCheck?: boolean
  }): Promise<RebaseStatus> {
    const {
      sessionId,
      repoPath,
      sessionBranch,
      targetBranch,
      sessionModifiedPaths = [],
      isManualCheck = false,
    } = params

    // Inspect commit OIDs
    const sessionOid = await this.gitService.getCommitOid(repoPath, String(sessionBranch))
    const targetOid = await this.gitService.getCommitOid(repoPath, String(targetBranch))

    if (!sessionOid || !targetOid) {
      return {
        sessionId,
        lifecycle: "IDLE",
        targetBranch,
        targetRemoteOid: targetOid,
        mergeBaseOid: null,
        behindCommitCount: 0,
        aheadCommitCount: 0,
        recommended: false,
        recommendationReason: null,
        requestedAt: null,
        completedAt: null,
        errorMessage: null,
      }
    }

    if (sessionOid === targetOid) {
      return {
        sessionId,
        lifecycle: "IDLE",
        targetBranch,
        targetRemoteOid: targetOid,
        mergeBaseOid: sessionOid,
        behindCommitCount: 0,
        aheadCommitCount: 0,
        recommended: false,
        recommendationReason: "Session branch is aligned with target branch",
        requestedAt: null,
        completedAt: null,
        errorMessage: null,
      }
    }

    // Compute merge-base
    const mbRes = await this.gitService.process.execute(["merge-base", sessionOid, targetOid], {
      cwd: repoPath,
      allowNonZeroExit: true,
    })
    const mergeBaseOid = mbRes.success ? mbRes.stdout.trim() : null

    if (!mergeBaseOid) {
      return {
        sessionId,
        lifecycle: "IDLE",
        targetBranch,
        targetRemoteOid: targetOid,
        mergeBaseOid: null,
        behindCommitCount: 0,
        aheadCommitCount: 0,
        recommended: false,
        recommendationReason: "No common merge-base found between branches",
        requestedAt: null,
        completedAt: null,
        errorMessage: null,
      }
    }

    // Compute behind count: commits in target not in merge-base
    const behindRes = await this.gitService.process.execute(
      ["rev-list", "--count", `${mergeBaseOid}..${targetOid}`],
      { cwd: repoPath, allowNonZeroExit: true },
    )
    const behindCommitCount = behindRes.success ? Number(behindRes.stdout.trim()) || 0 : 0

    // Compute ahead count: commits in session not in merge-base
    const aheadRes = await this.gitService.process.execute(
      ["rev-list", "--count", `${mergeBaseOid}..${sessionOid}`],
      { cwd: repoPath, allowNonZeroExit: true },
    )
    const aheadCommitCount = aheadRes.success ? Number(aheadRes.stdout.trim()) || 0 : 0

    // Check changed paths on target since merge-base
    const diffPathsRes = await this.gitService.process.execute(
      ["diff", "--name-only", mergeBaseOid, targetOid],
      { cwd: repoPath, allowNonZeroExit: true },
    )
    const targetChangedPaths = diffPathsRes.success
      ? diffPathsRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean)
      : []

    // Check overlapping modified paths
    const overlapping = targetChangedPaths.filter((p) => sessionModifiedPaths.includes(p))

    // Evaluate Section 20.3 Heuristic:
    let recommended = false
    let recommendationReason: string | null = null

    if (behindCommitCount >= 20) {
      recommended = true
      recommendationReason = `Target branch '${targetBranch}' is ${behindCommitCount} commits ahead of session base.`
    } else if (targetChangedPaths.length >= 50) {
      recommended = true
      recommendationReason = `Target branch '${targetBranch}' modified ${targetChangedPaths.length} files since session base.`
    } else if (overlapping.length > 0 && behindCommitCount >= 5) {
      recommended = true
      recommendationReason = `Target branch '${targetBranch}' modified ${overlapping.length} overlapping file(s) and is ${behindCommitCount} commits ahead.`
    } else if (isManualCheck && behindCommitCount > 0) {
      recommended = true
      recommendationReason = `Target branch has ${behindCommitCount} new commits available.`
    }

    // Cooldown check for automatic suggestions
    if (recommended && !isManualCheck && this.lastDismissedAt) {
      if (Date.now() - this.lastDismissedAt < this.dismissCooldownMs) {
        recommended = false
      }
    }

    return {
      sessionId,
      lifecycle: recommended ? "SUGGESTED" : "IDLE",
      targetBranch,
      targetRemoteOid: targetOid,
      mergeBaseOid,
      behindCommitCount,
      aheadCommitCount,
      recommended,
      recommendationReason,
      requestedAt: null,
      completedAt: null,
      errorMessage: null,
    }
  }
}
