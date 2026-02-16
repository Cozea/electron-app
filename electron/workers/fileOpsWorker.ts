import { readdir, readFile, stat, access } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  EXCLUDED_GENERATED_DIRECTORIES,
  shouldExcludeGeneratedFile,
} from '../services/generatedArtifactFilters'

const BATCH_SIZE = 50
const DEFAULT_EXCLUDED_DIRECTORIES = ['.git', ...EXCLUDED_GENERATED_DIRECTORIES]
const SLOW_FS_OP_WARNING_MS = 5000
const MANIFEST_DEBUG_VERBOSE = process.env.COZEA_DEBUG_MANIFEST === '1'

interface ManifestRequest {
  type: 'getManifest' | 'getManifestIncremental'
  id: string
  payload: {
    projectPath: string
    excludePatterns?: string[]
    strict?: boolean
    previousEntries?: Record<string, ManifestEntry>
    previousDirMtimes?: Record<string, number>
  }
}

interface ManifestCancelRequest {
  type: 'cancel'
  id: string
}

interface UtilityConnectRequest {
  type: 'connect'
}

type InboundRequest = ManifestRequest | ManifestCancelRequest

type ParentInboundMessage = UtilityConnectRequest | InboundRequest

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

interface UtilityPort {
  postMessage: (message: unknown) => void
  on: (event: 'message', listener: (event: unknown) => void) => void
  start?: () => void
}

const cancelledRequestIds = new Set<string>()
let controlPort: UtilityPort | null = null

function getEventData(eventOrData: unknown): unknown {
  if (typeof eventOrData !== 'object' || eventOrData === null) return eventOrData
  if ('data' in eventOrData) {
    return (eventOrData as { data?: unknown }).data
  }
  return eventOrData
}

function postMessage(message: unknown): void {
  if (controlPort) {
    controlPort.postMessage(message)
    return
  }
  process.parentPort?.postMessage(message)
}

function postDebug(message: string, details?: Record<string, unknown>) {
  if (!MANIFEST_DEBUG_VERBOSE) return
  postMessage({
    type: 'debug',
    message,
    details,
  })
}

function assertNotCancelled(requestId: string): void {
  if (!cancelledRequestIds.has(requestId)) return
  throw new Error('Manifest request cancelled')
}

