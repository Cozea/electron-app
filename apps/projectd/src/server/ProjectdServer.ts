import fs from "node:fs"
import net from "node:net"

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
  type ProjectdClientMessage,
  type ProjectdError,
  type ProjectdEventMessage,
  type ProjectdHandshakeResponse,
  type ProjectdHealthResult,
  type ProjectdRequest,
  type ProjectdResponse,
  type ProjectdServerMessage,
} from "@cozea/projectd-protocol"

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

  constructor(options?: ProjectdServerOptions) {
    this.socketPath = options?.socketPath ?? getProjectdSocketPath()
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
      default: {
        this.sendError(state, req.id, {
          code: "METHOD_NOT_FOUND",
          message: `Method '${req.method}' not found`,
        })
      }
    }
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
