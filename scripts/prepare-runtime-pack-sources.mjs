import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(rootDir, 'build', 'runtime')
const sourceRoot = process.env.COZEA_RUNTIME_PACK_SOURCE_ROOT
  ? path.resolve(process.env.COZEA_RUNTIME_PACK_SOURCE_ROOT)
  : path.join(runtimeRoot, 'packs-src')

const checkOnly = process.argv.includes('--check')
const force = process.argv.includes('--force')
const requireAll = process.argv.includes('--all') || process.env.COZEA_RUNTIME_PACK_SOURCE_REQUIRE === 'all'
const requestedTargetIds = new Set()

const targets = [
  {
    id: 'darwin-arm64',
    pythonAssetPattern: /aarch64-apple-darwin-install_only(?:_stripped)?\.tar\.gz$/,
    rustTriple: 'aarch64-apple-darwin',
    goArch: 'arm64',
  },
  {
    id: 'darwin-x64',
    pythonAssetPattern: /x86_64-apple-darwin-install_only(?:_stripped)?\.tar\.gz$/,
    rustTriple: 'x86_64-apple-darwin',
    goArch: 'amd64',
  },
]

let cachedPythonRelease = null
let cachedGoRelease = null
let cachedRustChannel = null

function log(message) {
  console.log(`[runtime-pack-sources] ${message}`)
}

function fail(message) {
  console.error(`[runtime-pack-sources] ERROR: ${message}`)
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json,application/octet-stream',
    'User-Agent': 'cozea-runtime-pack-sources',
  }
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
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

  const envTargets = (
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

function getNativeTarget() {
  const nativeId = `${process.platform}-${process.arch}`
  return targets.find((target) => target.id === nativeId) ?? null
}

function getRequiredTargets() {
  if (requestedTargetIds.size > 0) {
    return Array.from(requestedTargetIds).map((targetId) => {
      const target = targets.find((entry) => entry.id === targetId)
      if (!target) {
        const validTargets = targets.map((entry) => entry.id).join(', ')
        throw new Error(`Unknown target "${targetId}". Valid targets: ${validTargets}`)
      }
      return target
    })
  }
  if (requireAll) return [...targets]
  const native = getNativeTarget()
  return native ? [native] : []
}

function runtimeSourceDir(target, runtime) {
  return path.join(sourceRoot, target.id, runtime)
}

function runtimeBinaryPath(target, runtime) {
  if (runtime === 'python') return path.join(runtimeSourceDir(target, runtime), 'bin', 'python')
  if (runtime === 'rust') return path.join(runtimeSourceDir(target, runtime), 'bin', 'cargo')
  if (runtime === 'go') return path.join(runtimeSourceDir(target, runtime), 'bin', 'go')
  return ''
}

function runtimeValidationPaths(target, runtime) {
  if (runtime === 'rust') {
    return [
      path.join(runtimeSourceDir(target, runtime), 'bin', 'cargo'),
      path.join(runtimeSourceDir(target, runtime), 'bin', 'rustc'),
    ]
  }
  return [runtimeBinaryPath(target, runtime)]
}

async function validateRuntimeSource(target, runtime) {
  const requiredPaths = runtimeValidationPaths(target, runtime)
  for (const requiredPath of requiredPaths) {
    if (!(await exists(requiredPath))) {
      throw new Error(
        `Missing runtime pack source for ${runtime} (${target.id}): ${requiredPath}\n` +
        `Run: npm run prepare:runtime-pack-sources -- --target ${target.id}`
      )
    }
  }
}

async function validateTarget(target) {
  for (const runtime of ['python', 'rust', 'go']) {
    await validateRuntimeSource(target, runtime)
  }
}

async function downloadFile(url, destinationPath) {
  const headers = /^https:\/\/api\.github\.com\//i.test(url) || /^https:\/\/github\.com\//i.test(url)
    ? githubHeaders()
    : { 'User-Agent': 'cozea-runtime-pack-sources', Accept: 'application/octet-stream,*/*' }

  const response = await fetch(url, { headers })
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
    throw new Error(result.error || result.stderr || `Failed to extract zip archive: ${archivePath}`)
  }
}

