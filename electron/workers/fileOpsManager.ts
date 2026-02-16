import path from 'node:path'
import { app, MessageChannelMain, type MessagePortMain, utilityProcess, type UtilityProcess } from 'electron'

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
  timeout: ReturnType<typeof setTimeout>
}

interface ManifestWorkerRequest {
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

interface ManifestWorkerCancelRequest {
  type: 'cancel'
  id: string
}

type ManifestWorkerOutboundMessage = ManifestWorkerRequest | ManifestWorkerCancelRequest

interface ManifestWorkerReadyMessage {
  type: 'ready'
}

interface ManifestWorkerResultMessage {
  type: 'result'
  id: string
  success: boolean
  payload?: ManifestResult
  error?: string
  duration?: number
}

interface ManifestWorkerProgressMessage {
  type: 'progress'
  id: string
  processed: number
  total: number
}

interface ManifestWorkerDebugMessage {
  type: 'debug'
  message: string
  details?: Record<string, unknown>
}

interface ManifestWorkerErrorMessage {
  type: 'error'
  id?: string
  error: string
}

type ManifestWorkerInboundMessage =
  | ManifestWorkerReadyMessage
  | ManifestWorkerResultMessage
  | ManifestWorkerProgressMessage
  | ManifestWorkerDebugMessage
  | ManifestWorkerErrorMessage

let workerProcess: UtilityProcess | null = null
let workerPort: MessagePortMain | null = null
let workerReady = false
let workerReadyPromise: Promise<void> | null = null
const pendingRequests = new Map<string, PendingRequest>()
let requestId = 0
// Full repo indexing can legitimately take longer (especially first import scans).
// Keep this aligned with the 180s timeout expectation below.
const MANIFEST_WORKER_TIMEOUT_MS = 180000
const MANIFEST_DEBUG_VERBOSE = process.env.COZEA_DEBUG_MANIFEST === '1'
const MANIFEST_UTILITY_PROCESS_ENABLED = (() => {
  const raw = process.env.VITE_FF_UTILITY_PROCESS_MANIFEST?.trim().toLowerCase()
  if (!raw) return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return true
})()

function rejectPendingRequests(error: Error): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout)
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

function resetWorkerState(): void {
  workerReady = false
  workerReadyPromise = null
  workerPort = null
  workerProcess = null
}

function sendToWorker(message: ManifestWorkerOutboundMessage): void {
  if (!workerPort) {
    throw new Error('Manifest utility worker port is unavailable')
  }
  workerPort.postMessage(message)
}

function handleWorkerMessage(
  msg: ManifestWorkerInboundMessage,
  markReady: () => void,
  failReady: (error: Error) => void
): void {
  if (msg.type === 'ready') {
    markReady()
    return
  }

  if (msg.type === 'result') {
    const pending = pendingRequests.get(msg.id)
    if (!pending) return
    pendingRequests.delete(msg.id)
    clearTimeout(pending.timeout)
    if (msg.success && msg.payload) {
      console.log(`[FileOpsManager] Manifest generated in ${msg.duration ?? 0}ms`)
      pending.resolve(msg.payload)
      return
    }
    pending.reject(new Error(msg.error || 'Manifest worker request failed'))
    return
  }

  if (msg.type === 'progress') {
    return
  }

  if (msg.type === 'debug' && MANIFEST_DEBUG_VERBOSE) {
    console.warn('[FileOpsWorker]', msg.message, msg.details ?? {})
    return
  }

  if (msg.type === 'error') {
    const message = msg.error || 'Manifest worker failed'
    const pending = msg.id ? pendingRequests.get(msg.id) : undefined
    if (pending && msg.id) {
      pendingRequests.delete(msg.id)
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    } else {
      failReady(new Error(message))
    }
  }
}

