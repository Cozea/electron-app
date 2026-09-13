import { exportCloudRecovery } from "../collaboration/CloudRecoveryExporter"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

import {
  asBranchName,
  asProjectId,
  asSessionId,
  asWorkbenchId,
  asWorkspaceId,
  type LocalProjectWorkbench,
} from "@shared/collaboration"
import {
  encodeMessage,
  getProjectdSocketPath,
  LineMessageDecoder,
  PROJECTD_DEFAULT_DAEMON_VERSION,
  PROJECTD_PROTOCOL_VERSION,
  projectdSessionTopic,
  type ProjectdClientMessage,
  type ProjectdError,
  type ProjectdErrorCode,
  type ProjectdEnsureSessionWorkbenchParams,
  type ProjectdEventMessage,
  type ProjectdHandshakeResponse,
  type ProjectdHealthResult,
  type ProjectdRequest,
  type ProjectdResponse,
  type ProjectdServerMessage,
  type ProjectdSessionAttachParams,
  type ProjectdSessionStatus,
  type ProjectdSessionTicket,
} from "@cozea/projectd-protocol"

import { CollaborationSessionHost } from "../collaboration/CollaborationSessionHost"
import type { RoomConnector } from "../collaboration/SessionRoomClient"
import type { FileEventSource } from "../filesystem/FSEventsClient"
import { ProjectdDatabase } from "../storage/Database"
import { SqliteWorkbenchStore } from "../workbenches/SqliteWorkbenchStore"
import { WorkspaceRegistry } from "../workspaces/WorkspaceRegistry"
import { WorkspaceCatalogImporter } from "../workspaces/WorkspaceCatalogImporter"
import { GitService } from "../git/GitService"
import { WorkbenchManager } from "../workbenches/WorkbenchManager"
import { BackgroundDeviceIdentityManager } from "../identity/BackgroundDeviceIdentity"
import { BackgroundSessionStore, type BackgroundSessionDescriptor } from "../collaboration/BackgroundSessionStore"
import { BackgroundAccessDenied, refreshBackgroundSession, getBackgroundRecoveryAccess, shareBackgroundRecoveryKeys } from "../collaboration/BackgroundSessionAuth"
import { SessionRecoveryCoordinator } from "../collaboration/SessionRecoveryCoordinator"
import { exportLocalRecovery } from "../collaboration/LocalRecoveryExporter"
import { previewLocalRecovery } from "../collaboration/LocalRecoveryPreview"
import { SessionMerger } from "../autogit/SessionMerger"
import { GitHubSessionPullRequest } from "../autogit/GitHubSessionPullRequest"
import { getBackgroundRepositoryToken } from "../collaboration/BackgroundRepositoryAuth"

interface ConnectionState {
  socket: net.Socket
  decoder: LineMessageDecoder
  handshaked: boolean
  clientName: string
  subscribedTopics: Set<string>
}

export interface ProjectdServerOptions {
  sessionPullRequests?: (projectId: string, publicSessionId: string) => GitHubSessionPullRequest
  socketPath?: string
  version?: string
  database?: ProjectdDatabase
  dbPath?: string
  sourceCatalogPath?: string
  /** Opens session room connections; tests substitute an in-memory room. */
  sessionConnectorFactory?: (wsUrl: string) => RoomConnector
  /** File event source for each attached folder; FSEvents when the native helper exists. */
  fileEventSourceFactory?: (rootPath: string) => FileEventSource
  sessionRescanIntervalMs?: number
  backgroundIdentity?: BackgroundDeviceIdentityManager
  refreshSessionAuth?: typeof refreshBackgroundSession
  recoverySessionAuth?: typeof getBackgroundRecoveryAccess
}

const PUBLIC_SESSION_ID_PATTERN = /^czs_[a-f0-9]{16}$/

class ProjectdRequestError extends Error {
  readonly code: ProjectdErrorCode

  constructor(code: ProjectdErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function invalidParams(message: string): ProjectdRequestError {
  return new ProjectdRequestError("INVALID_PARAMS", message)
}

function requireSessionId(params: unknown): string {
  const publicSessionId = (params as { publicSessionId?: unknown } | undefined)?.publicSessionId
  if (typeof publicSessionId !== "string" || !PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) {
    throw invalidParams("A collaboration session ID (czs_…) is required")
  }
  return publicSessionId
}

function parseTicket(value: unknown): ProjectdSessionTicket {
  const ticket = (value ?? {}) as Partial<ProjectdSessionTicket>
  if (
    typeof ticket.wsUrl !== "string" ||
    !/^wss?:\/\//.test(ticket.wsUrl) ||
    typeof ticket.token !== "string" ||
    !ticket.token
  ) {
    throw invalidParams("The ticket needs the room's wsUrl and token")
  }
  const role = ticket.role === "viewer" || ticket.role === "project_manager" ? ticket.role : "developer"
  return { wsUrl: ticket.wsUrl, token: ticket.token, role }
}

function parseAttachParams(params: unknown) {
  const attach = (params ?? {}) as Partial<ProjectdSessionAttachParams>
  const publicSessionId = requireSessionId(attach)
  if (
    typeof attach.workspaceId !== "string" ||
    !attach.workspaceId ||
    typeof attach.projectId !== "string" ||
    !attach.projectId
  ) {
    throw invalidParams("workspaceId and projectId are required")
  }
  if (typeof attach.rootPath !== "string" || !path.isAbsolute(attach.rootPath)) {
    throw invalidParams("rootPath must be an absolute folder path")
  }
  const roomKey =
    typeof attach.roomKeyBase64 === "string" ? Buffer.from(attach.roomKeyBase64, "base64") : Buffer.alloc(0)
  if (roomKey.length !== 32) {
    throw invalidParams("roomKeyBase64 must hold the session's 32-byte room key")
  }
  const roomKeyVersion =
    typeof attach.roomKeyVersion === "number" && Number.isSafeInteger(attach.roomKeyVersion) && attach.roomKeyVersion >= 1
      ? attach.roomKeyVersion
      : 1
  const previousRoomKeys: Record<number, Uint8Array> = {}
  for (const [versionText, keyBase64] of Object.entries(attach.previousRoomKeysBase64 ?? {})) {
    const version = Number(versionText)
    const key = typeof keyBase64 === "string" ? Buffer.from(keyBase64, "base64") : Buffer.alloc(0)
    if (!Number.isSafeInteger(version) || version < 1 || version >= roomKeyVersion || key.length !== 32) {
      throw invalidParams("previousRoomKeysBase64 contains an invalid key generation")
    }
    previousRoomKeys[version] = new Uint8Array(key)
  }
  return {
    publicSessionId,
    workspaceId: attach.workspaceId,
    projectId: attach.projectId,
    rootPath: path.resolve(attach.rootPath),
    roomKey: new Uint8Array(roomKey),
    roomKeyVersion,
    previousRoomKeys,
    ticket: parseTicket(attach.ticket),
    actor: attach.actor,
    branchName:
      typeof attach.branchName === "string" && attach.branchName.trim() ? attach.branchName.trim() : undefined,
    shareEnvironmentFiles: attach.shareEnvironmentFiles === true,
    targetBranch:
      typeof attach.targetBranch === "string" && attach.targetBranch.trim() ? attach.targetBranch.trim() : undefined,
    sessionStartedAt:
      typeof attach.sessionStartedAt === "number" && Number.isFinite(attach.sessionStartedAt)
        ? attach.sessionStartedAt
        : undefined,
  }
}

/** The code an error carries, such as NOT_FOUND or NOT_SAVED, so clients can tell failures apart. */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === "string" && code ? code : "INTERNAL_ERROR"
}

export class ProjectdServer {
  readonly socketPath: string
  readonly version: string
  readonly startedAt: number
  readonly db: ProjectdDatabase
  readonly workbenchStore: SqliteWorkbenchStore
  readonly workspaceRegistry: WorkspaceRegistry
  readonly catalogImporter: WorkspaceCatalogImporter
  readonly gitService: GitService
  readonly workbenchManager: WorkbenchManager

