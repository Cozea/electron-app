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
        } else if (msg.type === 'error') {
          console.error('[FileOpsManager] Worker error:', msg.error)
          reject(new Error(msg.error))
        }
      })

      worker.on('error', (error) => {
        console.error('[FileOpsManager] Worker error:', error)
        workerReady = false
        workerReadyPromise = null

        // Reject all pending requests
        for (const [id, pending] of pendingRequests) {
          pending.reject(error)
          pendingRequests.delete(id)
        }
      })

      worker.on('exit', (code) => {
        console.log(`[FileOpsManager] Worker exited with code ${code}`)
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
  excludePatterns?: string[]
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
      },
    })

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('Worker request timed out'))
      }
    }, 60000)
  })
}

export async function getManifestFromWorkerIncremental(
  projectPath: string,
  excludePatterns?: string[],
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
        previousEntries,
        previousDirMtimes,
      },
    })

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('Worker request timed out'))
      }
    }, 60000)
  })
}

export function terminateWorker(): void {
  if (worker) {
    console.log('[FileOpsManager] Terminating worker')
    worker.terminate()
    worker = null
    workerReady = false
    workerReadyPromise = null
    pendingRequests.clear()
  }
}

// Initialize worker on module load for faster first request
// Delay slightly to not block app startup
setTimeout(() => {
  ensureWorker().catch((error) => {
    console.warn('[FileOpsManager] Failed to pre-initialize worker:', error)
  })
}, 1000)
