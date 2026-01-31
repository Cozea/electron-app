import { parentPort } from 'node:worker_threads'
import { readdir, readFile, stat, access } from 'node:fs/promises'
import path from 'node:path'
import xxhashInit, { type XXHashAPI } from 'xxhash-wasm'

let xxhasher: XXHashAPI | null = null

const BATCH_SIZE = 50

interface ManifestRequest {
  type: 'getManifest'
  id: string
  payload: {
    projectPath: string
    excludePatterns?: string[]
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
}

async function generateManifest(
  projectPath: string,
  excludePatterns?: string[]
): Promise<ManifestResult> {
  if (!xxhasher) throw new Error('xxhash not initialized in worker')

  const defaultExcludes = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']
  const excludes = new Set([...defaultExcludes, ...(excludePatterns || [])])

  // Check if project path exists
  try {
    await access(projectPath)
  } catch {
    return { manifest: [], totalFiles: 0 }
  }

  // Phase 1: Collect all file paths asynchronously
  const filePaths: string[] = []

  async function walkDir(dir: string, relativePath = '') {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      // Skip excluded directories/files
      if (excludes.has(entry.name)) continue
      // Skip hidden files except .env.example
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue

      const relPath = path.join(relativePath, entry.name)
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await walkDir(fullPath, relPath)
      } else if (entry.isFile()) {
        filePaths.push(relPath)
      }
    }
  }

  await walkDir(projectPath)

  // Phase 2: Process files in batches with controlled parallelism
  const manifest: ManifestEntry[] = []
  let processedCount = 0

  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (relPath) => {
        const fullPath = path.join(projectPath, relPath)
        try {
          const [content, stats] = await Promise.all([
            readFile(fullPath),
            stat(fullPath)
          ])
          const hash = xxhasher!.h64Raw(content).toString(16).padStart(16, '0')
          return {
            path: relPath.replace(/\\/g, '/'), // Normalize to forward slashes
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

  return { manifest, totalFiles: manifest.length }
}

// Handle messages from main thread
parentPort?.on('message', async (msg: ManifestRequest) => {
  if (msg.type === 'getManifest') {
    const startTime = Date.now()
    try {
      const result = await generateManifest(
        msg.payload.projectPath,
        msg.payload.excludePatterns
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
