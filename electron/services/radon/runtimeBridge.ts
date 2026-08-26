import type { AddressInfo } from 'node:net'

import { WebSocketServer, type WebSocket } from 'ws'

interface RuntimeEnvelope {
  event: string
  payload?: unknown
}

type RuntimeEnvelopeListener = (envelope: RuntimeEnvelope) => void

interface RuntimeMessagePayload {
  id?: number
  type?: string
  data?: unknown
}

const RUNTIME_EVENT = 'RNIDE_message'

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN
}

function safeSend(socket: WebSocket, envelope: RuntimeEnvelope): boolean {
  if (!isOpen(socket)) {
    return false
  }

  try {
    socket.send(JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

export class RadonRuntimeBridgeServer {
  private readonly sockets = new Set<WebSocket>()
  private readonly listeners = new Set<RuntimeEnvelopeListener>()
  private readonly server: WebSocketServer
  public readonly port: number
  private highestReceivedMessageId = 0

  private constructor(server: WebSocketServer, port: number) {
    this.server = server
    this.port = port

    this.server.on('connection', (socket) => {
      this.sockets.add(socket)

      safeSend(socket, {
        event: RUNTIME_EVENT,
        payload: {
          type: 'retransmit',
          id: this.highestReceivedMessageId,
        },
      })

      socket.on('message', (data) => {
        this.handleSocketMessage(socket, data.toString())
      })

      const cleanup = () => {
        this.sockets.delete(socket)
      }
      socket.on('close', cleanup)
      socket.on('error', cleanup)
    })
  }

  public static async create(preferredPort = 0): Promise<RadonRuntimeBridgeServer> {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: preferredPort,
    })

    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve())
      server.once('error', reject)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Failed to resolve runtime bridge port.')
    }

    return new RadonRuntimeBridgeServer(server, (address as AddressInfo).port)
  }

  public onEnvelope(listener: RuntimeEnvelopeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public sendRuntimeMessage(payload: unknown): boolean {
    const envelope: RuntimeEnvelope = {
      event: RUNTIME_EVENT,
      payload,
    }

    let sent = false
    for (const socket of this.sockets) {
      sent = safeSend(socket, envelope) || sent
    }
    return sent
  }

  public dispose(): void {
    for (const socket of this.sockets) {
      try {
        socket.close()
      } catch {
        // Ignore shutdown errors.
      }
    }
    this.sockets.clear()
    this.listeners.clear()
    this.server.close()
  }

  private handleSocketMessage(socket: WebSocket, raw: string): void {
    let envelope: RuntimeEnvelope
    try {
      envelope = JSON.parse(raw) as RuntimeEnvelope
    } catch {
      return
    }

    if (envelope.event !== RUNTIME_EVENT) {
      return
    }

    const payload = envelope.payload as RuntimeMessagePayload | undefined
    if (typeof payload?.id === 'number') {
      this.highestReceivedMessageId = Math.max(this.highestReceivedMessageId, payload.id)
      safeSend(socket, {
        event: RUNTIME_EVENT,
        payload: {
          type: 'ack',
          id: payload.id,
        },
      })
    }

    this.listeners.forEach((listener) => listener(envelope))
  }
}
