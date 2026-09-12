/**
 * One live collaboration session hosted by projectd.
 *
 * Master Specification: Section 9.5, 10.11 - 10.15, 12.3, 13.1 - 13.10, 14 - 16
 * Connects the session replica to its room (end-to-end encrypted, with a durable
 * outbound queue and reconnects on fresh tickets) and to one workspace folder:
 * disk edits go in through the snapshot-anchored adapter, and peer edits come out
 * through the materializer. Ingestion and materialization take turns on one queue,
 * so each sees the index and baselines the other left behind.
 *
 * With a branch, the folder syncs only while that branch is checked out and Git is
 * not in the middle of a merge or rebase there, and AutoGit saves the session to
 * the branch.
 */

import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import type {
  ProjectdCheckpointResult,
  ProjectdSessionState,
  ProjectdSessionStatus,
  ProjectdSessionTicket,
  ProjectdTargetStatus,
} from "@cozea/projectd-protocol"

import { AutoGitAgent, AutoGitError, type AutoGitTiming, type SessionFileChange } from "../autogit/AutoGitAgent"
import { TargetWatcher } from "../autogit/TargetWatcher"
import { FSEventsClient, type FileEventSource } from "../filesystem/FSEventsClient"
import { MaterializationIndex } from "../filesystem/MaterializationIndex"
import { FilesystemMaterializer } from "../filesystem/Materializer"
import { ScopePolicy } from "../filesystem/ScopePolicy"
import { isSharedEnvironmentFile } from "../filesystem/environmentFiles"
import { WorkspaceFilesystemWatcher, type NormalizedFsEvent } from "../filesystem/WorkspaceFilesystemWatcher"
import { resolveWorkspaceFilePath } from "../filesystem/workspacePath"
import type { GitService } from "../git/GitService"
import { NativeMacHelper } from "../native/NativeMacHelper"
import type { ProjectdDatabase } from "../storage/Database"
import { BaselineStore } from "./BaselineStore"
import { BoundedDiff } from "./BoundedDiff"
import { ExternalSnapshotAdapter } from "./ExternalSnapshotAdapter"
import { OutboundBatchQueue } from "./OutboundBatchQueue"
import { InvalidProjectPathError, normalizeProjectPath } from "./projectPath"
import { SessionReplica } from "./SessionReplica"
import {
  SessionRoomClient,
  webSocketRoomConnector,
  type RoomClientState,
  type RoomConnector,
} from "./SessionRoomClient"
import { SessionTransport } from "./SessionTransport"
import { TextDocRegistry } from "./TextDocRegistry"
import type { ChangeActor, ProjectEntryRecord } from "./TreeDoc"

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const DEFAULT_SUBMIT_DELAY_MS = 40
const DEFAULT_MATERIALIZE_DELAY_MS = 25
const DEFAULT_RESCAN_WITHOUT_EVENTS_MS = 2_000
const DEFAULT_GIT_POLL_MS = 2_000
// The room caps an encrypted batch at 1 MiB, and base64 plus JSON add about 40%.
const DEFAULT_MAX_TEXT_FILE_BYTES = 512 * 1024
const SUBMIT_CHUNK_BYTES = 256 * 1024
const STATUS_DEBOUNCE_MS = 100
const TICKET_EXPIRY_SKEW_SECONDS = 30
const TICKET_WAIT_MS = 5 * 60_000
const REJECTED_TICKET_CODES = new Set(["INVALID_SESSION_TOKEN", "ROOM_MISMATCH"])
// A checkpoint waits this long for the room to acknowledge this device's edits.
const ACK_WAIT_MS = 10_000
const ACK_POLL_MS = 20
// Detaching waits this long for a checkpoint or baseline move under way.
const AUTOGIT_STOP_WAIT_MS = 5_000
// Git holds index.lock through a checkout; one held longer is left over from a Git that crashed.
const INDEX_LOCK_WAIT_MS = 10_000
const INDEX_LOCK_POLL_MS = 50
const BRANCH_REF_PREFIX = "ref: refs/heads/"
const GIT_OPERATIONS: ReadonlyArray<readonly [marker: string, operation: string]> = [
  ["MERGE_HEAD", "merge"],
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
]

export interface CollaborationSessionHostOptions {
  publicSessionId: string
  workspaceId: string
  workspaceRoot: string
  /** The session's 32-byte room key. */
  roomKey: Uint8Array
  ticket: ProjectdSessionTicket
  db: ProjectdDatabase
  actor: ChangeActor
  gitService?: GitService
  /** The session's branch: the folder syncs only while it is checked out, and AutoGit saves to it. */
  branchName?: string
  /** Share env files (.env) through the session although Git ignores them. */
  shareEnvironmentFiles?: boolean
  /** The branch the session's work merges into; the host tracks how far it moved (P20). */
  targetBranch?: string
  /** When the session started, for the target tracker's "running for over a day" rule. */
  sessionStartedAt?: number
  /** How often the target branch is fetched and measured. */
  targetCheckIntervalMs?: number
  /** Fixes this device's replica client id; tests use it to choose which device leads. */
  clientId?: string
  autoGitTiming?: Partial<AutoGitTiming>
  /** How often the folder's Git state is checked, which is also how soon a paused folder resumes. */
  gitPollMs?: number
  connectorFactory?: (wsUrl: string) => RoomConnector
  fileEventSource?: FileEventSource
  /** Full rescans that stand in for file events when no native source runs; 0 turns them off. */
  rescanIntervalMs?: number
  submitDelayMs?: number
  materializeDelayMs?: number
  reconnectDelaysMs?: number[]
  maxTextFileBytes?: number
  onStatus?: (status: ProjectdSessionStatus) => void
  onTicketNeeded?: () => void
}

