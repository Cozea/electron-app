import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readlink, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(rootDir, 'build', 'runtime')
const checkOnly = process.argv.includes('--check')
const requireAll = process.argv.includes('--all') || process.env.COZEA_RUNTIME_BUNDLE_REQUIRE === 'all'
const requestedTargetIds = new Set()

const targets = [
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64' },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64' },
]

const requiredRuntimeBinaries = ['node', 'npm', 'corepack', 'pnpm', 'yarn', 'bun']

function log(message) {
  console.log(`[bundled-runtime] ${message}`)
}

function fail(message) {
  console.error(`[bundled-runtime] ERROR: ${message}`)
}

function warn(message) {
  console.warn(`[bundled-runtime] WARN: ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message || result.error) : null,
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

async function existsNoFollow(filePath) {
  try {
    await lstat(filePath)
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
        throw new Error('Missing value for --target. Example: --target darwin-arm64')
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

  const envTargets = (process.env.COZEA_RUNTIME_BUNDLE_TARGETS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const envTarget of envTargets) {
    requestedTargetIds.add(envTarget)
  }
}

function getTargetDir(target) {
  return path.join(runtimeRoot, target.id)
}

function getTargetEnvKey(target) {
  return `COZEA_JS_RUNTIME_BUNDLE_URL_${target.id.toUpperCase().replace(/-/g, '_')}`
}

function getNativeTarget() {
  const id = `${process.platform}-${process.arch}`
  return targets.find((target) => target.id === id) || null
}

function getRequiredTargets() {
  if (requestedTargetIds.size > 0) {
    return Array.from(requestedTargetIds).map((requestedId) => {
      const target = targets.find((entry) => entry.id === requestedId)
      if (!target) {
        const validTargets = targets.map((entry) => entry.id).join(', ')
        throw new Error(`Unknown target "${requestedId}". Valid targets: ${validTargets}`)
      }
      return target
    })
  }
  if (requireAll) return [...targets]
  const native = getNativeTarget()
  return native ? [native] : []
}

function githubHeaders(accept = 'application/vnd.github+json,application/octet-stream') {
  const headers = {
    Accept: accept,
    'User-Agent': 'cozea-runtime-bootstrap',
  }
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: githubHeaders('application/vnd.github+json,application/octet-stream'),
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }
  await mkdir(path.dirname(destinationPath), { recursive: true })
  const body = Readable.fromWeb(response.body)
  await pipeline(body, fs.createWriteStream(destinationPath))
}

function extractArchiveWithTar(archivePath, destinationPath, flags = []) {
  const result = run('tar', ['-x', ...flags, '-f', archivePath, '-C', destinationPath])
  if (!result.ok) {
    throw new Error(result.error || result.stderr || `Failed to extract archive: ${archivePath}`)
  }
}

function extractArchiveWithUnzip(archivePath, destinationPath) {
  const result = run('unzip', ['-q', archivePath, '-d', destinationPath])
  if (!result.ok) {
    throw new Error(result.error || result.stderr || `Failed to extract zip: ${archivePath}`)
  }
}

function extractArchiveWithPowerShell(archivePath, destinationPath) {
  const escapedArchive = archivePath.replace(/'/g, "''")
  const escapedDestination = destinationPath.replace(/'/g, "''")
  const command = `Expand-Archive -Path '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`
  const result = run('powershell', ['-NoProfile', '-Command', command])
  if (!result.ok) {
    throw new Error(result.error || result.stderr || `Failed to extract zip via PowerShell: ${archivePath}`)
  }
}

async function extractArchive(archivePath, destinationPath) {
  await mkdir(destinationPath, { recursive: true })
  const normalized = archivePath.toLowerCase()

  if (normalized.endsWith('.zip')) {
    if (process.platform === 'win32') {
      extractArchiveWithPowerShell(archivePath, destinationPath)
    } else {
      try {
        extractArchiveWithUnzip(archivePath, destinationPath)
      } catch {
        extractArchiveWithTar(archivePath, destinationPath)
      }
    }
    return
  }
  if (normalized.endsWith('.tar.gz') || normalized.endsWith('.tgz')) {
    extractArchiveWithTar(archivePath, destinationPath, ['-z'])
    return
  }
  if (normalized.endsWith('.tar.bz2') || normalized.endsWith('.tbz2')) {
    extractArchiveWithTar(archivePath, destinationPath, ['-j'])
    return
  }
  if (normalized.endsWith('.tar.xz') || normalized.endsWith('.txz')) {
    extractArchiveWithTar(archivePath, destinationPath, ['-J'])
    return
  }

  extractArchiveWithTar(archivePath, destinationPath)
}

async function flattenSingleNestedRoot(targetDir) {
  const entries = await readdir(targetDir, { withFileTypes: true })
  const visible = entries.filter((entry) => entry.name !== '.DS_Store')
  if (visible.length !== 1 || !visible[0].isDirectory()) {
    return
  }

  const nestedRoot = path.join(targetDir, visible[0].name)
  const children = await readdir(nestedRoot)
  for (const child of children) {
    await rename(path.join(nestedRoot, child), path.join(targetDir, child))
  }
  await rm(nestedRoot, { recursive: true, force: true })
}

async function ensureCorepackWrapper(targetDir, toolName) {
  const wrapperPath = path.join(targetDir, 'bin', toolName)
  const content = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd)"
exec "$SCRIPT_DIR/corepack" ${toolName} "$@"
`
  await writeFile(wrapperPath, content, { encoding: 'utf-8' })
  await chmod(wrapperPath, 0o755)
}

async function normalizeNodeToolLinks(targetDir) {
  const binDir = path.join(targetDir, 'bin')
  const expectedLinks = {
    npm: '../lib/node_modules/npm/bin/npm-cli.js',
    npx: '../lib/node_modules/npm/bin/npx-cli.js',
    corepack: '../lib/node_modules/corepack/dist/corepack.js',
  }

  for (const [toolName, relativeTarget] of Object.entries(expectedLinks)) {
    const linkPath = path.join(binDir, toolName)
    const absoluteTarget = path.resolve(binDir, relativeTarget)
    if (!(await exists(absoluteTarget))) {
      continue
    }

    let shouldCreateLink = true
    if (await existsNoFollow(linkPath)) {
      const currentStats = await lstat(linkPath)
      if (currentStats.isSymbolicLink()) {
        const currentTarget = await readlink(linkPath)
        const resolvedCurrentTarget = path.resolve(path.dirname(linkPath), currentTarget)
        if (resolvedCurrentTarget === absoluteTarget && await exists(resolvedCurrentTarget)) {
          shouldCreateLink = false
        } else {
          await unlink(linkPath)
        }
      } else {
        shouldCreateLink = false
      }
    }

    if (shouldCreateLink) {
      await symlink(relativeTarget, linkPath)
    }
  }
}

async function ensureCapabilityCatalog() {
  const catalogPath = path.join(runtimeRoot, 'capability-catalog.json')
  if (await exists(catalogPath)) return
  const catalog = {
    version: '1',
    generatedAt: new Date().toISOString(),
    rules: [
      {
        id: 'node-default',
        matchAnyFile: ['package.json'],
        suggestedCommands: [
          {
            command: 'npm run dev',
            runtime: 'npm',
            confidence: 0.85,
            reason: 'Found package.json in project root.',
          },
        ],
      },
      {
        id: 'python-default',
        matchAnyFile: ['pyproject.toml', 'requirements.txt'],
        suggestedCommands: [
          {
            command: 'python -m uvicorn main:app --reload',
            runtime: 'python',
            confidence: 0.35,
            reason: 'Found common Python project markers.',
          },
        ],
      },
      {
        id: 'rust-default',
        matchAnyFile: ['Cargo.toml'],
        suggestedCommands: [
          {
            command: 'cargo run',
            runtime: 'rust',
            confidence: 0.35,
            reason: 'Found Cargo manifest.',
          },
        ],
      },
      {
        id: 'go-default',
        matchAnyFile: ['go.mod'],
        suggestedCommands: [
          {
            command: 'go run .',
            runtime: 'go',
            confidence: 0.35,
            reason: 'Found go.mod manifest.',
          },
        ],
      },
    ],
  }
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8')
}

async function ensureManifestSkeleton() {
  const manifestPath = path.join(runtimeRoot, 'manifest.json')
  if (await exists(manifestPath)) return
  const manifest = {
    generatedAt: new Date().toISOString(),
    version: '1',
    entries: [],
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

async function maybeWriteBundledPublicKey() {
  const bundledPublicKeyPath = path.join(runtimeRoot, 'runtime-public-key.pem')
  if (await exists(bundledPublicKeyPath)) return

  const configured = process.env.COZEA_RUNTIME_SIGNING_PUBLIC_KEY?.trim() || process.env.COZEA_RUNTIME_PUBLIC_KEY_PEM?.trim()
  if (!configured) return
  const key = configured.includes('BEGIN PUBLIC KEY')
    ? configured
    : await fs.promises.readFile(path.resolve(configured), 'utf-8')

  await writeFile(bundledPublicKeyPath, key, 'utf-8')
}

async function resolveLatestNodeVersion() {
  const response = await fetch('https://nodejs.org/dist/index.json', {
    headers: { Accept: 'application/json', 'User-Agent': 'cozea-runtime-bootstrap' },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Node.js release index (${response.status})`)
  }
  const releases = await response.json()
  if (!Array.isArray(releases)) {
    throw new Error('Invalid Node.js release index payload')
  }

  const lts = releases.find((release) => release && typeof release === 'object' && release.lts)
  const version = String(lts?.version || '')
  if (!version.startsWith('v')) {
    throw new Error('Unable to resolve latest LTS Node.js version')
  }
  return version
}

