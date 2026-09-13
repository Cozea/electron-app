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

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  ProjectdAutoGitState,
  ProjectdAutoGitStatus,
  ProjectdCheckpointResult,
  ProjectdCheckpointSummary,
  ProjectdRebaseResult,
  ProjectdRebaseRecoveryRequest,
  ProjectdRebaseRecoveryResponse,
} from "@cozea/projectd-protocol"

import type { SessionReplica } from "../collaboration/SessionReplica"
import type { BinaryRevision } from "../collaboration/BinaryStore"
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
import { executeScopedNetworkGit, type RepositoryCredentialProvider } from "../git/ScopedNetworkGit"
import type { GitService } from "../git/GitService"
import { fallbackIdentityEnv } from "../git/identity"
import { BarrierCapture, type BarrierSnapshot } from "./BarrierCapture"
import { CheckpointBuilder, UnignoredEnvironmentFilesError, type CheckpointCommitResult } from "./CheckpointBuilder"
import { GitBaselineAdopter } from "./GitBaselineAdopter"
import { RebaseJournal } from "./RebaseJournal"
import { IsolatedRebaseResolution } from "./IsolatedRebaseResolution"

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
const BLOCKING_CODES = new Set(["REMOTE_CHANGED", "REMOTE_DIVERGED", "REMOTE_BRANCH_MISSING", "PROTECTED_BRANCH", "REBASE_RECOVERY_REQUIRED"])
// Holds the session itself can lift; saving is tried again with the next change.
const HELD_CODES = new Set(["ENV_NOT_IGNORED", "CONFLICT_MARKERS"])
// Tries at applying a merge of outside commits while files keep changing under it.
const MERGE_ATTEMPTS = 3
// Git's conflict markers. The ======= separator alone also underlines Markdown headings.
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/m
const REGULAR_OR_ABSENT_MODES = new Set(["000000", "100644", "100755", "120000"])

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
  renameTo?: string
  destinationFingerprint?: string
  expectedFingerprint?: string
  modeOnly?: boolean
  symlinkTarget?: string
  /**
   * A Git-originated binary change as an immutable object descriptor. A null
   * blob deletes the file. Payload bytes never cross this interface; the
   * consumer streams bounded ranges from the repository object store.
   */
  binary?: { blob: { repoPath: string; blobOid: string; size: number; contentHash: string } | null; fingerprint: string }
  expected: string | null
  /** The merged text; null deletes the file. */
  text: string | null
  /** For a file the merge creates. */
  mode?: number
}

export function sessionFileFingerprint(replica: SessionReplica, filePath: string): string {
  const entry = replica.tree.listLiveEntries().find((candidate) => candidate.path === filePath)
  if (!entry) return "absent"
  return JSON.stringify([entry.fileId, entry.kind, entry.mode, entry.lastStructuralOpId,
    entry.kind === "text" ? createHash("sha256").update(replica.textDocs.getTextContent(entry.fileId)).digest("hex") :
      entry.kind === "symlink" ? entry.symlinkTarget : replica.binaryStore.getRevisions(entry.fileId).map((revision) => revision.revisionId).sort()])
}

interface ExternalFile {
  renameTo?: string
  sessionPath: string
  baseMode: number
  baseOid: string
  headOid: string
  mode: number
}

export interface AutoGitAgentOptions {
  repositoryCredentials?: RepositoryCredentialProvider
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
  persistReplicaSnapshot?: (generation: number, snapshot: BarrierSnapshot) => Promise<void>
  /**
   * Applies files merged from commits pushed outside the session, unless one no longer
   * reads as `expected`; returns the paths that changed meanwhile. Runs inside runExclusive.
   */
  applySessionChanges: (changes: SessionFileChange[], integration?: { adoptionId: string; generation: number }) => Promise<string[]>
  recoverIntegration?: (adoptionId: string, generation: number) => Promise<boolean>
  completeIntegration?: (adoptionId: string) => void
  /** Resolves verified bytes for binary revisions captured at a barrier. */
  resolveBinaryContent?: (revision: BinaryRevision) => Promise<Buffer>
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
  private rebase: { from: string; parentOid: string; baseTreeOid: string | null; recoveryId?: string } | null = null
  private rebaseRun: Promise<ProjectdRebaseResult> | null = null

