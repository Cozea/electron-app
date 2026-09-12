import fs from "node:fs"
import net from "node:net"
import path from "node:path"

import {
  asProjectId,
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

interface ConnectionState {
  socket: net.Socket
  decoder: LineMessageDecoder
  handshaked: boolean
  clientName: string
  subscribedTopics: Set<string>
}

export interface ProjectdServerOptions {
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
  return {
    publicSessionId,
    workspaceId: attach.workspaceId,
    projectId: attach.projectId,
    rootPath: path.resolve(attach.rootPath),
    roomKey: new Uint8Array(roomKey),
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

  private server: net.Server | null = null
  private connections = new Set<ConnectionState>()
  private isShuttingDown = false
  private readonly sessionHosts = new Map<string, CollaborationSessionHost>()
  private readonly sessionConnectorFactory?: (wsUrl: string) => RoomConnector
  private readonly fileEventSourceFactory?: (rootPath: string) => FileEventSource
  private readonly sessionRescanIntervalMs?: number

  constructor(options?: ProjectdServerOptions) {
    this.socketPath = options?.socketPath ?? getProjectdSocketPath()
    this.sessionConnectorFactory = options?.sessionConnectorFactory
    this.fileEventSourceFactory = options?.fileEventSourceFactory
    this.sessionRescanIntervalMs = options?.sessionRescanIntervalMs
    this.version = options?.version ?? PROJECTD_DEFAULT_DAEMON_VERSION
    this.startedAt = Date.now()

    this.db = options?.database ?? new ProjectdDatabase(options?.dbPath)
    this.workbenchStore = new SqliteWorkbenchStore(this.db)
    this.workspaceRegistry = new WorkspaceRegistry(this.db)
    this.catalogImporter = new WorkspaceCatalogImporter(this.db, options?.sourceCatalogPath)
    this.gitService = new GitService()
  }

  async start(): Promise<void> {
    await this.ensureSocketAvailable()
    await this.catalogImporter.importIfNecessary()

    return new Promise<void>((resolve, reject) => {
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
      case "sessions.list":
        this.reply(state, req.id, () => [...this.sessionHosts.values()].map((host) => host.status()))
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
      case "sessions.previewMerge":
        this.reply(state, req.id, () => this.requireSessionHost(req.params).previewMerge())
        break
      case "sessions.merge":
        this.reply(state, req.id, () => {
          const params = (req.params ?? {}) as { strategy?: unknown; checkpointOid?: unknown }
          if (typeof params.checkpointOid !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(params.checkpointOid)) {
            throw invalidParams("checkpointOid must be the commit of the save that was reviewed")
          }
          const strategy = params.strategy === "squash" ? "squash" : "merge"
          return this.requireSessionHost(req.params).merge(strategy, params.checkpointOid)
        })
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
  private async attachSession(params: unknown): Promise<ProjectdSessionStatus> {
    const attach = parseAttachParams(params)
    const existing = this.sessionHosts.get(attach.publicSessionId)
    if (existing && existing.state !== "failed") {
      if (existing.workspaceRoot !== attach.rootPath) {
        throw new ProjectdRequestError(
          "ALREADY_EXISTS",
          `Session ${attach.publicSessionId} already syncs ${existing.workspaceRoot}`,
        )
      }
      existing.updateTicket(attach.ticket)
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

    const topic = projectdSessionTopic(attach.publicSessionId)
    const host = new CollaborationSessionHost({
      publicSessionId: attach.publicSessionId,
      workspaceId: attach.workspaceId,
      workspaceRoot: attach.rootPath,
      roomKey: attach.roomKey,
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
      onTicketNeeded: () => this.broadcast(topic, "ticket_needed", { publicSessionId: attach.publicSessionId }),
    })
    this.sessionHosts.set(attach.publicSessionId, host)
    void host.start()
    return host.status()
  }

  private async detachSession(params: unknown): Promise<{ detached: boolean }> {
    const publicSessionId = requireSessionId(params)
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
