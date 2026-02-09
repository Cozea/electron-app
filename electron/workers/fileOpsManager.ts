import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { app } from 'electron'

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

interface PendingRequest {
  resolve: (result: ManifestResult) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let workerReady = false
let workerReadyPromise: Promise<void> | null = null
const pendingRequests = new Map<string, PendingRequest>()
let requestId = 0
// Full repo indexing can legitimately take longer (especially first import scans).
// Keep this aligned with the 180s timeout expectation below.
const MANIFEST_WORKER_TIMEOUT_MS = 180000
const MANIFEST_DEBUG_VERBOSE = process.env.COZEA_DEBUG_MANIFEST === '1'

function rejectPendingRequests(error: Error): void {
  for (const [id, pending] of pendingRequests) {
    pending.reject(error)
    pendingRequests.delete(id)
  }
}

function getWorkerPath(): string {
  // In development, the worker is in electron/workers
  // In production, it's bundled in out/main
  if (app.isPackaged) {
    return path.join(__dirname, 'fileOpsWorker.js')
  }
  // For development with electron-vite, the worker gets built to out/main
  return path.join(__dirname, 'fileOpsWorker.js')
}

function ensureWorker(): Promise<void> {
  if (workerReady && worker) {
    return Promise.resolve()
  }

  if (workerReadyPromise) {
    return workerReadyPromise
  }

  workerReadyPromise = new Promise((resolve, reject) => {
    try {
      const workerPath = getWorkerPath()
      console.log('[FileOpsManager] Creating worker from:', workerPath)

      worker = new Worker(workerPath)

      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          console.log('[FileOpsManager] Worker is ready')
          workerReady = true
          resolve()
        } else if (msg.type === 'result') {
          const pending = pendingRequests.get(msg.id)
          if (pending) {
            pendingRequests.delete(msg.id)
            if (msg.success) {
              console.log(`[FileOpsManager] Manifest generated in ${msg.duration}ms`)
              pending.resolve(msg.payload)
            } else {
              pending.reject(new Error(msg.error))
            }
          }
        } else if (msg.type === 'progress') {
          // Progress updates can be used for UI feedback if needed
          // console.log(`[FileOpsManager] Progress: ${msg.processed}/${msg.total}`)
        } else if (msg.type === 'debug' && MANIFEST_DEBUG_VERBOSE) {
          console.warn('[FileOpsWorker]', msg.message, msg.details ?? {})
        } else if (msg.type === 'error') {
          console.error('[FileOpsManager] Worker error:', msg.error)
          reject(new Error(msg.error))
        }
      })

      worker.on('error', (error) => {
        console.error('[FileOpsManager] Worker error:', error)
        workerReady = false
        workerReadyPromise = null
        rejectPendingRequests(error)
      })

      worker.on('exit', (code) => {
        console.log(`[FileOpsManager] Worker exited with code ${code}`)
        if (pendingRequests.size > 0) {
          rejectPendingRequests(new Error('Manifest worker exited before completing requests'))
        }
        worker = null
        workerReady = false
        workerReadyPromise = null
      })
    } catch (error) {
      console.error('[FileOpsManager] Failed to create worker:', error)
      workerReadyPromise = null
      reject(error)
    }
  })

  return workerReadyPromise
}

export async function getManifestFromWorker(
  projectPath: string,
  excludePatterns?: string[],
  strict?: boolean
): Promise<ManifestResult> {
  await ensureWorker()

  if (!worker) {
    throw new Error('Worker not available')
  }

  const id = `manifest-${++requestId}`

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })

    worker!.postMessage({
      type: 'getManifest',
      id,
      payload: {
        projectPath,
        excludePatterns,
        strict,
      },
    })

    // Timeout after 180 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        terminateWorker(new Error('Worker request timed out'))
        reject(new Error('Worker request timed out'))
      }
    }, MANIFEST_WORKER_TIMEOUT_MS)
  })
}

export async function getManifestFromWorkerIncremental(
  projectPath: string,
  excludePatterns?: string[],
  strict?: boolean,
  previousEntries?: Record<string, ManifestEntry>,
  previousDirMtimes?: Record<string, number>
): Promise<ManifestResult> {
  await ensureWorker()

  if (!worker) {
    throw new Error('Worker not available')
  }

  const id = `manifest-${++requestId}`

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })

    worker!.postMessage({
      type: 'getManifestIncremental',
      id,
      payload: {
        projectPath,
        excludePatterns,
        strict,
        previousEntries,
        previousDirMtimes,
      },
    })

    // Timeout after 180 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        terminateWorker(new Error('Worker request timed out'))
        reject(new Error('Worker request timed out'))
      }
    }, MANIFEST_WORKER_TIMEOUT_MS)
  })
}

export function terminateWorker(reason?: Error): void {
  if (worker) {
    console.log('[FileOpsManager] Terminating worker')
    if (reason) {
      rejectPendingRequests(reason)
    }
    worker.terminate()
    worker = null
    workerReady = false
    workerReadyPromise = null
  }
}

// Initialize worker on module load for faster first request
// Delay slightly to not block app startup
setTimeout(() => {
  ensureWorker().catch((error) => {
    console.warn('[FileOpsManager] Failed to pre-initialize worker:', error)
  })
}, 1000)
