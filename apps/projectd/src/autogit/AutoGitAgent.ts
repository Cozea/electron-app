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
 * Commits pushed to the branch from outside the session are merged into the session
 * as Git would merge them, and the next checkpoint builds on them (Section 18.7).
 * AutoGit never overwrites commits it did not make: when the branch is rewritten
 * outside the session, the leader stops saving and every member is told why.
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  ProjectdAutoGitState,
  ProjectdAutoGitStatus,
  ProjectdCheckpointResult,
  ProjectdCheckpointSummary,
  ProjectdRebaseResult,
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
import { TextDocRegistry } from "../collaboration/TextDocRegistry"
import { ScopePolicy } from "../filesystem/ScopePolicy"
import type { GitExecuteOptions } from "../git/GitProcess"
import type { GitService } from "../git/GitService"
import { fallbackIdentityEnv } from "../git/identity"
import { BarrierCapture, type BarrierSnapshot } from "./BarrierCapture"
import { CheckpointBuilder, UnignoredEnvironmentFilesError, type CheckpointCommitResult } from "./CheckpointBuilder"
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
  /** How often the leader looks for commits pushed to the branch from outside the session. */
  remotePollMs: number
}

export const DEFAULT_AUTOGIT_TIMING: AutoGitTiming = {
  renewIntervalMs: 5_000,
  quietMs: 15_000,
  maxDirtyMs: 120_000,
  minIntervalMs: 30_000,
  retryMs: 15_000,
  eligibilityRecheckMs: 60_000,
  remoteTimeoutMs: 60_000,
  remotePollMs: 60_000,
}

const ADOPTION_RETRY_MS = 30_000
// Failures every leader would hit alike; checkpoints stop until someone acts (Section 15.9).
const BLOCKING_CODES = new Set(["REMOTE_CHANGED", "REMOTE_DIVERGED", "REMOTE_BRANCH_MISSING", "PROTECTED_BRANCH"])
// Holds the session itself can lift; saving is tried again with the next change.
const HELD_CODES = new Set(["ENV_NOT_IGNORED", "CONFLICT_MARKERS"])
// Tries at applying a merge of outside commits while files keep changing under it.
const MERGE_ATTEMPTS = 3
// Git's conflict markers. The ======= separator alone also underlines Markdown headings.
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/m
const REGULAR_OR_ABSENT_MODES = new Set(["000000", "100644", "100755"])

export class AutoGitError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AutoGitError"
    this.code = code
  }
}

/** One file of a merge from outside the session: its text as the merge found it, and after. */
export interface SessionFileChange {
  path: string
  /** The session's text when the merge read it; null when the session had no such file. */
  expected: string | null
  /** The merged text; null deletes the file. */
  text: string | null
  /** For a file the merge creates. */
  mode?: number
}

interface ExternalFile {
  sessionPath: string
  baseOid: string
  headOid: string
  mode: number
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
  /**
   * Applies files merged from commits pushed outside the session, unless one no longer
   * reads as `expected`; returns the paths that changed meanwhile. Runs inside runExclusive.
   */
  applySessionChanges: (changes: SessionFileChange[]) => Promise<string[]>
  /** The branch the session's work merges into, which an explicit rebase builds on (Section 21). */
  targetBranch?: string | null
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

function formatPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(", ")
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown
}

