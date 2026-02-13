import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadBundledRuntimeManifest, loadBundledRuntimePublicKey } from './runtimeManifest'
import { runtimeLocks } from './runtimeLocks'
import { getRuntimeCacheRoot, getRuntimeTarget, resolveRuntimeHealth } from './runtimeResolver'
import type { RuntimeEnsureResult, RuntimeKind, RuntimeManifest, RuntimeManifestEntry, RuntimeTarget } from './runtimeTypes'

const RUNTIME_MANIFEST_FILENAME = 'runtime-manifest.json'
const RUNTIME_MANIFEST_SIGNATURE_FILENAME = 'runtime-manifest.sig'
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_INSTALL_RETRIES = 2
const DEFAULT_RELEASE_REPOSITORY = 'Cozea/cozea-prod'

export interface RuntimeInstallOptions {
  cleanBrokenLocalFiles?: boolean
  forceReinstall?: boolean
}

let manifestCache: {
  value: RuntimeManifest
  fetchedAt: number
  releaseAssets: Map<string, string>
  target: RuntimeTarget
} | null = null

function logRuntimeInstaller(message: string) {
  console.log(`[runtime-installer] ${message}`)
}

function isBundledJsRuntime(runtime: RuntimeKind): boolean {
  return runtime === 'node' || runtime === 'npm' || runtime === 'corepack' || runtime === 'pnpm' || runtime === 'yarn' || runtime === 'bun'
}

function getRuntimeMetaDir(): string {
  return path.join(getRuntimeCacheRoot(), '_meta')
}

function getCachedManifestPath(): string {
  return path.join(getRuntimeMetaDir(), RUNTIME_MANIFEST_FILENAME)
}

function getCachedManifestSignaturePath(): string {
  return path.join(getRuntimeMetaDir(), RUNTIME_MANIFEST_SIGNATURE_FILENAME)
}

function getRuntimeReleaseRepository(): string {
  return process.env.COZEA_RUNTIME_RELEASE_REPO?.trim() || DEFAULT_RELEASE_REPOSITORY
}

function getRuntimeReleaseTag(): string | null {
  const explicitTag = process.env.COZEA_RUNTIME_RELEASE_TAG?.trim()
  if (explicitTag) return explicitTag
  try {
    const version = app.getVersion()
    if (version) return `v${version}`
  } catch {
    // Ignore when app version is unavailable.
  }
  return null
}

function toArchiveOverrideEnvKeys(runtime: RuntimeKind, target: RuntimeTarget): string[] {
  const normalizedRuntime = runtime.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const normalizedTarget = target.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return [
    `COZEA_RUNTIME_PACK_URL_${normalizedRuntime}_${normalizedTarget}`,
    `COZEA_RUNTIME_PACK_URL_${normalizedRuntime}`,
  ]
}

function resolveArchiveOverride(runtime: RuntimeKind, target: RuntimeTarget): string | null {
  for (const key of toArchiveOverrideEnvKeys(runtime, target)) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return null
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function getExecutableName(runtime: RuntimeKind): string {
  if (process.platform !== 'win32') {
    if (runtime === 'rust') return 'cargo'
    return runtime
  }

  if (runtime === 'npm') return 'npm.cmd'
  if (runtime === 'pnpm') return 'pnpm.cmd'
  if (runtime === 'yarn') return 'yarn.cmd'
  if (runtime === 'corepack') return 'corepack.cmd'
  if (runtime === 'rust') return 'cargo.exe'
  if (runtime === 'go') return 'go.exe'
  if (runtime === 'python') return 'python.exe'
  if (runtime === 'bun') return 'bun.exe'
  return `${runtime}.exe`
}

function getDefaultExecutableRelativePath(runtime: RuntimeKind): string {
  return path.join('bin', getExecutableName(runtime))
}

function getRuntimeInstallDir(runtime: RuntimeKind, target: RuntimeTarget): string {
  return path.join(getRuntimeCacheRoot(), target, runtime)
}

async function removeRuntimeInstallArtifacts(runtime: RuntimeKind, target: RuntimeTarget): Promise<void> {
  const runtimeDir = getRuntimeInstallDir(runtime, target)
  await rm(runtimeDir, { recursive: true, force: true })

  const runtimeParentDir = path.dirname(runtimeDir)
  if (!(await exists(runtimeParentDir))) return
  const entries = await readdir(runtimeParentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith(`${runtime}.bak-`)) continue
    await rm(path.join(runtimeParentDir, entry.name), { recursive: true, force: true })
  }
}

