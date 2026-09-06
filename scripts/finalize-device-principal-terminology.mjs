import fs from 'node:fs'
import path from 'node:path'

const roots = [
  'apps/desktop/src',
  'apps/desktop/electron',
  'cloudflare/worker/src',
  'convex',
  'shared',
  'tests',
]

const allowedExtensions = new Set(['.ts', '.tsx'])
const skippedDirectories = new Set(['node_modules', 'vendor', '_generated', 'dist', 'out'])

function collectFiles(root, output = []) {
  if (!fs.existsSync(root)) return output
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      collectFiles(fullPath, output)
      continue
    }
    if (allowedExtensions.has(path.extname(entry.name))) output.push(fullPath)
  }
  return output
}

function participatesInDevicePrincipalModel(source) {
  return (
    source.includes('devicePrincipals') ||
    source.includes('principalId') ||
    source.includes('identityKey') ||
    source.includes('projectPresence') ||
    source.includes('projectMembers') ||
    source.includes('projectCollab') ||
    source.includes('organizationMembers')
  )
}

function replaceIdentityTerms(source) {
  let next = source

  // Internal database relationships are principals, never "users".
  next = next.replace(/([A-Za-z][A-Za-z0-9]*)UserId\b/g, '$1PrincipalId')
  next = next.replace(/\buserId\b/g, 'principalId')

  // The public cryptographic identifier is identityKey. Do not retain deviceId aliases.
  next = next.replace(/([A-Za-z][A-Za-z0-9]*)DeviceId\b/g, '$1IdentityKey')
  next = next.replace(/\bdeviceId\b/g, 'identityKey')

  // Presence stores principal presentation, not account-shaped user presentation.
  next = next.replace(/\buserName\b/g, 'displayName')
  next = next.replace(/\buserAvatarUrl\b/g, 'avatarUrl')

  // Keep index names aligned with the relationship they index.
  next = next.replace(/by_project_and_user/g, 'by_project_and_principal')
  next = next.replace(/by_organization_and_user/g, 'by_organization_and_principal')
  next = next.replace(/by_comment_and_user/g, 'by_comment_and_principal')
  next = next.replace(/by_user_and_created/g, 'by_principal_and_created')
  next = next.replace(/by_user\b/g, 'by_principal')

  return next
}

const changed = []
for (const root of roots) {
  for (const file of collectFiles(root)) {
    const source = fs.readFileSync(file, 'utf8')
    if (!participatesInDevicePrincipalModel(source)) continue
    const next = replaceIdentityTerms(source)
    if (next === source) continue
    fs.writeFileSync(file, next)
    changed.push(file)
  }
}

if (changed.length === 0) {
  throw new Error('Expected principal terminology cleanup to change at least one source file.')
}

for (const invariantFile of ['convex/schema.ts', 'convex/yjs.ts']) {
  const source = fs.readFileSync(invariantFile, 'utf8')
  const forbidden = [
    /\buserId\b/,
    /UserId\b/,
    /\bdeviceId\b/,
    /DeviceId\b/,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`${invariantFile} still contains legacy principal identifier terminology: ${pattern}`)
    }
  }
}

console.log(`Finalized device-principal terminology in ${changed.length} files.`)
for (const file of changed) console.log(` - ${file}`)