export class SessionHostError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Emits nothing; periodic rescans find changes instead. */
class IdleFileEventSource extends EventEmitter implements FileEventSource {
  async start(): Promise<void> {
    // No native events to start
  }

  stop(): void {
    // Nothing to stop
  }
}

interface TicketWaiter {
  resolve(token: string): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

export class CollaborationSessionHost {
  readonly publicSessionId: string
  readonly workspaceId: string
  readonly workspaceRoot: string
  readonly replica: SessionReplica
  readonly transport: SessionTransport
  readonly roomClient: SessionRoomClient
  readonly index: MaterializationIndex
  readonly baselines: BaselineStore
  readonly queue: OutboundBatchQueue
  readonly watcher: WorkspaceFilesystemWatcher
  readonly target: TargetWatcher | null

  private readonly adapter: ExternalSnapshotAdapter
  private readonly textDiff = new BoundedDiff()
  private readonly materializer: FilesystemMaterializer
  private readonly autoGit: AutoGitAgent | null
  private readonly actor: ChangeActor
  private readonly branchName: string | null
  private readonly shareEnvironmentFiles: boolean
  private readonly connectorFactory: (wsUrl: string) => RoomConnector
  private readonly rescanIntervalMs: number
  private readonly submitDelayMs: number
  private readonly materializeDelayMs: number
  private readonly reconnectDelaysMs: number[]
  private readonly maxTextFileBytes: number
  private readonly gitPollMs: number
  private readonly onStatus?: (status: ProjectdSessionStatus) => void
  private readonly onTicketNeeded?: () => void
  private readonly unsubscribeRemote: () => void

  private ticket: ProjectdSessionTicket
  private ticketRejected = false
  private ticketWaiters: TicketWaiter[] = []
  private hostState: ProjectdSessionState = "starting"
  private running = false
  // True until the first sync after attaching has brought folder and room together.
  private reconciling = true
  // While reconcile starts the watcher, it handles the watcher's events itself.
  private reconcileEvents: NormalizedFsEvent[] | null = null
  private work: Promise<void> = Promise.resolve()
  private submitTimer: NodeJS.Timeout | null = null
  private unsentBytes = 0
  private readonly pendingMaterialize = new Set<string>()
  private materializeTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private rescanTimer: NodeJS.Timeout | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private readonly skippedPaths = new Set<string>()
  private lastError: { code: string; message: string } | null = null
  private readonly gitService?: GitService
  // The folder's Git directory, looked up once; null outside a repository or without a branch.
  private gitDirLookup: Promise<string | null> | null = null
  // Why the folder stopped syncing: another branch is checked out, or Git is mid-operation.
  private gitPause: string | null = null
  private gitPollTimer: NodeJS.Timeout | null = null
  private gitChecking = false
  private staleIndexLockMtimeMs: number | null = null

  constructor(options: CollaborationSessionHostOptions) {
    this.publicSessionId = options.publicSessionId
    this.gitService = options.gitService
    this.workspaceId = options.workspaceId
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.ticket = options.ticket
    this.actor = options.actor
    this.branchName = options.branchName?.trim() || null
    this.shareEnvironmentFiles = options.shareEnvironmentFiles === true
    this.connectorFactory = options.connectorFactory ?? webSocketRoomConnector
    this.submitDelayMs = options.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS
    this.materializeDelayMs = options.materializeDelayMs ?? DEFAULT_MATERIALIZE_DELAY_MS
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS
    this.maxTextFileBytes = options.maxTextFileBytes ?? DEFAULT_MAX_TEXT_FILE_BYTES
    this.gitPollMs = options.gitPollMs ?? DEFAULT_GIT_POLL_MS
    this.onStatus = options.onStatus
    this.onTicketNeeded = options.onTicketNeeded

    const eventSource =
      options.fileEventSource ??
      (new NativeMacHelper().isAvailable ? new FSEventsClient(this.workspaceRoot) : null)
    this.rescanIntervalMs = options.rescanIntervalMs ?? (eventSource ? 0 : DEFAULT_RESCAN_WITHOUT_EVENTS_MS)

    this.replica = new SessionReplica(this.publicSessionId, options.clientId)
    this.queue = new OutboundBatchQueue(options.db)
    this.transport = new SessionTransport({
      sessionId: this.publicSessionId,
      replica: this.replica,
      roomKey: options.roomKey,
    })
    this.roomClient = new SessionRoomClient({
      transport: this.transport,
      connect: (handlers) => this.connectorFactory(this.ticket.wsUrl)(handlers),
      getToken: () => this.currentToken(),
      onAcknowledged: (batchId, sessionSeq) => this.handleAcknowledged(batchId, sessionSeq),
      onStateChange: (state) => this.handleConnectionState(state),
      onAutoGitState: (state) => this.autoGit?.handleRoomState(state),
      onCheckpointRequested: () => this.autoGit?.handleCheckpointRequested(),
    })
    this.index = new MaterializationIndex(options.db)
    this.baselines = new BaselineStore({ db: options.db, sessionId: this.publicSessionId })
    this.adapter = new ExternalSnapshotAdapter({ replica: this.replica, baselineStore: this.baselines })
    this.materializer = new FilesystemMaterializer({
      workspaceRoot: this.workspaceRoot,
      sessionId: this.publicSessionId,
      replica: this.replica,
      index: this.index,
      baselineStore: this.baselines,
    })
    this.watcher = new WorkspaceFilesystemWatcher({
      workspaceRoot: this.workspaceRoot,
      sessionId: this.publicSessionId,
      scopePolicy: new ScopePolicy(this.workspaceRoot, options.gitService, {
        shareEnvironmentFiles: this.shareEnvironmentFiles,
      }),
      index: this.index,
      fseventsClient: eventSource ?? new IdleFileEventSource(),
    })
    this.autoGit =
      this.branchName && options.gitService
        ? new AutoGitAgent({
            publicSessionId: this.publicSessionId,
            branchName: this.branchName,
            workspaceRoot: this.workspaceRoot,
            gitService: options.gitService,
            room: this.roomClient,
            replica: this.replica,
            transport: this.transport,
            canWrite: () => this.canWrite,
            maxTextFileBytes: this.maxTextFileBytes,
            runExclusive: (work) => this.exclusive(work),
            flushLocalChanges: () => this.flushAndAwaitAcks(),
            applySessionChanges: (changes) => this.applySessionChanges(changes),
            onChange: () => this.emitStatusSoon(),
            timing: options.autoGitTiming,
          })
        : null
    const targetBranch = options.targetBranch?.trim() || null
    this.target =
      this.branchName && targetBranch && targetBranch !== this.branchName && options.gitService
        ? new TargetWatcher({
            workspaceRoot: this.workspaceRoot,
            branchName: this.branchName,
            targetBranch,
            gitService: options.gitService,
            sessionStartedAt: options.sessionStartedAt,
            intervalMs: options.targetCheckIntervalMs,
            onChange: () => this.emitStatusSoon(),
          })
        : null
    this.watcher.on("event", (event: NormalizedFsEvent) => this.handleFileEvent(event))
    this.unsubscribeRemote = this.replica.onRemoteChange((fileIds) => {
      this.scheduleMaterialize(fileIds)
      this.noteSessionActivity()
    })
  }

