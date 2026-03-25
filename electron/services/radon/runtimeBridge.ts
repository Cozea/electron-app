import http from 'node:http'

import { WebSocketServer, type RawData, type WebSocket } from 'ws'

export interface RadonRuntimeEnvelope {
  event: string
  payload?: unknown
}

function decodeMessage(data: RawData): string {
  if (typeof data === 'string') {
    return data
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8')
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8')
  }

  return Buffer.from(data).toString('utf8')
}

function parseEnvelope(raw: string): RadonRuntimeEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as { event?: unknown; payload?: unknown }
    if (typeof parsed.event !== 'string') {
      return null
    }
    return {
      event: parsed.event,
      payload: parsed.payload,
    }
  } catch {
    return null
  }
}

function getMessageId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const value = (payload as { id?: unknown }).id
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export class RadonRuntimeBridgeServer {
  private readonly envelopeListeners = new Set<(envelope: RadonRuntimeEnvelope) => void>()
  private readonly connectionListeners = new Set<(connected: boolean) => void>()
  private activeSocket: WebSocket | null = null
  private connected = false
  private lastReceivedRuntimeMessageId = 0

  private constructor(
    private readonly server: http.Server,
    private readonly wss: WebSocketServer,
  ) {
    this.wss.on('connection', (socket) => this.attachSocket(socket))
  }

  static async create(): Promise<RadonRuntimeBridgeServer> {
    const server = http.createServer(() => {})
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    return new RadonRuntimeBridgeServer(server, new WebSocketServer({ server }))
  }

  get port(): number {
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Radon runtime bridge server is not listening on a numeric port.')
    }
    return address.port
  }

  isConnected(): boolean {
    return this.connected
  }

  onEnvelope(callback: (envelope: RadonRuntimeEnvelope) => void): () => void {
    this.envelopeListeners.add(callback)
    return () => this.envelopeListeners.delete(callback)
  }

  onConnectionChanged(callback: (connected: boolean) => void): () => void {
    this.connectionListeners.add(callback)
    return () => this.connectionListeners.delete(callback)
  }

  sendRuntimeMessage(message: unknown): boolean {
    return this.sendEnvelope({
      event: 'RNIDE_message',
      payload: message,
    })
  }

  dispose(): void {
    this.activeSocket?.terminate()
    this.activeSocket = null
    this.setConnected(false)
    this.wss.close()
    this.server.close()
  }

  private attachSocket(socket: WebSocket): void {
    if (this.activeSocket && this.activeSocket !== socket) {
      this.activeSocket.terminate()
    }

    this.activeSocket = socket
    this.setConnected(true)
    this.sendRuntimeMessage({
      type: 'retransmit',
      id: this.lastReceivedRuntimeMessageId,
    })

    socket.on('message', (data) => {
      const envelope = parseEnvelope(decodeMessage(data))
      if (!envelope) {
        return
      }

      if (envelope.event === 'RNIDE_message') {
        const messageId = getMessageId(envelope.payload)
        if (messageId !== null) {
          this.lastReceivedRuntimeMessageId = Math.max(this.lastReceivedRuntimeMessageId, messageId)
          this.sendRuntimeMessage({
            type: 'ack',
            id: messageId,
          })
        }
      }

      for (const listener of this.envelopeListeners) {
        listener(envelope)
      }
    })

    const handleDisconnect = () => {
      if (this.activeSocket === socket) {
        this.activeSocket = null
        this.setConnected(false)
      }
    }

    socket.on('close', handleDisconnect)
    socket.on('error', handleDisconnect)
  }

  private sendEnvelope(envelope: RadonRuntimeEnvelope): boolean {
    const socket = this.activeSocket
    if (!socket || socket.readyState !== socket.OPEN) {
      return false
    }

    socket.send(JSON.stringify(envelope))
    return true
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return
    }

    this.connected = connected
    for (const listener of this.connectionListeners) {
      listener(connected)
    }
  }
}
