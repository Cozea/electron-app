import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(rootDir, 'build', 'runtime')
const sourceRoot = process.env.COZEA_RUNTIME_PACK_SOURCE_ROOT
  ? path.resolve(process.env.COZEA_RUNTIME_PACK_SOURCE_ROOT)
  : path.join(runtimeRoot, 'packs-src')
const archivesRoot = path.join(runtimeRoot, 'packs')
const manifestPath = path.join(runtimeRoot, 'manifest.json')

const requestedTargetIds = new Set()

const targets = [
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64' },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64' },
]

const runtimeKinds = (process.env.COZEA_RUNTIME_PACK_KINDS || 'python,rust,go')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

const executableRelativePathByRuntime = {
  python: 'bin/python',
  rust: 'bin/cargo',
  go: 'bin/go',
}

function log(message) {
  console.log(`[runtime-packs] ${message}`)
}

function run(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: result.status === 0,
    stderr: (result.stderr || result.error?.message || '').trim(),
  }
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function parseRequestedTargets() {
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (current === '--target') {
      const next = args[index + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value for --target')
      }
      requestedTargetIds.add(next.trim())
      index += 1
      continue
    }
    if (current.startsWith('--target=')) {
      const value = current.slice('--target='.length).trim()
      if (!value) throw new Error('Missing value for --target')
      requestedTargetIds.add(value)
    }
  }

  const envTargets = (
    process.env.COZEA_RUNTIME_PACK_TARGETS ??
    process.env.COZEA_RUNTIME_PACK_SOURCE_TARGETS ??
    process.env.COZEA_RUNTIME_BUNDLE_TARGETS ??
    ''
  )
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const envTarget of envTargets) {
    requestedTargetIds.add(envTarget)
  }
}

function getRequestedTargets() {
  if (requestedTargetIds.size === 0) {
    const nativeId = `${process.platform}-${process.arch}`
    const nativeTarget = targets.find((target) => target.id === nativeId)
    return nativeTarget ? [nativeTarget] : []
  }
  return Array.from(requestedTargetIds).map((targetId) => {
    const target = targets.find((entry) => entry.id === targetId)
    if (!target) {
      const validTargets = targets.map((entry) => entry.id).join(', ')
      throw new Error(`Unknown target "${targetId}". Valid targets: ${validTargets}`)
    }
    return target
  })
}

function getPackageVersion() {
  const packageJsonPath = path.join(rootDir, 'package.json')
  const raw = fs.readFileSync(packageJsonPath, 'utf-8')
  const parsed = JSON.parse(raw)
  return String(parsed.version || '0.0.0')
}

function getReleaseDownloadUrl(archiveName) {
  const repository = process.env.COZEA_RUNTIME_RELEASE_REPO?.trim() || 'Cozea/cozea-prod'
  const tag = process.env.COZEA_RUNTIME_RELEASE_TAG?.trim()
  if (!tag) return undefined
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${archiveName}`
}

function sha256Hex(payload) {
  return createHash('sha256').update(payload).digest('hex')
}

function loadExistingManifest() {
  if (!fs.existsSync(manifestPath)) {
    return { generatedAt: new Date().toISOString(), version: '1', entries: [] }
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.entries)) {
      return { generatedAt: new Date().toISOString(), version: '1', entries: [] }
    }
    return parsed
  } catch {
    return { generatedAt: new Date().toISOString(), version: '1', entries: [] }
  }
}

async function buildArchiveFromDirectory(sourceDir, archivePath, rootName) {
  await mkdir(path.dirname(archivePath), { recursive: true })
  const result = run('tar', ['-czf', archivePath, '-C', path.dirname(sourceDir), rootName])
  if (!result.ok) {
    throw new Error(`Failed to create archive ${archivePath}: ${result.stderr}`)
  }
}

async function main() {
  parseRequestedTargets()
  const selectedTargets = getRequestedTargets()
  if (selectedTargets.length === 0) {
    log(`No supported target for ${process.platform}-${process.arch}; skipping runtime pack build`)
    return
  }

  const appVersion = getPackageVersion()
  const packVersion = process.env.COZEA_RUNTIME_PACK_VERSION?.trim() || appVersion
  await mkdir(archivesRoot, { recursive: true })

  const existingManifest = loadExistingManifest()
  const retainedEntries = existingManifest.entries.filter((entry) => !selectedTargets.some((target) => target.id === entry.target))
  const newEntries = []

  for (const target of selectedTargets) {
    const targetSourceRoot = path.join(sourceRoot, target.id)
    if (!(await exists(targetSourceRoot))) {
      log(`No runtime pack source directory for ${target.id} at ${targetSourceRoot}; skipping`)
      continue
    }

    const targetArchiveRoot = path.join(archivesRoot, target.id)
    await mkdir(targetArchiveRoot, { recursive: true })

    for (const runtime of runtimeKinds) {
      const runtimeSourceDir = path.join(targetSourceRoot, runtime)
      if (!(await exists(runtimeSourceDir))) {
        continue
      }

      const archiveName = `runtime-pack-${runtime}-${target.id}.tar.gz`
      const archivePath = path.join(targetArchiveRoot, archiveName)
      await buildArchiveFromDirectory(runtimeSourceDir, archivePath, path.basename(runtimeSourceDir))

      const archivePayload = await readFile(archivePath)
      const entry = {
        runtime,
        target: target.id,
        version: packVersion,
        archiveName,
        sha256: sha256Hex(archivePayload),
        executableRelativePath: executableRelativePathByRuntime[runtime] || undefined,
        downloadUrl: getReleaseDownloadUrl(archiveName),
      }
      newEntries.push(entry)
      log(`Packed ${runtime} for ${target.id}: ${archiveName}`)
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    version: '1',
    entries: [...retainedEntries, ...newEntries],
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  log(`Wrote runtime manifest with ${manifest.entries.length} entries: ${manifestPath}`)
}

main().catch((error) => {
  console.error(`[runtime-packs] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