  constructor(options: AutoGitAgentOptions) {
    this.options = options
    this.timing = { ...DEFAULT_AUTOGIT_TIMING, ...options.timing }
    this.builder = new CheckpointBuilder(options.gitService, { resolveBinary: options.resolveBinaryContent })
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
    void this.checkpointNow().catch((error: unknown) => this.handleFailure(error))
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

  private async isolatedResolver(recoveryId: string): Promise<IsolatedRebaseResolution> {
    await this.start()
    this.requireRepo()
    const common = (await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim()
    return new IsolatedRebaseResolution(await RebaseJournal.open(common, this.options.publicSessionId, recoveryId), this.options.gitService)
  }

  async manageRebaseRecovery(input: unknown): Promise<ProjectdRebaseRecoveryResponse> {
    const request = input as ProjectdRebaseRecoveryRequest
    if (!request || !["list", "review", "resolve", "continue", "apply", "cancel"].includes(request.action)) throw new Error("Invalid rebase recovery action")
    if (request.action !== "list" && (typeof request.recoveryId !== "string" || !/^[a-f0-9-]{36}$/.test(request.recoveryId))) throw new Error("Invalid recovery ID")
    if (request.action === "resolve") {
      if (typeof request.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(request.fingerprint) || !Array.isArray(request.choices) || request.choices.length > 1024) throw new Error("Invalid resolution review")
      for (const choice of request.choices) {
        if (!choice || typeof choice.path !== "string" || choice.path.length > 4096 ||
          !["content", "variant", "delete"].includes(choice.kind) ||
          (choice.kind === "variant" && ![1, 2, 3].includes(choice.stage)) ||
          (choice.kind === "content" && (typeof choice.text !== "string" || Buffer.byteLength(choice.text) > 8 * 1024 * 1024 || typeof choice.executable !== "boolean"))) throw new Error("Invalid conflict choice")
      }
    }
    if (this.inFlight || this.rebaseRun) throw new AutoGitError("REBASE_BUSY", "Wait for the current Git operation before resolving.")
    let applied: RebaseJournal | null = null
    const work = (async (): Promise<ProjectdRebaseRecoveryResponse> => {
      await this.start()
      if (request.action === "list") {
        const common = (await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim()
        return { journals: (await RebaseJournal.list(common, this.options.publicSessionId)).map(({ id, state, createdAt }) => ({ id, state, createdAt })) }
      }
      const resolver = await this.isolatedResolver(request.recoveryId)
      if (request.action === "review") return { review: await resolver.preview() }
      if (!this.leading || !this.lease || !this.options.canWrite()) throw new AutoGitError("NOT_LEADER", "The current session leader must resolve this rebase.")
      this.lease = await this.options.room.renewLease(this.lease.generation)
      if (request.action === "cancel") {
        if (["adopting", "adopted"].includes(resolver.journal.record.state)) throw new Error("This rebase has begun adoption. Retry Apply before discarding recovery state.")
        const removed = await this.git(["worktree", "remove", "--force", resolver.journal.worktree], { allowNonZeroExit: true })
        if (!removed.success && await fs.stat(resolver.journal.worktree).then(() => true, () => false)) throw new Error("Could not discard the isolated worktree; its recovery record has been kept")
        await resolver.journal.finish("canceled")
        return {}
      }
      // A published checkpoint can outlive the reply or the local journal write.
      // Verify both authorities before treating this as completed; never re-integrate it.
      const recoveredIntegration = request.action === "apply" && await this.options.recoverIntegration?.(resolver.journal.record.id, this.lease.generation)
      const retained = resolver.journal.record
      if (request.action === "apply" && ["adopting", "adopted"].includes(retained.state)) {
        const receipt = await this.options.room.getRebaseReceipt(retained.id)
        if (receipt && receipt.adoption.from === retained.from && receipt.adoption.resultOid === retained.resultOid &&
          receipt.checkpoint.rebaseAdoptionId === retained.id && receipt.checkpoint.rebasedFrom === retained.from &&
          (!retained.pendingCheckpoint || receipt.checkpoint.commitOid === retained.pendingCheckpoint.commitOid)) {
          await resolver.journal.finish("applied")
          this.options.completeIntegration?.(retained.id)
          if (this.rebase?.recoveryId === retained.id) this.rebase = null
          this.blocked = null
          this.lastError = null
          return { result: { outcome: "rebased", commitOid: receipt.checkpoint.commitOid, message: "Recovered the completed rebase receipt." } }
        }
      }
      let recoveredPublication = false
      let published = this.options.room.autoGitState?.checkpoint
      const pendingCheckpoint = retained.pendingCheckpoint
      if (request.action === "apply" && retained.state === "adopted" && retained.resultOid && pendingCheckpoint &&
        this.options.room.autoGitState?.rebaseAdoption?.id === retained.id && await this.lsRemote() === pendingCheckpoint.commitOid) {
        await this.fetchBranch()
        if (!await this.isAncestor(retained.resultOid, pendingCheckpoint.commitOid)) throw new AutoGitError("REMOTE_CHANGED", "The pushed checkpoint does not contain this rebase result.")
        published = await this.options.room.publishCheckpoint(this.lease.generation, pendingCheckpoint)
        this.acceptCheckpoint(published)
        recoveredPublication = true
      }
      if (request.action === "apply" && ["adopting", "adopted"].includes(retained.state) &&
        retained.resultOid && published?.rebaseAdoptionId === retained.id && published.rebasedFrom === retained.from &&
        (recoveredPublication || !this.options.room.autoGitState?.rebaseAdoption) && await this.lsRemote() === published.commitOid) {
        await this.fetchBranch()
        if (!await this.isAncestor(retained.resultOid, published.commitOid)) throw new AutoGitError("REMOTE_CHANGED", "The published checkpoint does not contain this rebase result.")
        await resolver.journal.finish("applied")
        this.options.completeIntegration?.(retained.id)
        this.acceptCheckpoint(published)
        this.rebase = null
        this.blocked = null
        this.lastError = null
        return { result: { outcome: "rebased", commitOid: published.commitOid, message: "Recovered the already saved rebase." } }
      }
      if (await this.lsRemote() !== resolver.journal.record.from) throw new AutoGitError("REMOTE_CHANGED", "The session branch changed. Review a new rebase before resolving.")
      const target = this.options.targetBranch
      if (!target || await this.fetchTarget(target) !== resolver.journal.record.onto) throw new AutoGitError("TARGET_CHANGED", "The target branch changed. Review a new rebase before resolving.")
      if (request.action === "apply") {
        const record = resolver.journal.record
        if (!["computed", "adopting", "adopted"].includes(record.state) || !record.resultOid) throw new Error("Resolve the isolated rebase before applying it")
        await resolver.journal.beginAdoption()
        await this.options.room.beginRebaseAdoption(this.lease.generation, { id: record.id, from: record.from, resultOid: record.resultOid })
        if (!recoveredIntegration) await this.integrateExternalCommits(record.from, record.resultOid, true, { adoptionId: record.id, generation: this.lease.generation })
        await resolver.journal.markAdopted()
        this.rebase = { from: record.from, parentOid: record.resultOid, baseTreeOid: null, recoveryId: record.id }
        applied = resolver.journal
        return {}
      }
      if (request.action === "resolve") await resolver.resolve(request.fingerprint, request.choices.map((choice) =>
        choice.kind === "content" ? { path: choice.path, kind: "content", content: Buffer.from(choice.text), executable: choice.executable } : choice))
      else await resolver.continue()
      return { review: await resolver.preview() }
    })()
    this.inFlight = work.then(() => undefined, () => undefined)
    let response: ProjectdRebaseRecoveryResponse
    try { response = await work } finally { this.inFlight = null }
    if (applied) {
      await this.runCheckpoint()
      if (this.lastError) throw new AutoGitError(this.lastError.code, this.lastError.message)
      if (this.rebase) throw new AutoGitError("REBASE_PENDING", "The resolved rebase is waiting to be saved. Retained state has been kept.")
      await (applied as RebaseJournal).finish("applied")
      this.blocked = null
      this.lastError = null
      return { result: { outcome: "rebased", commitOid: this.checkpoint?.commitOid, message: "Applied and saved the resolved rebase." } }
    }
    return response
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
      // An explicit request must capture a new barrier, even if a prior save is
      // already pushing a snapshot captured before the request arrived.
      await this.inFlight
      this.blocked = null
      this.retryAt = 0
      await this.runCheckpoint()
      if (this.lastError) throw new AutoGitError(this.lastError.code, this.lastError.message)
      return { outcome: "saved", lastCheckpoint: this.summary() }
    }
    const routed = await this.options.room.requestCheckpoint()
    return { outcome: routed ? "requested" : "no_leader", lastCheckpoint: this.summary() }
  }

  /** Waits for a room-confirmed barrier captured after this request, on any leader. */
  async freshCheckpoint(): Promise<ProjectdCheckpointSummary> {
    await this.start()
    const request = await this.options.room.requestFreshCheckpoint()
    if (!request.routed) throw new AutoGitError("NO_LEADER", "No connected device can save this session to Git.")
    const deadline = Date.now() + 60_000
    while (!this.stopped && Date.now() < deadline) {
      const checkpoint = this.checkpoint
      if (checkpoint && (checkpoint.confirmedAt ?? 0) > request.serverTime) return this.summary()!
      if (this.lastError) throw new AutoGitError(this.lastError.code, this.lastError.message)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new AutoGitError("CHECKPOINT_PENDING", "Waiting for the device saving this session. Try the merge preview again once it is connected.")
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
      const roomAdoption = this.options.room.autoGitState?.rebaseAdoption
      if (roomAdoption && roomAdoption.id !== this.rebase?.recoveryId) throw new AutoGitError("REBASE_RECOVERY_REQUIRED", "A room-wide rebase adoption is pending. Its originating device must resume Apply before saving.")
      // On restart, an interrupted adoption must not be saved on the old parent.
      const common = (await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim()
      const interrupted = (await RebaseJournal.list(common, this.options.publicSessionId)).find((record) =>
        ["adopting", "adopted"].includes(record.state) && record.id !== this.rebase?.recoveryId)
      if (interrupted) throw new AutoGitError("REBASE_RECOVERY_REQUIRED", "A rebase adoption was interrupted. Open the retained rebase and retry Apply before saving.")
      // Commits pushed from outside the session are merged in first, so the barrier holds them.
      const parent = await this.resolveParent(lease.generation)
      this.requireConflictsResolved()
      const snapshot = await this.captureAtBarrier(lease.generation)
      if (snapshot.replicaSnapshot) await this.options.persistReplicaSnapshot?.(lease.generation, snapshot)
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
          captured.snapshot = {
            ...BarrierCapture.captureSnapshot(barrier, this.options.replica),
            replicaSnapshot: this.options.persistReplicaSnapshot && this.options.room.supportsSnapshots
              ? this.options.replica.captureSnapshot() : undefined,
          }
        }
      }, this.rebase?.recoveryId)
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
        const grandparent = await this.git(["rev-parse", "--verify", "--quiet", `${parentOid}^`], {
          allowNonZeroExit: true,
        })
        const checkpoint = {
          commitOid: parentOid,
          parentOid: grandparent.success ? grandparent.stdout.trim() || null : null,
          treeOid: built.treeOid,
          sessionSeq: snapshot.sessionSeq,
          barrierId: snapshot.barrierId,
          logicalTreeHash: snapshot.logicalTreeHash,
          rebasedFrom: rebase.from,
          ...(rebase.recoveryId ? { rebaseAdoptionId: rebase.recoveryId } : {}),
        }
        if (rebase.recoveryId) await (await this.isolatedResolver(rebase.recoveryId)).journal.retainCheckpoint(checkpoint)
        await this.push(parentOid, rebase.from)
        this.acceptCheckpoint(await this.options.room.publishCheckpoint(generation, checkpoint))
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
    const checkpoint = {
      commitOid: built.commitOid,
      parentOid: built.parentOid,
      treeOid: built.treeOid,
      sessionSeq: snapshot.sessionSeq,
      barrierId: snapshot.barrierId,
      logicalTreeHash: snapshot.logicalTreeHash,
      ...(rebase ? { rebasedFrom: rebase.from, ...(rebase.recoveryId ? { rebaseAdoptionId: rebase.recoveryId } : {}) } : {}),
    }
    if (rebase?.recoveryId) await (await this.isolatedResolver(rebase.recoveryId)).journal.retainCheckpoint(checkpoint)
    await this.push(built.commitOid, rebase?.from)
    this.acceptCheckpoint(await this.options.room.publishCheckpoint(generation, checkpoint))
    if (rebase) await this.finishRebase(rebase)
  }

  /** The rebase is on the remote; the save it replaced stays reachable here for recovery (Section 21.9). */
  private async finishRebase(rebase: { from: string; recoveryId?: string }): Promise<void> {
    if (rebase.recoveryId) {
      await (await this.isolatedResolver(rebase.recoveryId)).journal.finish("applied")
      this.options.completeIntegration?.(rebase.recoveryId)
    }
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
    this.acceptCheckpoint(await this.options.room.markSavedThrough(generation, snapshot.barrierId))
  }

  /**
   * Merges commits pushed to the branch from outside the session into the session
   * (Section 18.7, 19.3), as Git would: a file only one side changed takes that side's
   * version, and a file both changed merges line by line. Lines both changed get
   * conflict markers, and saving waits until they are resolved. The result reaches
   * every member through the session, never through a pull.
   */
  private async integrateExternalCommits(base: string, head: string, rejectConflicts = false, integration?: { adoptionId: string; generation: number }): Promise<void> {
    const repo = this.requireRepo()
    const diff = await this.git(
      ["diff", "--raw", "-z", "--find-renames", "--no-abbrev", base, head, "--", repo.prefix || "."],
      { allowNonZeroExit: true },
    )
    if (!diff.success) throw new AutoGitError("GIT_FAILED", firstLine(diff.stderr) || "git diff failed")

    const scope = new ScopePolicy(this.options.workspaceRoot)
    const files: ExternalFile[] = []
    const fields = diff.stdout.split("\0")
    const inScope = (filePath: string) => filePath.startsWith(repo.prefix) && !scope.isAlwaysIgnored(filePath.slice(repo.prefix.length))
    for (let index = 0; index + 1 < fields.length;) {
      const [oldMode = "", newMode = "", baseOid = "", headOid = "", status = ""] = (fields[index++] ?? "").replace(/^:/, "").split(" ")
      const oldPath = fields[index++] ?? ""
      const newPath = status.startsWith("R") ? fields[index++] ?? "" : oldPath
      if (!REGULAR_OR_ABSENT_MODES.has(oldMode) || !REGULAR_OR_ABSENT_MODES.has(newMode)) continue
      const basis = { baseMode: parseInt(oldMode, 8), mode: parseInt(newMode, 8) }
      if (oldPath !== newPath) {
        if (inScope(oldPath) && inScope(newPath)) files.push({ ...basis, sessionPath: oldPath.slice(repo.prefix.length), renameTo: newPath.slice(repo.prefix.length), baseOid, headOid })
        else {
          if (inScope(oldPath)) files.push({ ...basis, sessionPath: oldPath.slice(repo.prefix.length), baseOid, headOid: "0".repeat(headOid.length) })
          if (inScope(newPath)) files.push({ ...basis, sessionPath: newPath.slice(repo.prefix.length), baseOid: "0".repeat(baseOid.length), headOid })
        }
      } else if (inScope(oldPath)) files.push({ ...basis, sessionPath: oldPath.slice(repo.prefix.length), baseOid, headOid })
    }

    for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
      const changes: SessionFileChange[] = []
      const conflicted: string[] = []
      for (const file of files) {
        const source = this.options.replica.tree.listLiveEntries().find((entry) => entry.path === file.sessionPath)
        if (file.renameTo && (!source || this.options.replica.tree.listLiveEntries().some((entry) => entry.path === file.renameTo))) {
          throw new AutoGitError("REBASE_LIVE_CONFLICT", `The rename from ${file.sessionPath} to ${file.renameTo} overlaps a live path change. Resolve the retained paths before adoption.`)
        }
        const merged = await this.mergeExternalFile(file)
        if (file.renameTo && source) {
          if (this.options.replica.tree.listLiveEntries().find((entry) => entry.path === file.sessionPath)?.fileId !== source.fileId) throw new AutoGitError("REBASE_LIVE_CONFLICT", "The rename source changed identity during merge preparation.")
          const change: SessionFileChange = merged?.change ?? { path: file.sessionPath, expected: null, text: null, modeOnly: true,
            expectedFingerprint: sessionFileFingerprint(this.options.replica, file.sessionPath), mode: file.baseMode === file.mode ? source.mode : file.mode }
          changes.push({ ...change, renameTo: file.renameTo, destinationFingerprint: sessionFileFingerprint(this.options.replica, file.renameTo) })
        } else if (merged) changes.push(merged.change)
        if (merged?.conflicted) conflicted.push(file.sessionPath)
      }
      if (rejectConflicts && conflicted.length > 0) throw new AutoGitError("REBASE_LIVE_CONFLICT", "New live edits conflict with the resolved rebase. Live files have been kept; review a new rebase.")
      if (changes.length === 0) return
      // Applied only if no file changed while the merge ran; otherwise it merges again.
      const changedMeanwhile = await this.options.runExclusive(() => this.options.applySessionChanges(changes, integration))
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
    const live = this.options.replica.tree.listLiveEntries().find((candidate) => candidate.path === file.sessionPath)
    if (file.baseMode === 0o120000 || file.mode === 0o120000 || live?.kind === "symlink") return this.mergeExternalSymlink(file)
    const [base, theirs] = await Promise.all([this.readBlobText(file.baseOid), this.readBlobText(file.headOid)])
    // Preserve non-text content through the encrypted binary revision path.
    if (base === undefined || theirs === undefined) return this.mergeExternalBinary(file)
    const entry = this.options.replica.tree.listLiveEntries().find((candidate) => candidate.path === file.sessionPath)
    if (entry && entry.kind !== "text") return this.mergeExternalBinary(file)
    const ours = entry ? this.options.replica.textDocs.getTextContent(entry.fileId) : null
    const expectedFingerprint = sessionFileFingerprint(this.options.replica, file.sessionPath)
    const mode = entry && file.baseMode === file.mode ? entry.mode : file.mode
    const take = (text: string | null) => ({
      change: { path: file.sessionPath, expected: ours, expectedFingerprint, text, mode },
      conflicted: false,
    })

    if (ours === theirs) return entry && entry.mode !== mode ? take(ours) : null
    if ((theirs === null && (ours !== base || entry?.mode !== file.baseMode)) || (ours === null && base !== null)) {
      throw new AutoGitError("REBASE_LIVE_CONFLICT", `Deletion and live changes overlap in ${file.sessionPath}. Retained versions need explicit resolution.`)
    }
    // Deleted outside: the session's copy goes too, unless the session changed it since.
    if (theirs === null) return ours === base ? take(null) : null
    // Added outside, or changed outside after the session deleted it: the outside version is kept.
    if (ours === null || ours === base) return take(theirs)
    if (base === theirs) return entry && entry.mode !== mode ? take(ours) : null
    const merged = await this.mergeText(ours, base ?? "", theirs)
    return {
      change: { path: file.sessionPath, expected: ours, expectedFingerprint, text: merged.text, mode },
      conflicted: merged.conflicts > 0,
    }
  }

  private async mergeExternalSymlink(file: ExternalFile): Promise<{ change: SessionFileChange; conflicted: boolean } | null> {
    const repoPath = this.requireRepo().root
    const blobSize = async (oid: string): Promise<number | null> => {
      if (/^0+$/.test(oid)) return null
      const size = await this.git(["cat-file", "-s", oid])
      const bytes = Number(size.stdout.trim())
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new AutoGitError("GIT_UNREADABLE", `Git reported an unreadable size for an object in ${file.sessionPath}.`)
      if (bytes > 64 * 1024 * 1024) throw new AutoGitError("BINARY_TOO_LARGE", "Git type-change integration currently supports files up to 64 MiB.")
      return bytes
    }
    const [baseSize, theirsSize] = await Promise.all([blobSize(file.baseOid), blobSize(file.headOid)])
    // Small blobs are read bounded for text classification; anything larger is
    // compared by streamed hash and never buffered.
    const readHead = async (oid: string, size: number | null): Promise<Buffer | null> => {
      if (size === null) return null
      if (size > this.options.maxTextFileBytes) return null
      return this.options.gitService.readBlobRange(repoPath, oid, 0, size)
    }
    const [baseHead, theirsHead] = await Promise.all([
      file.baseOid && baseSize !== null ? readHead(file.baseOid, baseSize) : Promise.resolve(null),
      file.headOid && theirsSize !== null ? readHead(file.headOid, theirsSize) : Promise.resolve(null),
    ])
    const hashOf = (bytes: Buffer | null) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex")
    const [baseHash, theirsHash] = await Promise.all([
      file.baseOid && baseSize !== null && baseHead === null ? this.options.gitService.hashBlob(repoPath, file.baseOid) : Promise.resolve(hashOf(baseHead)),
      file.headOid && theirsSize !== null && theirsHead === null ? this.options.gitService.hashBlob(repoPath, file.headOid) : Promise.resolve(hashOf(theirsHead)),
    ])
    const replica = this.options.replica
    const entry = replica.tree.listLiveEntries().find((candidate) => candidate.path === file.sessionPath)
    const fingerprint = sessionFileFingerprint(replica, file.sessionPath)
    const hash = (bytes: Buffer | null) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex")
    const ours = !entry ? null : entry.kind === "symlink" ? hash(Buffer.from(entry.symlinkTarget ?? "")) : entry.kind === "text"
      ? hash(Buffer.from(replica.textDocs.getTextContent(entry.fileId))) : replica.binaryStore.getHeadRevision(entry.fileId)?.contentHash
    const matchesHash = (candidate: string | null, mode: number, present: boolean) =>
      ours === candidate && (present ? entry?.mode === mode : !entry)
    if (matchesHash(theirsHash, file.mode, theirsSize !== null) ||
      (baseHash === theirsHash && file.baseMode === file.mode)) return null
    if (!matchesHash(baseHash, file.baseMode, baseSize !== null) ||
      (entry?.kind === "binary" && replica.binaryStore.detectConcurrentRevisions(entry.fileId))) {
      throw new AutoGitError("REBASE_LIVE_CONFLICT", `Git and live changes overlap in the type or symlink target of ${file.sessionPath}. Retained versions need explicit resolution.`)
    }
    const change: SessionFileChange = { path: file.sessionPath, expected: null, expectedFingerprint: fingerprint, text: null, mode: file.mode }
    if (theirsSize !== null) {
      if (file.mode === 0o120000) {
        if (!theirsHead) throw new AutoGitError("BINARY_TOO_LARGE", `Git symlink target for ${file.sessionPath} exceeds the text ceiling.`)
        change.symlinkTarget = theirsHead.toString("utf8")
      } else if (theirsHead !== null && TextDocRegistry.classifyContent(theirsHead) === "text") {
        change.text = theirsHead.toString("utf8")
      } else {
        change.binary = {
          blob: { repoPath, blobOid: file.headOid, size: theirsSize, contentHash: theirsHash! },
          fingerprint,
        }
      }
    }
    return { change, conflicted: false }
  }

  private async mergeExternalBinary(file: ExternalFile): Promise<{ change: SessionFileChange; conflicted: boolean } | null> {
    const repoPath = this.requireRepo().root
    const gitService = this.options.gitService
    const blobSize = async (oid: string): Promise<number | null> => {
      if (/^0+$/.test(oid)) return null
      const size = await this.git(["cat-file", "-s", oid])
      const bytes = Number(size.stdout.trim())
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new AutoGitError("GIT_UNREADABLE", `Git reported an unreadable size for an object in ${file.sessionPath}.`)
      if (bytes > 64 * 1024 * 1024) throw new AutoGitError("BINARY_TOO_LARGE", "Git binary integration currently supports files up to 64 MiB.")
      return bytes
    }
    const [baseSize, theirsSize] = await Promise.all([blobSize(file.baseOid), blobSize(file.headOid)])
    // Hashes stream straight from the object store; blob bytes are never buffered here.
    const [baseHash, theirsHash] = await Promise.all([
      baseSize === null ? Promise.resolve(null) : gitService.hashBlob(repoPath, file.baseOid),
      theirsSize === null ? Promise.resolve(null) : gitService.hashBlob(repoPath, file.headOid),
    ])
    const replica = this.options.replica
    const entry = replica.tree.listLiveEntries().find((candidate) => candidate.path === file.sessionPath)
    const fingerprint = sessionFileFingerprint(replica, file.sessionPath)
    const hash = (bytes: Buffer | null) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex")
    const ours = !entry ? null : entry.kind === "text" ? hash(Buffer.from(replica.textDocs.getTextContent(entry.fileId))) :
      replica.binaryStore.getHeadRevision(entry.fileId)?.contentHash
    if (entry?.kind === "binary" && replica.binaryStore.detectConcurrentRevisions(entry.fileId)) throw new AutoGitError("REBASE_LIVE_CONFLICT", `Resolve binary conflicts in ${file.sessionPath} before integrating Git changes.`)
    const mode = entry && file.baseMode === file.mode ? entry.mode : file.mode
    if (ours === theirsHash || baseHash === theirsHash) return entry && entry.mode !== mode ? {
      change: { path: file.sessionPath, expected: null, text: null, expectedFingerprint: fingerprint, modeOnly: true, mode }, conflicted: false,
    } : null
    if (theirsSize === null && entry && entry.mode !== file.baseMode) throw new AutoGitError("REBASE_LIVE_CONFLICT", `Deletion overlaps a file-mode change in ${file.sessionPath}.`)
    if (ours !== baseHash) throw new AutoGitError("REBASE_LIVE_CONFLICT", `Git and live edits both changed ${file.sessionPath}. Both versions have been retained; resolve this binary change before adoption.`)
    if (theirsSize === null) {
      return { change: { path: file.sessionPath, expected: null, text: null, mode, binary: { blob: null, fingerprint } }, conflicted: false }
    }
    if (theirsHash === null) throw new AutoGitError("GIT_UNREADABLE", `Git lost the binary object for ${file.sessionPath} during the merge.`)
    return {
      change: {
        path: file.sessionPath, expected: null, text: null, mode,
        binary: { blob: { repoPath, blobOid: file.headOid, size: theirsSize, contentHash: theirsHash }, fingerprint },
      },
      conflicted: false,
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
  private async computeRebase(target: string, from: string, _allowConflicts: boolean): Promise<ProjectdRebaseResult | null> {
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
      const resolver = await this.isolatedResolver(rebased.recoveryId)
      await resolver.journal.beginAdoption()
      if (!this.lease) throw new AutoGitError("NOT_LEADER", "Rebase leadership changed before adoption")
      await this.options.room.beginRebaseAdoption(this.lease.generation, { id: rebased.recoveryId, from, resultOid: rebased.commitOid })
      await this.integrateExternalCommits(from, rebased.commitOid, true, { adoptionId: rebased.recoveryId, generation: this.lease.generation })
      await resolver.journal.markAdopted()
      this.rebase = { from, parentOid: rebased.commitOid, baseTreeOid: null, recoveryId: rebased.recoveryId }
      return null
    }
    const conflictingPaths = rebased.paths.map((conflicted) => this.sessionPath(conflicted))
    return {
      outcome: "conflicts", conflictingPaths, recoveryId: rebased.recoveryId,
      message: `${formatPaths(conflictingPaths)} changed on both sides. Review and resolve the retained isolated rebase. Live files have not been changed.`,
    }
  }

  /** Real Git rebase semantics, in a worktree of its own, away from everyone's folders (Section 21.4). */
  private async rebaseInWorktree(
    from: string,
    onto: string,
  ): Promise<{ kind: "clean"; commitOid: string; recoveryId: string } | { kind: "conflicts"; paths: string[]; recoveryId: string }> {
    const repo = this.requireRepo()
    const common = (await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim()
    const basis = this.checkpoint
    if (!basis || basis.commitOid !== from) throw new AutoGitError("REBASE_BASIS_CHANGED", "The checkpoint changed before rebase computation. Review the rebase again.")
    const journal = await RebaseJournal.create(common, this.options.publicSessionId, from, onto, basis.sessionSeq)
    const dir = journal.directory
    const worktree = journal.worktree
    let computed = false
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
      if (result.success) {
        const commitOid = (await inWorktree(["rev-parse", "HEAD"])).stdout.trim()
        // Keep the result reachable even if the daemon dies before CRDT adoption.
        await this.git(["update-ref", `refs/cozea/rebase-results/${journal.record.id}`, commitOid])
        await journal.computed(commitOid)
        computed = true
        return { kind: "clean", commitOid, recoveryId: journal.record.id }
      }
      const conflicted = await inWorktree(["diff", "--name-only", "--diff-filter=U", "-z"])
      const paths = conflicted.stdout.split("\0").filter(Boolean)
      if (paths.length === 0) throw new AutoGitError("GIT_FAILED", firstLine(result.stderr) || "git rebase failed")
      await journal.captureConflicts((await inWorktree(["ls-files", "--unmerged", "-z"])).stdout)
      return { kind: "conflicts", paths, recoveryId: journal.record.id }
    } finally {
      // Conflicts and interrupted computation retain Git's sequencer and index,
      // including binary, delete/modify and later commits still to replay.
      if (computed) await this.git(["worktree", "remove", "--force", worktree], { allowNonZeroExit: true })
    }
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
      if ((checkpoint.savedThroughSeq ?? 0) <= (current.savedThroughSeq ?? 0) &&
          (checkpoint.confirmedAt ?? 0) <= (current.confirmedAt ?? 0)) return
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
    if (this.options.repositoryCredentials && ["fetch", "push", "ls-remote"].includes(args[0] ?? "")) {
      return executeScopedNetworkGit(this.options.gitService.process, args, this.requireRepo().remote,
        { cwd: this.requireRepo().root, ...options }, this.options.repositoryCredentials)
    }
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
