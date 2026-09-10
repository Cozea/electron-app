import net from "node:net"

import {
  encodeMessage,
  getProjectdSocketPath,
  LineMessageDecoder,
  PROJECTD_PROTOCOL_VERSION,
  type ProjectdEventMessage,
  type ProjectdHandshakeRequest,
  type ProjectdHandshakeResponse,
  type ProjectdHealthResult,
  type ProjectdRequest,
  type ProjectdServerMessage,
  type ProjectdShutdownResult,
} from "./index"

export interface ProjectdClientOptions {
  socketPath?: string
  clientName?: string
  clientVersion?: string
  timeoutMs?: number
}

export class ProjectdClient {
  readonly socketPath: string
  readonly clientName: string
  readonly clientVersion?: string
  readonly defaultTimeoutMs: number

  private socket: net.Socket | null = null
  private decoder = new LineMessageDecoder()
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: any) => void
      reject: (err: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private topicListeners = new Map<string, Set<(event: ProjectdEventMessage) => void>>()
  private isConnected = false
  private isConnecting = false

  constructor(options?: ProjectdClientOptions) {
    this.socketPath = options?.socketPath ?? getProjectdSocketPath()
    this.clientName = options?.clientName ?? "client"
    this.clientVersion = options?.clientVersion
    this.defaultTimeoutMs = options?.timeoutMs ?? 5000
  }

  get connected(): boolean {
    return this.isConnected
  }

  async connect(): Promise<void> {
    if (this.isConnected) return
    if (this.isConnecting) {
      throw new Error("Connection already in progress")
    }
    this.isConnecting = true

    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      this.socket = socket

      const timeoutTimer = setTimeout(() => {
        socket.destroy()
        this.cleanup()
        reject(new Error(`Connection to projectd timed out after ${this.defaultTimeoutMs}ms`))
      }, this.defaultTimeoutMs)

      socket.on("connect", async () => {
        try {
          // Perform protocol handshake
          const handshakeReq: ProjectdHandshakeRequest = {
            type: "handshake",
            id: `hs_${crypto.randomUUID()}`,
            protocolVersion: PROJECTD_PROTOCOL_VERSION,
            clientName: this.clientName,
            clientVersion: this.clientVersion,
          }

          const response = await this.sendHandshake(socket, handshakeReq)
          clearTimeout(timeoutTimer)

          if (!response.success) {
            socket.destroy()
            this.cleanup()
            reject(
              new Error(
                `projectd handshake failed: ${response.error?.message ?? "unknown error"}`,
              ),
            )
            return
          }

          this.isConnected = true
          this.isConnecting = false
          resolve()
        } catch (err) {
          clearTimeout(timeoutTimer)
          socket.destroy()
          this.cleanup()
          reject(err)
        }
      })

      socket.on("data", (chunk) => {
        const messages = this.decoder.push(chunk)
        for (const msg of messages) {
          this.handleIncomingMessage(msg as ProjectdServerMessage)
        }
      })

      socket.on("close", () => {
        this.cleanup()
      })

      socket.on("error", (err) => {
        clearTimeout(timeoutTimer)
        const wasConnecting = this.isConnecting
        this.cleanup()
        if (wasConnecting) {
          reject(err)
        }
      })
    })
  }

  private sendHandshake(
    socket: net.Socket,
    req: ProjectdHandshakeRequest,
  ): Promise<ProjectdHandshakeResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Handshake timed out waiting for server response"))
      }, this.defaultTimeoutMs)

      const onData = (chunk: Buffer) => {
        const msgs = this.decoder.push(chunk)
        for (const msg of msgs) {
          if (msg.type === "handshake_ack" && msg.id === req.id) {
            clearTimeout(timeout)
            socket.removeListener("data", onData)
            resolve(msg)
            return
          }
        }
      }

      socket.on("data", onData)
      socket.write(encodeMessage(req))
    })
  }

  private handleIncomingMessage(msg: ProjectdServerMessage): void {
    if (!msg || typeof msg !== "object") return

    if (msg.type === "response") {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.id)
        if (msg.success) {
          pending.resolve((msg as any).result)
        } else {
          const err = new Error(msg.error.message)
          ;(err as any).code = msg.error.code
          ;(err as any).details = msg.error.details
          pending.reject(err)
        }
      }
    } else if (msg.type === "event") {
      const listeners = this.topicListeners.get(msg.topic)
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(msg)
          } catch (err) {
            console.error("[ProjectdClient] Error in event listener:", err)
          }
        }
      }
    }
  }

  async request<R = unknown, P = unknown>(
    method: string,
    params?: P,
    timeoutMs?: number,
  ): Promise<R> {
    if (!this.isConnected || !this.socket) {
      await this.connect()
    }

    const id = `req_${crypto.randomUUID()}`
    const req: ProjectdRequest<P> = {
      type: "request",
      id,
      method,
      params,
    }

    const timeout = timeoutMs ?? this.defaultTimeoutMs

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request '${method}' timed out after ${timeout}ms`))
      }, timeout)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.socket!.write(encodeMessage(req))
    })
  }

  async health(): Promise<ProjectdHealthResult> {
    return this.request<ProjectdHealthResult>("health")
  }

  async shutdown(reason?: string): Promise<ProjectdShutdownResult> {
    return this.request<ProjectdShutdownResult>("shutdown", { reason })
  }

  async subscribe(
    topic: string,
    listener: (event: ProjectdEventMessage) => void,
  ): Promise<() => void> {
    if (!this.isConnected || !this.socket) {
      await this.connect()
    }

    let listeners = this.topicListeners.get(topic)
    if (!listeners) {
      listeners = new Set()
      this.topicListeners.set(topic, listeners)

      const id = `sub_${crypto.randomUUID()}`
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(id)
          reject(new Error(`Subscription to topic '${topic}' timed out`))
        }, this.defaultTimeoutMs)

        this.pendingRequests.set(id, {
          resolve: () => resolve(),
          reject,
          timer,
        })

        this.socket!.write(encodeMessage({ type: "subscribe", id, topic }))
      })
    }

    listeners.add(listener)

    return () => {
      const current = this.topicListeners.get(topic)
      if (current) {
        current.delete(listener)
        if (current.size === 0) {
          this.topicListeners.delete(topic)
          if (this.isConnected && this.socket) {
            const id = `unsub_${crypto.randomUUID()}`
            this.socket.write(encodeMessage({ type: "unsubscribe", id, topic }))
          }
        }
      }
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.isConnected = false
    this.isConnecting = false
    this.socket = null

    for (const [_, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Connection closed"))
    }
    this.pendingRequests.clear()
  }
}