  get canWrite(): boolean {
    return this.ticket.role !== "viewer"
  }

  get state(): ProjectdSessionState {
    return this.hostState
  }

  /** Connects, then brings folder and room together. Later failures retry on their own. */
  async start(): Promise<void> {
    if (this.running || this.hostState === "stopped" || this.hostState === "failed") return
    this.running = true
    this.emitStatus()
    try {
      // Own batches the room had not acknowledged when the daemon last stopped (Section 13.9).
      for (const queued of this.queue.getPendingBatches(this.publicSessionId)) {
        this.replica.applyBatch(queued.batch)
        this.roomClient.submitBatch(queued.batch)
      }
    } catch (error) {
      this.fail("QUEUE_UNREADABLE", error)
      return
    }
    if ((await this.resolveGitDir()) && this.running && !this.gitPollTimer) {
      this.gitPollTimer = setInterval(() => void this.checkGit(), this.gitPollMs)
    }
    await this.connectAndReconcile()
  }

  updateTicket(ticket: ProjectdSessionTicket): void {
    this.ticket = ticket
    this.ticketRejected = false
    const waiters = this.ticketWaiters.splice(0)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(ticket.token)
    }
    this.refreshState()
    // With nobody waiting, the next attempt sits on a backoff timer; go now instead.
    if (waiters.length === 0 && this.running && this.roomClient.state === "disconnected") {
      this.clearReconnectTimer()
      this.reconnectAttempt = 0
      void this.connectAndReconcile()
    }
  }

  /** Scans the folder for changes the event source missed. */
  async rescan(): Promise<void> {
    if (!this.running || this.reconciling || this.gitPause || !this.canWrite) return
    await this.watcher.rescan()
  }

  /** Resolves once queued ingestion and materialization have run and changes were submitted. */
  async flush(): Promise<void> {
    if (this.materializeTimer) {
      clearTimeout(this.materializeTimer)
      this.materializeTimer = null
      void this.enqueue(() => this.materializePending())
    }
    await this.work
    this.flushSubmit()
  }

  /** Saves the session to its branch now, or asks the device that saves to (Section 15.1). */
  async checkpointNow(): Promise<ProjectdCheckpointResult> {
    if (!this.autoGit) {
      throw new SessionHostError("AUTOGIT_OFF", "This session has no Git branch to save to.")
    }
    if (!this.running || this.reconciling) {
      throw new SessionHostError(
        "NOT_READY",
        this.gitPause ?? "This folder is still syncing with the session. Save again once it is live.",
      )
    }
    return this.autoGit.checkpointNow()
  }

  /**
   * Adds the session's env files that Git doesn't ignore to the folder's .gitignore,
   * which then syncs like any file. Saving to Git resumes once it reaches the Mac that
   * saves. Returns the paths added.
   */
  async ignoreEnvironmentFiles(): Promise<string[]> {
    if (!this.canWrite) throw new SessionHostError("FORBIDDEN", "Viewers can't change the session's files.")
    if (!this.gitService) throw new SessionHostError("AUTOGIT_OFF", "This session's folder is not a Git repository.")
    const environmentFiles = this.replica.tree
      .listLiveEntries()
      .filter((entry) => entry.kind === "text" && isSharedEnvironmentFile(entry.path))
      .map((entry) => entry.path)
    if (environmentFiles.length === 0) return []
    const ignored = await this.gitService.checkIgnore(this.workspaceRoot, environmentFiles)
    const missing = environmentFiles.filter((filePath) => !ignored.has(filePath)).sort()
    if (missing.length === 0) return []
    const gitignorePath = path.join(this.workspaceRoot, ".gitignore")
    const existing = await fs.readFile(gitignorePath, "utf8").catch(() => "")
    const lines = [
      ...(existing && !existing.endsWith("\n") ? [""] : []),
      "# Env files shared through the Cozea live session. Git keeps them out of commits.",
      ...missing.map((filePath) => `/${filePath}`),
    ]
    await fs.appendFile(gitignorePath, `${lines.join("\n")}\n`)
    // The folder's watcher would find it too; this sends it without waiting for the event.
    await this.enqueue(() => this.ingestChange(".gitignore", gitignorePath))
    return missing
  }