function decodeSignatureBuffer(input: Buffer): Buffer {
  const text = input.toString('utf-8').trim()
  if (text && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
    try {
      return Buffer.from(text.replace(/\s+/g, ''), 'base64')
    } catch {
      // Fall back to raw bytes.
    }
  }
  return input
}

function verifyDetachedSignature(payload: Buffer, signatureBytes: Buffer, publicKeyPem: string): boolean {
  const key = createPublicKey(publicKeyPem)
  return verify(null, payload, key, signatureBytes)
}

function computeSha256Hex(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json,application/octet-stream',
    'User-Agent': 'cozea-runtime-installer',
  }
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function parseRepositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid runtime release repository "${repository}". Use owner/repo format.`)
  }
  return { owner, repo }
}

async function fetchReleaseAssets(): Promise<Map<string, string>> {
  const repository = getRuntimeReleaseRepository()
  const { owner, repo } = parseRepositoryParts(repository)
  const tag = getRuntimeReleaseTag()
  const endpoints = tag
    ? [
        `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
        `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      ]
    : [`https://api.github.com/repos/${owner}/${repo}/releases/latest`]

  let lastError: string | null = null
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { headers: githubHeaders() })
    if (!response.ok) {
      lastError = `${response.status} ${response.statusText}`
      continue
    }
    const payload = await response.json() as { assets?: Array<{ name?: string; browser_download_url?: string }> }
    const assetMap = new Map<string, string>()
    for (const asset of payload.assets ?? []) {
      const name = asset.name?.trim()
      const url = asset.browser_download_url?.trim()
      if (!name || !url) continue
      assetMap.set(name, url)
    }
    return assetMap
  }

  throw new Error(`Unable to resolve runtime release assets (${lastError ?? 'no release metadata'})`)
}

async function downloadToFile(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }

  await mkdir(path.dirname(destinationPath), { recursive: true })
  const body = Readable.fromWeb(response.body)
  await pipeline(body, fs.createWriteStream(destinationPath))
}

