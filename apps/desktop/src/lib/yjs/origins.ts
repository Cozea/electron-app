import type { FileChangeAttribution } from '../../../../../shared/electronApiTypes'

export type YjsOriginKind =
  | 'agent'
  | 'init'
  | 'reconnect'
  | 'remote'
  | 'snapshot'
  | 'state-vector'
  | 'sync'
  | 'user'

export interface RemoteYjsOrigin extends FileChangeAttribution {
  type: 'remote'
}

export function isAttributedYjsOrigin(origin: unknown): origin is FileChangeAttribution {
  return (
    typeof origin === 'object' &&
    origin !== null &&
    typeof (origin as { origin?: unknown }).origin === 'string'
  )
}

export function isRemoteYjsOrigin(origin: unknown): origin is RemoteYjsOrigin | 'remote' {
  return origin === 'remote' || (typeof origin === 'object' && origin !== null && (origin as { type?: unknown }).type === 'remote')
}

export function resolveYjsOriginKind(origin: unknown): YjsOriginKind | string | undefined {
  if (typeof origin === 'string') {
    return origin
  }
  if (isRemoteYjsOrigin(origin)) {
    return extractRemoteYjsOrigin(origin)?.origin ?? 'remote'
  }
  if (isAttributedYjsOrigin(origin)) {
    return origin.origin
  }
  return undefined
}

export function extractAttributionOrigin(origin: unknown): FileChangeAttribution | null {
  if (!isAttributedYjsOrigin(origin)) {
    return null
  }

  const raw = origin as FileChangeAttribution
  return {
    origin: raw.origin,
    sourceOrigin: typeof raw.sourceOrigin === 'string' ? raw.sourceOrigin : undefined,
    actorType:
      raw.actorType === 'user' || raw.actorType === 'agent' || raw.actorType === 'system'
        ? raw.actorType
        : undefined,
    actorId: typeof raw.actorId === 'string' ? raw.actorId : undefined,
    principalId: typeof raw.principalId === 'string' ? raw.principalId : undefined,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
    terminalId: typeof raw.terminalId === 'string' ? raw.terminalId : undefined,
    terminalTitle: typeof raw.terminalTitle === 'string' ? raw.terminalTitle : undefined,
    terminalKind: typeof raw.terminalKind === 'string' ? raw.terminalKind : undefined,
    commandId: typeof raw.commandId === 'string' ? raw.commandId : undefined,
    commandText: typeof raw.commandText === 'string' ? raw.commandText : undefined,
    runId: typeof raw.runId === 'string' ? raw.runId : undefined,
    sessionKey: typeof raw.sessionKey === 'string' ? raw.sessionKey : undefined,
    laneId: typeof raw.laneId === 'string' ? raw.laneId : undefined,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
    gitCwd: typeof raw.gitCwd === 'string' ? raw.gitCwd : undefined,
    checkpointGroupId: typeof raw.checkpointGroupId === 'string' ? raw.checkpointGroupId : undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : undefined,
  }
}

export function extractRemoteYjsOrigin(origin: unknown): RemoteYjsOrigin | null {
  if (origin === 'remote') {
    return { type: 'remote', origin: 'remote' }
  }
  if (!isRemoteYjsOrigin(origin)) {
    return null
  }
  const raw = extractAttributionOrigin(origin) ?? ({ origin: 'remote' } as FileChangeAttribution)
  return {
    type: 'remote',
    ...raw,
    origin: raw.origin ?? 'remote',
  }
}

export function makeRemoteYjsOrigin(input: {
  origin?: FileChangeAttribution['origin'] | null
  sourceOrigin?: string | null
  actorType?: FileChangeAttribution['actorType'] | null
  actorId?: string | null
  principalId?: string | null
  displayName?: string | null
  checkpointGroupId?: string | null
  clientId?: string | null
  terminalId?: string | null
  terminalTitle?: string | null
  terminalKind?: string | null
  commandId?: string | null
  commandText?: string | null
  runId?: string | null
  sessionKey?: string | null
  laneId?: string | null
  workspaceId?: string | null
  gitCwd?: string | null
  timestamp?: number | null
}): RemoteYjsOrigin {
  return {
    type: 'remote',
    origin: input.origin ?? 'remote',
    sourceOrigin: input.sourceOrigin ?? undefined,
    actorType: input.actorType ?? undefined,
    actorId: input.actorId ?? undefined,
    principalId: input.principalId ?? undefined,
    displayName: input.displayName ?? undefined,
    checkpointGroupId: input.checkpointGroupId ?? undefined,
    clientId: input.clientId ?? undefined,
    terminalId: input.terminalId ?? undefined,
    terminalTitle: input.terminalTitle ?? undefined,
    terminalKind: input.terminalKind ?? undefined,
    commandId: input.commandId ?? undefined,
    commandText: input.commandText ?? undefined,
    runId: input.runId ?? undefined,
    sessionKey: input.sessionKey ?? undefined,
    laneId: input.laneId ?? undefined,
    workspaceId: input.workspaceId ?? undefined,
    gitCwd: input.gitCwd ?? undefined,
    timestamp: input.timestamp ?? undefined,
  }
}