  /** Fetches the target branch and measures it now (P20); null for a session without one. */
  async checkTarget(): Promise<ProjectdTargetStatus | null> {
    if (!this.target) return null
    const status = await this.target.checkNow(true)
    this.emitStatusSoon()
    return status
  }

  /** Hides the rebase recommendation for a while. */
  dismissTargetRecommendation(): ProjectdTargetStatus | null {
    const status = this.target?.dismiss() ?? null
    this.emitStatusSoon()
    return status
  }

  async stop(): Promise<void> {
    if (this.hostState === "stopped") return
    // Unsent local edits go to the durable queue and leave on the next attach.
    if (this.running) this.flushSubmit()
    this.teardown()
    await this.work
    await waitAtMost(this.autoGit?.settled(), AUTOGIT_STOP_WAIT_MS)
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.setState("stopped")
  }

  status(): ProjectdSessionStatus {
    return {
      publicSessionId: this.publicSessionId,
      workspaceId: this.workspaceId,
      rootPath: this.workspaceRoot,
      state: this.hostState,
      role: this.ticket.role ?? "developer",
      lastAppliedSessionSeq: this.transport.lastAppliedSessionSeq,
      pendingBatches: this.roomClient.pendingBatchCount,
      fileCount: this.replica.tree.listLiveEntries().length,
      skippedPaths: [...this.skippedPaths].sort(),
      lastError: this.lastError ?? this.roomClient.lastError,
      updatedAt: Date.now(),
      pausedReason: this.gitPause,
      autoGit: this.autoGit?.status() ?? null,
      target: this.target?.status() ?? null,
    }
  }

  // ─── Connection ──────────────────────────────────────────────────────────────

  private async connectAndReconcile(): Promise<void> {
    if (!this.running) return
    try {
      await this.roomClient.connect()
    } catch (error) {
      if (!this.running) return
      this.recordError("ROOM_UNREACHABLE", error)
      this.scheduleReconnect()
      return
    }
    await this.reconcileNow()
  }

  /** Runs the first sync on the queue, unless it already ran. */
  private reconcileNow(): Promise<void> {
    if (!this.reconciling) return Promise.resolve()
    return this.enqueue(async () => {
      if (!this.reconciling || !this.running) return
      try {
        await this.reconcile()
      } catch (error) {
        this.fail(error instanceof SessionHostError ? error.code : "RECONCILE_FAILED", error)
      }
    })
  }

