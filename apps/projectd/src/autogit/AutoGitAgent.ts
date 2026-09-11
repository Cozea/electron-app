/**
 * Saves a live session to its Git branch from projectd (AutoGit).
 *
 * Master Specification: Section 14, 15, 16
 * Phase: P16, P17, P18
 *
 * The session room holds the leader lease: one eligible device at a time may push,
 * and the room takes barriers and checkpoint records from no one else. The leader
 * captures the session exactly at a room barrier, builds a deterministic commit from
 * that capture without touching any working tree, fast-forwards the session branch
 * on the remote, and records the checkpoint in the room. Every member then moves its
 * local branch and index to the checkpoint and keeps its working tree.
 *
 * AutoGit never overwrites commits it did not make: when the branch changes on the
 * remote outside the session, the leader stops saving and every member is told why.
 */

import type {
  ProjectdAutoGitState,
  ProjectdAutoGitStatus,
  ProjectdCheckpointResult,
  ProjectdCheckpointSummary,
} from "@cozea/projectd-protocol"

import type { SessionReplica } from "../collaboration/SessionReplica"
import {
  RoomRequestError,
  type RoomAutoGitState,
  type RoomCheckpoint,
  type RoomCheckpointInput,
  type RoomLease,
  type SessionRoomClient,
} from "../collaboration/SessionRoomClient"
import type { SessionTransport } from "../collaboration/SessionTransport"
import type { GitExecuteOptions } from "../git/GitProcess"
import type { GitService } from "../git/GitService"
import { BarrierCapture, type BarrierSnapshot } from "./BarrierCapture"
import { CheckpointBuilder } from "./CheckpointBuilder"
import { GitBaselineAdopter } from "./GitBaselineAdopter"

export interface AutoGitTiming {
  /** How often the leader renews its lease; the room's lease lasts 20 seconds (Section 14.5). */
  renewIntervalMs: number
  /** Quiet time after the last change before a checkpoint (Section 15.2). */
  quietMs: number
  /** Longest a change waits for a checkpoint while edits keep coming. */
  maxDirtyMs: number
  /** Shortest gap between automatic checkpoints. */
  minIntervalMs: number
  /** Wait before trying again after a checkpoint failed. */
  retryMs: number
  /** How often a device that cannot push checks again. */
  eligibilityRecheckMs: number
  /** Limit for one fetch, push or ls-remote. */
  remoteTimeoutMs: number
}

export const DEFAULT_AUTOGIT_TIMING: AutoGitTiming = {
  renewIntervalMs: 5_000,
  quietMs: 15_000,
  maxDirtyMs: 120_000,
  minIntervalMs: 30_000,
  retryMs: 15_000,
  eligibilityRecheckMs: 60_000,
  remoteTimeoutMs: 60_000,
}

const ADOPTION_RETRY_MS = 30_000
// Failures every leader would hit alike; checkpoints stop until someone acts (Section 15.9).
const BLOCKING_CODES = new Set(["REMOTE_CHANGED", "REMOTE_DIVERGED", "REMOTE_BRANCH_MISSING", "PROTECTED_BRANCH"])

export class AutoGitError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AutoGitError"
    this.code = code
  }
}

export interface AutoGitAgentOptions {
  publicSessionId: string
  branchName: string
  workspaceRoot: string
  gitService: GitService
  room: SessionRoomClient
  replica: SessionReplica
  transport: SessionTransport
  canWrite: () => boolean
  /** The largest text file the session syncs; larger files keep their Git versions. */
  maxTextFileBytes: number
  /** Runs work between the host's own ingestion and materialization steps. */
  runExclusive: <T>(work: () => Promise<T>) => Promise<T>
  /** Sends unsent local edits and resolves once the room has acknowledged every one. */
  flushLocalChanges: () => Promise<void>
  onChange: () => void
  timing?: Partial<AutoGitTiming>
}

interface Repository {
  /** The repository's top level. */
  root: string
  /** The session folder's place in the repository ("" at the top level). */
  prefix: string
  remote: string
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/^(fatal|error|remote|hint):\s*/, "").trim())
      .find(Boolean) ?? ""
  )
}

