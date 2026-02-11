import type { IpcMain } from 'electron'

import type { PerfBatch } from '../services/PerformanceService'

interface ToolRunRequest {
  name: string
  input: Record<string, unknown>
  projectPath?: string
  runId?: string
  toolCallId?: string
}

interface RegisterCoreHandlersDeps {
  runTool: (request: ToolRunRequest) => Promise<{ success: boolean; output?: unknown; error?: string }>
  cancelToolRuns: (runId: string) => Promise<{ success: boolean; canceled?: number; error?: string }>
  reportPerformance: (payload: PerfBatch) => Promise<{ success: boolean }> | { success: boolean }
  getUpdateState: () => unknown
  isAutoUpdateEnabled: () => boolean
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
  setUpdateError: (message: string) => void
  openExternal: (url: string) => Promise<void>
  isWindowFullScreen: () => boolean
}

export function registerCoreHandlers(ipcMain: IpcMain, deps: RegisterCoreHandlersDeps): void {
  ipcMain.handle('tools:run', async (_event, request: ToolRunRequest) => {
    return deps.runTool(request)
  })

  ipcMain.handle('performance:report', async (_event, payload: PerfBatch) => {
    return deps.reportPerformance(payload)
  })

  ipcMain.handle('tools:cancel', async (_event, request: { runId: string }) => {
    return deps.cancelToolRuns(request.runId)
  })

  ipcMain.handle('updates:getState', () => deps.getUpdateState())

  ipcMain.handle('updates:check', async () => {
    if (!deps.isAutoUpdateEnabled()) return deps.getUpdateState()
    await deps.checkForUpdates()
    return deps.getUpdateState()
  })

  ipcMain.handle('updates:download', async () => {
    if (!deps.isAutoUpdateEnabled()) return deps.getUpdateState()
    try {
      await deps.downloadUpdate()
    } catch (err) {
      deps.setUpdateError(err instanceof Error ? err.message : String(err))
    }
    return deps.getUpdateState()
  })

  ipcMain.handle('updates:install', async () => {
    if (!deps.isAutoUpdateEnabled()) {
      return { success: false, error: 'Updates are disabled in development builds.' }
    }
    try {
      deps.installUpdate()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await deps.openExternal(url)
    return { success: true }
  })

  ipcMain.handle('window:isFullScreen', () => {
    return deps.isWindowFullScreen()
  })
}