async function withSlowOpDebug<T>(
  requestId: string,
  op: string,
  target: string,
  run: () => Promise<T>
): Promise<T> {
  assertNotCancelled(requestId)
  const startedAt = Date.now()
  let warned = false
  const timeoutId = setTimeout(() => {
    warned = true
    postDebug('slow-op-pending', {
      requestId,
      op,
      target,
      elapsedMs: Date.now() - startedAt,
    })
  }, SLOW_FS_OP_WARNING_MS)

  try {
    const result = await run()
    assertNotCancelled(requestId)
    if (warned) {
      postDebug('slow-op-resolved', {
        requestId,
        op,
        target,
        elapsedMs: Date.now() - startedAt,
      })
    }
    return result
  } catch (error) {
    if (warned) {
      postDebug('slow-op-failed', {
        requestId,
        op,
        target,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function shouldExcludeFile(relativePath: string): boolean {
  return shouldExcludeGeneratedFile(relativePath)
}

async function generateManifest(
  requestId: string,
  projectPath: string,
  excludePatterns?: string[],
  strict?: boolean,
  previousEntries?: Record<string, ManifestEntry>,
  previousDirMtimes?: Record<string, number>
): Promise<ManifestResult> {
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

  try {
    await withSlowOpDebug(requestId, 'access', projectPath, async () => {
      await access(projectPath)
    })
  } catch (error) {
    if (strict) {
      throw error
    }
    return { manifest: [], totalFiles: 0, dirMtimes }
  }

  const filePaths: string[] = []
  const manifest: ManifestEntry[] = []

  async function walkDir(dir: string, relativePath = ''): Promise<void> {
    assertNotCancelled(requestId)

    let entries
    try {
      entries = await withSlowOpDebug(requestId, 'readdir', dir, async () => {
        return await readdir(dir, { withFileTypes: true })
      })
    } catch (error) {
      if (strict) {
        throw error
      }
      return
    }

    let dirStats
    try {
      dirStats = await withSlowOpDebug(requestId, 'stat-dir', dir, async () => {
        return await stat(dir)
      })
    } catch (error) {
      if (strict) {
        throw error
      }
      return
    }

    const dirKey = relativePath.replace(/\\/g, '/')
    dirMtimes[dirKey] = dirStats.mtimeMs

    if (previousEntries && previousDirs[dirKey] === dirStats.mtimeMs) {
      const cachedEntries = previousByDir.get(dirKey)
      if (cachedEntries && cachedEntries.every((entry) => entry.hash.length === 64)) {
        manifest.push(...cachedEntries)
        for (const [cachedDir, mtime] of Object.entries(previousDirs)) {
          if (cachedDir === dirKey || cachedDir.startsWith(`${dirKey}/`)) {
            if (!(cachedDir in dirMtimes)) {
              dirMtimes[cachedDir] = mtime
            }
          }
        }
        return
      }
    }

    for (const entry of entries) {
      assertNotCancelled(requestId)
      if (entry.isSymbolicLink()) continue

      if (excludes.has(entry.name.toLowerCase())) continue
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

  let processedCount = 0

  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    assertNotCancelled(requestId)
    const batch = filePaths.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (relPath) => {
        assertNotCancelled(requestId)
        if (shouldExcludeFile(relPath)) return null
        const fullPath = path.join(projectPath, relPath)
        try {
          const stats = await withSlowOpDebug(requestId, 'stat-file', fullPath, async () => {
            return await stat(fullPath)
          })
          const previous = previousByPath?.get(relPath)

          if (
            previous &&
            previous.hash.length === 64 &&
            previous.mtime === stats.mtimeMs &&
            previous.size === stats.size
          ) {
            return {
              path: relPath,
              hash: previous.hash,
              size: stats.size,
              mtime: stats.mtimeMs,
            }
          }

          const content = await withSlowOpDebug(requestId, 'read-file', fullPath, async () => {
            return await readFile(fullPath)
          })
          const hash = createHash('sha256').update(content).digest('hex')
          return {
            path: relPath,
            hash,
            size: stats.size,
            mtime: stats.mtimeMs,
          }
        } catch (error) {
          if (strict) {
            throw error
          }
          return null
        }
      })
    )

    for (const result of batchResults) {
      if (result) manifest.push(result)
    }

    processedCount += batch.length

    postMessage({
      type: 'progress',
      id: requestId,
      processed: processedCount,
      total: filePaths.length,
    })
  }

  assertNotCancelled(requestId)
  return { manifest, totalFiles: manifest.length, dirMtimes }
}

async function handleManifestRequest(msg: ManifestRequest): Promise<void> {
  const startTime = Date.now()
  cancelledRequestIds.delete(msg.id)

  try {
    const result = await generateManifest(
      msg.id,
      msg.payload.projectPath,
      msg.payload.excludePatterns,
      msg.payload.strict,
      msg.payload.previousEntries,
      msg.payload.previousDirMtimes
    )
    postMessage({
      type: 'result',
      id: msg.id,
      success: true,
      payload: result,
      duration: Date.now() - startTime,
    })
  } catch (error) {
    postMessage({
      type: 'result',
      id: msg.id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    })
  } finally {
    cancelledRequestIds.delete(msg.id)
  }
}

function handleInboundMessage(raw: unknown): void {
  const msg = raw as InboundRequest

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return
  }

  if (msg.type === 'cancel') {
    cancelledRequestIds.add(msg.id)
    return
  }

  if (msg.type === 'getManifest' || msg.type === 'getManifestIncremental') {
    void handleManifestRequest(msg)
  }
}

function handleParentMessage(raw: unknown): void {
  const parentEvent = raw as { data?: unknown; ports?: unknown[] }
  const message = getEventData(parentEvent)
  const parsed = message as ParentInboundMessage

  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'connect') {
    if (parsed && typeof parsed === 'object') {
      handleInboundMessage(parsed)
    }
    return
  }

  const maybePorts = parentEvent.ports
  const firstPort = Array.isArray(maybePorts) ? maybePorts[0] : null
  if (!firstPort || typeof firstPort !== 'object') {
    process.parentPort?.postMessage({ type: 'error', error: 'Missing message port for utility process' })
    return
  }

  const connectedPort = firstPort as UtilityPort
  controlPort = connectedPort

  controlPort.on('message', (eventOrData) => {
    const data = getEventData(eventOrData)
    handleInboundMessage(data)
  })

  controlPort.start?.()

  postMessage({ type: 'ready' })
}

if (process.parentPort) {
  process.parentPort.on('message', (event) => {
    handleParentMessage(event)
  })
} else {
  throw new Error('fileOpsUtility must run in an Electron utility process')
}