/** Names what went wrong talking to the remote, from Git's own words. */
function remoteFailure(remote: string, output: string): AutoGitError {
  if (/GH006|protected branch|pre-receive hook declined/i.test(output)) {
    return new AutoGitError("PROTECTED_BRANCH", `${remote} refused the push: ${firstLine(output)}`)
  }
  if (/non-fast-forward|fetch first|\[rejected\]/i.test(output)) {
    return new AutoGitError("PUSH_REJECTED", `${remote} has newer commits on this branch than this device expected.`)
  }
  if (
    /Authentication failed|could not read (Username|Password)|Permission denied|terminal prompts disabled|Repository not found|\b40[13]\b/i.test(
      output,
    )
  ) {
    return new AutoGitError("AUTH", `Git couldn't sign in to ${remote} from the background service. ${firstLine(output)}`.trim())
  }
  return new AutoGitError("REMOTE_UNREACHABLE", `Git couldn't reach ${remote}: ${firstLine(output) || "no answer"}`)
}

function readTrailers(body: string): Record<string, string> {
  const trailers: Record<string, string> = {}
  for (const line of body.split("\n")) {
    const match = /^(Cozea-[A-Za-z-]+):\s*(\S+)\s*$/.exec(line.trim())
    if (match) trailers[match[1]] = match[2]
  }
  return trailers
}

export class AutoGitAgent {
  private readonly options: AutoGitAgentOptions
  private readonly timing: AutoGitTiming
  private readonly builder: CheckpointBuilder
  private readonly adopter: GitBaselineAdopter

  private repo: Repository | null = null
  private starting: Promise<void> | null = null
  private stopped = false
  private eligible = false
  private ineligibleReason: string | null = null
  private blocked: AutoGitError | null = null
  private noticeShown = false
  private lease: RoomLease | null = null
  private checkpoint: RoomCheckpoint | null = null
  private leading = false
  private inFlight: Promise<void> | null = null
  private rerunRequested = false
  // Highest session sequence whose content a checkpoint holds.
  private cleanThroughSeq = 0
  private firstDirtyAt: number | null = null
  private lastActivityAt = 0
  private lastSuccessAt = 0
  private retryAt = 0
  private lastError: { code: string; message: string } | null = null
  private adoptedOid: string | null = null
  private adoptionRun: Promise<void> | null = null
  private adoptionSkip: { oid: string; at: number } | null = null
  private baselineNote: string | null = null
  private renewTimer: NodeJS.Timeout | null = null
  private checkpointTimer: NodeJS.Timeout | null = null
  private eligibilityTimer: NodeJS.Timeout | null = null

  constructor(options: AutoGitAgentOptions) {
    this.options = options
    this.timing = { ...DEFAULT_AUTOGIT_TIMING, ...options.timing }
    this.builder = new CheckpointBuilder(options.gitService)
    this.adopter = new GitBaselineAdopter(options.gitService)
  }

  /** Finds the repository and tells the room whether this device can push. Safe to call again. */
  start(): Promise<void> {
    this.starting ??= this.initialize()
    return this.starting
  }

  /** Stops saving; a leader gives its lease up so another device takes over at once. */
  stop(): void {
    if (this.stopped) return
    const lease = this.lease
    if (this.leading && lease) this.options.room.releaseLease(lease.generation)
    this.stopped = true
    this.leading = false
    this.clearTimers()
  }

  /** Resolves once work under way, a checkpoint or a baseline move, has finished. */
  async settled(): Promise<void> {
    await Promise.allSettled([this.starting, this.inFlight, this.adoptionRun])
  }

  handleRoomState(state: RoomAutoGitState | null): void {
    if (!state || this.stopped || !this.repo) return
    this.lease = state.lease
    if (state.checkpoint) this.acceptCheckpoint(state.checkpoint)
    this.updateLeadership()
    this.options.onChange()
  }

  /** The room connection opened or dropped. */
  handleConnectionChange(): void {
    if (this.stopped || !this.repo) return
    this.updateLeadership()
    this.options.onChange()
  }

  /** A member asked the leader to save now. */
  handleCheckpointRequested(): void {
    if (!this.leading) return
    this.retryAt = 0
    void this.runCheckpoint()
  }

  /** The session moved: a peer's batch arrived or the room took one of this device's. */
  noteActivity(): void {
    if (this.stopped || !this.repo) return
    if (this.isDirty()) {
      const now = Date.now()
      this.firstDirtyAt ??= now
      this.lastActivityAt = now
    }
    if (this.leading) this.scheduleCheckpoint()
    void this.maybeAdoptBaseline()
  }

