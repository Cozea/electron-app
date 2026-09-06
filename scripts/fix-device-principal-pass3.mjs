import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const file = (rel) => path.join(root, rel)

function edit(rel, transform) {
  const target = file(rel)
  if (!fs.existsSync(target)) return
  const before = fs.readFileSync(target, 'utf8')
  const after = transform(before)
  if (after !== before) fs.writeFileSync(target, after)
}

edit('apps/desktop/electron/collabKeys.ts', (text) => {
  text = text.replace("import os from 'node:os'\n", '')
  text = text.replace(
`interface StoredCollabDeviceIdentity {
  schemaVersion: 2
  deviceId: string
  identityKey: string
  deviceLabel: string`,
`interface StoredCollabDeviceIdentity {
  schemaVersion: 3
  identityKey: string`,
  )
  text = text.replace(
`export interface CollabDeviceIdentity {
  deviceId: string
  userId: string
  identityKey: string
  deviceLabel: string`,
`export interface CollabDeviceIdentity {
  identityKey: string`,
  )
  text = text.replace(
`export interface CollabDeviceChallengeSignature {
  deviceId: string
  userId: string
  identityKey: string`,
`export interface CollabDeviceChallengeSignature {
  identityKey: string`,
  )
  text = text.replace(/parsed\?\.schemaVersion !== 2 \|\|\n\s*!parsed\.identityKey \|\|\n\s*parsed\.deviceId !== parsed\.identityKey \|\|/g,
    "parsed?.schemaVersion !== 3 ||\n        !parsed.identityKey ||")
  text = text.replace(
`    schemaVersion: 2,
    deviceId: identityKey,
    identityKey,
    deviceLabel: os.hostname(),`,
`    schemaVersion: 3,
    identityKey,`,
  )
  text = text.replace(
`  return {
    deviceId: identityKey,
    userId: identityKey,
    identityKey,
    deviceLabel: identity.deviceLabel,`,
`  return {
    identityKey,`,
  )
  text = text.replace(
`  return {
    deviceId: identityKey,
    userId: identityKey,
    identityKey,
    algorithm: DEVICE_SIGNING_ALGORITHM,`,
`  return {
    identityKey,
    algorithm: DEVICE_SIGNING_ALGORITHM,`,
  )
  text = text.replaceAll('identity.deviceId', 'identity.identityKey')
  return text
})

edit('shared/electronApiTypes.ts', (text) => {
  text = text.replace(
`export interface CollabDeviceIdentity {
  deviceId: string
  userId: string
  identityKey: string
  deviceLabel: string`,
`export interface CollabDeviceIdentity {
  identityKey: string`,
  )
  text = text.replace(
`export interface CollabDeviceChallengeSignature {
  deviceId: string
  userId: string
  identityKey: string`,
`export interface CollabDeviceChallengeSignature {
  identityKey: string`,
  )
  return text
})

edit('apps/desktop/src/lib/deviceSession.ts', (text) =>
  text.replace('      deviceLabel: identity.deviceLabel,\n', ''),
)

edit('cloudflare/worker/src/types.ts', (text) => {
  text = text.replace(
`export interface SessionRequestBody {
  projectId: string
  clientType: 'web' | 'electron'
  deviceId: string
  deviceLabel: string
  platform: string
  publicKeyJwk: string
  publicKeyAlgorithm: string
  fingerprint: string
}`,
`export interface SessionRequestBody {
  projectId: string
  clientType: 'web' | 'electron'
}`,
  )
  text = text.replace('  deviceLabel: string\n', '')
  text = text.replace('  device_id: string\n', '')
  text = text.replace(
`export interface SessionDescriptor {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  deviceId: string
  deviceLabel?: string
  deviceFingerprint?: string
  devicePublicKeyJwk?: string`,
`export interface SessionDescriptor {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  principalId: string
  identityKey: string
  displayName: string
  encryptionFingerprint: string
  encryptionPublicKeyJwk: string`,
  )
  text = text.replace(
`export interface SessionClaims {
  sub: string
  projectId: string
  roomId: string
  userId: string
  deviceId: string`,
`export interface SessionClaims {
  sub: string
  projectId: string
  roomId: string
  principalId: string`,
  )
  text = text.replace(
`export interface ConvexSessionContext {
  userId: string
  projectId: string
  roomId: string
  deviceId: string
  deviceLabel: string
  deviceFingerprint: string
  devicePublicKeyJwk: string`,
`export interface ConvexSessionContext {
  principalId: string
  identityKey: string
  displayName: string
  projectId: string
  roomId: string
  encryptionFingerprint: string
  encryptionPublicKeyJwk: string`,
  )
  return text
})

