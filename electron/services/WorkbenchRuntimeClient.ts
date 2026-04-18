import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'

import type { WorkbenchRuntimeEventMessage, WorkbenchRuntimeMethod, WorkbenchRuntimeRequest, WorkbenchRuntimeResponse } from '../workbench-runtime/protocol'

interface PendingWorkbenchRuntimeRequest<Result> {
  resolve: (result: Result) => void
  reject: (error: Error) => void
}

interface WorkbenchRuntimeClientListener {
  onEvent?: (message: WorkbenchRuntimeEventMessage) => void
  onExit?: (error: Error) => void
}

export class WorkbenchRuntimeClient {
  private static instance: WorkbenchRuntimeClient | null = null

  public static getInstance(): WorkbenchRuntimeClient {
    if (!WorkbenchRuntimeClient.instance) {
      WorkbenchRuntimeClient.instance = new WorkbenchRuntimeClient()
    }
    return WorkbenchRuntimeClient.instance
  }

  private childProcess: ChildProcess | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingWorkbenchRuntimeRequest<unknown>>()
  private readonly listeners = new Set<WorkbenchRuntimeClientListener>()

  private constructor() {}

  public subscribe(listener: WorkbenchRuntimeClientListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public async request<Result>(method: WorkbenchRuntimeMethod, params: unknown): Promise<Result> {
    const child = this.ensureChildProcess()
    const requestId = this.nextRequestId
    this.nextRequestId += 1

    const message: WorkbenchRuntimeRequest = {
      type: 'request',
      id: requestId,
      method,
      params,
    }

    return await new Promise<Result>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      child.send(message, (error) => {
        if (!error) {
          return
        }

        this.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error('Failed to send request to workbench runtime.'))
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

    const entryPath = path.join(__dirname, '..', 'workbench-runtime.js')
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
        `Workbench runtime exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`,
      )
      this.childProcess = null
      for (const [requestId, pending] of this.pending.entries()) {
        this.pending.delete(requestId)
        pending.reject(error)
      }
      for (const listener of Array.from(this.listeners)) {
        listener.onExit?.(error)
      }
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim()
      if (text.length > 0) {
        console.error(`[WorkbenchRuntime] ${text}`)
      }
    })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim()
      if (text.length > 0) {
        console.info(`[WorkbenchRuntime] ${text}`)
      }
    })

    this.childProcess = child
    return child
  }

  private handleChildMessage(message: unknown): void {
    const payload = message as WorkbenchRuntimeResponse | WorkbenchRuntimeEventMessage | undefined
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return
    }

    if (payload.type === 'event') {
      for (const listener of Array.from(this.listeners)) {
        listener.onEvent?.(payload)
      }
      return
    }

    const pending = this.pending.get(payload.id)
    if (!pending) {
      return
    }
    this.pending.delete(payload.id)

    if (payload.ok) {
      pending.resolve(payload.result)
      return
    }

    pending.reject(new Error(payload.error))
  }
}
