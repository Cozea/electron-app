import { app } from 'electron'
import fs from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadBundledCapabilityCatalog, loadBundledRuntimePublicKey } from './runtimeManifest'
import type { CapabilityCatalog } from './runtimeTypes'
import { verifyCatalogAsset } from './catalogVerify'

const DEFAULT_CAPABILITY_CATALOG: CapabilityCatalog = {
  version: '0',
  generatedAt: new Date(0).toISOString(),
  rules: [
    {
      id: 'expo-native',
      matchAnyFile: ['app.json', 'app.config.js', 'app.config.ts'],
      matchAnyScript: ['ios', 'android', 'start'],
      suggestedCommands: [
        {
          command: 'npm start',
          runtime: 'npm',
          confidence: 0.92,
          reason: 'Found Expo app config and native mobile scripts.',
        },
      ],
    },
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

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000

let refreshInFlight: Promise<void> | null = null
let cachedCatalog: { value: CapabilityCatalog; loadedAt: number } | null = null

function getRuntimeMetaDir(): string {
  if (app && typeof app.isReady === 'function' && app.isReady()) {
    return path.join(app.getPath('userData'), 'runtimes', '_meta')
  }
  return path.join(os.homedir(), '.cozea', 'runtimes', '_meta')
}

function getCachedCatalogPath(): string {
  return path.join(getRuntimeMetaDir(), 'capability-catalog.json')
}

function getCachedCatalogSignaturePath(): string {
  return path.join(getRuntimeMetaDir(), 'capability-catalog.sig')
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json,application/octet-stream',
    'User-Agent': 'cozea-capability-catalog',
  }
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function getRuntimeReleaseRepository(): string {
  return process.env.COZEA_RUNTIME_RELEASE_REPO?.trim() || 'Cozea/cozea-prod'
}

function getRuntimeReleaseTag(): string | null {
  const explicitTag = process.env.COZEA_RUNTIME_RELEASE_TAG?.trim()
  if (explicitTag) return explicitTag
  try {
    if (app && typeof app.getVersion === 'function') {
      const version = app.getVersion()
      if (version) return `v${version}`
    }
  } catch {
    // Ignore when app version is unavailable.
  }
  return null
}

function getRuntimeTarget(): string {
  return `${process.platform}-${process.arch}`
}

function parseRepositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid runtime release repository "${repository}".`)
  }
  return { owner, repo }
}

function safeParseCatalog(raw: string): CapabilityCatalog | null {
  try {
    const parsed = JSON.parse(raw) as CapabilityCatalog
    if (!Array.isArray(parsed.rules)) return null
    return parsed
  } catch {
    return null
  }
}

function tryLoadVerifiedCatalog(catalogPath: string, signaturePath: string, publicKeyPem: string): CapabilityCatalog | null {
  if (!fs.existsSync(catalogPath) || !fs.existsSync(signaturePath)) return null
  const verification = verifyCatalogAsset({
    payloadPath: catalogPath,
    signaturePath,
    publicKeyPem,
  })
  if (!verification.valid) return null

  const raw = fs.readFileSync(catalogPath, 'utf-8')
  return safeParseCatalog(raw)
}

function setCachedCatalog(catalog: CapabilityCatalog) {
  cachedCatalog = {
    value: catalog,
    loadedAt: Date.now(),
  }
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

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { headers: githubHeaders() })
    if (!response.ok) continue
    const payload = await response.json() as { assets?: Array<{ name?: string; browser_download_url?: string }> }
    const map = new Map<string, string>()
    for (const asset of payload.assets ?? []) {
      const name = asset.name?.trim()
      const url = asset.browser_download_url?.trim()
      if (!name || !url) continue
      map.set(name, url)
    }
    return map
  }
  return new Map()
}

async function downloadToFile(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok || !response.body) {
    throw new Error(`Catalog download failed (${response.status}) for ${url}`)
  }
  await mkdir(path.dirname(destinationPath), { recursive: true })
  const body = Readable.fromWeb(response.body)
  await pipeline(body, fs.createWriteStream(destinationPath))
}

function firstAsset(assetMap: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const match = assetMap.get(name)
    if (match) return match
  }
  return null
}

async function refreshCatalogFromRelease(): Promise<void> {
  const publicKeyPem = loadBundledRuntimePublicKey()
  if (!publicKeyPem) return

  const assets = await fetchReleaseAssets()
  if (assets.size === 0) return

  const target = getRuntimeTarget()
  const catalogUrl = firstAsset(assets, [`capability-catalog-${target}.json`, 'capability-catalog.json'])
  const signatureUrl = firstAsset(assets, [`capability-catalog-${target}.sig`, 'capability-catalog.sig'])
  if (!catalogUrl || !signatureUrl) return

  const metaDir = getRuntimeMetaDir()
  await mkdir(metaDir, { recursive: true })

  const tempCatalogPath = path.join(metaDir, `capability-catalog.${Date.now()}.tmp.json`)
  const tempSignaturePath = path.join(metaDir, `capability-catalog.${Date.now()}.tmp.sig`)
  try {
    await downloadToFile(catalogUrl, tempCatalogPath)
    await downloadToFile(signatureUrl, tempSignaturePath)

    const verification = verifyCatalogAsset({
      payloadPath: tempCatalogPath,
      signaturePath: tempSignaturePath,
      publicKeyPem,
    })
    if (!verification.valid) return

    const raw = await readFile(tempCatalogPath, 'utf-8')
    const parsed = safeParseCatalog(raw)
    if (!parsed) return

    await rm(getCachedCatalogPath(), { force: true })
    await rm(getCachedCatalogSignaturePath(), { force: true })
    await rename(tempCatalogPath, getCachedCatalogPath())
    await rename(tempSignaturePath, getCachedCatalogSignaturePath())
    setCachedCatalog(parsed)
  } finally {
    await rm(tempCatalogPath, { force: true })
    await rm(tempSignaturePath, { force: true })
  }
}

function ensureBackgroundRefresh() {
  if (refreshInFlight) return
  refreshInFlight = refreshCatalogFromRelease()
    .catch(() => {
      // Ignore refresh errors and keep last known-good catalog.
    })
    .finally(() => {
      refreshInFlight = null
    })
}

export function loadCapabilityCatalog(): CapabilityCatalog {
  ensureBackgroundRefresh()

  if (cachedCatalog && Date.now() - cachedCatalog.loadedAt < CATALOG_CACHE_TTL_MS) {
    return cachedCatalog.value
  }

  const publicKeyPem = loadBundledRuntimePublicKey()
  if (publicKeyPem) {
    const cached = tryLoadVerifiedCatalog(
      getCachedCatalogPath(),
      getCachedCatalogSignaturePath(),
      publicKeyPem
    )
    if (cached) {
      setCachedCatalog(cached)
      return cached
    }
  }

  const bundled = loadBundledCapabilityCatalog()
  if (bundled.rules.length > 0) {
    setCachedCatalog(bundled)
    return bundled
  }

  setCachedCatalog(DEFAULT_CAPABILITY_CATALOG)
  return DEFAULT_CAPABILITY_CATALOG
}