  private handleConnectionState(state: RoomClientState): void {
    if (state === "live") this.reconnectAttempt = 0
    if (state === "disconnected" && this.running) {
      if (REJECTED_TICKET_CODES.has(this.roomClient.lastError?.code ?? "")) this.ticketRejected = true
      this.scheduleReconnect()
    }
    this.autoGit?.handleConnectionChange()
    this.refreshState()
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return
    const delayMs = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? 0
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connectAndReconcile()
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** The current ticket's token, or a wait for a new ticket when it expired or the room refused it. */
  private currentToken(): Promise<string> {
    if (!this.ticketRejected && !isTokenExpired(this.ticket.token)) {
      return Promise.resolve(this.ticket.token)
    }
    return new Promise<string>((resolve, reject) => {
      const waiter: TicketWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.ticketWaiters = this.ticketWaiters.filter((candidate) => candidate !== waiter)
          reject(new SessionHostError("TICKET_TIMEOUT", "No new session ticket arrived"))
          this.refreshState()
        }, TICKET_WAIT_MS),
      }
      this.ticketWaiters.push(waiter)
      if (this.ticketWaiters.length === 1) this.onTicketNeeded?.()
      this.refreshState()
    })
  }

  private handleAcknowledged(batchId: string, sessionSeq: number): void {
    this.queue.markAcked(batchId, sessionSeq)
    this.queue.pruneAcked(this.publicSessionId)
    this.noteSessionActivity()
    this.emitStatusSoon()
  }

  /** Tells AutoGit the session moved, once the change that moved it has finished applying. */
  private noteSessionActivity(): void {
    if (this.autoGit) queueMicrotask(() => this.autoGit?.noteActivity())
  }

  // ─── Reconcile ───────────────────────────────────────────────────────────────

  /**
   * First sync after connecting (Section 12.3). An empty room is seeded from the
   * folder. Otherwise the folder's offline edits go in and the room's state comes
   * out. A folder that already holds different versions of session files is
   * refused rather than overwritten. A folder other than the one the session last
   * synced joins afresh.
   */
  private async reconcile(): Promise<void> {
    if (await this.pauseIfFolderLeftBranch()) return
    // The index describes the disk of the folder it was recorded in. Read against another
    // folder, such as a fresh clone, what that folder lacks would look deleted, and the
    // deletion would reach every member.
    if (this.index.bindFolder(this.publicSessionId, this.workspaceId, this.workspaceRoot)) {
      console.info(
        `[CollaborationSessionHost] ${this.workspaceRoot} joins session ${this.publicSessionId} afresh: it last synced another folder`,
      )
    }
    if (this.index.list(this.publicSessionId).length === 0) {
      if (this.replica.tree.listLiveEntries().length === 0) {
        if (this.canWrite) await this.seedFromFolder()
      } else {
        await this.adoptMatchingFiles()
      }
    }

    // The watcher's startup scan reports disk changes made since the last materialization.
    this.reconcileEvents = []
    await this.watcher.start()
    const offlineEvents = this.reconcileEvents
    this.reconcileEvents = null
    // The folder left the branch while the watcher started.
    if (this.gitPause) {
      this.watcher.stop()
      return
    }
    for (const event of offlineEvents) await this.ingest(event)

    this.pendingMaterialize.clear()
    for (const entry of this.replica.tree.listAllEntries()) {
      if (!this.running || this.gitPause) return
      if (this.needsMaterialization(entry)) await this.materializer.materializeFile(entry.fileId, Date.now())
    }

    this.reconciling = false
    this.flushSubmit()
    this.scheduleMaterialize([])
    if (this.rescanIntervalMs > 0 && !this.rescanTimer) {
      this.rescanTimer = setInterval(() => void this.rescan(), this.rescanIntervalMs)
    }
    this.refreshState()
    void this.autoGit?.start()
    this.target?.start()
  }

  private async seedFromFolder(): Promise<void> {
    for (const item of await this.watcher.scanner.scanTree()) {
      if (!item.isSymlink) await this.ingestChange(item.relativePath, item.absolutePath)
    }
    this.flushSubmit()
  }

  /**
   * First attach to a folder with files. Files that match the session are adopted.
   * A different file the session may replace is one Git holds unchanged at HEAD, as
   * in a fresh clone of the session branch: the session's version is written over it
   * (Section 6.3, Git-assisted bootstrap). A shared env file is replaced too, and the
   * folder's own version kept beside it. Any other difference is work only this folder
   * has, so the folder is refused rather than overwritten.
   */
  private async adoptMatchingFiles(): Promise<void> {
    const matching: Array<{ entry: ProjectEntryRecord; diskHash: string; size: number; mtimeMs: number }> = []
    const differing: ProjectEntryRecord[] = []
    for (const entry of this.replica.tree.listLiveEntries()) {
      if (entry.kind !== "text") continue
      const absolutePath = await this.resolveEntryPath(entry.path)
      if (!absolutePath) continue
      const stat = await fs.lstat(absolutePath).catch(() => null)
      if (!stat) continue
      const bytes = stat.isFile() ? await fs.readFile(absolutePath) : null
      if (!bytes || bytes.toString("utf8") !== this.replica.textDocs.getTextContent(entry.fileId)) {
        differing.push(entry)
        continue
      }
      matching.push({ entry, diskHash: sha256(bytes), size: stat.size, mtimeMs: stat.mtimeMs })
    }

    const restorable = differing.length > 0 ? await this.filesGitCanRestore() : null
    const replacedEnvironmentFiles = this.shareEnvironmentFiles
      ? differing.filter((entry) => isSharedEnvironmentFile(entry.path))
      : []
    const blocking = differing.filter(
      (entry) => !restorable?.has(entry.path) && !replacedEnvironmentFiles.includes(entry),
    )
    if (blocking.length > 0) {
      const sample = blocking
        .slice(0, 5)
        .map((entry) => entry.path)
        .join(", ")
      const count = `${blocking.length} ${blocking.length === 1 ? "file" : "files"}`
      throw new SessionHostError(
        "WORKSPACE_CONFLICT",
        restorable
          ? `${count} in ${this.workspaceRoot} differ from the session and hold changes Git does not have (${sample}). Commit or stash them, then join again.`
          : `${count} in ${this.workspaceRoot} differ from the session (${sample}). Join from an empty folder or a clean checkout of the session branch.`,
      )
    }
    for (const { entry, diskHash, size, mtimeMs } of matching) {
      this.adapter.initializeBaseline(entry.fileId)
      this.recordDiskState(entry, diskHash, { size, mtimeMs })
    }
    for (const entry of replacedEnvironmentFiles) await this.keepLocalCopy(entry.path)
    // Git keeps the versions these replace, at HEAD; env files were copied aside just now.
    for (const entry of differing) await this.materializer.materializeFile(entry.fileId, Date.now())
  }

  /** Keeps this folder's version of a file the session replaces, as `<file>.conflict.<time>`, which never syncs. */
  private async keepLocalCopy(relativePath: string): Promise<void> {
    const absolutePath = await this.resolveEntryPath(relativePath)
    if (!absolutePath) return
    await fs.copyFile(absolutePath, `${absolutePath}.conflict.${Date.now()}`)
  }

  /** Files Git holds unchanged at HEAD, relative to the folder; null outside a Git work tree. */
  private async filesGitCanRestore(): Promise<Set<string> | null> {
    if (!this.gitService) return null
    try {
      return await this.gitService.listUnmodifiedTrackedFiles(this.workspaceRoot)
    } catch (error) {
      console.warn("[CollaborationSessionHost] Could not read Git state for the join", error)
      return null
    }
  }

  private needsMaterialization(entry: ProjectEntryRecord): boolean {
    const indexed = this.index.getByFileId(this.publicSessionId, entry.fileId)
    if (entry.deleted) return indexed !== null
    if (entry.kind === "binary") return false
    if (!indexed || indexed.relativePath !== entry.path) return true
    if (entry.kind === "symlink") return indexed.diskHash !== sha256(entry.symlinkTarget ?? "")
    return indexed.diskHash !== sha256(this.replica.textDocs.getTextContent(entry.fileId))
  }

  // ─── Folder → session ────────────────────────────────────────────────────────

  private handleFileEvent(event: NormalizedFsEvent): void {
    if (!this.running || !this.canWrite || this.gitPause) return
    if (this.reconcileEvents) {
      this.reconcileEvents.push(event)
      return
    }
    void this.enqueue(() => this.ingest(event))
  }

  private async ingest(event: NormalizedFsEvent): Promise<void> {
    if (!this.running || !this.canWrite) return
    if (await this.pauseIfFolderLeftBranch()) return
    if (event.type === "change") {
      if (!event.isSymlink) await this.ingestChange(event.relativePath, event.absolutePath)
    } else if (event.type === "delete") {
      await this.ingestDelete(event.relativePath, event.fileId)
    }
  }

  private async ingestChange(relativePath: string, absolutePath: string): Promise<void> {
    const filePath = toProjectPath(relativePath)
    if (!filePath) return
    const stat = await fs.lstat(absolutePath).catch(() => null)
    if (!stat?.isFile()) return
    if (stat.size > this.maxTextFileBytes) {
      this.skip(filePath)
      return
    }
    const bytes = await fs.readFile(absolutePath).catch(() => null)
    if (!bytes) return
    if (TextDocRegistry.classifyContent(bytes) !== "text") {
      this.skip(filePath)
      return
    }

    const diskHash = sha256(bytes)
    // The bytes this host last wrote or read: an echo, not an edit.
    if (this.index.getByPath(this.publicSessionId, filePath)?.diskHash === diskHash) return
    // Read while Git switched branches, these bytes may belong to the other branch.
    if (await this.pauseIfFolderLeftBranch()) return

    const text = bytes.toString("utf8")
    let entry = this.findLiveEntry(filePath)
    if (entry && entry.kind !== "text") return
    if (entry) {
      this.adapter.applyExternalDiskChange({ fileId: entry.fileId, diskText: text, actor: this.actor })
    } else {
      entry = this.replica.createFile({
        path: filePath,
        kind: "text",
        content: text,
        mode: fileMode(stat.mode),
        actor: this.actor,
      })
      this.adapter.initializeBaseline(entry.fileId, text)
    }
    this.skippedPaths.delete(filePath)
    this.recordDiskState(entry, diskHash, stat)

    this.unsentBytes += bytes.length
    if (this.unsentBytes >= SUBMIT_CHUNK_BYTES) this.flushSubmit()
    else this.scheduleSubmit()

    // Merged with concurrent peer edits, the text no longer matches disk; write the merge back.
    if (this.replica.textDocs.getTextContent(entry.fileId) !== text) {
      this.scheduleMaterialize([entry.fileId])
    }
  }

  private async ingestDelete(relativePath: string, fileId?: string): Promise<void> {
    const filePath = toProjectPath(relativePath)
    if (!filePath) return
    // Atomic saves delete and recreate; only a path that is still missing was deleted.
    const stillExists = await fs.lstat(path.join(this.workspaceRoot, filePath)).then(
      () => true,
      () => false,
    )
    if (stillExists) return
    // A checkout of another branch removes the files only this branch has.
    if (await this.pauseIfFolderLeftBranch()) return

    this.skippedPaths.delete(filePath)
    const entry = this.findLiveEntry(filePath) ?? (fileId ? this.liveEntryById(fileId) : null)
    if (!entry) {
      if (fileId) this.index.remove(this.publicSessionId, fileId)
      return
    }
    this.replica.deleteFile(entry.fileId, this.actor)
    this.index.remove(this.publicSessionId, entry.fileId)
    this.baselines.deleteBaseline(entry.fileId)
    this.scheduleSubmit()
  }

  /**
   * Applies AutoGit's merge of commits pushed from outside the session, as edits by
   * this device, and writes them to this folder. Nothing is applied when a file no
   * longer reads as the merge found it; those paths come back so it can merge again.
   */
  private async applySessionChanges(changes: SessionFileChange[]): Promise<string[]> {
    const currentText = (filePath: string): string | null => {
      const entry = this.findLiveEntry(filePath)
      return entry?.kind === "text" ? this.replica.textDocs.getTextContent(entry.fileId) : null
    }
    const changedMeanwhile = changes
      .filter((change) => currentText(change.path) !== change.expected)
      .map((change) => change.path)
    if (changedMeanwhile.length > 0) return changedMeanwhile

    const touched: string[] = []
    for (const change of changes) {
      const entry = this.findLiveEntry(change.path)
      if (change.text === null) {
        if (!entry) continue
        this.replica.deleteFile(entry.fileId, this.actor)
        touched.push(entry.fileId)
      } else if (entry) {
        this.replaceText(entry.fileId, change.text)
        touched.push(entry.fileId)
      } else {
        const created = this.replica.createFile({
          path: change.path,
          kind: "text",
          content: change.text,
          mode: change.mode,
          actor: this.actor,
        })
        touched.push(created.fileId)
      }
    }
    for (const fileId of touched) await this.materializer.materializeFile(fileId, Date.now())
    this.flushSubmit()
    return []
  }

  /** Edits a text doc into `next` with the smallest change, so concurrent peer edits merge around it. */
  private replaceText(fileId: string, next: string): void {
    const { doc, text } = this.replica.textDocs.getOrCreate(fileId)
    const ops = this.textDiff.computeDiff(text.toString(), next)
    doc.transact(() => {
      let index = 0
      for (const op of ops) {
        if (op.op === "equal") {
          index += op.text.length
        } else if (op.op === "delete") {
          text.delete(index, op.text.length)
        } else {
          text.insert(index, op.text)
          index += op.text.length
        }
      }
    }, this.actor)
  }

  private recordDiskState(
    entry: ProjectEntryRecord,
    diskHash: string,
    stat: { size: number; mtimeMs: number },
  ): void {
    this.index.recordMaterialization({
      sessionId: this.publicSessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: "text",
      mode: entry.mode,
      diskHash,
      diskSize: stat.size,
      diskMtimeMs: stat.mtimeMs,
      state: "materialized",
    })
  }

  private findLiveEntry(filePath: string): ProjectEntryRecord | null {
    return this.replica.tree.listLiveEntries().find((entry) => entry.path === filePath) ?? null
  }

  private liveEntryById(fileId: string): ProjectEntryRecord | null {
    const entry = this.replica.tree.getEntry(fileId)
    return entry && !entry.deleted ? entry : null
  }

  private async resolveEntryPath(relativePath: string): Promise<string | null> {
    try {
      return await resolveWorkspaceFilePath(this.workspaceRoot, relativePath)
    } catch (error) {
      if (error instanceof InvalidProjectPathError) return null
      throw error
    }
  }

  private skip(filePath: string): void {
    if (this.skippedPaths.has(filePath)) return
    this.skippedPaths.add(filePath)
    this.emitStatusSoon()
  }

  // ─── Session → room and folder ───────────────────────────────────────────────

  private scheduleSubmit(): void {
    if (this.submitTimer) return
    this.submitTimer = setTimeout(() => {
      this.submitTimer = null
      this.flushSubmit()
    }, this.submitDelayMs)
  }

  private flushSubmit(): void {
    if (this.submitTimer) {
      clearTimeout(this.submitTimer)
      this.submitTimer = null
    }
    this.unsentBytes = 0
    if (!this.canWrite) return
    const batch = this.replica.exportBatch()
    if (!batch) return
    this.queue.enqueue(batch)
    this.roomClient.submitBatch(batch)
    this.emitStatusSoon()
  }

  /** Sends unsent edits and waits until the room has acknowledged every one (Section 15.3). */
  private async flushAndAwaitAcks(): Promise<void> {
    this.flushSubmit()
    const deadline = Date.now() + ACK_WAIT_MS
    while (this.roomClient.pendingBatchCount > 0) {
      if (Date.now() > deadline || this.roomClient.state !== "live") {
        throw new AutoGitError("EDITS_NOT_ACKNOWLEDGED", "The session room has not confirmed this device's latest edits yet.")
      }
      await delay(ACK_POLL_MS)
    }
  }

  private scheduleMaterialize(fileIds: Iterable<string>): void {
    for (const fileId of fileIds) this.pendingMaterialize.add(fileId)
    this.emitStatusSoon()
    if (this.reconciling || this.gitPause || !this.running || this.materializeTimer || this.pendingMaterialize.size === 0) {
      return
    }
    this.materializeTimer = setTimeout(() => {
      this.materializeTimer = null
      void this.enqueue(() => this.materializePending())
    }, this.materializeDelayMs)
  }

  private async materializePending(): Promise<void> {
    // Peer edits written into another branch's checkout would land in that branch.
    if (await this.pauseIfFolderLeftBranch()) {
      this.pendingMaterialize.clear()
      return
    }
    const fileIds = [...this.pendingMaterialize]
    this.pendingMaterialize.clear()
    for (const fileId of fileIds) {
      if (!this.running || this.gitPause) return
      const entry = this.replica.tree.getEntry(fileId)
      if (!entry) continue
      // A local save not ingested yet goes in first, so the write below carries both edits.
      await this.ingestUnseenDiskEdit(entry)
      const current = this.replica.tree.getEntry(fileId)
      if (current && !this.gitPause && this.needsMaterialization(current)) {
        await this.materializer.materializeFile(fileId, Date.now())
      }
    }
  }

  private async ingestUnseenDiskEdit(entry: ProjectEntryRecord): Promise<void> {
    if (!this.canWrite || entry.deleted || entry.kind !== "text") return
    const indexed = this.index.getByFileId(this.publicSessionId, entry.fileId)
    // After a peer rename the old path is nobody's; the materializer keeps its bytes.
    if (!indexed || indexed.relativePath !== entry.path) return
    const absolutePath = await this.resolveEntryPath(entry.path)
    if (!absolutePath) return
    const stat = await fs.lstat(absolutePath).catch(() => null)
    if (!stat?.isFile() || (stat.size === indexed.diskSize && stat.mtimeMs === indexed.diskMtimeMs)) return
    await this.ingestChange(entry.path, absolutePath)
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.work = this.work.then(task).catch((error: unknown) => {
      this.recordError("SYNC_FAILED", error)
    })
    return this.work
  }

  /** Runs work between ingestion and materialization steps and hands back its result. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.work.then(work)
    this.work = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  // ─── Git (Section 6.4, 12.9) ─────────────────────────────────────────────────

  private resolveGitDir(): Promise<string | null> {
    this.gitDirLookup ??= this.lookUpGitDir()
    return this.gitDirLookup
  }

  private async lookUpGitDir(): Promise<string | null> {
    if (!this.branchName || !this.gitService) return null
    try {
      const result = await this.gitService.process.execute(["rev-parse", "--absolute-git-dir"], {
        cwd: this.workspaceRoot,
        allowNonZeroExit: true,
      })
      return result.success ? result.stdout.trim() || null : null
    } catch (error) {
      console.warn(`[projectd] Session ${this.publicSessionId}: could not find the folder's Git directory`, error)
      return null
    }
  }

  /** Why the folder must not sync now, or null while it may. */
  private async folderGitProblem(): Promise<string | null> {
    const gitDir = await this.resolveGitDir()
    if (!gitDir || !this.branchName) return null
    await this.waitForIndexLock(gitDir)
    for (const [marker, operation] of GIT_OPERATIONS) {
      if (await pathExists(path.join(gitDir, marker))) {
        return `Git is in the middle of a ${operation} in this folder. Syncing resumes once it finishes or is aborted.`
      }
    }
    const head = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8").catch(() => null))?.trim()
    if (!head || head === `${BRANCH_REF_PREFIX}${this.branchName}`) return null
    return head.startsWith(BRANCH_REF_PREFIX)
      ? `This folder has ${head.slice(BRANCH_REF_PREFIX.length)} checked out. Switch back to ${this.branchName} to keep syncing the session.`
      : `This folder has a detached HEAD. Check out ${this.branchName} to keep syncing the session.`
  }

  /** Waits while Git holds the index lock. A lock that outlives the wait is not waited on again. */
  private async waitForIndexLock(gitDir: string): Promise<void> {
    const lockPath = path.join(gitDir, "index.lock")
    const deadline = Date.now() + INDEX_LOCK_WAIT_MS
    for (;;) {
      const stat = await fs.stat(lockPath).catch(() => null)
      if (!stat) {
        this.staleIndexLockMtimeMs = null
        return
      }
      if (stat.mtimeMs === this.staleIndexLockMtimeMs) return
      if (Date.now() >= deadline) {
        console.warn(`[projectd] Session ${this.publicSessionId}: ${lockPath} looks left over; syncing anyway`)
        this.staleIndexLockMtimeMs = stat.mtimeMs
        return
      }
      await delay(INDEX_LOCK_POLL_MS)
    }
  }

  /** Pauses syncing when the folder left the session branch; true while paused. */
  private async pauseIfFolderLeftBranch(): Promise<boolean> {
    if (this.gitPause) return true
    const problem = await this.folderGitProblem()
    if (!problem) return false
    this.pauseForGit(problem)
    return true
  }

  /** Stops syncing the folder both ways; the session itself carries on (Section 6.4). */
  private pauseForGit(reason: string): void {
    if (!this.running || this.gitPause === reason) return
    const pausing = this.gitPause === null
    this.gitPause = reason
    if (pausing) {
      console.warn(`[projectd] Session ${this.publicSessionId} paused: ${reason}`)
      this.watcher.stop()
      this.pendingMaterialize.clear()
      if (this.materializeTimer) {
        clearTimeout(this.materializeTimer)
        this.materializeTimer = null
      }
      if (this.rescanTimer) {
        clearInterval(this.rescanTimer)
        this.rescanTimer = null
      }
    }
    this.refreshState()
    if (!pausing) this.emitStatus()
  }

  private async checkGit(): Promise<void> {
    // The first sync checks for itself.
    if (!this.running || this.gitChecking || (this.reconciling && !this.gitPause)) return
    this.gitChecking = true
    try {
      const problem = await this.folderGitProblem()
      if (!this.running) return
      if (problem) this.pauseForGit(problem)
      else if (this.gitPause) this.resumeFromGitPause()
    } finally {
      this.gitChecking = false
    }
  }

  /**
   * The branch is back. Anything may have changed in the folder meanwhile, so the
   * folder and the session come together as on joining: files that match are kept,
   * files Git holds unchanged take the session's version, and anything else stops
   * the sync rather than being overwritten.
   */
  private resumeFromGitPause(): void {
    this.gitPause = null
    this.index.clearSession(this.publicSessionId)
    this.reconciling = true
    this.refreshState()
    // Otherwise the next connection runs the sync.
    if (this.roomClient.state === "live") void this.reconcileNow()
  }

  // ─── State ───────────────────────────────────────────────────────────────────

  private refreshState(): void {
    if (!this.running) return
    if (this.gitPause) {
      this.setState("paused")
      return
    }
    if (this.ticketWaiters.length > 0) {
      this.setState("waiting_for_ticket")
      return
    }
    const connection = this.roomClient.state
    if (this.reconciling) {
      this.setState(connection === "syncing" || connection === "live" ? "syncing" : "starting")
      return
    }
    this.setState(connection === "live" ? "live" : "reconnecting")
  }

  private setState(state: ProjectdSessionState): void {
    if (this.hostState === state) return
    this.hostState = state
    this.emitStatus()
  }

  private emitStatus(): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.onStatus?.(this.status())
  }

  private emitStatusSoon(): void {
    if (this.statusTimer || !this.onStatus) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null
      this.onStatus?.(this.status())
    }, STATUS_DEBOUNCE_MS)
  }

  private recordError(code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.lastError = { code, message }
    console.warn(`[projectd] Session ${this.publicSessionId}: ${code}: ${message}`)
    this.emitStatusSoon()
  }

  private fail(code: string, error: unknown): void {
    this.recordError(code, error)
    this.teardown()
    this.hostState = "failed"
    this.emitStatus()
  }

  /** Stops every source of work; does not wait for the task in flight. */
  private teardown(): void {
    this.running = false
    this.clearReconnectTimer()
    if (this.submitTimer) {
      clearTimeout(this.submitTimer)
      this.submitTimer = null
    }
    if (this.materializeTimer) {
      clearTimeout(this.materializeTimer)
      this.materializeTimer = null
    }
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer)
      this.rescanTimer = null
    }
    if (this.gitPollTimer) {
      clearInterval(this.gitPollTimer)
      this.gitPollTimer = null
    }
    // A leader gives its lease up while the connection is still open.
    this.autoGit?.stop()
    this.target?.stop()
    this.watcher.stop()
    this.unsubscribeRemote()
    this.roomClient.disconnect()
    for (const waiter of this.ticketWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new SessionHostError("DETACHED", "The session was detached"))
    }
    this.materializer.dispose()
  }
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

async function waitAtMost(work: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!work) return
  let timer: NodeJS.Timeout | undefined
  await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, ms)))])
  clearTimeout(timer)
}

function pathExists(target: string): Promise<boolean> {
  return fs.lstat(target).then(
    () => true,
    () => false,
  )
}

function fileMode(mode: number): number {
  return mode & 0o111 ? 0o100755 : 0o100644
}

function toProjectPath(relativePath: string): string | null {
  try {
    return normalizeProjectPath(relativePath)
  } catch (error) {
    if (error instanceof InvalidProjectPathError) return null
    throw error
  }
}

/** Reads a JWT's exp claim; a token it cannot read is left for the room to judge. */
function isTokenExpired(token: string): boolean {
  const payload = token.split(".")[1]
  if (!payload) return false
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown }
    return typeof claims.exp === "number" && claims.exp - TICKET_EXPIRY_SKEW_SECONDS <= Date.now() / 1000
  } catch {
    return false
  }
}
