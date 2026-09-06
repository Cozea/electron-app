export const COLLAB_PROTOCOL_VERSION = '2.1'
const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization'
const DEFAULT_ALLOWED_METHODS = 'GET, POST, OPTIONS'

export interface ProtocolErrorPayload {
  code: string
  message: string
  recoverable: boolean
  retryAfterMs?: number
}

export interface HelloMessage {
  type: 'hello'
  payload: {
    protocolVersion: string
    projectId: string
    roomId: string
    sessionToken: string
    clientId: string
    knownSeq: number
    clientType: 'web' | 'electron'
  }
}

export interface ReadyMessage {
  type: 'ready'
  payload: {
    roomId: string
    serverTime: number
    headSeq: number
    resyncRequired: boolean
    mediaClientId?: string
  }
}

export interface SyncRequestMessage {
  type: 'sync.request'
  payload: { roomId: string; knownSeq: number }
}

export interface SyncDeltaMessage {
  type: 'sync.delta'
  payload: {
    roomId: string
    fromSeq: number
    toSeq: number
    updatesBinary: string[]
    headSeq?: number
    hasMore?: boolean
  }
}

export interface UpdatePushMessage {
  type: 'update.push'
  payload: {
    roomId: string
    idempotencyKey: string
    updateBinary: string
    authorType: 'user' | 'agent'
    authorId: string
    timestamp: number
  }
}

export interface UpdateAckMessage {
  type: 'update.ack'
  payload: {
    roomId: string
    seq: number
    idempotencyKey: string
    persisted: boolean
  }
}

export interface PresencePushMessage {
  type: 'presence.push'
  payload: {
    roomId: string
    clientId: string
    awarenessBinary: string
    ttlMs: number
  }
}

export interface PresenceSnapshotMessage {
  type: 'presence.snapshot'
  payload: {
    roomId: string
    entries: Array<{
      clientId: string
      awarenessBinary: string
      expiresAt: number
    }>
  }
}

export interface PresenceRemoveMessage {
  type: 'presence.remove'
  payload: { roomId: string; clientIds: string[] }
}

export interface BarrierRequestMessage {
  type: 'barrier.request'
  payload: { roomId: string; requestId: string }
}

export interface BarrierReadyMessage {
  type: 'barrier.ready'
  payload: { roomId: string; requestId: string; sequence: number }
}

export interface BaseAdvancedMessage {
  type: 'base.advanced'
  payload: {
    roomId: string
    commitSha: string
    coveredThroughSequence: number
  }
}

export interface MediaSignalMessage {
  type: 'media.signal'
  payload: {
    roomId: string
    targetClientId: string
    sourceClientId: string
    signal: unknown
  }
}

export interface MediaStateMessage {
  type: 'media.state'
  payload: {
    roomId: string
    clientId: string
    audio: boolean
    screenShare: boolean
  }
}

export interface ErrorMessage {
  type: 'error'
  payload: ProtocolErrorPayload
}

export type IncomingClientMessage =
  | HelloMessage
  | SyncRequestMessage
  | UpdatePushMessage
  | PresencePushMessage
  | BarrierRequestMessage
  | MediaSignalMessage
  | MediaStateMessage

export type OutgoingServerMessage =
  | ReadyMessage
  | SyncDeltaMessage
  | UpdateAckMessage
  | PresenceSnapshotMessage
  | PresenceRemoveMessage
  | BarrierReadyMessage
  | BaseAdvancedMessage
  | MediaSignalMessage
  | MediaStateMessage
  | ErrorMessage

export function jsonResponse(body: unknown, init?: ResponseInit, origin?: string | null): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(init?.headers, origin),
      ...(init?.headers ?? {}),
    },
  })
}

export function protocolError(
  code: string,
  message: string,
  init?: ResponseInit,
  recoverable = false,
  origin?: string | null,
): Response {
  return jsonResponse(
    { type: 'error', payload: { code, message, recoverable } },
    { status: init?.status ?? 400, headers: init?.headers },
    origin,
  )
}

export function stringifyMessage(message: OutgoingServerMessage): string {
  return JSON.stringify(message)
}

export function corsHeaders(headers?: HeadersInit, origin?: string | null): Record<string, string> {
  const requestOrigin = origin?.trim()
  const allowOrigin = requestOrigin && requestOrigin.length > 0 ? requestOrigin : '*'
  const normalized = new Headers(headers)
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': normalized.get('access-control-allow-methods') ?? DEFAULT_ALLOWED_METHODS,
    'access-control-allow-headers': normalized.get('access-control-allow-headers') ?? DEFAULT_ALLOWED_HEADERS,
    'access-control-max-age': normalized.get('access-control-max-age') ?? '86400',
    vary: normalized.get('vary') ?? 'Origin',
  }
}

export function preflightResponse(origin?: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(undefined, origin) })
}