  /** Saves now on the leader, or asks the leader to. */
  async checkpointNow(): Promise<ProjectdCheckpointResult> {
    await this.start()
    if (!this.repo) {
      throw new AutoGitError("AUTOGIT_OFF", "This session's folder is not a Git repository, so there is no branch to save to.")
    }
    if (this.leading) {
      this.blocked = null
      this.retryAt = 0
      await this.runCheckpoint()
      if (this.lastError) throw new AutoGitError(this.lastError.code, this.lastError.message)
      return { outcome: "saved", lastCheckpoint: this.summary() }
    }
    const routed = await this.options.room.requestCheckpoint()
    return { outcome: routed ? "requested" : "no_leader", lastCheckpoint: this.summary() }
  }

  status(): ProjectdAutoGitStatus | null {
    if (!this.repo) return null
    const leaderNotice = !this.leading && this.lease?.leaderClientId ? (this.lease.notice ?? null) : null
    const state = this.currentState(leaderNotice)
    return {
      state,
      isLeader: this.leading,
      leaderPrincipalId: this.lease?.leaderClientId ? this.lease.leaderPrincipalId : null,
      lastCheckpoint: this.summary(),
      unsavedChanges: Math.max(0, this.options.transport.lastAppliedSessionSeq - this.cleanThroughSeq),
      saving: this.inFlight !== null,
      detail:
        this.blocked?.message ??
        leaderNotice ??
        this.baselineNote ??
        (state === "ineligible" ? this.ineligibleReason : null),
      lastError: this.lastError,
    }
  }

  // ─── Setup and eligibility (Section 14.4) ────────────────────────────────────

  private async initialize(): Promise<void> {
    try {
      this.repo = await this.readRepository()
    } catch (error) {
      console.warn(`[projectd] AutoGit for ${this.options.publicSessionId} could not read the repository: ${describeError(error)}`)
      this.repo = null
    }
    if (this.stopped || !this.repo) {
      this.options.onChange()
      return
    }
    await this.refreshEligibility()
    this.handleRoomState(this.options.room.autoGitState)
  }

  private async readRepository(): Promise<Repository | null> {
    const cwd = this.options.workspaceRoot
    const git = this.options.gitService.process
    const top = await git.execute(["rev-parse", "--show-toplevel"], { cwd, allowNonZeroExit: true })
    if (!top.success) return null
    const prefix = await git.execute(["rev-parse", "--show-prefix"], { cwd })
    const configured = await git.execute(["config", "--get", `branch.${this.options.branchName}.remote`], {
      cwd,
      allowNonZeroExit: true,
    })
    const configuredRemote = configured.stdout.trim()
    return {
      root: top.stdout.trim(),
      prefix: prefix.stdout.trim(),
      remote: configured.success && configuredRemote && configuredRemote !== "." ? configuredRemote : "origin",
    }
  }

  private async refreshEligibility(): Promise<void> {
    const repo = this.repo
    if (this.stopped || !repo) return
    let reason: string | null = null
    if (!this.options.canWrite()) {
      reason = "Viewers don't save the session to Git."
    } else {
      const remotes = await this.git(["remote"], { allowNonZeroExit: true })
      if (!remotes.stdout.split("\n").some((line) => line.trim() === repo.remote)) {
        reason = `This repository has no remote named ${repo.remote} to save the session to.`
      } else {
        try {
          await this.lsRemote()
        } catch (error) {
          reason = describeError(error)
        }
      }
    }
    this.eligible = reason === null
    this.ineligibleReason = reason
    // The room refuses viewers outright, so they say nothing.
    if (this.options.canWrite()) this.options.room.setAutoGitEligibility(this.eligible)
    if (!this.eligible) this.scheduleEligibilityCheck()
    this.updateLeadership()
    this.options.onChange()
  }

  private scheduleEligibilityCheck(): void {
    if (this.stopped || this.eligibilityTimer) return
    this.eligibilityTimer = setTimeout(() => {
      this.eligibilityTimer = null
      void this.refreshEligibility()
    }, this.timing.eligibilityRecheckMs)
  }

  // ─── Leadership (Section 14.5 - 14.7) ────────────────────────────────────────

