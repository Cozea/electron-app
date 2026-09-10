import fs from "node:fs"
import net from "node:net"

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
}

export class ProjectdServer {
  readonly socketPath: string
  readonly version: string
  readonly startedAt: number

  private server: net.Server | null = null
  private connections = new Set<ConnectionState>()
  private isShuttingDown = false

  constructor(options?: ProjectdServerOptions) {
    this.socketPath = options?.socketPath ?? getProjectdSocketPath()
    this.version = options?.version ?? PROJECTD_DEFAULT_DAEMON_VERSION
    this.startedAt = Date.now()
  }

  async start(): Promise<void> {
    await this.ensureSocketAvailable()

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
