export interface EncryptionBootstrap {
  roomId: string
  encryptionRequired: boolean
  status: 'room_not_initialized' | 'ready' | 'missing_for_device' | 'device_revoked'
  activeKeyVersion: number | null
  wrappedRoomKey: string | null
  wrapAlgorithm: string | null
  senderPublicKeyJwk: string | null
}

export interface SessionRequestBody {
  projectId: string
  clientType: 'web' | 'electron'
  deviceId: string
  deviceLabel: string
  platform: string
  publicKeyJwk: string
  publicKeyAlgorithm: string
  fingerprint: string
}

export interface SessionDescriptor {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  deviceId: string
  deviceLabel?: string
  deviceFingerprint?: string
  devicePublicKeyJwk?: string
  capabilities: {
    execution: 'browser-local' | 'vm'
    languageScope: string[]
    preview: boolean
    terminal: boolean
    deployments: boolean
    yjs: boolean
  }
  encryption: EncryptionBootstrap
}

export interface SessionClaims {
  sub: string
  projectId: string
  roomId: string
  userId: string
  deviceId: string
  clientType: 'web' | 'electron'
  protocolVersion: string
  exp: number
  iat: number
}

export interface ConvexSessionContext {
  userId: string
  projectId: string
  roomId: string
  deviceId: string
  deviceLabel: string
  deviceFingerprint: string
  devicePublicKeyJwk: string
  encryption: EncryptionBootstrap
}

export interface ConvexPersistedUpdate {
  seq: number
  updateBinary: string
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

export interface Env {
  COLLAB_PROTOCOL_VERSION?: string
  COLLAB_JWT_SECRET: string
  CONVEX_URL: string
  AI_GATEWAY_SECRET: string
  COLLAB_ROOM: DurableObjectNamespaceLike
}