async function readVerifiedManifestFromFiles(
  manifestPath: string,
  signaturePath: string,
  publicKeyPem: string
): Promise<RuntimeManifest | null> {
  if (!(await exists(manifestPath)) || !(await exists(signaturePath))) return null

  const payload = await readFile(manifestPath)
  const signatureRaw = await readFile(signaturePath)
  const signatureBytes = decodeSignatureBuffer(signatureRaw)
  const valid = verifyDetachedSignature(payload, signatureBytes, publicKeyPem)
  if (!valid) return null

  try {
    const parsed = JSON.parse(payload.toString('utf-8')) as RuntimeManifest
    if (!Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

async function cacheManifestFiles(payload: Buffer, signature: Buffer): Promise<void> {
  const metaDir = getRuntimeMetaDir()
  await mkdir(metaDir, { recursive: true })
  await writeFile(getCachedManifestPath(), payload)
  await writeFile(getCachedManifestSignaturePath(), signature)
}

function firstExistingAssetUrl(assetMap: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const match = assetMap.get(name)
    if (match) return match
  }
  return null
}

async function resolveRuntimeManifest(
  publicKeyPem: string,
  target: RuntimeTarget
): Promise<{ manifest: RuntimeManifest; releaseAssets: Map<string, string> }> {
  const now = Date.now()
  if (manifestCache && manifestCache.target === target && now - manifestCache.fetchedAt < MANIFEST_CACHE_TTL_MS) {
    return { manifest: manifestCache.value, releaseAssets: manifestCache.releaseAssets }
  }

  let releaseAssets = new Map<string, string>()
  try {
    releaseAssets = await fetchReleaseAssets()
  } catch (error) {
    logRuntimeInstaller(`Release asset lookup failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const manifestUrlOverride = process.env.COZEA_RUNTIME_MANIFEST_URL?.trim()
  const signatureUrlOverride = process.env.COZEA_RUNTIME_MANIFEST_SIG_URL?.trim()
  const manifestUrl = manifestUrlOverride || firstExistingAssetUrl(releaseAssets, [
    `runtime-manifest-${target}.json`,
    RUNTIME_MANIFEST_FILENAME,
  ])
  const manifestSignatureUrl = signatureUrlOverride || firstExistingAssetUrl(releaseAssets, [
    `runtime-manifest-${target}.sig`,
    RUNTIME_MANIFEST_SIGNATURE_FILENAME,
  ])

  if (manifestUrl && manifestSignatureUrl) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cozea-runtime-manifest-'))
    const manifestPath = path.join(tempDir, RUNTIME_MANIFEST_FILENAME)
    const signaturePath = path.join(tempDir, RUNTIME_MANIFEST_SIGNATURE_FILENAME)
    try {
      await downloadToFile(manifestUrl, manifestPath)
      await downloadToFile(manifestSignatureUrl, signaturePath)

      const payload = await readFile(manifestPath)
      const signatureRaw = await readFile(signaturePath)
      const signatureBytes = decodeSignatureBuffer(signatureRaw)

      const valid = verifyDetachedSignature(payload, signatureBytes, publicKeyPem)
      if (!valid) {
        throw new Error('Runtime manifest signature verification failed.')
      }

      const parsed = JSON.parse(payload.toString('utf-8')) as RuntimeManifest
      if (!Array.isArray(parsed.entries)) {
        throw new Error('Runtime manifest is malformed: entries must be an array.')
      }

      await cacheManifestFiles(payload, signatureRaw)
      manifestCache = {
        value: parsed,
        fetchedAt: now,
        releaseAssets,
        target,
      }
      return { manifest: parsed, releaseAssets }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  const cachedManifest = await readVerifiedManifestFromFiles(
    getCachedManifestPath(),
    getCachedManifestSignaturePath(),
    publicKeyPem
  )
  if (cachedManifest) {
    manifestCache = {
      value: cachedManifest,
      fetchedAt: now,
      releaseAssets,
      target,
    }
    return { manifest: cachedManifest, releaseAssets }
  }

  const bundledManifest = loadBundledRuntimeManifest()
  if (!Array.isArray(bundledManifest.entries)) {
    throw new Error('Bundled runtime manifest is malformed.')
  }

  manifestCache = {
    value: bundledManifest,
    fetchedAt: now,
    releaseAssets,
    target,
  }
  return { manifest: bundledManifest, releaseAssets }
}

function resolveArchiveSource(
  entry: RuntimeManifestEntry,
  runtime: RuntimeKind,
  target: RuntimeTarget,
  releaseAssets: Map<string, string>
): string | null {
  const override = resolveArchiveOverride(runtime, target)
  if (override) return override
  if (entry.downloadUrl?.trim()) return entry.downloadUrl.trim()
  if (entry.archiveName?.trim()) {
    const archiveName = entry.archiveName.trim()
    const localCandidates = [
      path.join(process.env.APP_ROOT || process.cwd(), 'build', 'runtime', 'packs', target, archiveName),
      path.join(process.resourcesPath, 'runtime', 'packs', target, archiveName),
      path.join(process.env.APP_ROOT || process.cwd(), 'build', 'runtime', 'packs', archiveName),
      path.join(process.resourcesPath, 'runtime', 'packs', archiveName),
    ]
    const localPath = localCandidates.find((candidate) => fs.existsSync(candidate))
    if (localPath) return localPath
    return releaseAssets.get(archiveName) ?? null
  }
  return null
}

function runSync(command: string, args: string[]): { ok: boolean; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: result.status === 0,
    stderr: (result.stderr || result.error?.message || '').trim(),
  }
}

function extractZipArchive(archivePath: string, destinationPath: string): void {
  if (process.platform === 'win32') {
    const escapedArchive = archivePath.replace(/'/g, "''")
    const escapedDestination = destinationPath.replace(/'/g, "''")
    const command = `Expand-Archive -Path '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`
    const result = runSync('powershell', ['-NoProfile', '-Command', command])
    if (!result.ok) throw new Error(result.stderr || `Failed to extract ZIP archive: ${archivePath}`)
    return
  }

  const unzipResult = runSync('unzip', ['-q', archivePath, '-d', destinationPath])
  if (unzipResult.ok) return

  const tarResult = runSync('tar', ['-x', '-f', archivePath, '-C', destinationPath])
  if (!tarResult.ok) {
    throw new Error(tarResult.stderr || unzipResult.stderr || `Failed to extract ZIP archive: ${archivePath}`)
  }
}

function extractTarArchive(archivePath: string, destinationPath: string, flag: string): void {
  const result = runSync('tar', ['-x', flag, '-f', archivePath, '-C', destinationPath])
  if (!result.ok) {
    throw new Error(result.stderr || `Failed to extract archive: ${archivePath}`)
  }
}

async function extractArchive(archivePath: string, destinationPath: string): Promise<void> {
  const normalized = archivePath.toLowerCase()
  await mkdir(destinationPath, { recursive: true })

  if (normalized.endsWith('.zip')) {
    extractZipArchive(archivePath, destinationPath)
    return
  }
  if (normalized.endsWith('.tar.gz') || normalized.endsWith('.tgz')) {
    extractTarArchive(archivePath, destinationPath, '-z')
    return
  }
  if (normalized.endsWith('.tar.bz2') || normalized.endsWith('.tbz2')) {
    extractTarArchive(archivePath, destinationPath, '-j')
    return
  }
  if (normalized.endsWith('.tar.xz') || normalized.endsWith('.txz')) {
    extractTarArchive(archivePath, destinationPath, '-J')
    return
  }

  const fallback = runSync('tar', ['-x', '-f', archivePath, '-C', destinationPath])
  if (!fallback.ok) {
    throw new Error(fallback.stderr || `Unsupported runtime archive format: ${archivePath}`)
  }
}

async function flattenSingleNestedRoot(rootDir: string, executableRelativePath: string): Promise<void> {
  const executablePath = path.join(rootDir, executableRelativePath)
  if (await exists(executablePath)) return

  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true })
  const visibleEntries = entries.filter((entry) => entry.name !== '.DS_Store')
  if (visibleEntries.length !== 1 || !visibleEntries[0].isDirectory()) {
    return
  }

  const nestedRoot = path.join(rootDir, visibleEntries[0].name)
  const nestedExecutable = path.join(nestedRoot, executableRelativePath)
  if (!(await exists(nestedExecutable))) return

  const children = await fs.promises.readdir(nestedRoot)
  for (const child of children) {
    await rename(path.join(nestedRoot, child), path.join(rootDir, child))
  }
  await rm(nestedRoot, { recursive: true, force: true })
}

async function installExtractedRuntime(stagingDir: string, runtimeDir: string): Promise<void> {
  await mkdir(path.dirname(runtimeDir), { recursive: true })

  const backupDir = `${runtimeDir}.bak-${Date.now()}`
  const hadExisting = await exists(runtimeDir)
  if (hadExisting) {
    await rm(backupDir, { recursive: true, force: true })
    await rename(runtimeDir, backupDir)
  }

  const restoreBackup = async () => {
    if (!hadExisting) return
    if (!(await exists(backupDir))) return
    await rm(runtimeDir, { recursive: true, force: true })
    await rename(backupDir, runtimeDir)
  }

  try {
    try {
      await rename(stagingDir, runtimeDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') {
        throw error
      }
      await cp(stagingDir, runtimeDir, { recursive: true, force: true })
      await rm(stagingDir, { recursive: true, force: true })
    }
    if (hadExisting) {
      await rm(backupDir, { recursive: true, force: true })
    }
  } catch (error) {
    await restoreBackup()
    throw error
  }
}

async function materializeArchiveSource(source: string, tempDir: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const archivePath = path.join(
      tempDir,
      path.basename(new URL(source).pathname) || 'runtime-pack.archive'
    )
    await downloadToFile(source, archivePath)
    return archivePath
  }

  const archivePath = path.resolve(source)
  if (!(await exists(archivePath))) {
    throw new Error(`Runtime archive not found: ${archivePath}`)
  }
  return archivePath
}