  private server: net.Server | null = null
  private connections = new Set<ConnectionState>()
  private isShuttingDown = false
  private readonly sessionHosts = new Map<string, CollaborationSessionHost>()
  private readonly sessionPullRequests?: ProjectdServerOptions["sessionPullRequests"]
  private readonly sessionConnectorFactory?: (wsUrl: string) => RoomConnector
  private readonly fileEventSourceFactory?: (rootPath: string) => FileEventSource
  private readonly sessionRescanIntervalMs?: number
  private readonly backgroundStore: BackgroundSessionStore
  private readonly backgroundIdentity: BackgroundDeviceIdentityManager
  private readonly refreshSessionAuth: typeof refreshBackgroundSession
  private readonly recoverySessionAuth: typeof getBackgroundRecoveryAccess
  private readonly recoveryClosers = new Map<string, SessionRecoveryCoordinator>()
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null
  private backgroundRefresh: Promise<void> | null = null
  private sessionChanges: Promise<unknown> = Promise.resolve()

  constructor(options?: ProjectdServerOptions) {
    this.sessionPullRequests = options?.sessionPullRequests
    this.backgroundIdentity = options?.backgroundIdentity ?? new BackgroundDeviceIdentityManager()
    this.refreshSessionAuth = options?.refreshSessionAuth ?? refreshBackgroundSession
    this.recoverySessionAuth = options?.recoverySessionAuth ?? getBackgroundRecoveryAccess
    this.socketPath = options?.socketPath ?? getProjectdSocketPath()
    this.sessionConnectorFactory = options?.sessionConnectorFactory
    this.fileEventSourceFactory = options?.fileEventSourceFactory
    this.sessionRescanIntervalMs = options?.sessionRescanIntervalMs
    this.version = options?.version ?? PROJECTD_DEFAULT_DAEMON_VERSION
    this.startedAt = Date.now()

    this.db = options?.database ?? new ProjectdDatabase(options?.dbPath)
    this.backgroundStore = new BackgroundSessionStore(this.db)
    this.workbenchStore = new SqliteWorkbenchStore(this.db)
    this.workspaceRegistry = new WorkspaceRegistry(this.db)
    this.catalogImporter = new WorkspaceCatalogImporter(this.db, options?.sourceCatalogPath)
    this.gitService = new GitService()
    this.workbenchManager = new WorkbenchManager({
      store: this.workbenchStore,
      workspaceRegistry: this.workspaceRegistry,
      gitService: this.gitService,
    })
  }

  async start(): Promise<void> {
    await this.ensureSocketAvailable()
    await this.catalogImporter.importIfNecessary()

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleConnection(socket))

      server.on("error", (err) => {
        if (!this.server) {
          reject(err)
        } else {
          console.error("[projectd] Server socket error:", err)
        }
      })