function describeUnignoredEnvironmentFiles(paths: readonly string[]): string {
  const one = paths.length === 1
  return (
    `${formatPaths(paths)} ${one ? "isn't" : "aren't"} ignored by Git, so saving the session to Git is on hold ` +
    `rather than commit ${one ? "it" : "them"}. Add ${one ? "it" : "them"} to .gitignore to resume.`
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
  private remotePollTimer: NodeJS.Timeout | null = null
  private polling = false
  // The branch's head on the remote as last seen, and where it stood when saving stopped.
  private lastRemoteHead: string | null = null
  private blockedRemoteHead: string | null = null
  // The newest commit pushed from outside the session and merged into it, until a checkpoint covers it.
  private integratedHead: string | null = null
  // Files that merge left with conflict markers; saving waits until they are resolved.
  private conflictPaths = new Set<string>()
  // A rebase adopted into the session, waiting to be pushed over the save it replaces.
  private rebase: { from: string; parentOid: string; baseTreeOid: string | null } | null = null
  private rebaseRun: Promise<ProjectdRebaseResult> | null = null

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

  /** A member asked the leader to rebase the session onto its target (Section 21.1). */
  handleRebaseRequested(allowConflicts: boolean): void {
    if (!this.leading) return
    void this.rebaseOnto(allowConflicts).catch((error: unknown) =>
      console.warn(`[projectd] Rebase of ${this.options.publicSessionId} failed: ${describeError(error)}`),
    )
  }

  /** Rebases on the leader, or asks the leader to (Section 21). Nothing rebases without this. */
  async requestRebase(allowConflicts: boolean): Promise<ProjectdRebaseResult> {
    await this.start()
    if (!this.repo) throw new AutoGitError("AUTOGIT_OFF", "This session's folder is not a Git repository.")
    if (!this.options.targetBranch) throw new AutoGitError("NO_TARGET", "This session has no branch to rebase onto.")
    if (this.leading) return this.rebaseOnto(allowConflicts)
    const routed = await this.options.room.requestRebase(allowConflicts)
    return routed
      ? { outcome: "requested", message: "The Mac that saves this session is rebasing it now." }
      : { outcome: "no_leader", message: "No member's Mac can push this session's branch right now." }
  }

  /** The session moved: a peer's batch arrived or the room took one of this device's. */
  noteActivity(): void {
    if (this.stopped || !this.repo) return
    // A hold the session can lift, such as an env file Git doesn't ignore yet, is tried again.
    if (this.blocked && HELD_CODES.has(this.blocked.code)) this.blocked = null
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
        (this.rebaseRun ? `Rebasing the session onto ${this.options.targetBranch}…` : null) ??
        this.blocked?.message ??
        leaderNotice ??
        this.baselineNote ??
        (state === "ineligible" ? this.ineligibleReason : null),
      detailCode:
        (this.rebaseRun ? "REBASING" : null) ??
        this.blocked?.code ??
        (leaderNotice ? (this.lease?.noticeCode ?? null) : null),
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
      this.remotePollTimer = setInterval(() => void this.pollRemote(), this.timing.remotePollMs)
      this.scheduleCheckpoint()
      return
    }
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.renewTimer = null
    if (this.remotePollTimer) clearInterval(this.remotePollTimer)
    this.remotePollTimer = null
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

  private setNotice(message: string | null, code: string | null = null): void {
    const lease = this.lease
    if (!lease || (message === null && !this.noticeShown)) return
    this.options.room.setLeaderNotice(lease.generation, message, code)
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
      // Commits pushed from outside the session are merged in first, so the barrier holds them.
      const parent = await this.resolveParent(lease.generation)
      this.requireConflictsResolved()
      const snapshot = await this.captureAtBarrier(lease.generation)
      await this.saveSnapshot(lease.generation, snapshot, parent)
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

  private async saveSnapshot(
    generation: number,
    snapshot: BarrierSnapshot,
    parent: { parentOid: string | null; remoteHead: string | null },
  ): Promise<void> {
    const repo = this.requireRepo()
    const { parentOid, remoteHead } = parent
    let built: CheckpointCommitResult
    try {
      built = await this.builder.buildCheckpointCommit({
        repoPath: repo.root,
        sessionId: this.options.publicSessionId,
        parentOid,
        leaseGeneration: generation,
        snapshot,
        pathPrefix: repo.prefix,
        maxTextFileBytes: this.options.maxTextFileBytes,
        baseTreeOid: this.rebase?.baseTreeOid ?? null,
      })
    } catch (error) {
      if (error instanceof UnignoredEnvironmentFilesError) {
        throw new AutoGitError("ENV_NOT_IGNORED", describeUnignoredEnvironmentFiles(error.paths))
      }
      throw error
    }

    const rebase = this.rebase
    // A squashing rebase always makes its commit: the target alone doesn't hold the session.
    if (built.parentTreeOid !== null && built.treeOid === built.parentTreeOid && !rebase?.baseTreeOid) {
      if (rebase && parentOid) {
        // The rebased commits hold the session exactly: they replace the last save.
        this.lease = await this.options.room.renewLease(generation)
        await this.push(parentOid, rebase.from)
        const grandparent = await this.git(["rev-parse", "--verify", "--quiet", `${parentOid}^`], {
          allowNonZeroExit: true,
        })
        this.acceptCheckpoint(
          await this.options.room.publishCheckpoint(generation, {
            commitOid: parentOid,
            parentOid: grandparent.success ? grandparent.stdout.trim() || null : null,
            treeOid: built.treeOid,
            sessionSeq: snapshot.sessionSeq,
            barrierId: snapshot.barrierId,
            logicalTreeHash: snapshot.logicalTreeHash,
            rebasedFrom: rebase.from,
          }),
        )
        await this.finishRebase(rebase)
        return
      }
      // The branch already holds this content. A branch the remote lacks still goes up,
      // so members can clone it.
      if (remoteHead === null && parentOid) {
        this.lease = await this.options.room.renewLease(generation)
        await this.push(parentOid)
      }
      await this.recordUnchanged(generation, snapshot, built)
      return
    }

    // Fencing (Section 14.6): the room must still name this device before anything leaves it.
    this.lease = await this.options.room.renewLease(generation)
    // After an explicit rebase the push replaces the last save, and only that save (Section 21.9).
    await this.push(built.commitOid, rebase?.from)
    this.acceptCheckpoint(
      await this.options.room.publishCheckpoint(generation, {
        commitOid: built.commitOid,
        parentOid: built.parentOid,
        treeOid: built.treeOid,
        sessionSeq: snapshot.sessionSeq,
        barrierId: snapshot.barrierId,
        logicalTreeHash: snapshot.logicalTreeHash,
        ...(rebase ? { rebasedFrom: rebase.from } : {}),
      }),
    )
    if (rebase) await this.finishRebase(rebase)
  }

  /** The rebase is on the remote; the save it replaced stays reachable here for recovery (Section 21.9). */
  private async finishRebase(rebase: { from: string }): Promise<void> {
    this.rebase = null
    await this.git(["update-ref", `refs/cozea/rebased/${rebase.from}`, rebase.from], { allowNonZeroExit: true })
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

    // A rebase adopted into the session builds on its rebased commits, over the save it replaces.
    const rebase = this.rebase
    if (rebase) {
      if (remoteHead === rebase.from) return { parentOid: rebase.parentOid, remoteHead }
      this.rebase = null
      throw new AutoGitError(
        "REMOTE_CHANGED",
        `${branch} changed on ${repo.remote} during the rebase, so AutoGit didn't push it rather than overwrite those commits. The session keeps its files; save again to build on the branch as it is now.`,
      )
    }

    if (anchor) {
      // Commits from outside the session already merged into it come after the checkpoint.
      const known = this.integratedHead ?? anchor
      if (remoteHead === known) return { parentOid: known, remoteHead }
      if (!remoteHead) {
        throw new AutoGitError(
          "REMOTE_BRANCH_MISSING",
          `${branch} no longer exists on ${repo.remote}, so AutoGit stopped saving the session. Push the branch again to resume.`,
        )
      }
      await this.fetchBranch()
      if (!this.integratedHead) {
        const recovered = await this.ownCheckpointsSince(anchor, remoteHead)
        if (recovered) {
          // A leader pushed this and stopped before recording it (Section 15.9).
          this.acceptCheckpoint(await this.options.room.publishCheckpoint(generation, recovered))
          return { parentOid: remoteHead, remoteHead }
        }
      }
      // Commits pushed on top of the session's branch from outside are merged in (Section 18.7).
      if (await this.isAncestor(known, remoteHead)) {
        await this.integrateExternalCommits(known, remoteHead)
        this.integratedHead = remoteHead
        return { parentOid: remoteHead, remoteHead }
      }
      throw new AutoGitError(
        "REMOTE_CHANGED",
        `${branch} changed on ${repo.remote} outside the session and no longer holds the session's last save, so AutoGit stopped saving to it rather than overwrite those commits. Bring ${known.slice(0, 7)} back into the branch's history to resume.`,
      )
    }

    // The first checkpoint builds on whichever of the local and remote branch is ahead.
    const localHead = await this.options.gitService.getCommitOid(repo.root, `refs/heads/${branch}`)
    const known = this.integratedHead ?? localHead
    if (!remoteHead || known === remoteHead) return { parentOid: known, remoteHead }
    await this.fetchBranch()
    if (!known) return { parentOid: remoteHead, remoteHead }
    if (await this.isAncestor(known, remoteHead)) {
      // Commits pushed since the session started from this branch: the session doesn't
      // hold them, so they are merged in rather than undone by the checkpoint.
      await this.integrateExternalCommits(known, remoteHead)
      this.integratedHead = remoteHead
      return { parentOid: remoteHead, remoteHead }
    }
    if (await this.isAncestor(remoteHead, known)) return { parentOid: known, remoteHead }
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

  /**
   * The branch already holds the session at this barrier. Every member is told it is
   * saved, so nobody keeps counting changes Git has nothing to take from, such as an
   * edit to an ignored env file.
   */
  private async recordUnchanged(
    generation: number,
    snapshot: BarrierSnapshot,
    built: CheckpointCommitResult,
  ): Promise<void> {
    const parentOid = built.parentOid
    if (!parentOid) return
    if (parentOid !== this.checkpoint?.commitOid) {
      // A commit the session did not make holds it exactly: the branch as the first save
      // found it, or commits pushed from outside and merged in. That commit is the checkpoint.
      const grandparent = await this.git(["rev-parse", "--verify", "--quiet", `${parentOid}^`], {
        allowNonZeroExit: true,
      })
      this.lease = await this.options.room.renewLease(generation)
      this.acceptCheckpoint(
        await this.options.room.publishCheckpoint(generation, {
          commitOid: parentOid,
          parentOid: grandparent.success ? grandparent.stdout.trim() || null : null,
          treeOid: built.treeOid,
          sessionSeq: snapshot.sessionSeq,
          barrierId: snapshot.barrierId,
          logicalTreeHash: snapshot.logicalTreeHash,
        }),
      )
      return
    }
    // A room from before this message never answers; members then keep counting, and saving is unaffected.
    void this.options.room
      .markSavedThrough(generation, snapshot.barrierId)
      .then((checkpoint) => this.acceptCheckpoint(checkpoint))
      .catch(() => undefined)
  }

  /**
   * Merges commits pushed to the branch from outside the session into the session
   * (Section 18.7, 19.3), as Git would: a file only one side changed takes that side's
   * version, and a file both changed merges line by line. Lines both changed get
   * conflict markers, and saving waits until they are resolved. The result reaches
   * every member through the session, never through a pull.
   */
  private async integrateExternalCommits(base: string, head: string): Promise<void> {
    const repo = this.requireRepo()
    const diff = await this.git(
      ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", base, head, "--", repo.prefix || "."],
      { allowNonZeroExit: true },
    )
    if (!diff.success) throw new AutoGitError("GIT_FAILED", firstLine(diff.stderr) || "git diff failed")

    const scope = new ScopePolicy(this.options.workspaceRoot)
    const files: ExternalFile[] = []
    const fields = diff.stdout.split("\0")
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [oldMode = "", newMode = "", baseOid = "", headOid = ""] = (fields[index] ?? "").replace(/^:/, "").split(" ")
      const repoFilePath = fields[index + 1] ?? ""
      if (!repoFilePath.startsWith(repo.prefix)) continue
      const sessionPath = repoFilePath.slice(repo.prefix.length)
      // Symlinks and submodules don't sync, and neither do the editor files each machine keeps.
      if (!REGULAR_OR_ABSENT_MODES.has(oldMode) || !REGULAR_OR_ABSENT_MODES.has(newMode)) continue
      if (scope.isAlwaysIgnored(sessionPath)) continue
      files.push({ sessionPath, baseOid, headOid, mode: newMode === "100755" ? 0o100755 : 0o100644 })
    }

    for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
      const changes: SessionFileChange[] = []
      const conflicted: string[] = []
      for (const file of files) {
        const merged = await this.mergeExternalFile(file)
        if (!merged) continue
        changes.push(merged.change)
        if (merged.conflicted) conflicted.push(file.sessionPath)
      }
      if (changes.length === 0) return
      // Applied only if no file changed while the merge ran; otherwise it merges again.
      const changedMeanwhile = await this.options.runExclusive(() => this.options.applySessionChanges(changes))
      if (changedMeanwhile.length === 0) {
        for (const conflictedPath of conflicted) this.conflictPaths.add(conflictedPath)
        return
      }
    }
    throw new AutoGitError(
      "MERGE_RACED",
      "Files kept changing while AutoGit merged in commits pushed from outside the session. It tries again shortly.",
    )
  }

  /** How one file changed outside the session merges with the session's version; null when nothing changes. */
  private async mergeExternalFile(file: ExternalFile): Promise<{ change: SessionFileChange; conflicted: boolean } | null> {
    const [base, theirs] = await Promise.all([this.readBlobText(file.baseOid), this.readBlobText(file.headOid)])
    // Binary or too large on either side: the session doesn't carry it, and checkpoints keep Git's copy.
    if (base === undefined || theirs === undefined) return null
    const entry = this.options.replica.tree.listLiveEntries().find((candidate) => candidate.path === file.sessionPath)
    if (entry && entry.kind !== "text") return null
    const ours = entry ? this.options.replica.textDocs.getTextContent(entry.fileId) : null
    const take = (text: string | null) => ({
      change: { path: file.sessionPath, expected: ours, text, mode: file.mode },
      conflicted: false,
    })

    if (ours === theirs) return null
    // Deleted outside: the session's copy goes too, unless the session changed it since.
    if (theirs === null) return ours === base ? take(null) : null
    // Added outside, or changed outside after the session deleted it: the outside version is kept.
    if (ours === null || ours === base) return take(theirs)
    if (base === theirs) return null
    const merged = await this.mergeText(ours, base ?? "", theirs)
    return {
      change: { path: file.sessionPath, expected: ours, text: merged.text, mode: file.mode },
      conflicted: merged.conflicts > 0,
    }
  }

  /** A blob's text: null for no blob, undefined when the session wouldn't carry it as text. */
  private async readBlobText(oid: string): Promise<string | null | undefined> {
    if (/^0+$/.test(oid)) return null
    const size = await this.git(["cat-file", "-s", oid], { allowNonZeroExit: true })
    if (!size.success || Number(size.stdout.trim()) > this.options.maxTextFileBytes) return undefined
    const blob = await this.git(["cat-file", "blob", oid], { allowNonZeroExit: true })
    if (!blob.success) return undefined
    return TextDocRegistry.classifyContent(blob.stdoutBuffer) === "text" ? blob.stdoutBuffer.toString("utf8") : undefined
  }

  /** A three-way merge of one file with `git merge-file`, conflict markers and all. */
  private async mergeText(ours: string, base: string, theirs: string): Promise<{ text: string; conflicts: number }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-merge-"))
    try {
      const files = [path.join(dir, "session"), path.join(dir, "base"), path.join(dir, "remote")] as const
      await Promise.all([fs.writeFile(files[0], ours), fs.writeFile(files[1], base), fs.writeFile(files[2], theirs)])
      const remoteLabel = `${this.requireRepo().remote}/${this.options.branchName}`
      const result = await this.git(
        ["merge-file", "-p", "-L", "live session", "-L", "last save", "-L", remoteLabel, ...files],
        { allowNonZeroExit: true },
      )
      // The exit code counts conflicts; a negative one, read as above 127, is an error.
      const conflicts = result.exitCode ?? -1
      if (conflicts < 0 || conflicts > 127) {
        throw new AutoGitError("GIT_FAILED", firstLine(result.stderr) || "git merge-file failed")
      }
      return { text: result.stdout, conflicts }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Saving waits while a merge of outside commits has left conflict markers in the session. */
  private requireConflictsResolved(): void {
    if (this.conflictPaths.size === 0) return
    const unresolved = [...this.conflictPaths].filter((conflictPath) => {
      const entry = this.options.replica.tree.listLiveEntries().find((candidate) => candidate.path === conflictPath)
      return entry?.kind === "text" && CONFLICT_MARKER.test(this.options.replica.textDocs.getTextContent(entry.fileId))
    })
    this.conflictPaths = new Set(unresolved)
    if (unresolved.length === 0) return
    throw new AutoGitError(
      "CONFLICT_MARKERS",
      `Commits pushed to ${this.options.branchName} from outside the session changed the same lines as the session. Resolve the conflict markers in ${formatPaths(unresolved)} to resume saving to Git.`,
    )
  }

  /**
   * The leader looks at the branch on the remote now and then (Section 18.7), so commits
   * pushed from outside are merged in while nobody edits, and saving that stopped over
   * the remote tries again once the branch there changes.
   */
  private async pollRemote(): Promise<void> {
    if (!this.leading || this.inFlight || this.polling || this.stopped) return
    const known = this.integratedHead ?? this.checkpoint?.commitOid ?? null
    if (!known || (this.blocked && HELD_CODES.has(this.blocked.code))) return
    this.polling = true
    try {
      const head = await this.lsRemote().catch(() => undefined)
      if (head === undefined || head === known) return
      if (this.blocked) {
        if (head === this.blockedRemoteHead) return
        this.blocked = null
      }
      this.retryAt = 0
      void this.runCheckpoint()
    } finally {
      this.polling = false
    }
  }

  // ─── Explicit rebase (Section 21) ────────────────────────────────────────────

  private rebaseOnto(allowConflicts: boolean): Promise<ProjectdRebaseResult> {
    this.rebaseRun ??= this.runRebase(allowConflicts).finally(() => {
      this.rebaseRun = null
      this.options.onChange()
    })
    return this.rebaseRun
  }

  /**
   * Saves the session, rebases that save onto the target away from everyone's folders,
   * and adopts the result into the live session; the next save pushes it over the old
   * history. Editing goes on meanwhile; only saving waits (Section 21.3 - 21.9).
   */
  private async runRebase(allowConflicts: boolean): Promise<ProjectdRebaseResult> {
    const target = this.options.targetBranch
    if (!target) throw new AutoGitError("NO_TARGET", "This session has no branch to rebase onto.")
    if (!this.leading) throw new AutoGitError("NOT_LEADER", "Only the Mac that saves the session can rebase it.")
    if (this.rebase) {
      return { outcome: "held", message: "The last rebase is waiting for its conflict markers to be resolved." }
    }
    // Rebase from a save holding everything the session has (Section 21.3).
    this.blocked = null
    this.retryAt = 0
    await this.runCheckpoint()
    if (this.lastError) {
      throw new AutoGitError(this.lastError.code, `Save the session to Git before rebasing: ${this.lastError.message}`)
    }
    const from = this.checkpoint?.commitOid
    if (!from) throw new AutoGitError("NOT_SAVED", "The session hasn't been saved to Git yet.")

    while (this.inFlight) await this.inFlight
    let early: ProjectdRebaseResult | null = null
    const computing = this.computeRebase(target, from, allowConflicts).then((result) => {
      early = result
    })
    // Checkpoints wait while the rebase computes (Section 21.6).
    this.inFlight = computing.then(
      () => undefined,
      () => undefined,
    )
    this.options.onChange()
    try {
      await computing
    } catch (error) {
      this.setNotice(null)
      throw error
    } finally {
      this.inFlight = null
      this.options.onChange()
    }
    if (early) {
      this.setNotice(null)
      return early
    }

    await this.runCheckpoint()
    // runCheckpoint() mutates these fields asynchronously; capture them after the await so
    // TypeScript does not keep the earlier explicit-null narrowing from the start of this method.
    const blockedAfterRebase = this.blocked as AutoGitError | null
    const errorAfterRebase = this.lastError as { code: string; message: string } | null
    if (blockedAfterRebase?.code === "CONFLICT_MARKERS") {
      return { outcome: "held", message: blockedAfterRebase.message }
    }
    if (errorAfterRebase) throw new AutoGitError(errorAfterRebase.code, errorAfterRebase.message)
    return {
      outcome: "rebased",
      commitOid: this.checkpoint?.commitOid ?? null,
      message: `Rebased the session onto ${target}.`,
    }
  }

  /** Returns a result when the rebase stops here; null once the result waits in the session for the next save. */
  private async computeRebase(target: string, from: string, allowConflicts: boolean): Promise<ProjectdRebaseResult | null> {
    const repo = this.requireRepo()
    this.setNotice(`Rebasing the session onto ${target}…`, "REBASING")
    const onto = await this.fetchTarget(target)
    if (!onto) throw new AutoGitError("TARGET_MISSING", `${target} doesn't exist on ${repo.remote}.`)
    if (await this.isAncestor(onto, from)) {
      return { outcome: "current", message: `The session already has everything on ${target}.` }
    }

    const rebased = await this.rebaseInWorktree(from, onto)
    if (rebased.kind === "clean") {
      // B/R/L (Section 21.7): what the rebase changed goes into the live session, merged
      // with edits made since the save.
      await this.integrateExternalCommits(from, rebased.commitOid)
      this.rebase = { from, parentOid: rebased.commitOid, baseTreeOid: null }
      return null
    }
    const conflictingPaths = rebased.paths.map((conflicted) => this.sessionPath(conflicted))
    if (!allowConflicts) {
      return {
        outcome: "conflicts",
        conflictingPaths,
        message: `${formatPaths(conflictingPaths)} changed on both sides, so nothing was rebased. Rebase anyway to resolve them in the session, or resolve them in a pull request.`,
      }
    }
    // Rebasing anyway: the session's changes become one commit on top of the target, and
    // the files both sides changed carry conflict markers everyone can resolve live.
    const merged = await this.mergeTreeWithMarkers(onto, from)
    await this.integrateExternalCommits(from, merged.tree)
    for (const conflicted of merged.conflicts) this.conflictPaths.add(this.sessionPath(conflicted))
    this.rebase = { from, parentOid: onto, baseTreeOid: merged.tree }
    return null
  }

  /** Real Git rebase semantics, in a worktree of its own, away from everyone's folders (Section 21.4). */
  private async rebaseInWorktree(
    from: string,
    onto: string,
  ): Promise<{ kind: "clean"; commitOid: string } | { kind: "conflicts"; paths: string[] }> {
    const repo = this.requireRepo()
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-rebase-"))
    const worktree = path.join(dir, "worktree")
    try {
      const added = await this.git(["worktree", "add", "--detach", worktree, from], { allowNonZeroExit: true })
      if (!added.success) throw new AutoGitError("GIT_FAILED", firstLine(added.stderr) || "git worktree add failed")
      const env = await fallbackIdentityEnv(this.options.gitService.process, repo.root, {
        name: "Cozea AutoGit",
        email: "autogit@cozea.local",
      })
      const inWorktree = (args: string[]) =>
        this.options.gitService.process.execute(args, {
          cwd: worktree,
          env,
          allowNonZeroExit: true,
          timeoutMs: this.timing.remoteTimeoutMs,
        })
      // The person's hooks and signing are for their own commits, and no other branch moves.
      const result = await inWorktree([
        "-c",
        "commit.gpgsign=false",
        "-c",
        `core.hooksPath=${path.join(dir, "no-hooks")}`,
        "rebase",
        "--no-autostash",
        "--no-autosquash",
        "--no-update-refs",
        onto,
      ])
      if (result.success) return { kind: "clean", commitOid: (await inWorktree(["rev-parse", "HEAD"])).stdout.trim() }
      const conflicted = await inWorktree(["diff", "--name-only", "--diff-filter=U", "-z"])
      await inWorktree(["rebase", "--abort"])
      const paths = conflicted.stdout.split("\0").filter(Boolean)
      if (paths.length === 0) throw new AutoGitError("GIT_FAILED", firstLine(result.stderr) || "git rebase failed")
      return { kind: "conflicts", paths }
    } finally {
      await this.git(["worktree", "remove", "--force", worktree], { allowNonZeroExit: true })
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** The target merged with the save in Git's object store, conflict markers and all. */
  private async mergeTreeWithMarkers(onto: string, from: string): Promise<{ tree: string; conflicts: string[] }> {
    const result = await this.git(["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", onto, from], {
      allowNonZeroExit: true,
    })
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new AutoGitError("GIT_FAILED", firstLine(result.stderr) || "git merge-tree failed")
    }
    const [tree = "", ...paths] = result.stdout.split("\0")
    return { tree: tree.trim(), conflicts: [...new Set(paths.filter(Boolean))] }
  }

  private async fetchTarget(target: string): Promise<string | null> {
    const repo = this.requireRepo()
    const ref = `refs/remotes/${repo.remote}/${target}`
    let result
    try {
      result = await this.git(["fetch", "--no-tags", repo.remote, `+refs/heads/${target}:${ref}`], {
        allowNonZeroExit: true,
        timeoutMs: this.timing.remoteTimeoutMs,
      })
    } catch (error) {
      throw new AutoGitError("REMOTE_UNREACHABLE", `Git couldn't fetch ${target} from ${repo.remote}: ${describeError(error)}`)
    }
    if (!result.success) throw remoteFailure(repo.remote, result.stderr)
    return this.options.gitService.getCommitOid(repo.root, ref)
  }

  private sessionPath(repoFilePath: string): string {
    const prefix = this.requireRepo().prefix
    return repoFilePath.startsWith(prefix) ? repoFilePath.slice(prefix.length) : repoFilePath
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
    if (BLOCKING_CODES.has(code) || HELD_CODES.has(code)) {
      this.blocked = error instanceof AutoGitError ? error : new AutoGitError(code, message)
      this.blockedRemoteHead = this.lastRemoteHead
      this.setNotice(message, code)
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
    const current = this.checkpoint
    if (current?.commitOid === checkpoint.commitOid) {
      // The same commit, now known to hold the session through a later barrier.
      if ((checkpoint.savedThroughSeq ?? 0) <= (current.savedThroughSeq ?? 0)) return
    } else if (current && checkpoint.sessionSeq < current.sessionSeq) {
      return
    } else {
      // A checkpoint on top of commits merged in from outside covers them.
      this.integratedHead = null
    }
    this.checkpoint = checkpoint
    this.cleanThroughSeq = Math.max(this.cleanThroughSeq, checkpoint.sessionSeq, checkpoint.savedThroughSeq ?? 0)
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
        rewrittenFrom: checkpoint.rebasedFrom ?? null,
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
    this.lastRemoteHead = line ? (line.split("\t")[0] ?? null) : null
    return this.lastRemoteHead
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

  /**
   * Fast-forwards the session branch on the remote; never forces (Section 15.8). After an
   * explicit rebase it replaces exactly `leaseFrom`, with --force-with-lease (Section 21.9).
   */
  private async push(commitOid: string, leaseFrom?: string): Promise<void> {
    const repo = this.requireRepo()
    const branch = this.options.branchName
    const lease = leaseFrom ? [`--force-with-lease=refs/heads/${branch}:${leaseFrom}`] : []
    let result
    try {
      // The user's pre-push hooks are for their own pushes, not for checkpoints every few seconds.
      result = await this.git(
        ["push", "--no-verify", "--no-signed", "--porcelain", ...lease, repo.remote, `${commitOid}:refs/heads/${branch}`],
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
    if (this.remotePollTimer) clearInterval(this.remotePollTimer)
    this.renewTimer = null
    this.checkpointTimer = null
    this.eligibilityTimer = null
    this.remotePollTimer = null
  }
}