edit('cloudflare/worker/src/lib/validation.ts', (text) => {
  text = text.replace(
`  return {
    projectId: getStringField(body.projectId, 'projectId', 200),
    clientType,
    deviceId: getStringField(body.deviceId, 'deviceId', 200),
    deviceLabel: getStringField(body.deviceLabel, 'deviceLabel', 200),
    platform: getStringField(body.platform, 'platform', 100),
    publicKeyJwk: getStringField(body.publicKeyJwk, 'publicKeyJwk', 20_000),
    publicKeyAlgorithm: getStringField(body.publicKeyAlgorithm, 'publicKeyAlgorithm', 100),
    fingerprint: getStringField(body.fingerprint, 'fingerprint', 200),
  }`,
`  return {
    projectId: getStringField(body.projectId, 'projectId', 200),
    clientType,
  }`,
  )
  text = text.replace("    deviceLabel: getStringField(body.deviceLabel, 'deviceLabel', 200),\n", '')
  return text
})

edit('cloudflare/worker/src/lib/convex.ts', (text) => {
  text = text.replace(
`interface LocalDeviceProfileInfo {
  userId: string
  user: {
    id: string
    deviceId: string
    email: string
    firstName: string
    lastName: null
    profileImageUrl: string | null
  }`,
`interface LocalDeviceProfileInfo {
  principalId: string
  user: {
    principalId: string
    identityKey: string
    displayName: string
    avatarUrl: string | null
    platform: string
  }`,
  )
  text = text.replace(/\n  identity: \{[\s\S]*?\n  \}\n  authentication:/, '\n  authentication:')
  text = text.replace('    deviceLabel: identity.deviceLabel,\n', '')
  text = text.replace(
/export async function createCollabSessionFromConvex\([\s\S]*?\n}\n\nexport async function fetchYjsDeltasFromConvex/,
`export async function createCollabSessionFromConvex(
  env: Env,
  body: SessionRequestBody,
  auth: DeviceAccessClaims,
): Promise<ConvexSessionContext> {
  const principal = await requireActiveDeviceAccessInConvex(env, auth)
  const access = await runServerQuery<ProjectAccessResult>(env, 'projectMembers:getProjectAccessForServer', {
    projectId: body.projectId,
    userId: principal.principalId,
  })
  if (!access.canAccess || !access.canEdit) {
    throw new Error('The authenticated device cannot access this project')
  }

  const roomId = \`project:\${body.projectId}\`
  const encryption = await runServerQuery<EncryptionBootstrapResult>(env, 'yjs:getEncryptionBootstrap', {
    projectId: body.projectId,
    roomId,
    userId: principal.principalId,
    deviceId: principal.identityKey,
  })

  return {
    principalId: principal.principalId,
    identityKey: principal.identityKey,
    displayName: principal.displayName,
    projectId: body.projectId,
    roomId,
    encryptionFingerprint: principal.encryptionFingerprint,
    encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
    encryption,
  }
}

export async function fetchYjsDeltasFromConvex`,
  )
  return text
})

edit('cloudflare/worker/src/routes/deviceAuth.ts', (text) =>
  text.replace('    principalId: profile.userId,', '    principalId: profile.principalId,'),
)