function assertArchiveIntegrity(
  archivePayload: Buffer,
  manifestEntry: RuntimeManifestEntry,
  publicKeyPem: string
): void {
  if (!manifestEntry.sha256) {
    throw new Error('Runtime manifest entry is missing sha256.')
  }
  if (!manifestEntry.signature) {
    throw new Error('Runtime manifest entry is missing signature.')
  }

  const digest = computeSha256Hex(archivePayload)
  if (digest !== manifestEntry.sha256) {
    throw new Error(`Runtime archive SHA256 mismatch (expected ${manifestEntry.sha256}, got ${digest}).`)
  }

  const signatureBytes = Buffer.from(manifestEntry.signature.replace(/\s+/g, ''), 'base64')
  const signatureValid = verifyDetachedSignature(archivePayload, signatureBytes, publicKeyPem)
  if (!signatureValid) {
    throw new Error('Runtime archive signature verification failed.')
  }
}

function findManifestEntry(
  manifest: RuntimeManifest,
  runtime: RuntimeKind,
  target: RuntimeTarget
): RuntimeManifestEntry | null {
  return manifest.entries.find(
    (entry) => entry.runtime === runtime && entry.target === target
  ) ?? null
}

function getInstallRetries(): number {
  const raw = Number.parseInt(process.env.COZEA_RUNTIME_INSTALL_RETRIES ?? '', 10)
  if (Number.isFinite(raw) && raw >= 1) return raw
  return DEFAULT_INSTALL_RETRIES
}

