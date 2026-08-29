import type { DeviceAuthChallengeRequest, SessionRequestBody } from '../types'
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from '../../../../shared/deviceIdentity'

function getStringField(value: unknown, name: string, maxLength = 500): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required`)
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} is too long`)
  }
  return trimmed
}

export async function parseJsonRequest(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Expected application/json request body')
  }
  return request.json()
}

export function parseSessionRequestBody(value: unknown): SessionRequestBody {
  if (!value || typeof value !== 'object') {
    throw new Error('Request body must be an object')
  }

  const body = value as Record<string, unknown>
  const clientType = getStringField(body.clientType ?? 'electron', 'clientType', 32)
  if (clientType !== 'web' && clientType !== 'electron') {
    throw new Error('clientType must be web or electron')
  }

  return {
    projectId: getStringField(body.projectId, 'projectId', 200),
    clientType,
    deviceId: getStringField(body.deviceId, 'deviceId', 200),
    deviceLabel: getStringField(body.deviceLabel, 'deviceLabel', 200),
    platform: getStringField(body.platform, 'platform', 100),
    publicKeyJwk: getStringField(body.publicKeyJwk, 'publicKeyJwk', 20_000),
    publicKeyAlgorithm: getStringField(body.publicKeyAlgorithm, 'publicKeyAlgorithm', 100),
    fingerprint: getStringField(body.fingerprint, 'fingerprint', 200),
  }
}

export function parseDeviceAuthChallengeRequest(value: unknown): DeviceAuthChallengeRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Request body must be an object')
  }

  const body = value as Record<string, unknown>
  const identityKey = normalizeDeviceIdentityKey(getStringField(body.identityKey, 'identityKey', 64))
  if (!isDeviceIdentityKey(identityKey)) {
    throw new Error('identityKey must be a valid Cozea device ID')
  }

  return {
    identityKey,
    deviceLabel: getStringField(body.deviceLabel, 'deviceLabel', 200),
    platform: getStringField(body.platform, 'platform', 100),
    encryptionPublicKeyJwk: getStringField(body.encryptionPublicKeyJwk, 'encryptionPublicKeyJwk', 20_000),
    encryptionPublicKeyAlgorithm: getStringField(body.encryptionPublicKeyAlgorithm, 'encryptionPublicKeyAlgorithm', 100),
    encryptionFingerprint: getStringField(body.encryptionFingerprint, 'encryptionFingerprint', 200),
    signingPublicKeyJwk: getStringField(body.signingPublicKeyJwk, 'signingPublicKeyJwk', 20_000),
    signingPublicKeyAlgorithm: getStringField(body.signingPublicKeyAlgorithm, 'signingPublicKeyAlgorithm', 100),
    signingFingerprint: getStringField(body.signingFingerprint, 'signingFingerprint', 200),
  }
}

export function getRoomIdForProject(projectId: string): string {
  return `project:${projectId}`
}