async function extractArchive(archivePath, destinationPath) {
  await mkdir(destinationPath, { recursive: true })
  const normalized = archivePath.toLowerCase()
  if (normalized.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const command = `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationPath.replace(/'/g, "''")}' -Force`
      const psResult = run('powershell', ['-NoProfile', '-Command', command])
      if (!psResult.ok) {
        throw new Error(psResult.error || psResult.stderr || `Failed to extract zip archive: ${archivePath}`)
      }
      return
    }
    try {
      extractArchiveWithUnzip(archivePath, destinationPath)
    } catch {
      extractArchiveWithTar(archivePath, destinationPath)
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

async function copyExtractedRoot(extractDir, expectedRootName, destinationDir) {
  const expectedRoot = path.join(extractDir, expectedRootName)
  let sourceDir = expectedRoot
  if (!(await exists(sourceDir))) {
    const entries = await readdir(extractDir, { withFileTypes: true })
    const fallback = entries.find((entry) => entry.isDirectory())
    if (!fallback) {
      throw new Error(`Unable to locate extracted root directory (${expectedRootName})`)
    }
    sourceDir = path.join(extractDir, fallback.name)
  }

  await rm(destinationDir, { recursive: true, force: true })
  await mkdir(path.dirname(destinationDir), { recursive: true })
  await cp(sourceDir, destinationDir, { recursive: true, force: true, dereference: true })
}

async function fetchLatestPythonRelease() {
  if (cachedPythonRelease) return cachedPythonRelease
  const response = await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', {
    headers: githubHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to query python-build-standalone release (${response.status})`)
  }
  cachedPythonRelease = await response.json()
  return cachedPythonRelease
}

function selectPythonAsset(target, release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const matches = assets.filter(
    (asset) => typeof asset?.name === 'string' && typeof asset?.browser_download_url === 'string' && target.pythonAssetPattern.test(asset.name)
  )
  if (matches.length === 0) return null
  matches.sort((left, right) => {
    const leftScore = left.name.includes('_stripped') ? 0 : 1
    const rightScore = right.name.includes('_stripped') ? 0 : 1
    return leftScore - rightScore
  })
  return matches[0]
}

async function ensurePythonSource(target) {
  const pythonBinary = runtimeBinaryPath(target, 'python')
  if (!force && await exists(pythonBinary)) {
    return
  }

  const release = await fetchLatestPythonRelease()
  const asset = selectPythonAsset(target, release)
  if (!asset?.browser_download_url) {
    throw new Error(`No python-build-standalone archive found for ${target.id}`)
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `cozea-runtime-python-${target.id}-`))
  try {
    const archivePath = path.join(tempDir, asset.name)
    const extractDir = path.join(tempDir, 'extract')
    log(`Downloading Python runtime source (${asset.name}) for ${target.id}`)
    await downloadFile(asset.browser_download_url, archivePath)
    await extractArchive(archivePath, extractDir)
    await copyExtractedRoot(extractDir, 'python', runtimeSourceDir(target, 'python'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function fetchLatestGoRelease() {
  if (cachedGoRelease) return cachedGoRelease
  const response = await fetch('https://go.dev/dl/?mode=json', {
    headers: { Accept: 'application/json', 'User-Agent': 'cozea-runtime-pack-sources' },
  })
  if (!response.ok) {
    throw new Error(`Failed to query Go release feed (${response.status})`)
  }
  const payload = await response.json()
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Go release feed returned no releases')
  }
  cachedGoRelease = payload.find((release) => release?.stable) || payload[0]
  return cachedGoRelease
}

function resolveGoArchiveFile(target, release) {
  const files = Array.isArray(release?.files) ? release.files : []
  return files.find(
    (file) =>
      file?.kind === 'archive' &&
      file?.os === 'darwin' &&
      file?.arch === target.goArch &&
      typeof file?.filename === 'string'
  ) ?? null
}

async function ensureGoSource(target) {
  const goBinary = runtimeBinaryPath(target, 'go')
  if (!force && await exists(goBinary)) {
    return
  }

  const release = await fetchLatestGoRelease()
  const archiveFile = resolveGoArchiveFile(target, release)
  if (!archiveFile?.filename) {
    throw new Error(`No Go archive found for ${target.id}`)
  }

  const archiveUrl = `https://go.dev/dl/${archiveFile.filename}`
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `cozea-runtime-go-${target.id}-`))
  try {
    const archivePath = path.join(tempDir, archiveFile.filename)
    const extractDir = path.join(tempDir, 'extract')
    log(`Downloading Go runtime source (${archiveFile.filename}) for ${target.id}`)
    await downloadFile(archiveUrl, archivePath)
    await extractArchive(archivePath, extractDir)
    await copyExtractedRoot(extractDir, 'go', runtimeSourceDir(target, 'go'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function fetchRustChannel() {
  if (cachedRustChannel) return cachedRustChannel
  const response = await fetch('https://static.rust-lang.org/dist/channel-rust-stable.toml', {
    headers: { Accept: 'text/plain', 'User-Agent': 'cozea-runtime-pack-sources' },
  })
  if (!response.ok) {
    throw new Error(`Failed to query Rust stable channel (${response.status})`)
  }

  const payload = await response.text()
  const dateMatch = payload.match(/^date\s*=\s*"([^"]+)"/m)
  const versionMatch =
    payload.match(/cargo-([0-9]+\.[0-9]+\.[0-9]+)-x86_64-apple-darwin\.tar\.gz/) ??
    payload.match(/rustc-([0-9]+\.[0-9]+\.[0-9]+)-x86_64-apple-darwin\.tar\.gz/)

  if (!dateMatch?.[1] || !versionMatch?.[1]) {
    throw new Error('Unable to parse Rust channel metadata')
  }

  cachedRustChannel = {
    date: dateMatch[1],
    version: versionMatch[1],
  }
  return cachedRustChannel
}

async function installRustComponent(component, target, runtimeDir, tempDir, rustChannel) {
  const archiveName = `${component}-${rustChannel.version}-${target.rustTriple}.tar.gz`
  const archiveUrl = `https://static.rust-lang.org/dist/${rustChannel.date}/${archiveName}`
  const archivePath = path.join(tempDir, archiveName)
  const extractDir = path.join(tempDir, `${component}-extract`)

  log(`Downloading Rust component (${archiveName}) for ${target.id}`)
  await downloadFile(archiveUrl, archivePath)
  await extractArchive(archivePath, extractDir)

  const entries = await readdir(extractDir, { withFileTypes: true })
  const sourceRoot = entries.find((entry) => entry.isDirectory())
  if (!sourceRoot) {
    throw new Error(`Unable to locate extracted Rust component directory for ${component}`)
  }

  const installScriptPath = path.join(extractDir, sourceRoot.name, 'install.sh')
  if (!(await exists(installScriptPath))) {
    throw new Error(`Rust component installer missing: ${installScriptPath}`)
  }

  const installArgs = [
    installScriptPath,
    `--destdir=${runtimeDir}`,
    '--prefix=/',
    '--disable-verify',
    '--disable-ldconfig',
  ]
  if (component === 'rust-std') {
    installArgs.push(`--components=rust-std-${target.rustTriple}`)
  }

  const installResult = run('sh', installArgs)
  if (!installResult.ok) {
    throw new Error(
      installResult.error ||
      installResult.stderr ||
      `Failed to install Rust component ${component} for ${target.id}`
    )
  }
}

async function ensureRustSource(target) {
  const cargoBinary = runtimeBinaryPath(target, 'rust')
  if (!force && await exists(cargoBinary)) {
    return
  }

  const rustChannel = await fetchRustChannel()
  const runtimeDir = runtimeSourceDir(target, 'rust')
  await rm(runtimeDir, { recursive: true, force: true })
  await mkdir(runtimeDir, { recursive: true })

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `cozea-runtime-rust-${target.id}-`))
  try {
    for (const component of ['cargo', 'rustc', 'rust-std']) {
      await installRustComponent(component, target, runtimeDir, tempDir, rustChannel)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  parseRequestedTargets()
  await mkdir(sourceRoot, { recursive: true })
  const requiredTargets = getRequiredTargets()
  if (requiredTargets.length === 0) {
    log(`No supported target for ${process.platform}-${process.arch}; skipping runtime pack source preparation`)
    return
  }

  log(`Preparing runtime pack sources in ${sourceRoot}`)
  for (const target of requiredTargets) {
    if (!checkOnly) {
      await ensurePythonSource(target)
      await ensureRustSource(target)
      await ensureGoSource(target)
    }
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
