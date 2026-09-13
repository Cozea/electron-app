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

import { createHash, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import type {
  ProjectdBinaryConflictResponse,
  ProjectdStructuralConflictResponse,
  ProjectdCheckpointResult,
  ProjectdClosePreflight,
  ProjectdCloseChoice,
  ProjectdMergePreview,
  ProjectdMergeResult,
  ProjectdMergeStrategy,
  ProjectdRebaseResult,
  ProjectdSessionState,
  ProjectdSessionStatus,
  ProjectdSessionTicket,
  ProjectdTargetStatus,
} from "@cozea/projectd-protocol"

import { AutoGitAgent, AutoGitError, sessionFileFingerprint, type AutoGitTiming, type SessionFileChange } from "../autogit/AutoGitAgent"
import { SessionMerger } from "../autogit/SessionMerger"
import type { GitHubSessionPullRequest } from "../autogit/GitHubSessionPullRequest"
import type { RepositoryCredentialProvider } from "../git/ScopedNetworkGit"
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
import { BinaryContentCache } from "./BinaryContentCache"
import { SessionBinaryObjectStore, type BinaryObjectClient } from "./BinaryObjectStore"
import type { BinaryRevision } from "./BinaryStore"
import { ConflictEngine } from "./ConflictEngine"
import { BoundedDiff } from "./BoundedDiff"
import { ExternalSnapshotAdapter } from "./ExternalSnapshotAdapter"
import { OutboundBatchQueue } from "./OutboundBatchQueue"
import { PendingBinaryStore, type PendingBinaryRecord, type PendingBinarySource } from "./PendingBinaryStore"
import { InvalidProjectPathError, normalizeProjectPath } from "./projectPath"
import { SessionReplica } from "./SessionReplica"
import type { ReplicaSnapshot } from "./SessionReplica"
import type { CloudSnapshotRecord } from "@shared/collaboration/cloudSnapshot"
import { LocalReplicaStore } from "./LocalReplicaStore"
import { CloudReplicaStore } from "./CloudReplicaStore"
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
// A rename reaches the watcher as a delete and a create; the delete waits this long for the new name.
const DEFAULT_RENAME_WINDOW_MS = 500
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
  repositoryCredentials?: RepositoryCredentialProvider
  pullRequests?: GitHubSessionPullRequest
  publicSessionId: string
  workspaceId: string
  workspaceRoot: string
  /** The session's 32-byte room key. */
  roomKey: Uint8Array
  roomKeyVersion?: number
  previousRoomKeys?: Readonly<Record<number, Uint8Array>>
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
  /** How long a deleted file waits for a new name, so a rename travels as one change. */
  renameWindowMs?: number
  connectorFactory?: (wsUrl: string) => RoomConnector
  fileEventSource?: FileEventSource
  /** Full rescans that stand in for file events when no native source runs; 0 turns them off. */
  rescanIntervalMs?: number
  submitDelayMs?: number
  materializeDelayMs?: number
  reconnectDelaysMs?: number[]
  maxTextFileBytes?: number
  /** Test/custom object transport. Production derives the encrypted object endpoint from the session ticket. */
  binaryObjectStore?: BinaryObjectClient
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
  readonly roomKeyVersion: number
  readonly workspaceId: string
  readonly workspaceRoot: string
  readonly replica: SessionReplica
  readonly transport: SessionTransport
  readonly roomClient: SessionRoomClient
  readonly index: MaterializationIndex
  readonly baselines: BaselineStore
  readonly binaryCache: BinaryContentCache
  readonly pendingBinaryStore: PendingBinaryStore
  readonly binaryObjects: BinaryObjectClient
  readonly queue: OutboundBatchQueue
  readonly watcher: WorkspaceFilesystemWatcher
  readonly target: TargetWatcher | null

  private readonly merger: SessionMerger | null
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
  private readonly renameWindowMs: number
  private readonly onStatus?: (status: ProjectdSessionStatus) => void
  private readonly onTicketNeeded?: () => void
  private readonly unsubscribeRemote: () => void

  private ticket: ProjectdSessionTicket
  private ticketRejected = false
  private ticketWaiters: TicketWaiter[] = []
  private hostState: ProjectdSessionState = "starting"
  private running = false
  private readonly replicaStore: LocalReplicaStore
  private snapshotTimer: NodeJS.Timeout | null = null
  private binaryReplayTimer: NodeJS.Timeout | null = null
  private recoveryLoaded = false
  private stopping = false
  private stopWork: Promise<void> | null = null
  // True until the first sync after attaching has brought folder and room together.
  private reconciling = true
  private offlineObservation = false
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
  // Deleted files waiting for a new name, by file id, with the bytes they last had on disk.
  private readonly pendingDeletes = new Map<string, { path: string; diskHash: string; timer: NodeJS.Timeout }>()
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
    this.roomKeyVersion = Math.max(1, Math.floor(options.roomKeyVersion ?? 1))
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
    this.renameWindowMs = options.renameWindowMs ?? DEFAULT_RENAME_WINDOW_MS
    this.onStatus = options.onStatus
    this.onTicketNeeded = options.onTicketNeeded

    const eventSource =
      options.fileEventSource ??
      (new NativeMacHelper().isAvailable ? new FSEventsClient(this.workspaceRoot) : null)
    this.rescanIntervalMs = options.rescanIntervalMs ?? (eventSource ? 0 : DEFAULT_RESCAN_WITHOUT_EVENTS_MS)

    this.replica = new SessionReplica(this.publicSessionId, options.clientId)
    this.replicaStore = new LocalReplicaStore(options.db, {
      sessionId: this.publicSessionId, roomKey: options.roomKey,
      roomKeyVersion: options.roomKeyVersion, previousRoomKeys: options.previousRoomKeys,
    })
    this.queue = new OutboundBatchQueue(options.db, {
      sessionId: this.publicSessionId,
      roomKey: options.roomKey,
      roomKeyVersion: options.roomKeyVersion,
      previousRoomKeys: options.previousRoomKeys,
    })
    this.transport = new SessionTransport({
      sessionId: this.publicSessionId,
      replica: this.replica,
      roomKey: options.roomKey,
      roomKeyVersion: options.roomKeyVersion,
      previousRoomKeys: options.previousRoomKeys,
    })
    this.roomClient = new SessionRoomClient({
      loadSnapshot: (record) => new CloudReplicaStore(this.publicSessionId, this.binaryObjects).download(record),
      transport: this.transport,
      connect: (handlers) => this.connectorFactory(this.ticket.wsUrl)(handlers),
      getToken: () => this.currentToken(),
      onAcknowledged: (batchId, sessionSeq) => this.handleAcknowledged(batchId, sessionSeq),
      onStateChange: (state) => this.handleConnectionState(state),
      onAutoGitState: (state) => this.autoGit?.handleRoomState(state),
      onCheckpointRequested: () => this.autoGit?.handleCheckpointRequested(),
      onRebaseRequested: (allowConflicts) => this.autoGit?.handleRebaseRequested(allowConflicts),
    })
    this.index = new MaterializationIndex(options.db)
    this.baselines = new BaselineStore({ db: options.db, sessionId: this.publicSessionId })
    this.binaryCache = new BinaryContentCache({ db: options.db })
    this.pendingBinaryStore = new PendingBinaryStore(options.db, {
      sessionId: this.publicSessionId, roomKey: options.roomKey,
      roomKeyVersion: options.roomKeyVersion, previousRoomKeys: options.previousRoomKeys,
    })
    this.binaryObjects =
      options.binaryObjectStore ??
      new SessionBinaryObjectStore({
        sessionId: this.publicSessionId,
        roomKey: options.roomKey,
        roomKeyVersion: options.roomKeyVersion,
        previousRoomKeys: options.previousRoomKeys,
        getRoomUrl: () => this.ticket.wsUrl,
        getToken: () => this.currentToken(),
      })
    this.adapter = new ExternalSnapshotAdapter({ replica: this.replica, baselineStore: this.baselines })
    this.materializer = new FilesystemMaterializer({
      workspaceRoot: this.workspaceRoot,
      sessionId: this.publicSessionId,
      replica: this.replica,
      index: this.index,
      baselineStore: this.baselines,
      resolveBinary: (revision) => this.resolveBinaryRevision(revision),
      streamBinary: async (revision, write) => {
        if (await this.binaryCache.copyVerifiedTo(revision.contentHash, revision.size, write)) return
        if (!revision.manifest) {
          throw new SessionHostError(
            "BINARY_MANIFEST_MISSING",
            `Binary revision ${revision.revisionId} has no chunk manifest and is not in the local cache`,
          )
        }
        if (!this.binaryObjects.downloadTo) {
          await write(await this.resolveBinaryRevision(revision))
          return
        }
        await this.binaryCache.putFrom({
          contentHash: revision.contentHash,
          size: revision.size,
          stream: async (cacheWrite) => {
            await this.binaryObjects.downloadTo!(revision.manifest!, async (chunk) => {
              await cacheWrite(chunk)
              await write(chunk)
            })
          },
        })
      },
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
            repositoryCredentials: options.repositoryCredentials,
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
            persistReplicaSnapshot: async (generation, snapshot) => {
              if (!snapshot.replicaSnapshot) throw new Error("Missing barrier replica state")
              const record = await new CloudReplicaStore(this.publicSessionId, this.binaryObjects).upload({
                sessionSeq: snapshot.sessionSeq, barrierId: snapshot.barrierId, keyVersion: this.roomKeyVersion,
              }, snapshot.replicaSnapshot)
              await this.roomClient.publishSnapshot(generation, record)
            },
            applySessionChanges: (changes, integration) => this.applySessionChanges(changes, integration),
            recoverIntegration: (adoptionId, generation) => this.exclusive(() => this.recoverIntegration(adoptionId, generation)),
            completeIntegration: (adoptionId) => {
              for (const queued of this.queue.getIntegrationBatches(this.publicSessionId)) if (queued.integration?.adoptionId === adoptionId) this.queue.removeIntegration(queued.batchId)
            },
            resolveBinaryStreamContent: async (revision, write) => {
              if (await this.binaryCache.copyVerifiedTo(revision.contentHash, revision.size, write)) {
                return { size: revision.size, contentHash: revision.contentHash }
              }
              if (!revision.manifest) {
                throw new SessionHostError(
                  "BINARY_MANIFEST_MISSING",
                  `Binary revision ${revision.revisionId} has no chunk manifest and is not in the local cache`,
                )
              }
              if (!this.binaryObjects.downloadTo) {
                throw new SessionHostError(
                  "STREAMING_UNAVAILABLE",
                  `Binary revision ${revision.revisionId} needs a streaming object source for checkpoints.`,
                )
              }
              await this.binaryCache.putFrom({
                contentHash: revision.contentHash,
                size: revision.size,
                stream: async (cacheWrite) => {
                  await this.binaryObjects.downloadTo!(revision.manifest!, async (chunk) => {
                    await cacheWrite(chunk)
                    await write(chunk)
                  })
                },
              })
              return { size: revision.size, contentHash: revision.contentHash }
            },
            targetBranch: options.targetBranch?.trim() || null,
            onChange: () => this.emitStatusSoon(),
            timing: options.autoGitTiming,
          })
        : null
    const targetBranch = options.targetBranch?.trim() || null
    this.target =
      this.branchName && targetBranch && targetBranch !== this.branchName && options.gitService
        ? new TargetWatcher({
            repositoryCredentials: options.repositoryCredentials,
            workspaceRoot: this.workspaceRoot,
            branchName: this.branchName,
            targetBranch,
            gitService: options.gitService,
            sessionStartedAt: options.sessionStartedAt,
            intervalMs: options.targetCheckIntervalMs,
            onChange: () => this.emitStatusSoon(),
          })
        : null
    this.merger =
      this.branchName && targetBranch && targetBranch !== this.branchName && options.gitService
        ? new SessionMerger({
            repositoryCredentials: options.repositoryCredentials,
            pullRequests: options.pullRequests,
            workspaceRoot: this.workspaceRoot,
            branchName: this.branchName,
            targetBranch,
            gitService: options.gitService,
          })
        : null
    this.watcher.on("event", (event: NormalizedFsEvent) => this.handleFileEvent(event))
    this.unsubscribeRemote = this.replica.onRemoteChange((fileIds) => {
      this.scheduleMaterialize(fileIds)
      this.scheduleSnapshot()
      this.noteSessionActivity()
    })
  }

  get canWrite(): boolean {
    return this.ticket.role !== "viewer"
  }

  get state(): ProjectdSessionState {
    return this.hostState
  }

  /** Readiness of the local workspace is independent of a temporary room outage. */
  get workspaceReady(): boolean {
    return this.running && !this.stopping && this.recoveryLoaded && !this.reconciling && !this.gitPause && this.hostState !== "failed"
  }

  /** Connects, then brings folder and room together. Later failures retry on their own. */
  async start(offline = false): Promise<void> {
    if (this.running || this.hostState === "stopped" || this.hostState === "failed") return
    this.running = true
    this.emitStatus()
    try {
      const recovered = this.replicaStore.load()
      if (recovered) {
        this.replica.restoreSnapshot(recovered.replica)
        this.transport.lastAppliedSessionSeq = recovered.sequence
        this.transport.lastDurableSessionSeq = recovered.sequence
      }
      // Own batches the room had not acknowledged when the daemon last stopped (Section 13.9).
      for (const queued of this.queue.getPendingBatches(this.publicSessionId)) {
        this.replica.applyBatch(queued.batch)
        this.roomClient.submitBatch(queued.batch)
      }
      this.recoveryLoaded = true
    } catch (error) {
      this.fail("QUEUE_UNREADABLE", error)
      return
    }
    if (offline) {
      try {
        await this.exclusive(() => this.startOfflineObservation())
        if (this.running && !this.stopping) this.setState("reconnecting")
      } catch (error) { this.fail("OFFLINE_RECOVERY_FAILED", error) }
      return
    }
    await this.connectAndReconcile()
  }

  private async startOfflineObservation(): Promise<void> {
    if (!this.replicaStore.load() || !this.index.matchesFolder(this.publicSessionId, this.workspaceId, this.workspaceRoot)) return
    // Without a durable identity/baseline for existing files, an offline scan
    // could misclassify retained CRDT state as a new disk edit or deletion.
    for (const entry of this.replica.tree.listLiveEntries()) {
      const indexed = this.index.getByFileId(this.publicSessionId, entry.fileId)
      if (!indexed || indexed.relativePath !== entry.path || (entry.kind === "text" && !this.baselines.getBaseline(entry.fileId))) return
    }
    if (await this.pauseIfFolderLeftBranch()) return
    this.offlineObservation = true
    this.reconcileEvents = []
    await this.watcher.start()
    const events = this.reconcileEvents
    this.reconcileEvents = null
    if (!this.running || this.stopping || this.gitPause) {
      this.watcher.stop()
      return
    }
    for (const event of events) await this.ingest(event)
    await this.commitPendingDeletes()
    this.flushSubmit()
    this.persistSnapshot()
    this.reconciling = false
    if (this.rescanIntervalMs > 0 && !this.rescanTimer) {
      this.rescanTimer = setInterval(() => void this.rescan(), this.rescanIntervalMs)
    }
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
    if (!this.running || this.stopping || this.reconciling || this.gitPause || !this.canWrite) return
    await this.watcher.rescan()
  }

  /** Resolves once queued ingestion and materialization have run and changes were submitted. */
  async flush(): Promise<void> {
    await this.exclusive(async () => {
      // Queued ingestion can create deletes and materialization work. Inspect
      // those queues after ingestion, not before waiting for it.
      await this.commitPendingDeletes()
      if (this.materializeTimer) {
        clearTimeout(this.materializeTimer)
        this.materializeTimer = null
      }
      // Before reconciliation, disk may contain edits absent from the recovered
      // replica. Shutdown must preserve those bytes for the next reconciliation.
      if (!this.reconciling && !this.offlineObservation && this.pendingMaterialize.size > 0) await this.materializePending()
      this.flushSubmit()
      this.persistSnapshot()
    })
  }

  /** Retains local work before participant membership is removed. */
  async prepareLeave(): Promise<{ pendingBatches: number; pendingBinaryVersions: number }> {
    if (!this.running || this.stopping || !this.recoveryLoaded) {
      throw new SessionHostError("NOT_READY", "The session must finish loading its recovery data before leaving.")
    }
    await this.rescan()
    await this.flush()
    try {
      await this.awaitRoomAcknowledgements()
    } catch {
      // The encrypted outbox and snapshot already retain this device's work.
      // Room availability must not turn participant Leave into data deletion.
    }
    return { pendingBatches: this.queue.pendingCount(this.publicSessionId), pendingBinaryVersions: this.pendingBinaryStore.count() }
  }

  /** Global pause requires a durable room frontier; unavailable Git is reported as lag. */
  async pauseSession(): Promise<{ gitLag: boolean }> {
    if (this.ticket.role !== "project_manager") {
      throw new SessionHostError("FORBIDDEN", "Only a session manager can pause collaboration.")
    }
    if (!this.running || this.stopping || this.reconciling || !this.recoveryLoaded) {
      throw new SessionHostError("NOT_READY", "Wait for the session to finish loading before pausing.")
    }
    // A retry must finish an existing fence, not try to replace its snapshot.
    let fence = await this.roomClient.getLifecycleFence()
    if (fence && fence.intent !== "pause") {
      throw new SessionHostError("LIFECYCLE_PENDING", "Another lifecycle transition is already in progress.")
    }
    if (!fence) {
      await this.rescan()
      await this.flush()
      await this.awaitRoomAcknowledgements()
      try {
        if (this.autoGit) {
          await this.autoGit.freshCheckpoint()
        } else {
          // A device without Git can still ask another eligible participant.
          const request = await this.roomClient.requestFreshCheckpoint()
          const deadline = Date.now() + 60_000
          while (request.routed && this.running && !this.stopping && Date.now() < deadline) {
            if ((this.roomClient.autoGitState?.checkpoint?.confirmedAt ?? 0) > request.serverTime) break
            await delay(25)
          }
        }
      } catch {
          // Git availability must not block a durable cloud pause. The fence's
          // checkpoint frontier tells every participant whether Git is behind.
      }
      const snapshot = await this.publishDurableSnapshot()
      fence = await this.roomClient.prepareLifecycleFence("pause", snapshot.barrierId)
    }
    await this.roomClient.commitLifecycleFence(fence.fenceId)
    return { gitLag: fence.gitSavedThroughSeq === null || fence.gitSavedThroughSeq < fence.sessionSeq }
  }

  private closeReview: ProjectdClosePreflight | null = null

  /** Reviews one cloud-durable frontier; later edits require a new review. */
  async prepareClose(): Promise<ProjectdClosePreflight> {
    if (this.ticket.role !== "project_manager" || !this.running || this.stopping || this.reconciling) {
      throw new SessionHostError("NOT_READY", "A session manager must open the live session before reviewing its closure.")
    }
    this.closeReview = null
    const fence = await this.roomClient.getLifecycleFence()
    if (fence && fence.intent !== "close") throw new SessionHostError("LIFECYCLE_PENDING", "Resolve the existing pause before closing.")
    const snapshot = fence ? await this.roomClient.getSnapshot() : await this.publishDurableSnapshot()
    if (!snapshot || (fence && fence.barrierId !== snapshot.barrierId)) {
      throw new SessionHostError("SNAPSHOT_UNAVAILABLE", "A retained cloud snapshot is required to close this session.")
    }
    const checkpoint = this.roomClient.autoGitState?.checkpoint
    const savedThrough = checkpoint ? checkpoint.savedThroughSeq ?? checkpoint.sessionSeq : null
    const detected = this.replica.detectConflicts()
    let merge: ProjectdMergePreview | null = null
    let mergeUnavailable: string | null = "No Git target is available on this device."
    if (this.merger && checkpoint) {
      try {
        merge = await this.merger.preview({ checkpointOid: checkpoint.commitOid,
          unsavedChanges: Math.max(0, snapshot.sessionSeq - (savedThrough ?? 0)) })
        mergeUnavailable = null
      } catch {
        mergeUnavailable = "The latest checkpoint could not be compared with the target branch."
      }
    }
    if (this.transport.lastAppliedSessionSeq !== snapshot.sessionSeq || this.replica.hasUnexportedChanges() || this.roomClient.pendingBatchCount > 0) {
      throw new SessionHostError("REVIEW_CHANGED", "The session changed while preparing this review. Review it again.")
    }
    const review: ProjectdClosePreflight = {
      publicSessionId: this.publicSessionId,
      reviewId: snapshot.barrierId, sessionSeq: snapshot.sessionSeq, gitSavedThroughSeq: savedThrough,
      gitLag: savedThrough === null || savedThrough < snapshot.sessionSeq,
      conflicts: { pathCollisions: detected.pathCollisions.length, concurrentRenames: detected.concurrentRenames.length,
        deleteModify: detected.deleteModifyConflicts.length, binary: detected.binaryConflicts.length },
      merge, mergeUnavailable,
    }
    this.closeReview = review
    return review
  }

  async closeSession(choice: ProjectdCloseChoice): Promise<{ gitLag: boolean }> {
    const review = this.closeReview
    if (this.ticket.role !== "project_manager" || !review || review.reviewId !== choice.reviewId) {
      throw new SessionHostError("REVIEW_REQUIRED", "Review the session's retained state before closing it.")
    }
    if (review.gitLag && choice.allowUnpublishedGit !== true) {
      throw new SessionHostError("UNPUBLISHED_GIT", "Choose whether to close with changes retained in cloud storage but not saved to Git.")
    }
    if (Object.values(review.conflicts).some((count) => count > 0) && choice.allowUnresolvedConflicts !== true) {
      throw new SessionHostError("UNRESOLVED_CONFLICTS", "Choose whether to retain the unresolved conflicts when closing.")
    }
    const existing = await this.roomClient.getLifecycleFence()
    if (existing) {
      if (existing.intent !== "close" || existing.sessionSeq !== review.sessionSeq) {
        throw new SessionHostError("REVIEW_CHANGED", "Another lifecycle transition replaced this review.")
      }
      await this.roomClient.commitLifecycleFence(existing.fenceId)
      return { gitLag: existing.gitSavedThroughSeq === null || existing.gitSavedThroughSeq < existing.sessionSeq }
    }
    await this.rescan()
    await this.flush()
    await this.awaitRoomAcknowledgements()
    if (this.transport.lastAppliedSessionSeq !== review.sessionSeq || this.replica.hasUnexportedChanges() || this.roomClient.pendingBatchCount > 0) {
      this.closeReview = null
      throw new SessionHostError("REVIEW_CHANGED", "New changes arrived after review. Review them before closing.")
    }
    // A later snapshot of the same accepted frontier does not change the review.
    const snapshot = await this.roomClient.getSnapshot()
    if (!snapshot || snapshot.sessionSeq !== review.sessionSeq) {
      this.closeReview = null
      throw new SessionHostError("REVIEW_CHANGED", "The retained session frontier changed. Review it again.")
    }
    const fence = await this.roomClient.prepareLifecycleFence("close", snapshot.barrierId, choice.allowUnpublishedGit)
    await this.roomClient.commitLifecycleFence(fence.fenceId)
    return { gitLag: fence.gitSavedThroughSeq === null || fence.gitSavedThroughSeq < fence.sessionSeq }
  }

  /** Retains a full replica in encrypted cloud storage, independently of AutoGit availability. */
  async publishDurableSnapshot(): Promise<CloudSnapshotRecord> {
    if (!this.running || this.stopping || this.reconciling || !this.recoveryLoaded || !this.canWrite) {
      throw new SessionHostError("NOT_READY", "A writable, hydrated session is required to retain a cloud snapshot.")
    }
    if (!this.roomClient.supportsSnapshots) {
      throw new SessionHostError("SNAPSHOTS_UNAVAILABLE", "The session service does not support durable cloud snapshots.")
    }
    await this.rescan()
    await this.flush()
    const captured = await this.exclusive(async () => {
      await this.flushAndAwaitAcks()
      const state: { replica?: ReplicaSnapshot } = {}
      const barrier = await this.roomClient.requestSnapshotBarrier((frontier) => {
        if (this.transport.lastAppliedSessionSeq === frontier.sessionSeq && !this.replica.hasUnexportedChanges()) {
          state.replica = this.replica.captureSnapshot()
        }
      })
      if (!state.replica) throw new SessionHostError("NOT_AT_BARRIER", "Catch up with the session before retaining its snapshot.")
      return { barrier, replica: state.replica }
    })
    const record = await new CloudReplicaStore(this.publicSessionId, this.binaryObjects).upload({
      sessionSeq: captured.barrier.sessionSeq, barrierId: captured.barrier.barrierId, keyVersion: this.roomKeyVersion,
    }, captured.replica)
    return this.roomClient.publishSnapshot(0, record)
  }

  /** Saves the session to its branch now, or asks the device that saves to (Section 15.1). */
  async checkpointNow(): Promise<ProjectdCheckpointResult> {
    if (!this.autoGit) {
      throw new SessionHostError("AUTOGIT_OFF", "This session has no Git branch to save to.")
    }
    if (!this.running || this.stopping || this.reconciling) {
      throw new SessionHostError(
        "NOT_READY",
        this.gitPause ?? "This folder is still syncing with the session. Save again once it is live.",
      )
    }
    // Native watcher delivery can lag behind an editor's completed disk write.
    // An explicit save must capture that write before asking the leader to save.
    await this.rescan()
    await this.flush()
    await this.flushAndAwaitAcks()
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

  /** Previews merging the session's last save into its target branch (P22). */
  async previewMerge(): Promise<ProjectdMergePreview> {
    const merger = this.requireMerger()
    if (!this.autoGit || !this.running || this.reconciling) {
      throw new SessionHostError("NOT_READY", "Wait for the session to finish syncing before reviewing a merge.")
    }
    // A filesystem event may still be inside the watcher's debounce window.
    // Discover the current disk bytes before requesting the immutable barrier.
    await this.rescan()
    await this.flush()
    const checkpoint = await this.autoGit.freshCheckpoint()
    return merger.preview({ ...this.mergeInput(), checkpointOid: checkpoint.commitOid })
  }

  /** Merges the reviewed save into the target branch, or says why not (P22). */
  async createPullRequest(reviewedCheckpointOid: string, reviewedTargetOid: string) {
    if (!this.canWrite) throw new SessionHostError("FORBIDDEN", "Viewers can't create session pull requests.")
    if (!this.running || !this.workspaceReady || this.reconciling) throw new SessionHostError("NOT_READY", "Wait for the session to finish syncing.")
    await this.rescan()
    await this.flush()
    if (!this.canWrite) throw new SessionHostError("FORBIDDEN", "Session write access changed.")
    return this.requireMerger().createPullRequest({ ...this.mergeInput(), reviewedCheckpointOid, reviewedTargetOid })
  }

  merge(strategy: ProjectdMergeStrategy, reviewedCheckpointOid: string, reviewedTargetOid: string): Promise<ProjectdMergeResult> {
    if (!this.canWrite) throw new SessionHostError("FORBIDDEN", "Viewers can't merge the session.")
    return this.requireMerger().merge({ ...this.mergeInput(), strategy, reviewedCheckpointOid, reviewedTargetOid })
  }

  /** Rebases the session onto its target on the Mac that saves it (P21); only ever when someone asked. */
  rebase(allowConflicts: boolean): Promise<ProjectdRebaseResult> {
    if (!this.canWrite) throw new SessionHostError("FORBIDDEN", "Viewers can't rebase the session.")
    if (!this.autoGit) throw new SessionHostError("AUTOGIT_OFF", "This session isn't saved to a Git branch.")
    return this.autoGit.requestRebase(allowConflicts)
  }

  manageRebaseRecovery(request: unknown) {
    const action = (request as { action?: unknown } | null)?.action
    if (!this.canWrite && action !== "list" && action !== "review") throw new SessionHostError("FORBIDDEN", "Viewers cannot resolve rebases")
    if (!this.autoGit) throw new SessionHostError("AUTOGIT_OFF", "This session has no Git repository")
    return this.autoGit.manageRebaseRecovery(request)
  }

  manageBinaryConflicts(request: unknown): Promise<ProjectdBinaryConflictResponse> {
    return this.exclusive(async () => {
      if (!request || typeof request !== "object") throw new SessionHostError("INVALID_REQUEST", "A conflict review or resolution is required.")
      const input = request as Record<string, unknown>
      const fingerprint = (fileId: string) => {
        const entry = this.liveEntryById(fileId)
        return entry ? sha256(sessionFileFingerprint(this.replica, entry.path)) : "absent"
      }
      const list = (after = ""): ProjectdBinaryConflictResponse => {
        const entries = this.replica.tree.listLiveEntries().filter((entry) => entry.kind === "binary" && entry.fileId > after && this.replica.binaryStore.detectConcurrentRevisions(entry.fileId))
          .sort((a, b) => a.fileId < b.fileId ? -1 : 1)
        return { nextFileId: entries.length > 100 ? entries[99]!.fileId : null,
          conflicts: entries.slice(0, 100).map((entry) => {
            const variants = this.replica.binaryStore.getFrontier(entry.fileId)
            if (variants.length > 128) throw new SessionHostError("CONFLICT_TOO_LARGE", "This file has more than 128 alternatives and needs an extended review.")
            return { fileId: entry.fileId, path: entry.path, fingerprint: fingerprint(entry.fileId),
              variants: variants.map(({ revisionId, contentHash, size, createdAt }) => ({ revisionId, contentHash, size, createdAt })) }
          }) }
      }
      if (input.action === "list") {
        if (input.afterFileId !== undefined && (typeof input.afterFileId !== "string" || input.afterFileId.length > 256)) throw new SessionHostError("INVALID_REQUEST", "Invalid conflict page cursor.")
        return list(input.afterFileId as string | undefined)
      }
      if (!["resolve", "preview", "export"].includes(String(input.action)) || typeof input.fileId !== "string" || typeof input.revisionId !== "string" || typeof input.fingerprint !== "string" ||
        input.fileId.length > 256 || input.revisionId.length > 256 || input.fingerprint.length !== 64) throw new SessionHostError("INVALID_REQUEST", "Invalid binary resolution.")
      const previewOnly = input.action !== "resolve"
      if (!previewOnly && !this.canWrite) throw new SessionHostError("FORBIDDEN", "Viewers cannot resolve session conflicts.")
      const assertReady = () => {
        if (!this.workspaceReady || (!previewOnly && (!this.canWrite || this.pendingBinaryStore.count() > 0))) throw new SessionHostError("SESSION_NOT_READY", "Wait for local file changes to finish before reviewing versions.")
        const entry = this.liveEntryById(input.fileId as string)
        if (entry?.kind !== "binary" || fingerprint(entry.fileId) !== input.fingerprint || !this.replica.binaryStore.detectConcurrentRevisions(entry.fileId)) {
          throw new SessionHostError("CONFLICT_CHANGED", "The conflict changed. Review its current versions before resolving.")
        }
        return entry
      }
      const entry = assertReady()
      const frontier = this.replica.binaryStore.getFrontier(entry.fileId)
      const chosen = frontier.find((revision) => revision.revisionId === input.revisionId)
      if (!chosen) throw new SessionHostError("CONFLICT_CHANGED", "Choose one of the reviewed versions.")
      if (input.action === "export") {
        if (typeof input.destinationDirectory !== "string" || !path.isAbsolute(input.destinationDirectory)) throw new SessionHostError("INVALID_REQUEST", "Choose an export folder.")
        const directory = await fs.realpath(input.destinationDirectory)
        const workspace = await fs.realpath(this.workspaceRoot)
        if (directory === workspace || directory.startsWith(workspace + path.sep)) throw new SessionHostError("INVALID_EXPORT_FOLDER", "Choose a folder outside this session workspace.")
        assertReady()
        const exportRoot = await fs.mkdtemp(path.join(directory, "cozea-version-"))
        try {
          await fs.chmod(exportRoot, 0o700)
          const exportedPath = path.join(exportRoot, path.basename(entry.path))
          const handle = await fs.open(exportedPath, "wx", 0o600)
          try {
            let offset = 0
            let outputHash = createHash("sha256")
            const write = async (chunk: Buffer) => {
              let consumed = 0
              while (consumed < chunk.length) {
                const { bytesWritten } = await handle.write(chunk, consumed, chunk.length - consumed, offset)
                if (!bytesWritten) throw new Error("Export write made no progress")
                consumed += bytesWritten; offset += bytesWritten
              }
              outputHash.update(chunk)
            }
            if (!await this.binaryCache.copyTo(chosen.contentHash, chosen.size, write)) {
              await handle.truncate(0)
              offset = 0
              outputHash = createHash("sha256")
              if (chosen.manifest && this.binaryObjects.downloadTo) await this.binaryObjects.downloadTo(chosen.manifest, write)
              else {
                if (chosen.size > 64 * 1024 * 1024) throw new SessionHostError("STREAMING_UNAVAILABLE", "This object source does not support streaming export.")
                await write(await this.resolveBinaryRevision(chosen))
              }
            }
            if (offset !== chosen.size || outputHash.digest("hex") !== chosen.contentHash) throw new SessionHostError("BINARY_DOWNLOAD_CORRUPT", "Export bytes differ from the reviewed revision.")
            assertReady()
            await handle.sync()
          } finally { await handle.close() }
          return { conflicts: [], nextFileId: null, exportedPath }
        } catch (error) {
          await fs.rm(exportRoot, { recursive: true, force: true })
          throw error
        }
      }
      if (chosen.size > 64 * 1024 * 1024) throw new SessionHostError("BINARY_TOO_LARGE", "Conflict resolution currently supports files up to 64 MiB.")
      // Verify availability before recording any resolution. Room updates can arrive during download.
      const bytes = await this.resolveBinaryRevision(chosen)
      if (previewOnly) {
        assertReady()
        const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
          : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : null
        return { conflicts: [], nextFileId: null, preview: { revisionId: chosen.revisionId, size: bytes.length,
          hex: bytes.subarray(0, 256).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "", truncated: bytes.length > 256,
          imageDataUrl: mime && bytes.length <= 512 * 1024 ? `data:${mime};base64,${bytes.toString("base64")}` : null } }
      }
      await this.ingestUnseenDiskEdit(entry)
      if (await this.pauseIfFolderLeftBranch()) throw new SessionHostError("SESSION_NOT_READY", "Return to the session branch before resolving.")
      assertReady()
      this.flushSubmit()
      const staged = new SessionReplica(this.publicSessionId, this.replica.clientId)
      staged.restoreSnapshot(this.replica.captureSnapshot())
      const resolved = staged.resolveBinaryConflict(entry.fileId, chosen.revisionId, frontier.map((revision) => revision.revisionId), this.actor)
      const batch = staged.exportBatch((pending) => this.queue.enqueue(pending))!
      this.replica.applyBatch(batch)
      this.roomClient.submitBatch(batch)
      this.persistSnapshot()
      await this.materializer.materializeFile(entry.fileId, Date.now())
      this.emitStatusSoon()
      return { conflicts: [], nextFileId: null, resolvedRevisionId: resolved.revisionId }
    })
  }

  manageStructuralConflicts(request: unknown): Promise<ProjectdStructuralConflictResponse> {
    return this.exclusive(async () => {
      if (!request || typeof request !== "object") throw new SessionHostError("INVALID_REQUEST", "A structural review is required.")
      const input = request as Record<string, unknown>
      const reviews = (): ProjectdStructuralConflictResponse["conflicts"] => {
        const conflicts = this.replica.detectConflicts()
        return this.replica.tree.listAllEntries().flatMap((entry) => {
          const kinds: ProjectdStructuralConflictResponse["conflicts"][number]["kinds"] = []
          if (conflicts.pathCollisions.some((item) => item.fileIds.includes(entry.fileId))) kinds.push("path_collision")
          const rename = conflicts.concurrentRenames.find((item) => item.fileId === entry.fileId)
          if (rename) kinds.push("concurrent_rename")
          if (conflicts.deleteModifyConflicts.some((item) => item.fileId === entry.fileId)) kinds.push("delete_modify")
          if (!kinds.length) return []
          const ops = this.replica.tree.listStructuralOps().filter((op) => op.fileId === entry.fileId).map((op) => op.opId).sort()
          const content = entry.kind === "text" ? Array.from(this.replica.textDocs.getStateVector(entry.fileId))
            : this.replica.binaryStore.getRevisions(entry.fileId).map((revision) => revision.revisionId).sort()
          return [{ fileId: entry.fileId, path: entry.path, deleted: entry.deleted, kinds,
            textPreview: entry.kind === "text" ? this.replica.textDocs.getTextContent(entry.fileId).slice(0, 2000) : entry.kind === "symlink" ? (entry.symlinkTarget ?? "").slice(0, 2000) : undefined,
            alternatives: [...new Set(rename?.ops.map((op) => op.toPath!).filter(Boolean) ?? [])],
            fingerprint: sha256(JSON.stringify([entry, ops, content])) }]
        }).sort((a, b) => a.fileId < b.fileId ? -1 : 1)
      }
      if (input.action === "list") {
        if (input.afterFileId !== undefined && (typeof input.afterFileId !== "string" || input.afterFileId.length > 256)) throw new SessionHostError("INVALID_REQUEST", "Invalid page cursor.")
        const rows = reviews().filter((item) => item.fileId > (input.afterFileId as string ?? ""))
        return { conflicts: rows.slice(0, 100), nextFileId: rows.length > 100 ? rows[99]!.fileId : null }
      }
      if (input.action !== "resolve" || typeof input.fileId !== "string" || typeof input.fingerprint !== "string" ||
        !["rename", "restore", "delete"].includes(String(input.choice))) throw new SessionHostError("INVALID_REQUEST", "Invalid structural resolution.")
      if (!this.canWrite) throw new SessionHostError("FORBIDDEN", "Viewers cannot resolve session conflicts.")
      const assertReview = () => {
        if (!this.workspaceReady || !this.canWrite || this.pendingBinaryStore.count()) throw new SessionHostError("SESSION_NOT_READY", "Wait for local changes to finish before resolving.")
        const row = reviews().find((item) => item.fileId === input.fileId)
        if (!row || row.fingerprint !== input.fingerprint) throw new SessionHostError("CONFLICT_CHANGED", "The conflict changed. Review its current state.")
        return row
      }
      const reviewed = assertReview()
      const entry = this.replica.tree.getEntry(reviewed.fileId)!
      const destination = input.path === undefined ? entry.path : typeof input.path === "string" ? normalizeProjectPath(input.path) : ""
      if (!destination) throw new SessionHostError("INVALID_REQUEST", "Choose a valid destination path.")
      if (input.choice === "restore" && !entry.deleted) throw new SessionHostError("CONFLICT_CHANGED", "This file is already present.")
      if (input.choice === "rename" && entry.deleted) throw new SessionHostError("INVALID_REQUEST", "Restore this deleted file to a chosen path.")
      const validateDestination = () => {
        if (input.choice !== "delete" && this.replica.tree.listLiveEntries().some((other) => other.fileId !== entry.fileId &&
          ConflictEngine.normalizeForVolumeComparison(other.path) === ConflictEngine.normalizeForVolumeComparison(destination))) {
          throw new SessionHostError("PATH_OCCUPIED", "Another session file uses this path. Choose a different destination.")
        }
      }
      validateDestination()
      const absolute = await resolveWorkspaceFilePath(this.workspaceRoot, destination)
      const disk = await fs.lstat(absolute).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error })
      const indexed = this.index.getByFileId(this.publicSessionId, entry.fileId)
      if (input.choice !== "delete" && disk && (destination !== entry.path || indexed?.relativePath !== destination)) throw new SessionHostError("PATH_OCCUPIED", "This destination contains local work. Choose an empty path.")
      if (!entry.deleted) await this.ingestUnseenDiskEdit(entry)
      if (input.choice !== "delete" && entry.kind === "binary") {
        const head = this.replica.binaryStore.getHeadRevision(entry.fileId)
        if (head && !this.replica.binaryStore.detectConcurrentRevisions(entry.fileId)) await this.resolveBinaryRevision(head)
      }
      if (await this.pauseIfFolderLeftBranch()) throw new SessionHostError("SESSION_NOT_READY", "Return to the session branch before resolving.")
      assertReview()
      validateDestination()
      this.flushSubmit()
      const staged = new SessionReplica(this.publicSessionId, this.replica.clientId)
      staged.restoreSnapshot(this.replica.captureSnapshot())
      const rename = staged.detectConflicts().concurrentRenames.find((item) => item.fileId === entry.fileId)
      if (rename) staged.tree.resolveRenames(entry.fileId, destination, rename.ops.map((op) => op.opId), this.actor)
      if (input.choice === "delete") staged.deleteFile(entry.fileId, this.actor, true)
      else {
        if (entry.deleted) staged.tree.restoreEntry(entry.fileId, this.actor)
        staged.renameFile(entry.fileId, destination, this.actor)
      }
      const batch = staged.exportBatch((pending) => this.queue.enqueue(pending))!
      this.replica.applyBatch(batch)
      this.roomClient.submitBatch(batch)
      this.persistSnapshot()
      this.scheduleMaterialize([entry.fileId])
      await this.materializePending()
      return { conflicts: [], nextFileId: null }
    })
  }

  private mergeInput(): { checkpointOid: string | null; unsavedChanges: number } {
    const autoGit = this.autoGit?.status() ?? null
    return { checkpointOid: autoGit?.lastCheckpoint?.commitOid ?? null, unsavedChanges: autoGit?.unsavedChanges ?? 0 }
  }

  private requireMerger(): SessionMerger {
    if (!this.merger) throw new SessionHostError("NO_TARGET", "This session has no branch to merge into.")
    return this.merger
  }

  stop(): Promise<void> {
    if (this.stopWork) return this.stopWork
    if (this.hostState === "stopped") return Promise.resolve()
    this.stopping = true
    this.watcher.stop()
    this.autoGit?.stop()
    this.target?.stop()
    this.stopWork = this.finishStop()
    return this.stopWork
  }

  private async finishStop(): Promise<void> {
    try {
      // Keep ingestion and materialization alive until already-admitted work is
      // in the durable outbox. Teardown would otherwise make it a no-op.
      await this.flush()
      await waitAtMost(this.autoGit?.settled(), AUTOGIT_STOP_WAIT_MS)
    } finally {
      this.teardown()
      await this.work
      if (this.statusTimer) {
        clearTimeout(this.statusTimer)
        this.statusTimer = null
      }
      this.setState("stopped")
    }
  }

  status(): ProjectdSessionStatus {
    return {
      publicSessionId: this.publicSessionId,
      workspaceId: this.workspaceId,
      rootPath: this.workspaceRoot,
      state: this.hostState,
      role: this.ticket.role ?? "developer",
      lastAppliedSessionSeq: this.transport.lastAppliedSessionSeq,
      pendingBatches: this.queue.pendingCount(this.publicSessionId),
      pendingBinaryVersions: this.pendingBinaryStore.count(),
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
    if (!this.running || this.stopping) return
    if (this.offlineObservation) await this.exclusive(async () => {
      this.watcher.stop()
      this.flushSubmit()
      this.persistSnapshot()
      this.offlineObservation = false
      this.reconciling = true
    })
    const gitDir = await this.resolveGitDir()
    if (!this.running || this.stopping) return
    if (gitDir && !this.gitPollTimer) {
      this.gitPollTimer = setInterval(() => void this.checkGit(), this.gitPollMs)
    }
    try {
      await this.roomClient.connect()
    } catch (error) {
      if (!this.running) return
      this.recordError("ROOM_UNREACHABLE", error)
      this.scheduleReconnect()
      return
    }
    await this.reconcileNow()
    await this.enqueue(() => this.replayPendingBinaries())
    this.scheduleBinaryReplay()
  }

  private scheduleBinaryReplay(): void {
    if (!this.running || this.stopping || this.binaryReplayTimer) return
    this.binaryReplayTimer = setTimeout(() => {
      this.binaryReplayTimer = null
      void this.enqueue(async () => {
        if (!this.running || this.stopping) return
        await this.replayPendingBinaries()
        if (!this.running || this.stopping) return
        if (this.pendingBinaryStore.count() > 0) this.scheduleBinaryReplay()
      }).catch((error) => {
        if (!this.running || this.stopping) return
        this.recordError("BINARY_RECOVERY_FAILED", error)
      })
    }, 5_000)
  }

  /** Publish captured versions against their original bases, never a newer remote head. */
  private async replayPendingBinaries(duringReconciliation = false): Promise<void> {
    if (!this.running || this.stopping || !this.canWrite || (this.reconciling && !duringReconciliation) || this.gitPause || this.roomClient.state !== "live") return
    for (const staged of this.pendingBinaryStore.list()) {
      if (!this.running || this.stopping || this.roomClient.state !== "live") return
      const alreadyPublished = this.replica.tree.listAllEntries().some((entry) =>
        this.replica.binaryStore.getRevisions(entry.fileId).some((revision) => revision.revisionId === staged.revisionId))
      if (!alreadyPublished) {
        const manifest = await this.uploadStagedBinary(staged).catch((error: unknown) => {
          // An interrupted upload must stay resumable, never fail the host: the
          // durable capture is retained and the replay timer picks it back up.
          this.recordError("BINARY_UPLOAD_DEFERRED", error)
          this.scheduleBinaryReplay()
          return null
        })
        if (!manifest) continue
        if (!this.running || this.stopping || !this.canWrite || await this.pauseIfFolderLeftBranch()) return
        let entry = staged.fileId ? this.replica.tree.getEntry(staged.fileId) : null
        if (!entry || entry.kind !== "binary") {
          // An uncommitted create/type change cannot take ownership of an
          // unrelated file that appeared at the same path while offline.
          const fileId = `recovered_${sha256(Buffer.from(JSON.stringify([this.publicSessionId, staged.fileId, staged.path])))}`
          entry = this.replica.tree.getEntry(fileId) ?? this.replica.tree.createEntry({
            fileId, path: staged.path, kind: "binary", mode: staged.mode, actor: this.actor,
          })
        }
        this.replica.addBinaryRevision({ revisionId: staged.revisionId, fileId: entry.fileId,
          baseRevisionId: staged.baseRevisionId, contentHash: staged.contentHash, size: staged.size,
          manifest, encryptedManifestRef: `inline:v1:${manifest.contentHash}`, actor: this.actor, createdAt: staged.createdAt })
        this.scheduleMaterialize([entry.fileId])
      }
      this.flushSubmit()
      this.persistSnapshot()
      this.pendingBinaryStore.remove(staged.revisionId)
    }
  }

  /** Uploads the exact durable capture; live-disk bytes are never reread here. */
  private async uploadStagedBinary(staged: PendingBinaryRecord) {
    const source = this.pendingBinaryStore.asSource(staged)
    let bufferedFallback: Buffer | null = null
    const manifest = this.binaryObjects.uploadFrom
      ? await this.binaryObjects.uploadFrom(source)
      : await this.binaryObjects.upload((bufferedFallback = this.pendingBinaryStore.readBytes(staged)))
    if (manifest.contentHash !== staged.contentHash || manifest.size !== staged.size) {
      throw new SessionHostError("BINARY_HASH_MISMATCH", "Retained binary upload did not match its captured version")
    }
    if (bufferedFallback) {
      const cached = await this.binaryCache.put(bufferedFallback)
      if (cached.contentHash !== staged.contentHash || cached.size !== staged.size) {
        throw new SessionHostError("BINARY_HASH_MISMATCH", "Retained binary cache did not match its captured version")
      }
    } else {
      await this.binaryCache.putFrom({
        contentHash: staged.contentHash,
        size: staged.size,
        stream: (write) => this.pendingBinaryStore.writeTo(staged, write),
      })
    }
    return manifest
  }

  /** Runs the first sync on the queue, unless it already ran. */
  private reconcileNow(): Promise<void> {
    if (!this.reconciling) return Promise.resolve()
    return this.enqueue(async () => {
      if (!this.reconciling || !this.running || this.stopping) return
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
    if (!this.running || this.stopping || this.reconnectTimer) return
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
    this.scheduleSnapshot()
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
    // Deletes that found no new name are deletes.
    await this.commitPendingDeletes()

    // Captured offline binary versions must participate in conflict detection
    // before any newer room version can replace the local bytes.
    await this.replayPendingBinaries(true)

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
      await this.ingestChange(item.relativePath, item.absolutePath)
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
      const absolutePath = await this.resolveEntryPath(entry.path)
      if (!absolutePath) continue
      const stat = await fs.lstat(absolutePath).catch(() => null)
      if (!stat) continue
      if (entry.kind === "binary") {
        // Bounded first-attach compare: stream the on-disk hash and compare it
        // with the session revision. A binary is never read whole merely to
        // decide whether the local copy matches. All fields come from the same
        // stable observation, never from the pre-read lstat.
        const head = this.replica.binaryStore.getHeadRevision(entry.fileId)
        const metadata = stat.isFile()
          ? await this.watcher.scanner.stableReader.readMetadata(absolutePath, { skipInitialDelay: true })
          : null
        const diskHash = metadata && metadata.exists && !metadata.isSymlink && metadata.contentHash !== undefined
          ? metadata.contentHash
          : null
        const diskMode = metadata && metadata.exists && !metadata.isSymlink && metadata.mode !== undefined
          ? metadata.mode
          : null
        const diskSize = metadata && metadata.exists && !metadata.isSymlink && metadata.size !== undefined
          ? metadata.size
          : null
        const diskMtimeMs = metadata && metadata.exists && !metadata.isSymlink && metadata.mtimeMs !== undefined
          ? metadata.mtimeMs
          : null
        if (!head || diskHash === null || diskMode === null || diskSize === null || diskMtimeMs === null ||
          diskHash !== head.contentHash || fileMode(diskMode) !== entry.mode) {
          differing.push(entry)
          continue
        }
        matching.push({ entry, diskHash, size: diskSize, mtimeMs: diskMtimeMs })
        continue
      }
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(absolutePath)
        if (entry.kind !== "symlink" || target !== entry.symlinkTarget) {
          differing.push(entry)
          continue
        }
        matching.push({ entry, diskHash: sha256(target), size: stat.size, mtimeMs: stat.mtimeMs })
        continue
      }
      if (!stat.isFile() || entry.kind !== "text") {
        differing.push(entry)
        continue
      }
      // Bounded text compare: stable metadata first, then a whole read only
      // below the text-size ceiling. Oversized text compares streamed hashes.
      const textMetadata = await this.watcher.scanner.stableReader.readMetadata(absolutePath, { skipInitialDelay: true })
      if (!textMetadata.exists || textMetadata.isSymlink || textMetadata.contentHash === undefined ||
        textMetadata.size === undefined || textMetadata.mtimeMs === undefined || textMetadata.mode === undefined) {
        differing.push(entry)
        continue
      }
      let textMatches: boolean
      if (textMetadata.size <= this.maxTextFileBytes) {
        // The bound travels into the read: a file that grows past the ceiling
        // between observations reports exceedsMaxBytes instead of allocating.
        const complete = await this.watcher.scanner.stableReader.read(absolutePath, {
          skipInitialDelay: true, maxBytes: this.maxTextFileBytes,
        })
        if (!complete.exists || complete.isSymlink || complete.exceedsMaxBytes || !complete.bytes ||
          complete.contentHash === undefined || complete.size === undefined ||
          complete.mtimeMs === undefined || complete.mode === undefined ||
          complete.size !== textMetadata.size || complete.contentHash !== textMetadata.contentHash) {
          differing.push(entry)
          continue
        }
        // One stable observation describes the accepted bytes throughout.
        textMatches = complete.bytes.toString("utf8") === this.replica.textDocs.getTextContent(entry.fileId)
        if (!textMatches || fileMode(complete.mode) !== entry.mode) {
          differing.push(entry)
          continue
        }
        matching.push({ entry, diskHash: complete.contentHash, size: complete.size, mtimeMs: complete.mtimeMs })
        continue
      }
      textMatches = textMetadata.contentHash === sha256(this.replica.textDocs.getTextContent(entry.fileId))
      if (!textMatches || fileMode(textMetadata.mode) !== entry.mode) {
        differing.push(entry)
        continue
      }
      matching.push({ entry, diskHash: textMetadata.contentHash, size: textMetadata.size, mtimeMs: textMetadata.mtimeMs })
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
      if (entry.kind === "text") this.adapter.initializeBaseline(entry.fileId)
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
    if (!indexed || indexed.relativePath !== entry.path || indexed.mode !== entry.mode) return true
    if (entry.kind === "symlink") return indexed.diskHash !== sha256(entry.symlinkTarget ?? "")
    if (entry.kind === "binary") {
      if (this.replica.binaryStore.detectConcurrentRevisions(entry.fileId)) return false
      const head = this.replica.binaryStore.getHeadRevision(entry.fileId)
      return Boolean(head && indexed.diskHash !== head.contentHash)
    }
    return indexed.diskHash !== sha256(this.replica.textDocs.getTextContent(entry.fileId))
  }

  // ─── Folder → session ────────────────────────────────────────────────────────

  private handleFileEvent(event: NormalizedFsEvent): void {
    if (!this.running || this.stopping || !this.canWrite || this.gitPause) return
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
      await this.ingestChange(event.relativePath, event.absolutePath)
    } else if (event.type === "delete") {
      await this.ingestDelete(event.relativePath, event.fileId)
    }
  }

  private async ingestChange(relativePath: string, absolutePath: string): Promise<void> {
    const filePath = toProjectPath(relativePath)
    if (!filePath) return
    const stat = await fs.lstat(absolutePath).catch(() => null)
    if (stat?.isSymbolicLink()) {
      const target = await fs.readlink(absolutePath).catch(() => null)
      if (target === null || await this.pauseIfFolderLeftBranch()) return
      const diskHash = sha256(target)
      const indexed = this.index.getByPath(this.publicSessionId, filePath)
      if (indexed?.kind === "symlink" && indexed.diskHash === diskHash) return
      let entry = this.findLiveEntry(filePath)
      if (entry && entry.kind !== "symlink") {
        this.replica.deleteFile(entry.fileId, this.actor)
        entry = null
      }
      if (!entry) {
        const renamedFrom = this.takeRenamedFrom(filePath, diskHash, "symlink")
        if (renamedFrom) entry = this.replica.renameFile(renamedFrom, filePath, this.actor)
      }
      entry = entry
        ? this.replica.tree.setSymlinkTarget(entry.fileId, target, this.actor)
        : this.replica.createFile({ path: filePath, kind: "symlink", symlinkTarget: target, mode: 0o120000, actor: this.actor })
      this.recordDiskState(entry, diskHash, stat)
      this.scheduleSubmit()
      return
    }
    if (!stat?.isFile()) return

    const metadata = await this.watcher.scanner.stableReader.readMetadata(absolutePath, { skipInitialDelay: true })
    if (!metadata.exists || metadata.isSymlink || metadata.contentHash === undefined || metadata.size === undefined ||
      metadata.mtimeMs === undefined || metadata.mode === undefined) return

    let diskHash = metadata.contentHash
    let diskStat = { mode: metadata.mode, size: metadata.size, mtimeMs: metadata.mtimeMs }
    let bytes: Buffer | null = null
    if (metadata.size <= this.maxTextFileBytes) {
      const complete = await this.watcher.scanner.stableReader.read(absolutePath, { skipInitialDelay: true })
      if (!complete.exists || complete.isSymlink || !complete.bytes || complete.contentHash === undefined || complete.size === undefined ||
        complete.mtimeMs === undefined || complete.mode === undefined) return
      bytes = complete.bytes
      diskHash = complete.contentHash
      diskStat = { mode: complete.mode, size: complete.size, mtimeMs: complete.mtimeMs }
    }

    // Read while Git switched branches, these bytes may belong to the other branch.
    if (await this.pauseIfFolderLeftBranch()) return
    const indexed = this.index.getByPath(this.publicSessionId, filePath)
    if (indexed?.kind !== "symlink" && indexed?.diskHash === diskHash) {
      const entry = this.findLiveEntry(filePath)
      if (entry && indexed.mode !== fileMode(diskStat.mode)) {
        const updated = this.replica.tree.chmodEntry(entry.fileId, fileMode(diskStat.mode), this.actor)
        this.recordDiskState(updated, diskHash, diskStat)
        this.flushSubmit()
      }
      return
    }

    const kind = diskStat.size > this.maxTextFileBytes || !bytes || TextDocRegistry.classifyContent(bytes) !== "text" ? "binary" : "text"
    if (kind === "binary") {
      if (bytes) {
        await this.ingestBinary(filePath, {
          contentHash: diskHash,
          size: bytes.length,
          read: async (offset, length) => bytes!.subarray(offset, offset + length),
        }, diskStat)
        return
      }
      const handle = await fs.open(absolutePath, "r").catch(() => null)
      if (!handle) return
      try {
        const source: PendingBinarySource = {
          contentHash: diskHash,
          size: diskStat.size,
          read: async (offset, length) => {
            const chunk = Buffer.allocUnsafe(length)
            let total = 0
            while (total < length) {
              const { bytesRead } = await handle.read(chunk, total, length - total, offset + total)
              if (!bytesRead) break
              total += bytesRead
            }
            return total === length ? chunk : chunk.subarray(0, total)
          },
        }
        await this.ingestBinary(filePath, source, diskStat)
      } finally {
        await handle.close()
      }
      return
    }

    const text = bytes!.toString("utf8")
    let entry = this.findLiveEntry(filePath)
    if (entry && entry.kind !== "text") {
      this.replica.deleteFile(entry.fileId, this.actor)
      entry = null
    }
    if (entry) {
      this.adapter.applyExternalDiskChange({ fileId: entry.fileId, diskText: text, actor: this.actor })
    } else {
      // The exact bytes of a file just deleted: that file, renamed (Section 10.19).
      const renamedFrom = this.takeRenamedFrom(filePath, diskHash, "text")
      if (renamedFrom) {
        entry = this.replica.renameFile(renamedFrom, filePath, this.actor)
      } else {
        entry = this.replica.createFile({
          path: filePath,
          kind: "text",
          content: text,
          mode: fileMode(diskStat.mode),
          actor: this.actor,
        })
        this.adapter.initializeBaseline(entry.fileId, text)
      }
    }
    entry = this.replica.tree.chmodEntry(entry.fileId, fileMode(diskStat.mode), this.actor)
    this.skippedPaths.delete(filePath)
    this.recordDiskState(entry, diskHash, diskStat)

    this.unsentBytes += bytes!.length
    if (this.unsentBytes >= SUBMIT_CHUNK_BYTES) this.flushSubmit()
    else this.scheduleSubmit()

    // Merged with concurrent peer edits, the text no longer matches disk; write the merge back.
    if (this.replica.textDocs.getTextContent(entry.fileId) !== text) {
      this.scheduleMaterialize([entry.fileId])
    }
  }

  private async ingestBinary(
    filePath: string,
    source: PendingBinarySource,
    stat: { mode: number; size: number; mtimeMs: number },
  ): Promise<void> {
    const diskHash = source.contentHash
    // A startup scan may see bytes already captured before the outage. Replaying
    // that original intent preserves its base even if the room advanced meanwhile.
    const retained = this.pendingBinaryStore.list().find((version) =>
      version.path === filePath && version.contentHash === diskHash && version.mode === fileMode(stat.mode))
    if (retained) {
      await this.pendingBinaryStore.writeTo(retained, async () => undefined)
      this.scheduleBinaryReplay()
      return
    }
    const prior = this.findLiveEntry(filePath)
    const staged = await this.pendingBinaryStore.stageFrom({ path: filePath, fileId: prior?.fileId ?? null,
      baseRevisionId: prior ? this.replica.binaryStore.getHeadRevision(prior.fileId)?.revisionId ?? null : null,
      mode: fileMode(stat.mode) }, source)
    this.scheduleBinaryReplay()
    if (this.offlineObservation) {
      this.emitStatusSoon()
      return
    }
    const manifest = await this.uploadStagedBinary(staged).catch((error: unknown) => {
      // An interrupted seed upload must stay resumable, never fail reconcile:
      // the durable capture is retained and the replay pass picks it back up.
      this.recordError("BINARY_UPLOAD_DEFERRED", error)
      this.scheduleBinaryReplay()
      return null
    })
    if (!manifest) return

    let entry = this.findLiveEntry(filePath)
    if (entry && entry.kind !== "binary") {
      this.replica.deleteFile(entry.fileId, this.actor)
      entry = null
    }
    if (!entry) {
      const renamedFrom = this.takeRenamedFrom(filePath, diskHash, "binary")
      if (renamedFrom) {
        const renamedEntry = this.liveEntryById(renamedFrom)
        entry = renamedEntry ? this.replica.renameFile(renamedFrom, filePath, this.actor) : null
      }
    }
    if (!entry) {
      entry = this.replica.createFile({
        path: filePath,
        kind: "binary",
        mode: fileMode(stat.mode),
        actor: this.actor,
      })
    }

    entry = this.replica.tree.chmodEntry(entry.fileId, fileMode(stat.mode), this.actor)
    const revision: BinaryRevision = {
      revisionId: staged.revisionId,
      fileId: entry.fileId,
      baseRevisionId: staged.baseRevisionId,
      contentHash: manifest.contentHash,
      manifest,
      encryptedManifestRef: `inline:v1:${manifest.contentHash}`,
      size: manifest.size,
      actor: this.actor,
      createdAt: staged.createdAt,
    }
    this.replica.addBinaryRevision(revision)
    this.skippedPaths.delete(filePath)
    // Retire the encrypted staging copy only after both local replay sources
    // include this exact revision. Failed uploads never reach this point.
    this.flushSubmit()
    this.persistSnapshot()
    this.pendingBinaryStore.remove(staged.revisionId)
    this.recordDiskState(entry, diskHash, stat)

    // Only metadata enters the room batch, so binary size must not force the room's
    // batching threshold. The payload has already been uploaded chunk-by-chunk.
    this.scheduleSubmit()
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
    // A rename arrives as a delete and a create: the delete waits briefly for the new name.
    const indexed = this.index.getByFileId(this.publicSessionId, entry.fileId)
    if (indexed && this.renameWindowMs > 0) {
      if (this.pendingDeletes.has(entry.fileId)) return
      const fileIdToDelete = entry.fileId
      const timer = setTimeout(() => void this.enqueue(() => this.commitPendingDelete(fileIdToDelete)), this.renameWindowMs)
      this.pendingDeletes.set(entry.fileId, { path: filePath, diskHash: indexed.diskHash, timer })
      return
    }
    this.deleteEntry(entry.fileId)
  }

  private deleteEntry(fileId: string): void {
    this.replica.deleteFile(fileId, this.actor)
    this.index.remove(this.publicSessionId, fileId)
    this.baselines.deleteBaseline(fileId)
    this.scheduleSubmit()
  }

  /** Deletes a file whose new name never turned up. */
  private async commitPendingDelete(fileId: string): Promise<void> {
    const pending = this.pendingDeletes.get(fileId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingDeletes.delete(fileId)
    if (!this.running || this.gitPause || !this.liveEntryById(fileId)) return
    // Back at its old path, as after an atomic save.
    if (await fs.lstat(path.join(this.workspaceRoot, pending.path)).then(() => true, () => false)) return
    this.deleteEntry(fileId)
  }

  private async commitPendingDeletes(): Promise<void> {
    // Awaited filesystem checks can admit new watcher events. Drain only the
    // deletes present at entry so newly scheduled rename windows stay intact.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const fileId of [...this.pendingDeletes.keys()]) await this.commitPendingDelete(fileId)
  }

  /** The file just deleted that this new file continues: the same bytes, preferring the same name. */
  private takeRenamedFrom(filePath: string, diskHash: string, kind: ProjectEntryRecord["kind"]): string | null {
    let match: string | null = null
    for (const [fileId, pending] of this.pendingDeletes) {
      if (pending.diskHash !== diskHash || this.liveEntryById(fileId)?.kind !== kind) continue
      // Files with the same bytes: the one with the same name wins, as in a folder move.
      const sameName = path.posix.basename(pending.path) === path.posix.basename(filePath)
      if (!match || sameName) match = fileId
      if (sameName) break
    }
    if (!match) return null
    const pending = this.pendingDeletes.get(match)
    if (pending) clearTimeout(pending.timer)
    this.pendingDeletes.delete(match)
    return match
  }

  /**
   * Applies AutoGit's merge of commits pushed from outside the session, as edits by
   * this device, and writes them to this folder. Nothing is applied when a file no
   * longer reads as the merge found it; those paths come back so it can merge again.
   */
  private async recoverIntegration(adoptionId: string, generation: number): Promise<boolean> {
    let committed = false
    for (const queued of this.queue.getIntegrationBatches(this.publicSessionId)) {
      if (queued.integration?.adoptionId !== adoptionId) continue
      try {
        await this.roomClient.finishIntegration(generation, queued.integration.barrierId, queued.batch)
        this.replica.applyBatch(queued.batch)
        this.persistSnapshot()
        committed = true
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "INTEGRATION_STALE") this.queue.removeIntegration(queued.batchId)
        else throw error
      }
    }
    return committed
  }

  private async applySessionChanges(changes: SessionFileChange[], integration?: { adoptionId: string; generation: number }): Promise<string[]> {
    const currentText = (filePath: string): string | null => {
      const entry = this.findLiveEntry(filePath)
      return entry?.kind === "text" ? this.replica.textDocs.getTextContent(entry.fileId) : null
    }
    // Upload every payload before any replica mutation. A failed upload leaves the
    // complete live change set untouched; successful objects are immutable.
    // Git-originated binaries arrive as immutable blob descriptors and stream
    // once from the repository object store into the durable capture; no whole
    // payload crosses this boundary and no range is read twice.
    const binaries = new Map<SessionFileChange, Awaited<ReturnType<SessionBinaryObjectStore["upload"]>>>()
    for (const change of changes) {
      const blob = change.binary?.blob
      if (blob) {
        if (!this.gitService) {
          throw new SessionHostError("AUTOGIT_OFF", `Cannot adopt the Git binary for ${change.path} without repository access.`)
        }
        const gitService = this.gitService
        const live = this.findLiveEntry(change.path)
        const staged = await this.pendingBinaryStore.stageFromStream({
          path: change.path,
          fileId: live?.fileId ?? null,
          baseRevisionId: live && live.kind === "binary"
            ? this.replica.binaryStore.getHeadRevision(live.fileId)?.revisionId ?? null
            : null,
          mode: change.mode !== undefined ? fileMode(change.mode) : live?.mode ?? 0o100644,
        }, {
          size: blob.size,
          contentHash: blob.contentHash,
          stream: (write) => gitService.streamBlob(blob.repoPath, blob.blobOid, write),
        })
        try {
          binaries.set(change, await this.uploadStagedBinary(staged))
        } finally {
          this.pendingBinaryStore.remove(staged.revisionId)
        }
      }
    }
    await this.flushAndAwaitAcks()
    const barrier = integration ? await this.roomClient.beginIntegration(integration.generation, integration.adoptionId) : null
    try {
      if (barrier) {
        while (this.transport.lastAppliedSessionSeq < barrier.sessionSeq) {
          if (Date.now() >= barrier.expiresAt) throw new AutoGitError("INTEGRATION_STALE", "The session did not catch up before the integration barrier expired.")
          await delay(5)
        }
      }
      const changedMeanwhile = changes
        .filter((change) => (change.renameTo && sessionFileFingerprint(this.replica, change.renameTo) !== change.destinationFingerprint) || (change.expectedFingerprint !== undefined ? sessionFileFingerprint(this.replica, change.path) !== change.expectedFingerprint : change.binary ? sessionFileFingerprint(this.replica, change.path) !== change.binary.fingerprint : currentText(change.path) !== change.expected))
        .map((change) => change.path)
      if (changedMeanwhile.length > 0) return changedMeanwhile

      // Keep original pending edits independently journaled before taking the basis.
      this.flushSubmit()
      const staged = new SessionReplica(this.publicSessionId, this.replica.clientId)
      staged.restoreSnapshot(this.replica.captureSnapshot())
      const touched: string[] = []
      for (const change of changes) {
        let entry = staged.tree.listLiveEntries().find((candidate) => candidate.path === change.path) ?? null
        if (change.renameTo && entry) entry = staged.renameFile(entry.fileId, change.renameTo, this.actor)
        const destination = change.renameTo ?? change.path
        if (change.symlinkTarget !== undefined) {
          if (entry && entry.kind !== "symlink") { staged.deleteFile(entry.fileId, this.actor); entry = null }
          entry = entry ? staged.tree.setSymlinkTarget(entry.fileId, change.symlinkTarget, this.actor)
            : staged.createFile({ path: destination, kind: "symlink", symlinkTarget: change.symlinkTarget, mode: 0o120000, actor: this.actor })
          touched.push(entry.fileId)
          continue
        }
        if (change.modeOnly && entry && change.mode !== undefined) {
          staged.tree.chmodEntry(entry.fileId, change.mode, this.actor)
          touched.push(entry.fileId)
          continue
        }
        if (change.binary) {
          if (change.binary.blob === null) {
            if (entry) { staged.deleteFile(entry.fileId, this.actor); touched.push(entry.fileId) }
            continue
          }
          const manifest = binaries.get(change)!
          if (entry && entry.kind !== "binary") { staged.deleteFile(entry.fileId, this.actor); entry = null }
          if (!entry) entry = staged.createFile({ path: destination, kind: "binary", mode: change.mode, actor: this.actor })
          if (change.mode !== undefined) staged.tree.chmodEntry(entry.fileId, change.mode, this.actor)
          staged.addBinaryRevision({ revisionId: randomUUID(), fileId: entry.fileId,
            baseRevisionId: staged.binaryStore.getHeadRevision(entry.fileId)?.revisionId ?? null,
            contentHash: manifest.contentHash, manifest, encryptedManifestRef: `inline:v1:${manifest.contentHash}`,
            size: manifest.size, actor: this.actor, createdAt: Date.now() })
          touched.push(entry.fileId)
          continue
        }
        if (change.text !== null && entry && entry.kind !== "text") { staged.deleteFile(entry.fileId, this.actor); entry = null }
        if (change.text === null) {
          if (!entry) continue
          staged.deleteFile(entry.fileId, this.actor)
          touched.push(entry.fileId)
        } else if (entry) {
          if (change.mode !== undefined) staged.tree.chmodEntry(entry.fileId, change.mode, this.actor)
          this.replaceText(entry.fileId, change.text, staged)
          touched.push(entry.fileId)
        } else {
          const created = staged.createFile({
            path: destination,
            kind: "text",
            content: change.text,
            mode: change.mode,
            actor: this.actor,
          })
          touched.push(created.fileId)
        }
      }
      // Building and journal acceptance can both fail without touching the live replica.
      const batch = staged.exportBatch((pending) => this.queue.enqueue(pending, barrier && integration ? { ...integration, barrierId: barrier.id } : undefined))
      if (batch) {
        if (barrier && integration) await this.roomClient.finishIntegration(integration.generation, barrier.id, batch)
        this.replica.applyBatch(batch)
        if (!barrier) this.roomClient.submitBatch(batch)
        this.persistSnapshot()
      }
      this.persistSnapshot()
      for (const fileId of touched) await this.materializer.materializeFile(fileId, Date.now())
      return []
    } finally {
      if (barrier && integration) await this.roomClient.finishIntegration(integration.generation, barrier.id).catch(() => undefined)
    }
  }

  /** Edits a text doc into `next` with the smallest change, so concurrent peer edits merge around it. */
  private replaceText(fileId: string, next: string, replica = this.replica): void {
    const { doc, text } = replica.textDocs.getOrCreate(fileId)
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
    // Type replacement creates a new tree entry. Retire its tombstoned index
    // owner before echo lookup can mistake the old kind for the current file.
    let previous = this.index.getByPath(this.publicSessionId, entry.path)
    while (previous && previous.fileId !== entry.fileId && this.replica.tree.getEntry(previous.fileId)?.deleted) {
      this.index.remove(this.publicSessionId, previous.fileId)
      previous = this.index.getByPath(this.publicSessionId, entry.path)
    }
    this.index.recordMaterialization({
      sessionId: this.publicSessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      diskHash,
      diskSize: stat.size,
      diskMtimeMs: stat.mtimeMs,
      state: "materialized",
    })
  }

  private async resolveBinaryRevision(revision: BinaryRevision): Promise<Buffer> {
    const cached = await this.binaryCache.get(revision.contentHash)
    if (cached) {
      if (cached.length !== revision.size) {
        throw new SessionHostError("BINARY_CACHE_CORRUPT", `Cached binary ${revision.contentHash} has the wrong size`)
      }
      return cached
    }
    if (!revision.manifest) {
      throw new SessionHostError(
        "BINARY_MANIFEST_MISSING",
        `Binary revision ${revision.revisionId} has no chunk manifest and is not in the local cache`,
      )
    }
    const downloaded = await this.binaryObjects.download(revision.manifest)
    if (sha256(downloaded) !== revision.contentHash || downloaded.length !== revision.size) {
      throw new SessionHostError("BINARY_DOWNLOAD_CORRUPT", `Binary revision ${revision.revisionId} failed verification`)
    }
    await this.binaryCache.put(downloaded)
    return downloaded
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

  // ─── Session → room and folder ───────────────────────────────────────────────

  private scheduleSubmit(): void {
    if (this.submitTimer) return
    this.submitTimer = setTimeout(() => {
      this.submitTimer = null
      try {
        this.flushSubmit()
      } catch (error) {
        this.recordError("JOURNAL_WRITE_FAILED", error)
      }
    }, this.submitDelayMs)
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer || this.stopping) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      try {
        this.persistSnapshot()
      } catch (error) {
        this.recordError("SNAPSHOT_WRITE_FAILED", error)
      }
    }, 250)
  }

  private persistSnapshot(): void {
    // A snapshot marks its contents as the restored baseline. Unjournaled local
    // edits must not become that baseline, or their outbound delta would be lost.
    if (!this.recoveryLoaded || this.replica.hasUnexportedChanges()) return
    this.replicaStore.save({ sequence: this.transport.lastAppliedSessionSeq, replica: this.replica.captureSnapshot() })
  }

  private flushSubmit(): void {
    if (this.submitTimer) {
      clearTimeout(this.submitTimer)
      this.submitTimer = null
    }
    this.unsentBytes = 0
    if (!this.canWrite) return
    const batch = this.replica.exportBatch((pending) => this.queue.enqueue(pending))
    if (!batch) return
    this.roomClient.submitBatch(batch)
    this.scheduleSnapshot()
    this.emitStatusSoon()
  }

  /** Sends unsent edits and waits until the room has acknowledged every one (Section 15.3). */
  private async flushAndAwaitAcks(): Promise<void> {
    this.flushSubmit()
    await this.awaitRoomAcknowledgements()
  }

  private async awaitRoomAcknowledgements(): Promise<void> {
    if (this.pendingBinaryStore.count() > 0) {
      throw new SessionHostError("BINARY_UPLOAD_PENDING", "Retained binary versions must finish uploading before the session is fully saved.")
    }
    const deadline = Date.now() + ACK_WAIT_MS
    while (this.roomClient.pendingBatchCount > 0) {
      if (Date.now() > deadline || this.roomClient.state !== "live") {
        throw new AutoGitError("EDITS_NOT_ACKNOWLEDGED", "The session room has not confirmed this device's latest edits yet.")
      }
      await delay(ACK_POLL_MS)
    }
  }

  private scheduleMaterialize(fileIds: Iterable<string>): void {
    const previousPaths = new Set<string>()
    for (const fileId of fileIds) {
      this.pendingMaterialize.add(fileId)
      const previous = this.index.getByFileId(this.publicSessionId, fileId)
      if (previous) previousPaths.add(ConflictEngine.normalizeForVolumeComparison(previous.relativePath))
    }
    if (previousPaths.size) for (const entry of this.replica.tree.listLiveEntries()) {
      if (previousPaths.has(ConflictEngine.normalizeForVolumeComparison(entry.path))) this.pendingMaterialize.add(entry.fileId)
    }
    this.emitStatusSoon()
    if (this.reconciling || this.offlineObservation || this.gitPause || !this.running || this.materializeTimer || this.pendingMaterialize.size === 0) {
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
    if (!this.canWrite || entry.deleted) return
    const indexed = this.index.getByFileId(this.publicSessionId, entry.fileId)
    // After a peer rename the old path is nobody's; the materializer keeps its bytes.
    if (!indexed || indexed.relativePath !== entry.path) return
    const absolutePath = await this.resolveEntryPath(entry.path)
    if (!absolutePath) return
    const stat = await fs.lstat(absolutePath).catch(() => null)
    if (stat?.isSymbolicLink()) {
      await this.ingestChange(entry.path, absolutePath)
      return
    }
    if (!stat?.isFile() || (stat.size === indexed.diskSize && stat.mtimeMs === indexed.diskMtimeMs && fileMode(stat.mode) === indexed.mode)) return
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
    if (!this.running || this.stopping || this.gitChecking || (this.reconciling && !this.gitPause)) return
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
    if (this.binaryReplayTimer) {
      clearTimeout(this.binaryReplayTimer)
      this.binaryReplayTimer = null
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer)
      this.snapshotTimer = null
    }
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
    // A delete still waiting stays in the index, so the next attach finds it again.
    for (const pending of this.pendingDeletes.values()) clearTimeout(pending.timer)
    this.pendingDeletes.clear()
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
