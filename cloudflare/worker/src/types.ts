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

export interface DeviceAuthChallengeRequest {
  identityKey: string
  deviceLabel: string
  platform: string
  encryptionPublicKeyJwk: string
  encryptionPublicKeyAlgorithm: string
  encryptionFingerprint: string
  signingPublicKeyJwk: string
  signingPublicKeyAlgorithm: string
  signingFingerprint: string
}

export interface DeviceAuthChallengeClaims extends DeviceAuthChallengeRequest {
  typ: 'cozea-device-challenge'
  nonce: string
  iat: number
  exp: number
}

export interface DeviceAccessClaims {
  sub: string
  iss: string
  aud: string
  device_id: string
  identity_kind: 'device'
  jti: string
  key_version: number
  token_issued_at: number
  iat: number
  exp: number
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
  DEVICE_AUTH_CHALLENGE_SECRET: string
  CONVEX_URL: string
  AI_GATEWAY_SECRET: string
  DEVICE_AUTH_ISSUER: string
  DEVICE_AUTH_AUDIENCE: string
  DEVICE_AUTH_PRIVATE_JWK: string
  DEVICE_AUTH_PUBLIC_JWK: string
  DEVICE_AUTH_KEY_ID: string
  DEVICE_AUTH_PREVIOUS_PUBLIC_JWK?: string
  DEVICE_AUTH_PREVIOUS_KEY_ID?: string
  COLLAB_ROOM: DurableObjectNamespaceLike
  DEVAPP_RUNTIME_BUILD: DurableObjectNamespaceLike
  DEVAPP_BUILD_INPUTS: R2Bucket
  DEVAPP_BUILDER_GITHUB_TOKEN: string
  DEVAPP_BUILDER_GITHUB_REPOSITORY: string
  DEVAPP_BUILDER_CALLBACK_TOKEN: string
  DEVAPP_IMAGE_REGISTRY_USERNAME: string
  DEVAPP_IMAGE_REGISTRY_TOKEN: string
}