async function resolveLatestBunAssetName(target) {
  const response = await fetch('https://api.github.com/repos/oven-sh/bun/releases/latest', {
    headers: githubHeaders('application/vnd.github+json'),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Bun release metadata (${response.status})`)
  }
  const release = await response.json()
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const pattern = target.arch === 'arm64'
    ? /^bun-darwin-aarch64\.zip$/
    : /^bun-darwin-x64\.zip$/
  const match = assets.find((asset) => typeof asset?.name === 'string' && pattern.test(asset.name))
  if (!match?.browser_download_url || !match?.name) {
    throw new Error(`Unable to resolve Bun archive for ${target.id}`)
  }
  return {
    assetName: match.name,
    downloadUrl: match.browser_download_url,
  }
}

async function hydrateFromArchiveInput(target, archiveInput, sourceLabel) {
  const targetDir = getTargetDir(target)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `cozea-runtime-archive-${target.id}-`))
  try {
    const archivePath = /^https?:\/\//i.test(archiveInput)
      ? path.join(tempDir, path.basename(new URL(archiveInput).pathname) || `${target.id}.archive`)
      : path.resolve(archiveInput)
    if (/^https?:\/\//i.test(archiveInput)) {
      log(`Downloading ${sourceLabel} for ${target.id}`)
      await downloadFile(archiveInput, archivePath)
    }
    if (!(await exists(archivePath))) {
      throw new Error(`Archive not found: ${archivePath}`)
    }

    await rm(targetDir, { recursive: true, force: true })
    await mkdir(targetDir, { recursive: true })
    await extractArchive(archivePath, targetDir)
    await flattenSingleNestedRoot(targetDir)
    await normalizeNodeToolLinks(targetDir)
    await ensureCorepackWrapper(targetDir, 'pnpm')
    await ensureCorepackWrapper(targetDir, 'yarn')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function hydrateFromUpstream(target) {
  if (target.platform !== 'darwin') {
    throw new Error(`Automatic runtime hydration is not implemented for ${target.id}. Use ${getTargetEnvKey(target)}.`)
  }
  if (process.platform !== target.platform || process.arch !== target.arch) {
    throw new Error(`Cannot auto-hydrate ${target.id} on ${process.platform}-${process.arch}. Use ${getTargetEnvKey(target)}.`)
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `cozea-runtime-upstream-${target.id}-`))
  const targetDir = getTargetDir(target)
  try {
    const nodeVersion = await resolveLatestNodeVersion()
    const nodeArchiveName = `node-${nodeVersion}-${target.platform}-${target.arch}.tar.gz`
    const nodeArchiveUrl = `https://nodejs.org/dist/${nodeVersion}/${nodeArchiveName}`
    const nodeArchivePath = path.join(tempDir, nodeArchiveName)
    const nodeExtractDir = path.join(tempDir, 'node-extract')
    await mkdir(nodeExtractDir, { recursive: true })

    log(`Downloading Node.js ${nodeVersion} for ${target.id}`)
    await downloadFile(nodeArchiveUrl, nodeArchivePath)
    await extractArchive(nodeArchivePath, nodeExtractDir)

    const nodeEntries = await readdir(nodeExtractDir, { withFileTypes: true })
    const nodeRoot = nodeEntries.find((entry) => entry.isDirectory())
    if (!nodeRoot) {
      throw new Error('Unable to locate extracted Node.js directory')
    }
    const nodeRootPath = path.join(nodeExtractDir, nodeRoot.name)

    await rm(targetDir, { recursive: true, force: true })
    await mkdir(targetDir, { recursive: true })
    await cp(nodeRootPath, targetDir, { recursive: true, force: true })
    await normalizeNodeToolLinks(targetDir)

    const bunAsset = await resolveLatestBunAssetName(target)
    const bunArchivePath = path.join(tempDir, bunAsset.assetName)
    const bunExtractDir = path.join(tempDir, 'bun-extract')
    await mkdir(bunExtractDir, { recursive: true })

    log(`Downloading Bun (${bunAsset.assetName}) for ${target.id}`)
    await downloadFile(bunAsset.downloadUrl, bunArchivePath)
    await extractArchive(bunArchivePath, bunExtractDir)

    const bunDirEntries = await readdir(bunExtractDir, { withFileTypes: true })
    const bunRoot = bunDirEntries.find((entry) => entry.isDirectory())
    if (!bunRoot) {
      throw new Error('Unable to locate extracted Bun directory')
    }
    const bunPath = path.join(bunExtractDir, bunRoot.name, 'bun')
    if (!(await exists(bunPath))) {
      throw new Error('Bun executable missing from extracted archive')
    }
    await cp(bunPath, path.join(targetDir, 'bin', 'bun'))
    await chmod(path.join(targetDir, 'bin', 'bun'), 0o755)

    await ensureCorepackWrapper(targetDir, 'pnpm')
    await ensureCorepackWrapper(targetDir, 'yarn')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function validateTarget(target) {
  for (const binary of requiredRuntimeBinaries) {
    const binaryPath = path.join(getTargetDir(target), 'bin', binary)
    if (!(await exists(binaryPath))) {
      throw new Error(
        `Missing bundled runtime binary for ${target.id}: ${binaryPath}\n` +
        `Set ${getTargetEnvKey(target)}=<archive-url-or-local-path> and run:\n` +
        `  npm run prepare:bundled-runtimes -- --target ${target.id}`
      )
    }
  }
}

async function hydrateTarget(target) {
  const configuredArchive = process.env[getTargetEnvKey(target)]?.trim()
  if (configuredArchive) {
    await hydrateFromArchiveInput(target, configuredArchive, `configured archive (${getTargetEnvKey(target)})`)
    return
  }
  await hydrateFromUpstream(target)
}

async function main() {
  parseRequestedTargets()
  await mkdir(runtimeRoot, { recursive: true })
  await ensureManifestSkeleton()
  await ensureCapabilityCatalog()
  await maybeWriteBundledPublicKey()

  const requiredTargets = getRequiredTargets()
  if (requiredTargets.length === 0) {
    warn(`No supported native target for ${process.platform}-${process.arch}.`)
    return
  }

  log(`Preparing bundled runtimes in ${runtimeRoot}`)

  for (const target of requiredTargets) {
    const targetDir = getTargetDir(target)
    const hasAllBinaries = await Promise.all(
      requiredRuntimeBinaries.map((binary) => exists(path.join(targetDir, 'bin', binary)))
    ).then((entries) => entries.every(Boolean))

    if (!hasAllBinaries && !checkOnly) {
      log(`Bundled runtime missing for ${target.id}; hydrating`)
      await hydrateTarget(target)
    }
  }

  for (const target of requiredTargets) {
    await validateTarget(target)
  }

  if (checkOnly) {
    log(`Check complete for ${requiredTargets.map((target) => target.id).join(', ')}`)
  } else {
    log(`Ready for ${requiredTargets.map((target) => target.id).join(', ')}`)
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
