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

edit('apps/desktop/src/contexts/YjsProjectContext.tsx', (text) =>
  text.replace(
`      protocolVersion: collabSession.protocolVersion,
      deviceId: collabSession.deviceId,
      deviceFingerprint: collabSession.deviceFingerprint,
      devicePublicKeyJwk: collabSession.devicePublicKeyJwk,
      encryption: collabSession.encryption,`,
`      protocolVersion: collabSession.protocolVersion,
      principalId: collabSession.principalId,
      identityKey: collabSession.identityKey,
      displayName: collabSession.displayName,
      encryptionFingerprint: collabSession.encryptionFingerprint,
      encryptionPublicKeyJwk: collabSession.encryptionPublicKeyJwk,
      encryption: collabSession.encryption,`,
  ),
)

edit('apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx', (text) =>
  text
    .replace(
`          protocolVersion: collabSession.protocolVersion,
          deviceId: collabSession.identityKey,
          devicePublicKeyJwk: collabSession.encryptionPublicKeyJwk,
          encryption: collabSession.encryption,`,
`          protocolVersion: collabSession.protocolVersion,
          principalId: collabSession.principalId,
          identityKey: collabSession.identityKey,
          displayName: collabSession.displayName,
          encryptionFingerprint: collabSession.encryptionFingerprint,
          encryptionPublicKeyJwk: collabSession.encryptionPublicKeyJwk,
          encryption: collabSession.encryption,`,
    )
    .replace(
`        protocolVersion: nextSession.protocolVersion,
        deviceId: nextSession.identityKey,
        devicePublicKeyJwk: nextSession.encryptionPublicKeyJwk,
        encryption: nextSession.encryption,`,
`        protocolVersion: nextSession.protocolVersion,
        principalId: nextSession.principalId,
        identityKey: nextSession.identityKey,
        displayName: nextSession.displayName,
        encryptionFingerprint: nextSession.encryptionFingerprint,
        encryptionPublicKeyJwk: nextSession.encryptionPublicKeyJwk,
        encryption: nextSession.encryption,`,
    ),
)

edit('convex/yjs.ts', (text) =>
  text.replace(
`        return {
          userId: principal._id,
          deviceId: principal.identityKey,
          deviceLabel: principal.displayName,
          platform: principal.platform,
          fingerprint: principal.encryptionFingerprint,
          publicKeyJwk: principal.encryptionPublicKeyJwk,
          publicKeyAlgorithm: principal.encryptionPublicKeyAlgorithm,`,
`        return {
          principalId: principal._id,
          identityKey: principal.identityKey,
          displayName: principal.displayName,
          platform: principal.platform,
          encryptionFingerprint: principal.encryptionFingerprint,
          encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
          encryptionPublicKeyAlgorithm: principal.encryptionPublicKeyAlgorithm,`,
  ),
)

edit('apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx', (text) =>
  text
    .replaceAll("['userId']", "['principalId']")
    .replaceAll('device.userId', 'device.principalId')
    .replaceAll('device.deviceLabel', 'device.displayName')
    .replaceAll('device.fingerprint', 'device.encryptionFingerprint')
    .replaceAll('device.publicKeyJwk', 'device.encryptionPublicKeyJwk')
    .replaceAll('device.publicKeyAlgorithm', 'device.encryptionPublicKeyAlgorithm'),
)

console.log('Applied device-principal collaboration presentation repair pass 5.')
