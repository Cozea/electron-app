/**
 * Measures how far a session's target branch has moved, and says whether rebasing
 * onto it is worth it (Section 20.1 - 20.3).
 *
 * Invariants:
 * - C25: Rebase is explicit. This recommends a rebase; it never starts one.
 *
 * The thresholds are the plan's starting values, meant to be tuned from use, and
 * never a reason to rebase on their own.
 */

import type { GitService } from "../git/GitService"

/** Target commits the session branch lacks before a rebase is recommended outright. */
export const BEHIND_COMMITS_THRESHOLD = 20
/** Files the target changed before a rebase is recommended outright. */
export const CHANGED_PATHS_THRESHOLD = 50
/** Target commits needed when the target changed files the session changed too. */
export const OVERLAP_BEHIND_THRESHOLD = 5
/** A session running this long is worth rebasing whenever the target moved. */
export const LONG_SESSION_MS = 24 * 60 * 60 * 1000
/** How long a dismissed recommendation stays hidden from automatic checks. */
export const DISMISS_COOLDOWN_MS = 60 * 60 * 1000

export interface TargetDivergence {
  targetOid: string | null
  mergeBaseOid: string | null
  /** Commits on the target the session branch lacks. */
  behind: number
  /** Commits on the session branch the target lacks. */
  ahead: number
  targetChangedPaths: string[]
  /** Files both the target and the session changed since they split. */
  overlappingPaths: string[]
  recommended: boolean
  /** Why a rebase is recommended; null when it isn't. */
  reason: string | null
}

export interface TargetMeasureParams {
  repoPath: string
  /** The session branch, as a full ref. */
  sessionRef: string
  /** The target as fetched, such as refs/remotes/origin/main. */
  targetRef: string
  /** The target's name for people, such as main. */
  targetName: string
  /** When the session started, in epoch milliseconds. */
  sessionActiveSince?: number
  /** Someone asked: any new target commit is worth a rebase, and a dismissal doesn't apply. */
  isManualCheck?: boolean
  now?: number
}

function countCommits(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`
}

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(", ")
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown
}

export class TargetBranchTracker {
  readonly gitService: GitService
  readonly dismissCooldownMs: number
  private lastDismissedAt: number | null = null

  constructor(gitService: GitService, options: { dismissCooldownMs?: number } = {}) {
    this.gitService = gitService
    this.dismissCooldownMs = options.dismissCooldownMs ?? DISMISS_COOLDOWN_MS
  }

  /** Hides automatic recommendations for the cooldown; a check someone asks for still shows one. */
  dismissRecommendation(now = Date.now()): void {
    this.lastDismissedAt = now
  }

  async measure(params: TargetMeasureParams): Promise<TargetDivergence> {
    const now = params.now ?? Date.now()
    const git = (args: string[]) =>
      this.gitService.process.execute(args, { cwd: params.repoPath, allowNonZeroExit: true })
    const [sessionOid, targetOid] = await Promise.all([
      this.gitService.getCommitOid(params.repoPath, params.sessionRef),
      this.gitService.getCommitOid(params.repoPath, params.targetRef),
    ])
    const unmoved: TargetDivergence = {
      targetOid,
      mergeBaseOid: null,
      behind: 0,
      ahead: 0,
      targetChangedPaths: [],
      overlappingPaths: [],
      recommended: false,
      reason: null,
    }
    if (!sessionOid || !targetOid) return unmoved
    if (sessionOid === targetOid) return { ...unmoved, mergeBaseOid: sessionOid }

    const mergeBase = await git(["merge-base", sessionOid, targetOid])
    const mergeBaseOid = mergeBase.success ? mergeBase.stdout.trim() || null : null
    if (!mergeBaseOid) return unmoved

    const count = async (range: string) => Number((await git(["rev-list", "--count", range])).stdout.trim()) || 0
    const changedSince = async (to: string) => {
      const result = await git(["diff", "--name-only", "--no-renames", "-z", mergeBaseOid, to])
      return result.success ? result.stdout.split("\0").filter(Boolean) : []
    }
    const [behind, ahead] = await Promise.all([count(`${mergeBaseOid}..${targetOid}`), count(`${mergeBaseOid}..${sessionOid}`)])
    const targetChangedPaths = behind > 0 ? await changedSince(targetOid) : []
    const sessionPaths = new Set(ahead > 0 && targetChangedPaths.length > 0 ? await changedSince(sessionOid) : [])
    const overlappingPaths = targetChangedPaths.filter((changed) => sessionPaths.has(changed))

    const reason = this.reasonToRebase({ ...params, now, behind, targetChangedPaths, overlappingPaths })
    const dismissed =
      !params.isManualCheck && this.lastDismissedAt !== null && now - this.lastDismissedAt < this.dismissCooldownMs
    const recommended = reason !== null && !dismissed
    return {
      targetOid,
      mergeBaseOid,
      behind,
      ahead,
      targetChangedPaths,
      overlappingPaths,
      recommended,
      reason: recommended ? reason : null,
    }
  }

  /** The Section 20.3 heuristic, in words for the session bar. */
  private reasonToRebase(input: {
    targetName: string
    behind: number
    targetChangedPaths: string[]
    overlappingPaths: string[]
    sessionActiveSince?: number
    isManualCheck?: boolean
    now: number
  }): string | null {
    const { targetName, behind, targetChangedPaths, overlappingPaths } = input
    if (behind === 0) return null
    if (behind >= BEHIND_COMMITS_THRESHOLD) {
      return `${targetName} has ${countCommits(behind)} this session's branch doesn't have.`
    }
    if (targetChangedPaths.length >= CHANGED_PATHS_THRESHOLD) {
      return `${targetName} changed ${targetChangedPaths.length} files since this session's branch split from it.`
    }
    if (overlappingPaths.length > 0 && behind >= OVERLAP_BEHIND_THRESHOLD) {
      return `${targetName} changed ${listPaths(overlappingPaths)}, which the session changed too.`
    }
    if (input.sessionActiveSince !== undefined && input.now - input.sessionActiveSince > LONG_SESSION_MS) {
      return `The session has run for over a day, and ${targetName} has moved on by ${countCommits(behind)}.`
    }
    if (input.isManualCheck) {
      return `${targetName} has ${countCommits(behind)} this session's branch doesn't have.`
    }
    return null
  }
}
