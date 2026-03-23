import http, { type IncomingMessage, type ServerResponse } from 'node:http'

import { Mp4BoxStreamParser } from './frameParsers'

type StreamTransport = 'mjpeg' | 'fmp4'

interface BaseStreamEntry {
  clients: Set<ServerResponse>
  transport: StreamTransport
}

interface MjpegStreamEntry extends BaseStreamEntry {
  transport: 'mjpeg'
  latestFrame: Buffer | null
}

interface Fmp4StreamEntry extends BaseStreamEntry {
  transport: 'fmp4'
  parser: Mp4BoxStreamParser
  initBoxes: Buffer[]
  initSegment: Buffer | null
  recentBoxes: Buffer[]
  recentBytes: number
}

type StreamEntry = MjpegStreamEntry | Fmp4StreamEntry

const STREAM_BOUNDARY = 'cozea-native-preview-frame'
const FMP4_RECENT_BYTES_LIMIT = 1024 * 1024

export class NativePreviewStreamServer {
  private server: http.Server | null = null
  private port: number | null = null
  private readonly entries = new Map<string, StreamEntry>()

  private async ensureServer(): Promise<void> {
    if (this.server && this.port) return

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response)
    })

    await new Promise<void>((resolve, reject) => {
      const server = this.server
      if (!server) {
        reject(new Error('Native preview stream server was not created.'))
        return
      }

      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to bind native preview stream server.'))
          return
        }
        this.port = address.port
        resolve()
      })
    })
  }

  async attachSession(sessionId: string, transport: StreamTransport): Promise<string> {
    await this.ensureServer()

    const existing = this.entries.get(sessionId)
    if (existing && existing.transport === transport) {
      return this.buildStreamUrl(sessionId)
    }

    if (existing) {
      this.detachSession(sessionId)
    }

    const entry: StreamEntry = transport === 'mjpeg'
      ? {
          transport,
          clients: new Set(),
          latestFrame: null,
        }
      : {
          transport,
          clients: new Set(),
          parser: new Mp4BoxStreamParser(),
          initBoxes: [],
          initSegment: null,
          recentBoxes: [],
          recentBytes: 0,
        }

    this.entries.set(sessionId, entry)
    return this.buildStreamUrl(sessionId)
  }

  publishFrame(sessionId: string, frame: Buffer): void {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.transport !== 'mjpeg') return

    entry.latestFrame = frame
    for (const client of [...entry.clients]) {
      this.writeFrame(client, frame)
    }
  }

  publishVideoChunk(sessionId: string, chunk: Buffer): void {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.transport !== 'fmp4' || !chunk.length) return

    try {
      entry.parser.push(chunk, (type, box) => {
        this.handleFmp4Box(entry, type, box)
      })
    } catch {
      for (const client of [...entry.clients]) {
        if (!client.writableEnded) {
          client.end()
        }
      }
      this.entries.delete(sessionId)
    }
  }

  detachSession(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    for (const client of entry.clients) {
      if (!client.writableEnded) {
        client.end()
      }
    }

    this.entries.delete(sessionId)
  }

  private buildStreamUrl(sessionId: string): string {
    return `http://127.0.0.1:${this.port}/native-preview/${encodeURIComponent(sessionId)}`
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ? new URL(request.url, 'http://127.0.0.1') : null
    const pathName = url?.pathname ?? ''
    const prefix = '/native-preview/'

    if (!pathName.startsWith(prefix)) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    const sessionId = decodeURIComponent(pathName.slice(prefix.length))
    const entry = this.entries.get(sessionId)
    if (!entry) {
      response.writeHead(404)
      response.end('Unknown native preview session')
      return
    }

    if (entry.transport === 'mjpeg') {
      response.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Connection: 'keep-alive',
        Pragma: 'no-cache',
        Expires: '0',
      })
      entry.clients.add(response)
      if (entry.latestFrame) {
        this.writeFrame(response, entry.latestFrame)
      }
    } else {
      response.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Connection: 'keep-alive',
        Pragma: 'no-cache',
        Expires: '0',
      })
      entry.clients.add(response)
      if (entry.initSegment) {
        response.write(entry.initSegment)
        for (const box of entry.recentBoxes) {
          response.write(box)
        }
      }
    }

    request.on('close', () => {
      entry.clients.delete(response)
    })
  }

  private writeFrame(response: ServerResponse, frame: Buffer): void {
    if (response.destroyed || response.writableEnded) {
      return
    }

    try {
      response.write(`--${STREAM_BOUNDARY}\r\n`)
      response.write(`Content-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`)
      response.write(frame)
      response.write('\r\n')
    } catch {
      response.end()
    }
  }

  private handleFmp4Box(entry: Fmp4StreamEntry, type: string, box: Buffer): void {
    if (!entry.initSegment) {
      if (type === 'moof') {
        entry.initSegment = Buffer.concat(entry.initBoxes)
        entry.initBoxes = []
        for (const client of [...entry.clients]) {
          if (!client.destroyed && !client.writableEnded) {
            client.write(entry.initSegment)
          }
        }
      } else {
        entry.initBoxes.push(box)
        return
      }
    }

    entry.recentBoxes.push(box)
    entry.recentBytes += box.length
    while (entry.recentBytes > FMP4_RECENT_BYTES_LIMIT && entry.recentBoxes.length > 1) {
      const dropped = entry.recentBoxes.shift()
      if (dropped) {
        entry.recentBytes -= dropped.length
      }
    }

    for (const client of [...entry.clients]) {
      if (client.destroyed || client.writableEnded) {
        entry.clients.delete(client)
        continue
      }

      try {
        client.write(box)
      } catch {
        client.end()
      }
    }
  }
}
