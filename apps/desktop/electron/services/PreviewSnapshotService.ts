import { BrowserWindow } from 'electron'

import type { PreviewCaptureScreenshotResult } from '../../shared/electronApiTypes'

interface PreviewSnapshotRequest {
  height: number
  url: string
  width: number
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadUrlForCapture(
  targetWindow: BrowserWindow,
  targetUrl: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      targetWindow.webContents.removeListener('did-finish-load', onFinishLoad)
      targetWindow.webContents.removeListener('did-fail-load', onFailLoad)
      callback()
    }

    const onFinishLoad = () => {
      finish(resolve)
    }

    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ) => {
      if (!isMainFrame) return
      finish(() => reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`)))
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Page load timeout')))
    }, timeoutMs)

    targetWindow.webContents.on('did-finish-load', onFinishLoad)
    targetWindow.webContents.on('did-fail-load', onFailLoad)

    void targetWindow.loadURL(targetUrl).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error))
      finish(() => reject(err))
    })
  })
}

export class PreviewSnapshotService {
  private static instance: PreviewSnapshotService | null = null

  public static getInstance(): PreviewSnapshotService {
    if (!PreviewSnapshotService.instance) {
      PreviewSnapshotService.instance = new PreviewSnapshotService()
    }
    return PreviewSnapshotService.instance
  }

  private workerWindow: BrowserWindow | null = null
  private queueTail: Promise<void> = Promise.resolve()
  private pendingByKey = new Map<string, Promise<PreviewCaptureScreenshotResult>>()

  public async capture(request: PreviewSnapshotRequest): Promise<PreviewCaptureScreenshotResult> {
    const key = `${request.width}x${request.height}:${request.url}`
    const existing = this.pendingByKey.get(key)
    if (existing) {
      return existing
    }

    const task = this.enqueue(async () => this.captureWithWorkerWindow(request))
    this.pendingByKey.set(key, task)

    try {
      return await task
    } finally {
      this.pendingByKey.delete(key)
    }
  }

  public dispose(): void {
    this.pendingByKey.clear()
    this.queueTail = Promise.resolve()

    if (this.workerWindow && !this.workerWindow.isDestroyed()) {
      this.workerWindow.destroy()
    }
    this.workerWindow = null
  }

  private enqueue(task: () => Promise<PreviewCaptureScreenshotResult>): Promise<PreviewCaptureScreenshotResult> {
    const run = this.queueTail.then(task, task)
    this.queueTail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private getWorkerWindow(width: number, height: number): BrowserWindow {
    const current = this.workerWindow
    if (current && !current.isDestroyed()) {
      current.setBounds({ x: 0, y: 0, width, height })
      return current
    }

    this.workerWindow = new BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
      },
    })

    this.workerWindow.on('closed', () => {
      this.workerWindow = null
    })

    return this.workerWindow
  }

  private async captureWithWorkerWindow({
    height,
    url,
    width,
  }: PreviewSnapshotRequest): Promise<PreviewCaptureScreenshotResult> {
    const captureWindow = this.getWorkerWindow(width, height)

    try {
      await loadUrlForCapture(captureWindow, url, 30000)
      await wait(350)

      const image = await captureWindow.webContents.capturePage()
      const base64 = image.toPNG().toString('base64')

      return { success: true, base64 }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screenshot capture failed'
      return { success: false, error: message }
    }
  }
}
