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

edit('apps/desktop/src/lib/yjs/CollabWsProvider.ts', (text) =>
  text.replace(
`  deviceId: string
  deviceFingerprint?: string
  devicePublicKeyJwk?: string`,
`  principalId: string
  identityKey: string
  displayName: string
  encryptionFingerprint: string
  encryptionPublicKeyJwk: string`,
  ),
)

for (const rel of [
  'apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx',
  'apps/desktop/src/features/settings/pages/ProjectSettingsPage.tsx',
]) {
  edit(rel, (text) =>
    text
      .replaceAll('.deviceId', '.identityKey')
      .replaceAll('.devicePublicKeyJwk', '.encryptionPublicKeyJwk')
      .replaceAll('.deviceFingerprint', '.encryptionFingerprint'),
  )
}

console.log('Applied device-principal collaboration consumer repair pass 4.')