edit('cloudflare/worker/src/routes/collabSession.ts', (text) => {
  text = text.replace(
`  const token = await signSessionToken(env, {
    sub: sessionContext.userId,
    userId: sessionContext.userId,
    projectId: sessionContext.projectId,
    roomId,
    deviceId: sessionContext.deviceId,`,
`  const token = await signSessionToken(env, {
    sub: sessionContext.identityKey,
    principalId: sessionContext.principalId,
    projectId: sessionContext.projectId,
    roomId,`,
  )
  text = text.replace(
`    protocolVersion,
    deviceId: sessionContext.deviceId,
    deviceLabel: sessionContext.deviceLabel,
    deviceFingerprint: sessionContext.deviceFingerprint,
    devicePublicKeyJwk: sessionContext.devicePublicKeyJwk,`,
`    protocolVersion,
    principalId: sessionContext.principalId,
    identityKey: sessionContext.identityKey,
    displayName: sessionContext.displayName,
    encryptionFingerprint: sessionContext.encryptionFingerprint,
    encryptionPublicKeyJwk: sessionContext.encryptionPublicKeyJwk,`,
  )
  return text
})

edit('cloudflare/worker/src/lib/jwt.ts', (text) => {
  text = text.replace('    device_id: identityKey,\n', '')
  text = text.replace('    claims.sub !== claims.device_id ||\n', '')
  return text
})

edit('cloudflare/worker/src/durableObjects/CollabRoom.ts', (text) =>
  text
    .replace('  userId: string\n', '  principalId: string\n')
    .replace('        userId: claims.userId,', '        principalId: claims.principalId,'),
)

edit('apps/desktop/src/features/collaboration/hooks/useCollabSession.ts', (text) => {
  text = text.replace(
`  deviceId: string
  deviceLabel?: string
  deviceFingerprint?: string
  devicePublicKeyJwk?: string`,
`  principalId: string
  identityKey: string
  displayName: string
  encryptionFingerprint: string
  encryptionPublicKeyJwk: string`,
  )
  text = text.replace('      const deviceIdentity = await window.electronAPI.collab.ensureDeviceIdentity()\n', '')
  text = text.replace(
`        body: JSON.stringify({
          projectId,
          clientType: 'electron',
          deviceId: deviceIdentity.deviceId,
          deviceLabel: deviceIdentity.deviceLabel,
          platform: deviceIdentity.platform,
          publicKeyJwk: deviceIdentity.publicKeyJwk,
          publicKeyAlgorithm: deviceIdentity.publicKeyAlgorithm,
          fingerprint: deviceIdentity.fingerprint,
        }),`,
`        body: JSON.stringify({ projectId, clientType: 'electron' }),`,
  )
  text = text.replace('        !parsedSession?.deviceId ||\n', '        !parsedSession?.identityKey ||\n')
  text = text.replace(
`      const nextSession: CollabSession = {
        ...parsedSession,
        deviceLabel: deviceIdentity.deviceLabel,
        deviceFingerprint: deviceIdentity.fingerprint,
        devicePublicKeyJwk: deviceIdentity.publicKeyJwk,
        capabilities: parsedCapabilities ?? {`,
`      const nextSession: CollabSession = {
        ...parsedSession,
        capabilities: parsedCapabilities ?? {`,
  )
  return text
})

edit('apps/desktop/src/contexts/YjsProjectContext.tsx', (text) =>
  text
    .replaceAll('session.deviceId', 'session.identityKey')
    .replaceAll('session.devicePublicKeyJwk', 'session.encryptionPublicKeyJwk')
    .replaceAll('session.deviceFingerprint', 'session.encryptionFingerprint')
    .replaceAll('wsSession?.deviceId', 'wsSession?.identityKey')
    .replaceAll('wsSession?.devicePublicKeyJwk', 'wsSession?.encryptionPublicKeyJwk')
    .replaceAll('wsSession?.deviceFingerprint', 'wsSession?.encryptionFingerprint'),
)

console.log('Applied device-principal transport cleanup pass 3.')
