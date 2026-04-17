export type YjsOriginKind =
  | 'agent'
  | 'init'
  | 'reconnect'
  | 'remote'
  | 'snapshot'
  | 'state-vector'
  | 'sync'
  | 'user'

export interface RemoteYjsOrigin {
  type: 'remote'
  checkpointGroupId?: string | null
  clientId?: string | null
  sourceOrigin?: string | null
  timestamp?: number | null
}

export function isRemoteYjsOrigin(origin: unknown): origin is RemoteYjsOrigin | 'remote' {
  return origin === 'remote' || (typeof origin === 'object' && origin !== null && (origin as { type?: unknown }).type === 'remote')
}

export function resolveYjsOriginKind(origin: unknown): YjsOriginKind | string | undefined {
  if (typeof origin === 'string') {
    return origin
  }
  if (isRemoteYjsOrigin(origin)) {
    return 'remote'
  }
  return undefined
}

export function extractRemoteYjsOrigin(origin: unknown): RemoteYjsOrigin | null {
  if (origin === 'remote') {
    return { type: 'remote' }
  }
  if (!isRemoteYjsOrigin(origin)) {
    return null
  }
  const raw = origin as RemoteYjsOrigin
  return {
    type: 'remote',
    checkpointGroupId: typeof raw.checkpointGroupId === 'string' ? raw.checkpointGroupId : null,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : null,
    sourceOrigin: typeof raw.sourceOrigin === 'string' ? raw.sourceOrigin : null,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : null,
  }
}

export function makeRemoteYjsOrigin(input: {
  checkpointGroupId?: string | null
  clientId?: string | null
  sourceOrigin?: string | null
  timestamp?: number | null
}): RemoteYjsOrigin {
  return {
    type: 'remote',
    checkpointGroupId: input.checkpointGroupId ?? null,
    clientId: input.clientId ?? null,
    sourceOrigin: input.sourceOrigin ?? null,
    timestamp: input.timestamp ?? null,
  }
}