      server.listen(this.socketPath, () => {
        this.server = server
        // Enforce socket permissions 0600 (Section 8.4)
        try {
          fs.chmodSync(this.socketPath, 0o600)
        } catch (err) {
          console.warn("[projectd] Failed to chmod socket to 0600:", err)
        }
        resolve()
      })
    })
    this.scheduleBackgroundRefresh(0)
  }

  private scheduleBackgroundRefresh(delayMs = 30_000): void {
    if (this.isShuttingDown || this.backgroundTimer) return
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = null
      this.backgroundRefresh = this.refreshBackgroundSessions().finally(() => {
        this.backgroundRefresh = null
        this.scheduleBackgroundRefresh()
      })
    }, delayMs)
    this.backgroundTimer.unref()
  }

  private async refreshBackgroundSessions(): Promise<void> {
    const count = this.db.db.prepare("SELECT count(*) AS count FROM background_sessions").get() as { count: number }
    if (!count.count) return
    try {
      const identity = await this.backgroundIdentity.loadExistingIdentity()
      for (const saved of this.backgroundStore.list(identity)) {
        if (this.isShuttingDown) return
        const accessGeneration = this.backgroundStore.accessState(saved.publicSessionId, identity).generation
        try {
          const renewed = await this.refreshSessionAuth(saved, identity, this.backgroundIdentity)
          await this.changeSessions(async () => {
            if (this.isShuttingDown || !this.hasBackgroundSession(saved.publicSessionId)) return
            if (!this.backgroundStore.acceptFreshAccess(saved.publicSessionId, identity, accessGeneration)) return
            await this.attachSessionUnlocked(renewed, false)
            this.backgroundStore.save(renewed, identity)
          })
        } catch (error) {
          if (error instanceof BackgroundAccessDenied) {
            await this.changeSessions(async () => {
              try { this.backgroundStore.denyAccess(saved.publicSessionId, identity) }
              finally { await this.detachSessionUnlocked({ publicSessionId: saved.publicSessionId }, false) }
            })
          } else if (saved.ticket && saved.roomKeyBase64) {
            // Restore local encrypted state after a network failure, without
            // using a cached ticket to connect or starting workspace observation.
            await this.changeSessions(async () => {
              if (this.isShuttingDown || !this.hasBackgroundSession(saved.publicSessionId) ||
                this.sessionHosts.has(saved.publicSessionId) || this.backgroundStore.accessState(saved.publicSessionId, identity).denied) return
              try { await this.attachSessionUnlocked(saved, false, true) } catch {
                // Keep the original descriptor/journal for explicit recovery.
              }
            })
          }
          this.broadcast(projectdSessionTopic(saved.publicSessionId), "background_error", {
            code: errorCode(error),
            message: error instanceof BackgroundAccessDenied ? error.message : "Background connection unavailable; retained work will retry",
          })
        }
      }
    } catch {
      // Keychain locked/unavailable: keep the encrypted intent and retry, never
      // generate a different principal or fall back to plaintext credentials.
      console.warn("[projectd] Background identity unavailable; retained sessions will retry")
    }
  }

  private hasBackgroundSession(publicSessionId: string): boolean {
    return Boolean(this.db.db.prepare("SELECT 1 FROM background_sessions WHERE session_id=?").get(publicSessionId))
  }

  private async ensureSocketAvailable(): Promise<void> {
    if (!fs.existsSync(this.socketPath)) {
      return
    }

    // Check if another daemon is alive on the socket
    const isAlive = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection(this.socketPath)
      probe.on("connect", () => {
        probe.destroy()
        resolve(true)
      })
      probe.on("error", () => {
        resolve(false)
      })
      probe.setTimeout(500, () => {
        probe.destroy()
        resolve(false)
      })
    })

    if (isAlive) {
      throw new Error(`cozea-projectd is already running on socket ${this.socketPath}`)
    }

    // Socket file is stale, safe to remove
    try {
      fs.unlinkSync(this.socketPath)
    } catch {
      // Ignore unlink failure if already gone
    }
  }

  private handleConnection(socket: net.Socket): void {
    if (this.isShuttingDown) {
      socket.destroy()
      return
    }

    const state: ConnectionState = {
      socket,
      decoder: new LineMessageDecoder(),
      handshaked: false,
      clientName: "unknown",
      subscribedTopics: new Set(),
    }

    this.connections.add(state)

    socket.on("data", (chunk) => {
      const messages = state.decoder.push(chunk)
      for (const msg of messages) {
        this.handleMessage(state, msg as ProjectdClientMessage)
      }
    })

    socket.on("close", () => {
      this.connections.delete(state)
    })

    socket.on("error", (err) => {
      console.warn("[projectd] Client connection error:", err)
      this.connections.delete(state)
    })
  }

  private sendMessage(state: ConnectionState, msg: ProjectdServerMessage): void {
    if (!state.socket.destroyed && state.socket.writable) {
      state.socket.write(encodeMessage(msg))
    }
  }

  private sendError(
    state: ConnectionState,
    id: string,
    error: ProjectdError,
  ): void {
    const response: ProjectdResponse = {
      type: "response",
      id,
      success: false,
      error,
    }
    this.sendMessage(state, response)
  }

  private handleMessage(state: ConnectionState, msg: ProjectdClientMessage): void {
    if (!msg || typeof msg !== "object") return

    // Enforce handshake before any other request
    if (!state.handshaked) {
      if (msg.type !== "handshake") {
        this.sendError(state, (msg as any).id ?? "unknown", {
          code: "INVALID_HANDSHAKE",
          message: "Handshake required before sending requests",
        })
        state.socket.destroy()
        return
      }

      if (msg.protocolVersion !== PROJECTD_PROTOCOL_VERSION) {
        const handshakeErr: ProjectdHandshakeResponse = {
          type: "handshake_ack",
          id: msg.id,
          success: false,
          protocolVersion: PROJECTD_PROTOCOL_VERSION,
          daemonVersion: this.version,
          pid: process.pid,
          error: {
            code: "UNSUPPORTED_VERSION",
            message: `Unsupported protocol version '${msg.protocolVersion}' (expected '${PROJECTD_PROTOCOL_VERSION}')`,
          },
        }
        this.sendMessage(state, handshakeErr)
        state.socket.destroy()
        return
      }

      state.handshaked = true
      state.clientName = msg.clientName ?? "client"

      const ack: ProjectdHandshakeResponse = {
        type: "handshake_ack",
        id: msg.id,
        success: true,
        protocolVersion: PROJECTD_PROTOCOL_VERSION,
        daemonVersion: this.version,
        pid: process.pid,
      }
      this.sendMessage(state, ack)
      return
    }

    switch (msg.type) {
      case "request":
        this.handleRequest(state, msg)
        break
      case "subscribe":
        state.subscribedTopics.add(msg.topic)
        this.sendMessage(state, {
          type: "response",
          id: msg.id,
          success: true,
          result: { subscribed: true, topic: msg.topic },
        })
        break
      case "unsubscribe":
        state.subscribedTopics.delete(msg.topic)
        this.sendMessage(state, {
          type: "response",
          id: msg.id,
          success: true,
          result: { unsubscribed: true, topic: msg.topic },
        })
        break
      case "handshake":
        // Duplicate handshake on already handshaked connection
        this.sendMessage(state, {
          type: "handshake_ack",
          id: msg.id,
          success: true,
          protocolVersion: PROJECTD_PROTOCOL_VERSION,
          daemonVersion: this.version,
          pid: process.pid,
        })
        break
      default:
        this.sendError(state, (msg as any).id ?? "unknown", {
          code: "INVALID_PARAMS",
          message: `Unknown message type: ${(msg as any).type}`,
        })
    }
  }

  private handleRequest(state: ConnectionState, req: ProjectdRequest): void {
    switch (req.method) {
      case "health": {
        const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000)
        const result: ProjectdHealthResult = {
          status: "healthy",
          version: this.version,
          protocolVersion: PROJECTD_PROTOCOL_VERSION,
          pid: process.pid,
          uptimeSeconds,
          activeConnections: this.connections.size,
          startedAt: this.startedAt,
        }
        this.sendMessage(state, {
          type: "response",
          id: req.id,
          success: true,
          result,
        })
        break
      }
      case "shutdown": {
        this.sendMessage(state, {
          type: "response",
          id: req.id,
          success: true,
          result: { shuttingDown: true },
        })
        setTimeout(() => {
          void this.stop()
        }, 50)
        break
      }
      case "echo": {
        this.sendMessage(state, {
          type: "response",
          id: req.id,
          success: true,
          result: req.params,
        })
        break
      }
      case "workbenches.list": {
        const p = req.params as { projectId: string }
        if (!p?.projectId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'projectId' parameter",
          })
          break
        }
        void this.workbenchStore
          .listByProject(asProjectId(p.projectId))
          .then((workbenches) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: workbenches,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workbenches.ensureSession": {
        const p = (req.params ?? {}) as Partial<ProjectdEnsureSessionWorkbenchParams>
        if (
          typeof p.projectId !== "string" ||
          !p.projectId ||
          typeof p.publicSessionId !== "string" ||
          !PUBLIC_SESSION_ID_PATTERN.test(p.publicSessionId) ||
          typeof p.branchName !== "string" ||
          !p.branchName.trim() ||
          typeof p.title !== "string" ||
          !p.title.trim()
        ) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "projectId, publicSessionId, branchName and title are required",
          })
          break
        }
        if (p.rootPath && !path.isAbsolute(p.rootPath)) {
          this.sendError(state, req.id, { code: "INVALID_PARAMS", message: "rootPath must be absolute" })
          break
        }
        if (p.sourceRootPath && !path.isAbsolute(p.sourceRootPath)) {
          this.sendError(state, req.id, { code: "INVALID_PARAMS", message: "sourceRootPath must be absolute" })
          break
        }
        const { projectId, publicSessionId } = p
        void this.workbenchManager
          .ensureSessionWorkbench({
            projectId: asProjectId(p.projectId),
            sessionId: asSessionId(p.publicSessionId),
            branchName: asBranchName(p.branchName.trim()),
            baseBranch: p.baseBranch?.trim() ? asBranchName(p.baseBranch.trim()) : null,
            createBranch: p.createBranch === true,
            title: p.title.trim(),
            sourceRepoUrl: p.sourceRepoUrl ?? null,
            sourceRootPath: p.sourceRootPath ?? null,
            includeDirtyChanges: p.includeDirtyChanges === true,
            workspaceId: p.workspaceId ? asWorkspaceId(p.workspaceId) : undefined,
            rootPath: p.rootPath,
            setActive: !p.background && p.setActive === true,
          })
          .then(async (result) => {
            if (p.background) {
              const identity = await this.backgroundIdentity.loadExistingIdentity()
              const intent = {
                publicSessionId, projectId,
                workspaceId: String(result.workbench.workspaceId), rootPath: result.rootPath,
                branchName: String(result.workbench.branchName), background: p.background,
              }
              const saved = this.hasBackgroundSession(publicSessionId)
                ? this.backgroundStore.findRecovery(publicSessionId, identity) : null
              if (saved && (saved.projectId !== intent.projectId || saved.workspaceId !== intent.workspaceId ||
                saved.rootPath !== intent.rootPath || saved.branchName !== intent.branchName)) {
                throw new Error("The retained session belongs to a different workspace; recover it before replacing its binding")
              }
              // Opening an existing Workbench must not erase its only cached
              // keys and ticket before an authentication attempt can fail.
              const retainedIntent = { ...saved, ...intent }
              this.backgroundStore.save(retainedIntent, identity)
              const accessGeneration = this.backgroundStore.accessState(publicSessionId, identity).generation
              let attachment: BackgroundSessionDescriptor
              let offline = false
              try {
                attachment = await this.refreshSessionAuth(retainedIntent, identity, this.backgroundIdentity)
              } catch (error) {
                if (error instanceof BackgroundAccessDenied) {
                  await this.changeSessions(async () => {
                    try { this.backgroundStore.denyAccess(publicSessionId, identity) }
                    finally { await this.detachSessionUnlocked({ publicSessionId }, false) }
                  })
                  throw error
                }
                if (!saved?.ticket || !saved.roomKeyBase64) throw error
                attachment = { ...saved, ...intent, ticket: saved.ticket, roomKeyBase64: saved.roomKeyBase64 }
                offline = true
              }
              await this.changeSessions(async () => {
                if (this.isShuttingDown || !this.hasBackgroundSession(publicSessionId)) {
                  throw new Error("Session was left while preparing the workspace")
                }
                if (offline ? this.backgroundStore.accessState(publicSessionId, identity).denied
                  : !this.backgroundStore.acceptFreshAccess(publicSessionId, identity, accessGeneration)) {
                  throw new Error("Session access must be verified online before this workspace can reopen")
                }
                await this.attachSessionUnlocked(attachment, false, offline)
                this.backgroundStore.save(attachment, identity)
              })
              const deadline = Date.now() + 90_000
              while (true) {
                const host = this.sessionHosts.get(publicSessionId)
                if (this.isShuttingDown || !host) throw new Error("Session stopped before it was ready")
                if (host.state === "failed") throw new Error(host.status().lastError?.message ?? "Session hydration failed")
                if (host.workspaceReady && (offline || (host.state === "live" && host.status().pendingBatches === 0))) break
                if (offline && !host.workspaceReady && host.state !== "starting") {
                  throw new Error("Retained data is available, but this workspace needs reconciliation before offline editing. Export recovery or reconnect to open it.")
                }
                if (Date.now() >= deadline) throw new Error("Session is still syncing; open it again when the connection recovers")
                await new Promise((resolve) => setTimeout(resolve, 50))
              }
              if (p.setActive) {
                result.workbench = (await this.workbenchStore.setActive(asProjectId(projectId), result.workbench.workbenchId)).activated
              }
            }
            this.broadcast(`project:${p.projectId}`, "workbench_saved", result.workbench)
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: errorCode(err),
              message: err instanceof Error ? err.message : String(err),
            })
          })
        break
      }
      case "workbenches.get": {
        const p = req.params as { workbenchId: string }
        if (!p?.workbenchId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'workbenchId' parameter",
          })
          break
        }
        void this.workbenchStore
          .get(asWorkbenchId(p.workbenchId))
          .then((workbench) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: workbench,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workbenches.save": {
        const wb = req.params as LocalProjectWorkbench
        if (!wb?.workbenchId || !wb?.projectId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Invalid workbench object: missing workbenchId or projectId",
          })
          break
        }
        void this.workbenchStore
          .save(wb)
          .then((saved) => {
            this.broadcast(`project:${wb.projectId}`, "workbench_saved", saved)
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: saved,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workbenches.activate": {
        const p = req.params as { projectId: string; workbenchId: string }
        if (!p?.projectId || !p?.workbenchId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'projectId' or 'workbenchId' parameter",
          })
          break
        }
        void this.workbenchStore
          .setActive(asProjectId(p.projectId), asWorkbenchId(p.workbenchId))
          .then((res) => {
            this.broadcast(`project:${p.projectId}`, "workbench_switched", res)
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: res,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workbenches.idle": {
        const p = req.params as { projectId: string; workbenchId: string }
        if (!p?.projectId || !p?.workbenchId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'projectId' or 'workbenchId' parameter",
          })
          break
        }
        void this.workbenchStore
          .setIdle(asProjectId(p.projectId), asWorkbenchId(p.workbenchId))
          .then((res) => {
            this.broadcast(`project:${p.projectId}`, "workbench_idled", res)
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: res,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workbenches.delete": {
        const p = req.params as { workbenchId: string }
        if (!p?.workbenchId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'workbenchId' parameter",
          })
          break
        }
        void this.workbenchStore
          .delete(asWorkbenchId(p.workbenchId))
          .then((deleted) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: { deleted },
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workspaces.list": {
        const p = req.params as { projectId: string }
        if (!p?.projectId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'projectId' parameter",
          })
          break
        }
        void this.workspaceRegistry
          .listByProject(asProjectId(p.projectId))
          .then((workspaces) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: workspaces,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workspaces.get": {
        const p = req.params as { workspaceId: string }
        if (!p?.workspaceId) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'workspaceId' parameter",
          })
          break
        }
        void this.workspaceRegistry
          .get(asWorkspaceId(p.workspaceId))
          .then((ws) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: ws,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "workspaces.register": {
        const p = req.params as any
        if (!p?.workspaceId || !p?.projectId || !p?.rootPath) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing workspace registration fields",
          })
          break
        }
        void this.workspaceRegistry
          .registerWorkspace({
            workspaceId: asWorkspaceId(p.workspaceId),
            projectId: asProjectId(p.projectId),
            rootPath: p.rootPath,
            projectRootPath: p.projectRootPath,
            gitRootPath: p.gitRootPath,
            gitOriginUrl: p.gitOriginUrl,
            source: p.source ?? "register",
            storageOwnership: p.storageOwnership,
            managedRootId: p.managedRootId,
          })
          .then((ws) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: ws,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "git.health": {
        void this.gitService
          .getHealth()
          .then((health) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: health,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "git.status": {
        const p = req.params as { cwd: string }
        if (!p?.cwd) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'cwd' parameter",
          })
          break
        }
        void this.gitService
          .getStatus(p.cwd)
          .then((status) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: status,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "git.branches": {
        const p = req.params as { cwd: string }
        if (!p?.cwd) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'cwd' parameter",
          })
          break
        }
        void this.gitService
          .getBranches(p.cwd)
          .then((branches) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: branches,
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "git.checkIgnore": {
        const p = req.params as { cwd: string; paths: string[] }
        if (!p?.cwd || !Array.isArray(p.paths)) {
          this.sendError(state, req.id, {
            code: "INVALID_PARAMS",
            message: "Missing 'cwd' or 'paths' parameter",
          })
          break
        }
        void this.gitService
          .checkIgnore(p.cwd, p.paths)
          .then((ignoredSet) => {
            this.sendMessage(state, {
              type: "response",
              id: req.id,
              success: true,
              result: Array.from(ignoredSet),
            })
          })
          .catch((err) => {
            this.sendError(state, req.id, {
              code: "INTERNAL_ERROR",
              message: err.message,
            })
          })
        break
      }
      case "sessions.attach":
        this.reply(state, req.id, () => this.attachSession(req.params))
        break
      case "sessions.detach":
        this.reply(state, req.id, () => this.detachSession(req.params))
        break
      case "sessions.prepareLeave":
        this.reply(state, req.id, () => this.changeSessions(async () => {
          const publicSessionId = requireSessionId(req.params)
          const host = this.sessionHosts.get(publicSessionId)
          if (host) return host.prepareLeave()
          // No active host means no in-memory batch to drain. Existing journal
          // rows remain on disk and Leave retains their encrypted key descriptor.
          const row = this.db.db.prepare(`SELECT count(*) AS count FROM outbound_batches
            WHERE session_id=? AND state IN ('pending', 'sent')`).get(publicSessionId) as { count: number }
          const hasStaged = this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_binary_versions'").get()
          const staged = hasStaged ? this.db.db.prepare("SELECT count(*) AS count FROM pending_binary_versions WHERE session_id=?")
            .get(publicSessionId) as { count: number } : { count: 0 }
          return { pendingBatches: row.count, pendingBinaryVersions: staged.count }
        }))
        break
      case "sessions.pause":
        this.reply(state, req.id, () => this.changeSessions(() => this.requireSessionHost(req.params).pauseSession()))
        break
      case "sessions.prepareClose":
        this.reply(state, req.id, () => this.changeSessions(() => this.prepareSessionClose(requireSessionId(req.params))))
        break
      case "sessions.close":
        this.reply(state, req.id, () => this.changeSessions(() => {
          const choice = (req.params as { choice?: import("@cozea/projectd-protocol").ProjectdCloseChoice })?.choice
          if (!choice) throw new Error("A close review and explicit choices are required")
          const recovery = this.recoveryClosers.get(requireSessionId(req.params))
          return recovery ? recovery.closeSession(choice) : this.requireSessionHost(req.params).closeSession(choice)
        }))
        break
      case "sessions.clear":
        this.reply(state, req.id, () => this.changeSessions(async () => {
          this.recoveryClosers.clear()
          this.db.db.prepare("DELETE FROM background_session_access").run()
          this.db.db.prepare("DELETE FROM background_sessions").run()
          this.db.db.prepare("DELETE FROM background_session_recovery").run()
          for (const publicSessionId of this.sessionHosts.keys()) {
            await this.detachSessionUnlocked({ publicSessionId }, false)
          }
          return { cleared: true }
        }))
        break
      case "sessions.list":
        this.reply(state, req.id, () => [...this.sessionHosts.values()].map((host) => host.status()))
        break
      case "sessions.recovery.list":
        this.reply(state, req.id, async () => this.backgroundStore.discoverRecovery(await this.backgroundIdentity.loadExistingIdentity()))
        break
      case "sessions.recovery.preview":
        this.reply(state, req.id, async () => {
          const publicSessionId = requireSessionId(req.params)
          const p = (req.params ?? {}) as { afterCursor?: unknown; limit?: unknown }
          if (p.afterCursor !== undefined && (typeof p.afterCursor !== "string" || p.afterCursor.length > 512)) {
            throw invalidParams("afterCursor must be a bounded recovery cursor")
          }
          if (p.limit !== undefined && (typeof p.limit !== "number" || !Number.isSafeInteger(p.limit) || p.limit < 1 || p.limit > 100)) {
            throw invalidParams("limit must be an integer from 1 to 100")
          }
          const identity = await this.backgroundIdentity.loadExistingIdentity()
          const descriptor = this.backgroundStore.findRecovery(publicSessionId, identity)
          if (!descriptor) throw new ProjectdRequestError("NOT_FOUND", "No local recovery record exists for this device")
          return previewLocalRecovery(this.db, descriptor, {
            afterCursor: p.afterCursor as string | undefined,
            limit: p.limit as number | undefined,
          })
        })
        break
      case "sessions.recovery.export":
        this.reply(state, req.id, () => this.changeSessions(async () => {
          const publicSessionId = requireSessionId(req.params)
          const destination = (req.params as { destinationParent?: unknown }).destinationParent
          if (typeof destination !== "string" || !path.isAbsolute(destination)) throw invalidParams("Choose an absolute export folder")
          const identity = await this.backgroundIdentity.loadExistingIdentity()
          const source = (req.params as { source?: unknown }).source ?? "local"
          if (source !== "local" && source !== "cloud") throw invalidParams("Invalid recovery source")
          if (source === "cloud") {
            const context = (req.params as { cloudContext?: { projectId?: unknown; background?: { gatewayUrl?: unknown; convexUrl?: unknown } } }).cloudContext
            if (context) {
              if (typeof context.projectId !== "string" || !context.projectId ||
                typeof context.background?.gatewayUrl !== "string" || typeof context.background.convexUrl !== "string") {
                throw invalidParams("Cloud recovery requires a project and trusted services")
              }
              const request = { publicSessionId, projectId: context.projectId,
                background: { gatewayUrl: context.background.gatewayUrl, convexUrl: context.background.convexUrl } }
              return exportCloudRecovery({ destinationParent: destination, connectorFactory: this.sessionConnectorFactory,
                getAccess: async () => this.recoverySessionAuth(request, identity, this.backgroundIdentity, "recovery") })
            }
            const saved = this.backgroundStore.findRecovery(publicSessionId, identity)
            if (!saved) throw new Error("Cloud recovery requires the session's project")
            return exportCloudRecovery({ destinationParent: destination, sourceRoot: saved.rootPath,
              connectorFactory: this.sessionConnectorFactory,
              getAccess: async () => this.recoverySessionAuth(saved, identity, this.backgroundIdentity, "recovery") })
          }
          const descriptor = this.backgroundStore.findRecovery(publicSessionId, identity)
          if (!descriptor) throw new Error("No recovery record exists for this device")
          return exportLocalRecovery(this.db, descriptor, destination)
        }))
        break
      case "sessions.recovery.shareKeys":
        this.reply(state, req.id, () => this.changeSessions(async () => {
          const publicSessionId = requireSessionId(req.params)
          const context = (req.params as { context?: { projectId?: unknown; background?: { gatewayUrl?: unknown; convexUrl?: unknown } } }).context
          if (typeof context?.projectId !== "string" || !context.projectId ||
            typeof context.background?.gatewayUrl !== "string" || typeof context.background.convexUrl !== "string") {
            throw invalidParams("Recovery key sharing requires a project and trusted services")
          }
          const identity = await this.backgroundIdentity.loadExistingIdentity()
          return shareBackgroundRecoveryKeys({ publicSessionId, projectId: context.projectId,
            background: { gatewayUrl: context.background.gatewayUrl, convexUrl: context.background.convexUrl } }, identity, this.backgroundIdentity)
        }))
        break
      case "sessions.status":
        this.reply(state, req.id, () => this.sessionHosts.get(requireSessionId(req.params))?.status() ?? null)
        break
      case "sessions.updateTicket":
        this.reply(state, req.id, () => this.updateSessionTicket(req.params))
        break
      case "sessions.checkpointNow":
        this.reply(state, req.id, () => this.checkpointSession(req.params))
        break
      case "sessions.ignoreEnvironmentFiles":
        this.reply(state, req.id, async () => ({
          paths: await this.requireSessionHost(req.params).ignoreEnvironmentFiles(),
        }))
        break
      case "sessions.checkTarget":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).checkTarget())
        break
      case "sessions.dismissTarget":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).dismissTargetRecommendation())
        break
      case "sessions.rebaseRecovery":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).manageRebaseRecovery((req.params as { request?: unknown }).request))
        break
      case "sessions.binaryConflicts":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).manageBinaryConflicts((req.params as { request?: unknown }).request))
        break
      case "sessions.structuralConflicts":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).manageStructuralConflicts((req.params as { request?: unknown }).request))
        break
      case "sessions.rebase":
        this.reply(state, req.id, () =>
          this.requireSessionHost(req.params).rebase((req.params as { allowConflicts?: unknown })?.allowConflicts === true),
        )
        break
      case "sessions.previewMerge":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).previewMerge())
        break
      case "sessions.createPullRequest":
      case "sessions.merge":
        this.reply(state, req.id, () => {
          const params = (req.params ?? {}) as { strategy?: unknown; checkpointOid?: unknown; targetOid?: unknown }
          if (typeof params.checkpointOid !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(params.checkpointOid)) {
            throw invalidParams("checkpointOid must be the commit of the save that was reviewed")
          }
          const strategy = params.strategy === "squash" ? "squash" : "merge"
          if (typeof params.targetOid !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(params.targetOid)) {
            throw invalidParams("targetOid must be the target commit that was reviewed")
          }
          const host = this.requireSessionHost(req.params)
          return req.method === "sessions.createPullRequest"
            ? host.createPullRequest(params.checkpointOid, params.targetOid)
            : host.merge(strategy, params.checkpointOid, params.targetOid)
        })
        break
      case "sessions.adoptGitResult":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).adoptGitResult())
        break
      case "sessions.syncFromGitHub":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).syncFromGitHub())
        break
      default: {
        this.sendError(state, req.id, {
          code: "METHOD_NOT_FOUND",
          message: `Method '${req.method}' not found`,
        })
      }
    }
  }

  /** Answers a request with whatever the work returns or throws. */
  private reply(state: ConnectionState, id: string, work: () => unknown): void {
    void Promise.resolve()
      .then(work)
      .then(
        (result) => this.sendMessage(state, { type: "response", id, success: true, result }),
        (err: unknown) =>
          this.sendError(state, id, {
            code: errorCode(err),
            message: err instanceof Error ? err.message : String(err),
          }),
      )
  }

  /**
   * Starts syncing a folder with a session and answers straight away; the host
   * reports progress as `status` events on the session's topic.
   */
  private changeSessions<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.sessionChanges.then(work)
    this.sessionChanges = pending.catch(() => undefined)
    return pending
  }

  private attachSession(params: unknown): Promise<ProjectdSessionStatus> {
    return this.changeSessions(() => this.attachSessionUnlocked(params))
  }

  private async prepareSessionClose(publicSessionId: string) {
    this.recoveryClosers.delete(publicSessionId)
    const host = this.sessionHosts.get(publicSessionId)
    if (host) {
      try { return await host.prepareClose() } catch {
        // A paused host may still exist until the next auth refresh. Recovery
        // independently rechecks lifecycle and manager access before proceeding.
      }
    }
    const identity = await this.backgroundIdentity.loadExistingIdentity()
    const saved = this.backgroundStore.findRecovery(publicSessionId, identity)
    if (!saved) throw new Error("Open this session on this device before reviewing its retained state")
    const merger = saved.branchName && saved.targetBranch ? new SessionMerger({ workspaceRoot: saved.rootPath,
      branchName: saved.branchName, targetBranch: saved.targetBranch, gitService: this.gitService }) : null
    const recovery = new SessionRecoveryCoordinator({
      connectorFactory: this.sessionConnectorFactory,
      getAccess: async () => {
        const currentIdentity = await this.backgroundIdentity.loadExistingIdentity()
        if (currentIdentity.identityKey !== identity.identityKey) throw new Error("Device identity changed; review again")
        return this.recoverySessionAuth(saved, currentIdentity, this.backgroundIdentity, "paused_close")
      },
      previewMerge: merger ? (checkpointOid, unsavedChanges) => merger.preview({ checkpointOid, unsavedChanges }) : undefined,
    })
    const review = await recovery.prepareClose()
    this.recoveryClosers.set(publicSessionId, recovery)
    return review
  }

  private async attachSessionUnlocked(params: unknown, persist = true, offline = false): Promise<ProjectdSessionStatus> {
    if (this.isShuttingDown) throw new Error("Daemon is stopping")
    const attach = parseAttachParams(params)
    const background = (params as ProjectdSessionAttachParams).background
    const identity = background && persist ? await this.backgroundIdentity.loadExistingIdentity() : null
    if (identity && this.backgroundStore.accessState(attach.publicSessionId, identity).denied) {
      throw new Error("Session access must be freshly verified before attachment")
    }
    const existing = this.sessionHosts.get(attach.publicSessionId)
    if (existing && existing.roomKeyVersion > attach.roomKeyVersion) return existing.status()
    if (existing && existing.state !== "failed" && existing.roomKeyVersion === attach.roomKeyVersion) {
      if (existing.workspaceRoot !== attach.rootPath) {
        throw new ProjectdRequestError(
          "ALREADY_EXISTS",
          `Session ${attach.publicSessionId} already syncs ${existing.workspaceRoot}`,
        )
      }
      if (!offline) existing.updateTicket(attach.ticket)
      if (identity) this.backgroundStore.save(params as BackgroundSessionDescriptor, identity)
      return existing.status()
    }
    if (existing) {
      this.sessionHosts.delete(attach.publicSessionId)
      await existing.stop()
    }
    for (const host of this.sessionHosts.values()) {
      if (host.workspaceRoot === attach.rootPath) {
        throw new ProjectdRequestError(
          "ALREADY_EXISTS",
          `${attach.rootPath} already syncs session ${host.publicSessionId}`,
        )
      }
    }
    const folder = await fs.promises.stat(attach.rootPath).catch(() => null)
    if (!folder?.isDirectory()) {
      throw invalidParams(`Folder not found: ${attach.rootPath}`)
    }

    await this.workspaceRegistry.registerWorkspace({
      workspaceId: asWorkspaceId(attach.workspaceId),
      projectId: asProjectId(attach.projectId),
      rootPath: attach.rootPath,
      source: "collaboration-session",
    })

    if (identity) this.backgroundStore.save(params as BackgroundSessionDescriptor, identity)

    const repositoryToken = async (scope: { owner: string; repository: string }, purpose: "pull_request" | "git_write") => {
      const currentIdentity = await this.backgroundIdentity.loadExistingIdentity()
      if (this.backgroundStore.accessState(attach.publicSessionId, currentIdentity).denied) throw new Error("Session access was revoked")
      const descriptor = this.backgroundStore.findActive(attach.publicSessionId, currentIdentity)
      if (!descriptor || descriptor.projectId !== attach.projectId) throw new Error("Session background access is unavailable")
      const token = await getBackgroundRepositoryToken(descriptor, scope, this.backgroundIdentity, purpose)
      const after = await this.backgroundIdentity.loadExistingIdentity()
      if (after.identityKey !== currentIdentity.identityKey || this.backgroundStore.accessState(attach.publicSessionId, after).denied ||
        !this.backgroundStore.findActive(attach.publicSessionId, after)) throw new Error("Session authorization changed")
      return token
    }
    const topic = projectdSessionTopic(attach.publicSessionId)
    const host = new CollaborationSessionHost({
      repositoryCredentials: background ? (scope) => repositoryToken(scope, "git_write") : undefined,
      pullRequests: this.sessionPullRequests?.(attach.projectId, attach.publicSessionId) ?? (background ? new GitHubSessionPullRequest({
        getRepositoryToken: (scope) => repositoryToken(scope, "pull_request"),
      }) : undefined),
      publicSessionId: attach.publicSessionId,
      workspaceId: attach.workspaceId,
      workspaceRoot: attach.rootPath,
      roomKey: attach.roomKey,
      roomKeyVersion: attach.roomKeyVersion,
      previousRoomKeys: attach.previousRoomKeys,
      ticket: attach.ticket,
      db: this.db,
      gitService: this.gitService,
      branchName: attach.branchName,
      shareEnvironmentFiles: attach.shareEnvironmentFiles,
      targetBranch: attach.targetBranch,
      sessionStartedAt: attach.sessionStartedAt,
      actor: {
        actorType: "user",
        principalId: attach.actor?.principalId,
        identityKey: attach.actor?.identityKey,
      },
      connectorFactory: this.sessionConnectorFactory,
      fileEventSource: this.fileEventSourceFactory?.(attach.rootPath),
      rescanIntervalMs: this.sessionRescanIntervalMs,
      onStatus: (status) => this.broadcast(topic, "status", status),
      onTicketNeeded: () => {
        if (background) {
          if (this.backgroundTimer) clearTimeout(this.backgroundTimer)
          this.backgroundTimer = null
          if (!this.backgroundRefresh) this.scheduleBackgroundRefresh(0)
        } else this.broadcast(topic, "ticket_needed", { publicSessionId: attach.publicSessionId })
      },
    })
    this.sessionHosts.set(attach.publicSessionId, host)
    void host.start(offline)
    return host.status()
  }

  private detachSession(params: unknown, forget = true): Promise<{ detached: boolean }> {
    return this.changeSessions(() => this.detachSessionUnlocked(params, forget))
  }

  private async detachSessionUnlocked(params: unknown, forget: boolean): Promise<{ detached: boolean }> {
    const publicSessionId = requireSessionId(params)
    if (forget) this.recoveryClosers.delete(publicSessionId)
    if (forget) this.backgroundStore.remove(publicSessionId)
    const host = this.sessionHosts.get(publicSessionId)
    if (!host) return { detached: false }
    this.sessionHosts.delete(publicSessionId)
    await host.stop()
    return { detached: true }
  }

  private updateSessionTicket(params: unknown): ProjectdSessionStatus {
    const publicSessionId = requireSessionId(params)
    const host = this.sessionHosts.get(publicSessionId)
    if (!host) {
      throw new ProjectdRequestError("NOT_FOUND", `Session ${publicSessionId} is not attached`)
    }
    host.updateTicket(parseTicket((params as { ticket?: unknown }).ticket))
    return host.status()
  }

  private requireSessionHost(params: unknown): CollaborationSessionHost {
    const publicSessionId = requireSessionId(params)
    const host = this.sessionHosts.get(publicSessionId)
    if (!host) {
      throw new ProjectdRequestError("NOT_FOUND", `Session ${publicSessionId} is not attached`)
    }
    return host
  }

  /** Saves an attached session to its Git branch now, or asks the device that saves to. */
  private checkpointSession(params: unknown) {
    const publicSessionId = requireSessionId(params)
    const host = this.sessionHosts.get(publicSessionId)
    if (!host) {
      throw new ProjectdRequestError("NOT_FOUND", `Session ${publicSessionId} is not attached`)
    }
    return host.checkpointNow()
  }

  broadcast(topic: string, event: string, payload: unknown): void {
    const msg: ProjectdEventMessage = {
      type: "event",
      topic,
      event,
      payload,
      timestamp: Date.now(),
    }
    for (const client of this.connections) {
      if (client.handshaked && client.subscribedTopics.has(topic)) {
        this.sendMessage(client, msg)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer)
    this.backgroundTimer = null
    await this.backgroundRefresh
    await this.sessionChanges
    this.recoveryClosers.clear()

    const hosts = [...this.sessionHosts.values()]
    this.sessionHosts.clear()
    await Promise.allSettled(hosts.map((host) => host.stop()))

    for (const conn of this.connections) {
      try {
        conn.socket.destroy()
      } catch {
        // Ignore
      }
    }
    this.connections.clear()

    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          try {
            if (fs.existsSync(this.socketPath)) {
              fs.unlinkSync(this.socketPath)
            }
          } catch {
            // Ignore
          }
          this.server = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}
