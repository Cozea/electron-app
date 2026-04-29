import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'

import type {
  CheckpointWorkerMethod,
  CheckpointWorkerParams,
  CheckpointWorkerRequest,
  CheckpointWorkerResponse,
  CheckpointWorkerResult,
} from '../checkpoint-worker/protocol'

interface PendingCheckpointWorkerRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

function isCheckpointWorkerResponse(message: unknown): message is CheckpointWorkerResponse {
  if (typeof message !== 'object' || message === null) {
    return false
  }

  const payload = message as Record<string, unknown>
  return (
    payload.type === 'response' &&
    typeof payload.id === 'number' &&
    typeof payload.ok === 'boolean'
  )
}

export class CheckpointWorkerClient {
  private static instance: CheckpointWorkerClient | null = null

  public static getInstance(): CheckpointWorkerClient {
    if (!CheckpointWorkerClient.instance) {
      CheckpointWorkerClient.instance = new CheckpointWorkerClient()
    }
    return CheckpointWorkerClient.instance
  }

  private childProcess: ChildProcess | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingCheckpointWorkerRequest>()

  private constructor() {}

  public async captureCheckpoint(
    params: CheckpointWorkerParams<'captureCheckpoint'>,
  ): Promise<CheckpointWorkerResult<'captureCheckpoint'>> {
    return this.request('captureCheckpoint', params)
  }

  public async diffCheckpoints(
    params: CheckpointWorkerParams<'diffCheckpoints'>,
  ): Promise<CheckpointWorkerResult<'diffCheckpoints'>> {
    return this.request('diffCheckpoints', params)
  }

  public async readCheckpointFilePair(
    params: CheckpointWorkerParams<'readCheckpointFilePair'>,
  ): Promise<CheckpointWorkerResult<'readCheckpointFilePair'>> {
    return this.request('readCheckpointFilePair', params)
  }

  public async deleteCheckpointRefs(
    params: CheckpointWorkerParams<'deleteCheckpointRefs'>,
  ): Promise<CheckpointWorkerResult<'deleteCheckpointRefs'>> {
    return this.request('deleteCheckpointRefs', params)
  }

  public async deleteAllCheckpointRefs(
    params: CheckpointWorkerParams<'deleteAllCheckpointRefs'>,
  ): Promise<CheckpointWorkerResult<'deleteAllCheckpointRefs'>> {
    return this.request('deleteAllCheckpointRefs', params)
  }

  public async getHeadDiffStats(
    params: CheckpointWorkerParams<'getHeadDiffStats'>,
  ): Promise<CheckpointWorkerResult<'getHeadDiffStats'>> {
    return this.request('getHeadDiffStats', params)
  }

  public async request<TMethod extends CheckpointWorkerMethod>(
    method: TMethod,
    params: CheckpointWorkerParams<TMethod>,
  ): Promise<CheckpointWorkerResult<TMethod>> {
    const child = this.ensureChildProcess()
    const requestId = this.nextRequestId
    this.nextRequestId += 1

    const message: CheckpointWorkerRequest = {
      type: 'request',
      id: requestId,
      method,
      params,
    } as CheckpointWorkerRequest

    return await new Promise<CheckpointWorkerResult<TMethod>>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (result) => resolve(result as CheckpointWorkerResult<TMethod>),
        reject,
      })

      child.send(message, (error) => {
        if (!error) {
          return
        }

        this.pending.delete(requestId)
        reject(
          error instanceof Error
            ? error
            : new Error('Failed to send request to checkpoint worker.'),
        )
      })
    })
  }

  public dispose(): void {
    const child = this.childProcess
    this.childProcess = null
    if (!child) {
      return
    }

    try {
      child.kill()
    } catch {
      // Ignore repeated shutdown failures.
    }
  }

  private ensureChildProcess(): ChildProcess {
    if (this.childProcess && this.childProcess.connected) {
      return this.childProcess
    }

    const entryPath = path.join(__dirname, 'checkpoint-worker.js')
    const child = fork(entryPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
      },
    })

    child.on('message', (message: unknown) => {
      this.handleChildMessage(message)
    })

    child.once('exit', (code, signal) => {
      const error = new Error(
        `Checkpoint worker exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`,
      )
      this.childProcess = null
      for (const [requestId, pending] of this.pending.entries()) {
        this.pending.delete(requestId)
        pending.reject(error)
      }
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim()
      if (text.length > 0) {
        console.error(`[CheckpointWorker] ${text}`)
      }
    })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim()
      if (text.length > 0) {
        console.info(`[CheckpointWorker] ${text}`)
      }
    })

    this.childProcess = child
    return child
  }

  private handleChildMessage(message: unknown): void {
    if (!isCheckpointWorkerResponse(message)) {
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }
    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.result)
      return
    }

    pending.reject(new Error(message.error))
  }
}
