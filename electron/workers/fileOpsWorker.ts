import { parentPort } from 'node:worker_threads'
import { readdir, readFile, stat, access } from 'node:fs/promises'
import path from 'node:path'
import xxhashInit, { type XXHashAPI } from 'xxhash-wasm'

let xxhasher: XXHashAPI | null = null

const BATCH_SIZE = 50
const DEFAULT_EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pnpm-store',
  '.yarn',
  '__pycache__',
  'tmp',
  'temp',
  'logs',
  'vendor',
  'target',
]
const EXCLUDED_FILE_SUFFIXES = [
  '.log',
  '.tmp',
  '.temp',
  '.swp',
  '.swo',
  '.pid',
  '/prisma/dev.db',
  '/prisma/dev.db-wal',
  '/prisma/dev.db-shm',
]

function shouldExcludeFile(relativePath: string): boolean {
  const normalizedLower = relativePath.replace(/\\/g, '/').toLowerCase()
  return EXCLUDED_FILE_SUFFIXES.some((suffix) => normalizedLower.endsWith(suffix))
}

interface ManifestRequest {
  type: 'getManifest' | 'getManifestIncremental'
  id: string
  payload: {
    projectPath: string
    excludePatterns?: string[]
    previousEntries?: Record<string, ManifestEntry>
    previousDirMtimes?: Record<string, number>
  }
}

interface ManifestEntry {
  path: string
  hash: string
  size: number
  mtime: number
}

interface ManifestResult {
  manifest: ManifestEntry[]
  totalFiles: number
  dirMtimes: Record<string, number>
}

async function generateManifest(
  projectPath: string,
  excludePatterns?: string[],
  previousEntries?: Record<string, ManifestEntry>,
  previousDirMtimes?: Record<string, number>
): Promise<ManifestResult> {
  if (!xxhasher) throw new Error('xxhash not initialized in worker')

  const excludes = new Set(
    [...DEFAULT_EXCLUDED_DIRECTORIES, ...(excludePatterns || [])].map((name) => name.toLowerCase())
  )
  const previousByPath = previousEntries ? new Map(Object.entries(previousEntries)) : null
  const previousDirs = previousDirMtimes ?? {}
  const previousByDir = new Map<string, ManifestEntry[]>()
  if (previousEntries) {
    for (const entry of Object.values(previousEntries)) {
      const dir = entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : ''
      const list = previousByDir.get(dir)
      if (list) {
        list.push(entry)
      } else {
        previousByDir.set(dir, [entry])
      }
    }
  }
  const dirMtimes: Record<string, number> = {}

  // Check if project path exists
  try {
    await access(projectPath)
  } catch {
    return { manifest: [], totalFiles: 0, dirMtimes }
  }

  // Phase 1: Collect all file paths asynchronously
  const filePaths: string[] = []
  const manifest: ManifestEntry[] = []

  async function walkDir(dir: string, relativePath = '') {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    let dirStats
    try {
      dirStats = await stat(dir)
    } catch {
      return
    }

    const dirKey = relativePath.replace(/\\/g, '/')
    dirMtimes[dirKey] = dirStats.mtimeMs

    if (previousEntries && previousDirs[dirKey] === dirStats.mtimeMs) {
      const cachedEntries = previousByDir.get(dirKey)
      if (cachedEntries) {
        manifest.push(...cachedEntries)
      }

      for (const [cachedDir, mtime] of Object.entries(previousDirs)) {
        if (cachedDir === dirKey || cachedDir.startsWith(`${dirKey}/`)) {
          if (!(cachedDir in dirMtimes)) {
            dirMtimes[cachedDir] = mtime
          }
        }
      }

      return
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue

      // Skip excluded directories/files
      if (excludes.has(entry.name.toLowerCase())) continue
      // Skip hidden files except .env.example
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue

      const relPath = path.join(relativePath, entry.name)
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await walkDir(fullPath, relPath)
      } else if (entry.isFile()) {
        const normalized = relPath.replace(/\\/g, '/')
        if (shouldExcludeFile(normalized)) continue
        filePaths.push(normalized)
      }
    }
  }

  await walkDir(projectPath)

  // Phase 2: Process files in batches with controlled parallelism
  let processedCount = 0

  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (relPath) => {
        if (shouldExcludeFile(relPath)) return null
        const fullPath = path.join(projectPath, relPath)
        try {
          const stats = await stat(fullPath)
          const previous = previousByPath?.get(relPath)

          if (previous && previous.mtime === stats.mtimeMs && previous.size === stats.size) {
            return {
              path: relPath,
              hash: previous.hash,
              size: stats.size,
              mtime: stats.mtimeMs,
            }
          }

          const content = await readFile(fullPath)
          const hash = xxhasher!.h64Raw(content).toString(16).padStart(16, '0')
          return {
            path: relPath,
            hash,
            size: stats.size,
            mtime: stats.mtimeMs,
          }
        } catch {
          return null
        }
      })
    )

    // Add successful results to manifest
    for (const result of batchResults) {
      if (result) manifest.push(result)
    }

    processedCount += batch.length

    // Report progress to main thread
    parentPort?.postMessage({
      type: 'progress',
      processed: processedCount,
      total: filePaths.length,
    })
  }

  return { manifest, totalFiles: manifest.length, dirMtimes }
}

// Handle messages from main thread
parentPort?.on('message', async (msg: ManifestRequest) => {
  if (msg.type === 'getManifest' || msg.type === 'getManifestIncremental') {
    const startTime = Date.now()
    try {
      const result = await generateManifest(
        msg.payload.projectPath,
        msg.payload.excludePatterns,
        msg.payload.previousEntries,
        msg.payload.previousDirMtimes
      )
      parentPort?.postMessage({
        type: 'result',
        id: msg.id,
        success: true,
        payload: result,
        duration: Date.now() - startTime,
      })
    } catch (error) {
      parentPort?.postMessage({
        type: 'result',
        id: msg.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      })
    }
  }
})

// Initialize xxhash and signal ready
xxhashInit().then((h) => {
  xxhasher = h
  parentPort?.postMessage({ type: 'ready' })
  console.log('[FileOpsWorker] Worker initialized with xxhash')
}).catch((error) => {
  console.error('[FileOpsWorker] Failed to initialize xxhash:', error)
  parentPort?.postMessage({ type: 'error', error: 'Failed to initialize xxhash' })
})