function ensureWorker(): Promise<void> {
  if (!MANIFEST_UTILITY_PROCESS_ENABLED) {
    return Promise.reject(new Error('Manifest utility process path is disabled by VITE_FF_UTILITY_PROCESS_MANIFEST'))
  }

  if (workerReady && workerProcess && workerPort) {
    return Promise.resolve()
  }

  if (workerReadyPromise) {
    return workerReadyPromise
  }

  workerReadyPromise = new Promise((resolve, reject) => {
    let settled = false
    const markReady = () => {
      if (settled) return
      settled = true
      workerReady = true
      resolve()
    }
    const failReady = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    try {
      const workerPath = getWorkerPath()
      console.log('[FileOpsManager] Creating utility process from:', workerPath)

      workerProcess = utilityProcess.fork(workerPath)
      const { port1, port2 } = new MessageChannelMain()
      workerPort = port1
      workerPort.start()
      workerPort.on('message', (event) => {
        handleWorkerMessage(event.data as ManifestWorkerInboundMessage, markReady, failReady)
      })

      workerProcess.on('spawn', () => {
        workerProcess?.postMessage({ type: 'connect' }, [port2])
      })

      workerProcess.on('message', (msg) => {
        handleWorkerMessage(msg as ManifestWorkerInboundMessage, markReady, failReady)
      })

      workerProcess.on('error', (errorType, location) => {
        const error = new Error(`[${errorType}] ${location}`)
        console.error('[FileOpsManager] Utility process fatal error:', error.message)
        failReady(error)
        rejectPendingRequests(error)
        terminateWorker(error)
      })

      workerProcess.on('exit', (code) => {
        console.log(`[FileOpsManager] Utility process exited with code ${code}`)
        failReady(new Error(`Manifest utility process exited (${code})`))
        if (pendingRequests.size > 0) {
          rejectPendingRequests(new Error('Manifest utility process exited before completing requests'))
        }
        resetWorkerState()
      })
    } catch (error) {
      console.error('[FileOpsManager] Failed to create utility process:', error)
      resetWorkerState()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

  return workerReadyPromise
}

async function requestManifest(
  request: ManifestWorkerRequest,
  timeoutErrorMessage: string
): Promise<ManifestResult> {
  await ensureWorker()

  if (!workerPort) {
    throw new Error('Manifest utility process port is unavailable')
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(request.id)
      if (!pending) return
      pendingRequests.delete(request.id)
      try {
        sendToWorker({ type: 'cancel', id: request.id })
      } catch {
        // Ignore send failures; terminate will handle cleanup.
      }
      const timeoutError = new Error(timeoutErrorMessage)
      terminateWorker(timeoutError)
      reject(timeoutError)
    }, MANIFEST_WORKER_TIMEOUT_MS)

    pendingRequests.set(request.id, { resolve, reject, timeout })
    sendToWorker(request)
  })
}

export async function getManifestFromWorker(
  projectPath: string,
  excludePatterns?: string[],
  strict?: boolean
): Promise<ManifestResult> {
  const id = `manifest-${++requestId}`
  return requestManifest(
    {
      type: 'getManifest',
      id,
      payload: {
        projectPath,
        excludePatterns,
        strict,
      },
    },
    'Manifest utility process request timed out'
  )
}

export async function getManifestFromWorkerIncremental(
  projectPath: string,
  excludePatterns?: string[],
  strict?: boolean,
  previousEntries?: Record<string, ManifestEntry>,
  previousDirMtimes?: Record<string, number>
): Promise<ManifestResult> {
  const id = `manifest-${++requestId}`
  return requestManifest(
    {
      type: 'getManifestIncremental',
      id,
      payload: {
        projectPath,
        excludePatterns,
        strict,
        previousEntries,
        previousDirMtimes,
      },
    },
    'Incremental manifest utility process request timed out'
  )
}

export function terminateWorker(reason?: Error): void {
  if (workerProcess) {
    console.log('[FileOpsManager] Terminating manifest utility process')
    if (reason) {
      rejectPendingRequests(reason)
    }
    workerPort?.close()
    workerProcess.kill()
    resetWorkerState()
  }
}

// Initialize worker on module load for faster first request
// Delay slightly to not block app startup
setTimeout(() => {
  ensureWorker().catch((error) => {
    console.warn('[FileOpsManager] Failed to pre-initialize worker:', error)
  })
}, 1000)