function getRuntimePublicKey(): string | null {
  const explicit = process.env.COZEA_RUNTIME_PUBLIC_KEY_PEM?.trim()
  if (explicit) {
    if (explicit.includes('BEGIN PUBLIC KEY')) return explicit
    if (fs.existsSync(explicit)) {
      return fs.readFileSync(explicit, 'utf-8')
    }
    return null
  }
  return loadBundledRuntimePublicKey()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function ensureRuntimeInstalled(
  runtime: RuntimeKind,
  target = getRuntimeTarget(),
  options: RuntimeInstallOptions = {}
): Promise<RuntimeEnsureResult> {
  return runtimeLocks.withLock(`${runtime}:${target}`, async () => {
    if (options.cleanBrokenLocalFiles || options.forceReinstall) {
      await removeRuntimeInstallArtifacts(runtime, target)
    }

    const existing = resolveRuntimeHealth(runtime, target)
    if (existing.available && !options.forceReinstall) {
      return {
        success: true,
        runtime,
        target,
        source: existing.source,
        executablePath: existing.executablePath,
        installed: false,
      }
    }

    if (existing.available && options.forceReinstall && existing.source !== 'runtime-pack') {
      return {
        success: true,
        runtime,
        target,
        source: existing.source,
        executablePath: existing.executablePath,
        installed: false,
      }
    }

    const publicKeyPem = getRuntimePublicKey()
    if (!publicKeyPem) {
      return {
        success: false,
        runtime,
        target,
        source: existing.source,
        installed: false,
        error: 'Runtime signing public key is not configured.',
      }
    }

    const retries = getInstallRetries()
    let lastError = existing.error ?? 'Runtime executable not found.'

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const { manifest, releaseAssets } = await resolveRuntimeManifest(publicKeyPem, target)
        const manifestEntry = findManifestEntry(manifest, runtime, target)
        if (!manifestEntry) {
          throw new Error(
            isBundledJsRuntime(runtime)
              ? `Bundled JS runtime "${runtime}" is missing for ${target}.`
              : `Runtime pack entry missing for ${runtime} (${target}).`
          )
        }

        const archiveSource = resolveArchiveSource(manifestEntry, runtime, target, releaseAssets)
        if (!archiveSource) {
          const overrideKeys = toArchiveOverrideEnvKeys(runtime, target).join(', ')
          throw new Error(
            `No runtime archive source found for ${runtime} (${target}). Set one of: ${overrideKeys}`
          )
        }

        const tempDir = await mkdtemp(path.join(os.tmpdir(), `cozea-runtime-${runtime}-${String(target)}-`))
        try {
          const archivePath = await materializeArchiveSource(archiveSource, tempDir)
          const archivePayload = await readFile(archivePath)
          assertArchiveIntegrity(archivePayload, manifestEntry, publicKeyPem)

          const stagingRoot = path.join(tempDir, 'staging')
          await extractArchive(archivePath, stagingRoot)

          const executableRelativePath = manifestEntry.executableRelativePath || getDefaultExecutableRelativePath(runtime)
          await flattenSingleNestedRoot(stagingRoot, executableRelativePath)

          const stagedExecutable = path.join(stagingRoot, executableRelativePath)
          if (!(await exists(stagedExecutable))) {
            throw new Error(`Runtime archive missing executable: ${executableRelativePath}`)
          }
          if (process.platform !== 'win32') {
            await fs.promises.chmod(stagedExecutable, 0o755).catch(() => {
              // Ignore chmod failures for non-executable script targets.
            })
          }

          const runtimeDir = getRuntimeInstallDir(runtime, target)
          await installExtractedRuntime(stagingRoot, runtimeDir)
        } finally {
          await rm(tempDir, { recursive: true, force: true })
        }

        const resolved = resolveRuntimeHealth(runtime, target)
        if (!resolved.available || !resolved.executablePath) {
          throw new Error('Runtime installed but executable could not be resolved.')
        }

        logRuntimeInstaller(`Installed runtime ${runtime} for ${target} from runtime pack`)
        return {
          success: true,
          runtime,
          target,
          source: resolved.source,
          executablePath: resolved.executablePath,
          installed: true,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (attempt < retries) {
          await sleep(250 * attempt)
        }
      }
    }

    return {
      success: false,
      runtime,
      target,
      source: 'missing',
      installed: false,
      error: lastError,
    }
  })
}
