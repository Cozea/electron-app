/**
 * Keeps an eye on the branch a session's work merges into (Section 20).
 *
 * Phase: P20
 *
 * Now and then, and whenever someone asks, it fetches the target from the remote
 * and measures it against the session branch: how many commits each side has that
 * the other lacks, which files the target changed, and which of those the session
 * changed too. It says whether a rebase is worth it and why, and never starts one
 * (C25).
 */

import type { ProjectdTargetStatus } from "@cozea/projectd-protocol"

import type { GitService } from "../git/GitService"
import { TargetBranchTracker } from "./TargetBranchTracker"

export const DEFAULT_TARGET_CHECK_INTERVAL_MS = 15 * 60_000
const FIRST_CHECK_DELAY_MS = 5_000
const FETCH_TIMEOUT_MS = 60_000
const MAX_OVERLAPPING_PATHS = 10

export interface TargetWatcherOptions {
  workspaceRoot: string
  branchName: string
  targetBranch: string
  gitService: GitService
  /** When the session started, for the "running for over a day" rule. */
  sessionStartedAt?: number
  intervalMs?: number
  firstCheckDelayMs?: number
  onChange: () => void
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/^(fatal|error):\s*/, "").trim())
      .find(Boolean) ?? ""
  )
}

export class TargetWatcher {
  private readonly options: TargetWatcherOptions
  private readonly tracker: TargetBranchTracker
  private current: ProjectdTargetStatus
  private timer: NodeJS.Timeout | null = null
  private running: Promise<ProjectdTargetStatus> | null = null
  private stopped = false

  constructor(options: TargetWatcherOptions) {
    this.options = options
    this.tracker = new TargetBranchTracker(options.gitService)
    this.current = {
      branch: options.targetBranch,
      behind: 0,
      ahead: 0,
      changedPathCount: 0,
      overlappingPaths: [],
      recommended: false,
      reason: null,
      checkedAt: null,
      checking: false,
      error: null,
    }
  }

  /** Checks soon, then on an interval. Safe to call again. */
  start(): void {
    if (this.stopped || this.timer || this.running || this.current.checkedAt !== null) return
    this.schedule(this.options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  status(): ProjectdTargetStatus {
    return this.current
  }

  /** Checks now. A check someone asked for recommends a rebase for any new commit on the target. */
  checkNow(manual = true): Promise<ProjectdTargetStatus> {
    this.running ??= this.check(manual).finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Hides the recommendation for a while; the numbers stay. */
  dismiss(): ProjectdTargetStatus {
    this.tracker.dismissRecommendation()
    return this.update({ recommended: false, reason: null })
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.checkNow(false).finally(() =>
        this.schedule(this.options.intervalMs ?? DEFAULT_TARGET_CHECK_INTERVAL_MS),
      )
    }, delayMs)
  }

  private async check(manual: boolean): Promise<ProjectdTargetStatus> {
    this.update({ checking: true })
    try {
      const { gitService, workspaceRoot, branchName, targetBranch } = this.options
      const git = (args: string[], cwd: string, timeoutMs?: number) =>
        gitService.process.execute(args, { cwd, allowNonZeroExit: true, timeoutMs })
      const top = await git(["rev-parse", "--show-toplevel"], workspaceRoot)
      if (!top.success) throw new Error("This folder is not a Git repository.")
      const root = top.stdout.trim()
      const configured = (await git(["config", "--get", `branch.${branchName}.remote`], root)).stdout.trim()
      const remote = configured && configured !== "." ? configured : "origin"
      const targetRef = `refs/remotes/${remote}/${targetBranch}`
      const fetched = await git(
        ["fetch", "--no-tags", remote, `+refs/heads/${targetBranch}:${targetRef}`],
        root,
        FETCH_TIMEOUT_MS,
      )
      if (!fetched.success) {
        throw new Error(`Git couldn't fetch ${targetBranch} from ${remote}: ${firstLine(fetched.stderr) || "no answer"}`)
      }
      const measured = await this.tracker.measure({
        repoPath: root,
        sessionRef: `refs/heads/${branchName}`,
        targetRef,
        targetName: targetBranch,
        sessionActiveSince: this.options.sessionStartedAt,
        isManualCheck: manual,
      })
      return this.update({
        behind: measured.behind,
        ahead: measured.ahead,
        changedPathCount: measured.targetChangedPaths.length,
        overlappingPaths: measured.overlappingPaths.slice(0, MAX_OVERLAPPING_PATHS),
        recommended: measured.recommended,
        reason: measured.reason,
        checkedAt: Date.now(),
        checking: false,
        error: null,
      })
    } catch (error) {
      return this.update({ checking: false, checkedAt: Date.now(), error: describeError(error) })
    }
  }

  private update(changes: Partial<ProjectdTargetStatus>): ProjectdTargetStatus {
    this.current = { ...this.current, ...changes }
    this.options.onChange()
    return this.current
  }
}