  private updateLeadership(): void {
    const leading =
      !this.stopped &&
      this.eligible &&
      this.options.room.state === "live" &&
      this.lease?.leaderClientId === this.options.room.clientId
    if (leading === this.leading) {
      if (leading) this.scheduleCheckpoint()
      return
    }
    this.leading = leading
    if (leading) {
      this.blocked = null
      this.noticeShown = Boolean(this.lease?.notice)
      this.retryAt = 0
      this.renewTimer = setInterval(() => void this.renew(), this.timing.renewIntervalMs)
      this.scheduleCheckpoint()
      return
    }
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.renewTimer = null
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer)
    this.checkpointTimer = null
  }

  private async renew(): Promise<void> {
    const lease = this.lease
    if (!this.leading || !lease) return
    try {
      this.lease = await this.options.room.renewLease(lease.generation)
    } catch (error) {
      if (error instanceof RoomRequestError && error.code === "LEASE_STALE") {
        this.lease = null
        this.updateLeadership()
        this.options.onChange()
      }
      // Otherwise the room decides when the lease ends: a dropped connection is not a lost lease.
    }
  }

  private setNotice(message: string | null): void {
    const lease = this.lease
    if (!lease || (message === null && !this.noticeShown)) return
    this.options.room.setLeaderNotice(lease.generation, message)
    this.noticeShown = message !== null
  }

  // ─── Scheduling (Section 15.1 - 15.2) ────────────────────────────────────────

  private isDirty(): boolean {
    return this.options.transport.lastAppliedSessionSeq > this.cleanThroughSeq
  }

  private scheduleCheckpoint(immediate = false): void {
    if (!this.leading || this.blocked || this.inFlight) return
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer)
    this.checkpointTimer = null
    if (!immediate && !this.isDirty()) return
    const now = Date.now()
    let due = now
    if (!immediate) {
      this.firstDirtyAt ??= now
      if (!this.lastActivityAt) this.lastActivityAt = now
      due = Math.min(this.lastActivityAt + this.timing.quietMs, this.firstDirtyAt + this.timing.maxDirtyMs)
      due = Math.max(due, this.lastSuccessAt + this.timing.minIntervalMs, this.retryAt)
    }
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null
      void this.runCheckpoint()
    }, Math.max(0, due - now))
  }

  private runCheckpoint(): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true
      return this.inFlight
    }
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer)
    this.checkpointTimer = null
    const run = this.checkpointOnce().finally(() => {
      this.inFlight = null
      const rerun = this.rerunRequested
      this.rerunRequested = false
      this.options.onChange()
      this.scheduleCheckpoint(rerun && this.isDirty())
    })
    this.inFlight = run
    this.options.onChange()
    return run
  }

  // ─── Checkpoint (Section 15.3 - 15.10) ───────────────────────────────────────

  private async checkpointOnce(): Promise<void> {
    const lease = this.lease
    if (!this.leading || !lease || !this.repo) return
    try {
      const snapshot = await this.captureAtBarrier(lease.generation)
      await this.saveSnapshot(lease.generation, snapshot)
      this.lastError = null
      this.retryAt = 0
      this.lastSuccessAt = Date.now()
      this.cleanThroughSeq = Math.max(this.cleanThroughSeq, snapshot.sessionSeq)
      if (this.isDirty()) {
        // Edits that arrived after the barrier wait for the next checkpoint.
        this.firstDirtyAt = this.lastSuccessAt
      } else {
        this.firstDirtyAt = null
        this.lastActivityAt = 0
      }
      this.setNotice(null)
    } catch (error) {
      this.handleFailure(error)
    }
  }

  /**
   * Captures the replica exactly at a room barrier (Section 15.3 - 15.4). Local edits
   * go out and are acknowledged first, and the capture runs as the barrier arrives,
   * before any later batch applies. Ingestion waits meanwhile; editing does not.
   */
  private captureAtBarrier(generation: number): Promise<BarrierSnapshot> {
    return this.options.runExclusive(async () => {
      await this.options.flushLocalChanges()
      const captured: { snapshot?: BarrierSnapshot; behind?: string } = {}
      await this.options.room.requestBarrier(generation, (barrier) => {
        const applied = this.options.transport.lastAppliedSessionSeq
        if (applied !== barrier.sessionSeq) {
          captured.behind = `this device has applied ${applied} of the session's ${barrier.sessionSeq} changes`
        } else if (this.options.replica.hasUnexportedChanges()) {
          captured.behind = "this device has edits it has not sent yet"
        } else {
          captured.snapshot = BarrierCapture.captureSnapshot(barrier, this.options.replica)
        }
      })
      if (!captured.snapshot) {
        throw new AutoGitError("NOT_AT_BARRIER", `Waiting to catch up with the session: ${captured.behind ?? "no barrier"}.`)
      }
      return captured.snapshot
    })
  }

  private async saveSnapshot(generation: number, snapshot: BarrierSnapshot): Promise<void> {
    const repo = this.requireRepo()
    const { parentOid, remoteHead } = await this.resolveParent(generation)
    const built = await this.builder.buildCheckpointCommit({
      repoPath: repo.root,
      sessionId: this.options.publicSessionId,
      parentOid,
      leaseGeneration: generation,
      snapshot,
      pathPrefix: repo.prefix,
      maxTextFileBytes: this.options.maxTextFileBytes,
    })

    if (built.parentTreeOid !== null && built.treeOid === built.parentTreeOid) {
      // The branch already holds this content. A branch the remote lacks still goes up,
      // so members can clone it.
      if (remoteHead === null && parentOid) {
        this.lease = await this.options.room.renewLease(generation)
        await this.push(parentOid)
      }
      return
    }

    // Fencing (Section 14.6): the room must still name this device before anything leaves it.
    this.lease = await this.options.room.renewLease(generation)
    await this.push(built.commitOid)
    this.acceptCheckpoint(
      await this.options.room.publishCheckpoint(generation, {
        commitOid: built.commitOid,
        parentOid: built.parentOid,
        treeOid: built.treeOid,
        sessionSeq: snapshot.sessionSeq,
        barrierId: snapshot.barrierId,
        logicalTreeHash: snapshot.logicalTreeHash,
      }),
    )
  }

  /**
   * The commit the next checkpoint builds on. After the first checkpoint it is always
   * the last one the room recorded; the remote must still point there, or at
   * checkpoints of this session a leader pushed without recording them.
   */
  private async resolveParent(generation: number): Promise<{ parentOid: string | null; remoteHead: string | null }> {
    const repo = this.requireRepo()
    const branch = this.options.branchName
    const remoteHead = await this.lsRemote()
    const anchor = this.checkpoint?.commitOid ?? null

    if (anchor) {
      if (remoteHead === anchor) return { parentOid: anchor, remoteHead }
      if (!remoteHead) {
        throw new AutoGitError(
          "REMOTE_BRANCH_MISSING",
          `${branch} no longer exists on ${repo.remote}, so AutoGit stopped saving the session. Push the branch again to resume.`,
        )
      }
      await this.fetchBranch()
      const recovered = await this.ownCheckpointsSince(anchor, remoteHead)
      if (!recovered) {
        throw new AutoGitError(
          "REMOTE_CHANGED",
          `${branch} changed on ${repo.remote} outside the session, so AutoGit stopped saving to it rather than overwrite those commits.`,
        )
      }
      // A leader pushed this and stopped before recording it (Section 15.9).
      this.acceptCheckpoint(await this.options.room.publishCheckpoint(generation, recovered))
      return { parentOid: remoteHead, remoteHead }
    }

    // The first checkpoint builds on whichever of the local and remote branch is ahead.
    const localHead = await this.options.gitService.getCommitOid(repo.root, `refs/heads/${branch}`)
    if (!remoteHead || localHead === remoteHead) return { parentOid: localHead, remoteHead }
    await this.fetchBranch()
    if (!localHead || (await this.isAncestor(localHead, remoteHead))) return { parentOid: remoteHead, remoteHead }
    if (await this.isAncestor(remoteHead, localHead)) return { parentOid: localHead, remoteHead }
    throw new AutoGitError(
      "REMOTE_DIVERGED",
      `${branch} has different commits in this folder and on ${repo.remote}. Bring them together, then save again.`,
    )
  }

  /** The newest of the commits after `anchor`, when every one is a checkpoint of this session. */
  private async ownCheckpointsSince(anchor: string, head: string): Promise<RoomCheckpointInput | null> {
    const log = await this.git(["log", "--reverse", "--format=%H%x1f%T%x1f%P%x1f%B%x1e", `${anchor}..${head}`], {
      allowNonZeroExit: true,
    })
    if (!log.success) return null
    const commits = log.stdout
      .split("\x1e")
      .map((record) => record.replace(/^\n/, ""))
      .filter(Boolean)
      .map((record) => {
        const [oid = "", tree = "", parents = "", body = ""] = record.split("\x1f")
        return { oid, tree, parents, body }
      })
    let expectedParent = anchor
    let newest: RoomCheckpointInput | null = null
    for (const commit of commits) {
      const trailers = readTrailers(commit.body)
      const sessionSeq = Number(trailers["Cozea-Seq"])
      if (
        commit.parents !== expectedParent ||
        trailers["Cozea-Session"] !== this.options.publicSessionId ||
        !Number.isSafeInteger(sessionSeq) ||
        !trailers["Cozea-Barrier"] ||
        !trailers["Cozea-Snapshot"]
      ) {
        return null
      }
      newest = {
        commitOid: commit.oid,
        parentOid: expectedParent,
        treeOid: commit.tree,
        sessionSeq,
        barrierId: trailers["Cozea-Barrier"],
        logicalTreeHash: trailers["Cozea-Snapshot"],
      }
      expectedParent = commit.oid
    }
    return newest
  }

  private handleFailure(error: unknown): void {
    const code = error instanceof AutoGitError || error instanceof RoomRequestError ? error.code : "CHECKPOINT_FAILED"
    const message = describeError(error)
    this.lastError = { code, message }
    if (code === "LEASE_STALE") {
      this.lease = null
      this.updateLeadership()
      return
    }
    if (BLOCKING_CODES.has(code)) {
      this.blocked = error instanceof AutoGitError ? error : new AutoGitError(code, message)
      this.setNotice(message)
      return
    }
    if (code === "AUTH") {
      // Another member's Mac may be able to push; step aside until this one can.
      this.eligible = false
      this.ineligibleReason = message
      this.options.room.setAutoGitEligibility(false)
      this.updateLeadership()
      this.scheduleEligibilityCheck()
      return
    }
    this.retryAt = Date.now() + this.timing.retryMs
    console.warn(`[projectd] AutoGit checkpoint for ${this.options.publicSessionId} failed: ${code}: ${message}`)
  }

  // ─── Baseline adoption (Section 16) ──────────────────────────────────────────

  private acceptCheckpoint(checkpoint: RoomCheckpoint): void {
    if (this.checkpoint?.commitOid === checkpoint.commitOid) return
    if (this.checkpoint && checkpoint.sessionSeq < this.checkpoint.sessionSeq) return
    this.checkpoint = checkpoint
    this.cleanThroughSeq = Math.max(this.cleanThroughSeq, checkpoint.sessionSeq)
    if (!this.isDirty()) {
      this.firstDirtyAt = null
      this.lastActivityAt = 0
    }
    void this.maybeAdoptBaseline()
  }

  private maybeAdoptBaseline(): Promise<void> {
    const checkpoint = this.checkpoint
    const repo = this.repo
    if (!repo || !checkpoint || this.adoptionRun || this.stopped || this.adoptedOid === checkpoint.commitOid) {
      return Promise.resolve()
    }
    // The folder holds at least the checkpoint's content first.
    if (this.options.transport.lastAppliedSessionSeq < checkpoint.sessionSeq) return Promise.resolve()
    if (this.adoptionSkip?.oid === checkpoint.commitOid && Date.now() - this.adoptionSkip.at < ADOPTION_RETRY_MS) {
      return Promise.resolve()
    }
    const run = this.adoptBaseline(repo, checkpoint).finally(() => {
      this.adoptionRun = null
      this.options.onChange()
      // A newer checkpoint arrived meanwhile.
      if (this.checkpoint && this.checkpoint.commitOid !== checkpoint.commitOid) void this.maybeAdoptBaseline()
    })
    this.adoptionRun = run
    return run
  }

  private async adoptBaseline(repo: Repository, checkpoint: RoomCheckpoint): Promise<void> {
    try {
      const result = await this.adopter.advanceBaseline({
        cwd: this.options.workspaceRoot,
        branchName: this.options.branchName,
        checkpointOid: checkpoint.commitOid,
        remote: repo.remote,
      })
      if (result.state === "skipped") {
        this.adoptionSkip = { oid: checkpoint.commitOid, at: Date.now() }
        this.baselineNote = `Git in this folder still compares against an older commit. ${result.reason ?? ""}`.trim()
      } else {
        this.adoptedOid = checkpoint.commitOid
        this.adoptionSkip = null
        this.baselineNote = null
      }
    } catch (error) {
      this.adoptionSkip = { oid: checkpoint.commitOid, at: Date.now() }
      this.baselineNote = `Git in this folder still compares against an older commit: ${describeError(error)}`
    }
  }

  // ─── Git ─────────────────────────────────────────────────────────────────────

  private git(args: string[], options: Omit<GitExecuteOptions, "cwd"> = {}) {
    return this.options.gitService.process.execute(args, { cwd: this.requireRepo().root, ...options })
  }

  private async lsRemote(): Promise<string | null> {
    const repo = this.requireRepo()
    const ref = `refs/heads/${this.options.branchName}`
    let result
    try {
      result = await this.git(["ls-remote", repo.remote, ref], {
        allowNonZeroExit: true,
        timeoutMs: this.timing.remoteTimeoutMs,
      })
    } catch (error) {
      throw new AutoGitError("REMOTE_UNREACHABLE", `Git couldn't reach ${repo.remote}: ${describeError(error)}`)
    }
    if (!result.success) throw remoteFailure(repo.remote, result.stderr)
    const line = result.stdout.split("\n").find((entry) => entry.endsWith(`\t${ref}`))
    return line ? (line.split("\t")[0] ?? null) : null
  }

  private async fetchBranch(): Promise<void> {
    const repo = this.requireRepo()
    const branch = this.options.branchName
    let result
    try {
      result = await this.git(["fetch", "--no-tags", repo.remote, `+refs/heads/${branch}:refs/remotes/${repo.remote}/${branch}`], {
        allowNonZeroExit: true,
        timeoutMs: this.timing.remoteTimeoutMs,
      })
    } catch (error) {
      throw new AutoGitError("REMOTE_UNREACHABLE", `Git couldn't fetch from ${repo.remote}: ${describeError(error)}`)
    }
    if (!result.success) throw remoteFailure(repo.remote, result.stderr)
  }

  /** Fast-forwards the session branch on the remote; never forces (Section 15.8). */
  private async push(commitOid: string): Promise<void> {
    const repo = this.requireRepo()
    let result
    try {
      // The user's pre-push hooks are for their own pushes, not for checkpoints every few seconds.
      result = await this.git(
        ["push", "--no-verify", "--no-signed", "--porcelain", repo.remote, `${commitOid}:refs/heads/${this.options.branchName}`],
        { allowNonZeroExit: true, timeoutMs: this.timing.remoteTimeoutMs },
      )
    } catch (error) {
      // No answer (Section 15.9): the push may have landed all the same.
      if ((await this.lsRemote().catch(() => null)) === commitOid) return
      throw new AutoGitError("REMOTE_UNREACHABLE", `Git couldn't finish pushing to ${repo.remote}: ${describeError(error)}`)
    }
    if (result.success) return
    if ((await this.lsRemote().catch(() => null)) === commitOid) return
    throw remoteFailure(repo.remote, `${result.stderr}\n${result.stdout}`)
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.git(["merge-base", "--is-ancestor", ancestor, descendant], { allowNonZeroExit: true })
    if (result.exitCode === 0) return true
    if (result.exitCode === 1) return false
    throw new AutoGitError("GIT_FAILED", firstLine(result.stderr) || "git merge-base failed")
  }

  private requireRepo(): Repository {
    if (!this.repo) throw new AutoGitError("AUTOGIT_OFF", "This session's folder is not a Git repository.")
    return this.repo
  }

  private summary(): ProjectdCheckpointSummary | null {
    return this.checkpoint
      ? {
          commitOid: this.checkpoint.commitOid,
          sessionSeq: this.checkpoint.sessionSeq,
          publishedAt: this.checkpoint.publishedAt,
        }
      : null
  }

  private currentState(leaderNotice: string | null): ProjectdAutoGitState {
    if (this.blocked) return "blocked"
    if (this.leading) return "leader"
    if (this.lease?.leaderClientId) return leaderNotice ? "blocked" : "follower"
    return this.eligible ? "no_leader" : "ineligible"
  }

  private clearTimers(): void {
    if (this.renewTimer) clearInterval(this.renewTimer)
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer)
    if (this.eligibilityTimer) clearTimeout(this.eligibilityTimer)
    this.renewTimer = null
    this.checkpointTimer = null
    this.eligibilityTimer = null
  }
}
