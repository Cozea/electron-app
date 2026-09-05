import type {
  AvailableExternalBrowserResult,
  AvailableExternalEditor,
  ExternalBrowserId,
  ExternalEditorId,
  GpuAccelerationDiagnostics,
} from '../../../../shared/electronApiTypes'
import type { IpcMain } from 'electron'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization'

interface RegisterCoreHandlersDeps {
  getUpdateState: () => unknown
  isAutoUpdateEnabled: () => boolean
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: (continueActiveChats?: boolean) => void | Promise<void>
  setUpdateError: (message: string) => void
  openExternal: (url: string) => Promise<void>
  listAvailableBrowsers: () => AvailableExternalBrowserResult
  openInBrowser: (options: { url: string; browserId?: ExternalBrowserId }) => Promise<void>
  listAvailableEditors: () => AvailableExternalEditor[]
  openInEditor: (options: {
    editorId: ExternalEditorId
    filePath: string
    line?: number
    column?: number
  }) => Promise<void>
  getGpuDiagnostics: () => GpuAccelerationDiagnostics
  setNativeThemeSource: (source: 'system' | 'light' | 'dark') => Promise<void>
  isWindowFullScreen: () => boolean
  openSettingsWindow: (route?: string) => Promise<{ success: boolean; error?: string }>
}

export function registerCoreHandlers(ipcMain: IpcMain, deps: RegisterCoreHandlersDeps): void {
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

  ipcMain.handle('updates:install', async (_event, options?: unknown) => {
    if (!deps.isAutoUpdateEnabled()) {
      return { success: false, error: 'Updates are disabled in development builds.' }
    }
    try {
      const continueActiveChats = Boolean(options && typeof options === "object" && "continueActiveChats" in options && options.continueActiveChats === true)
      await deps.installUpdate(continueActiveChats)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await deps.openExternal(url)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('shell:listAvailableBrowsers', () => {
    return deps.listAvailableBrowsers()
  })

  ipcMain.handle(
    'shell:openInBrowser',
    async (_event, options: { url: string; browserId?: ExternalBrowserId }) => {
      try {
        await deps.openInBrowser(options)
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  ipcMain.handle('editor:listAvailableEditors', () => {
    return deps.listAvailableEditors()
  })

  ipcMain.handle('app:getGpuDiagnostics', () => {
    return deps.getGpuDiagnostics()
  })

  ipcMain.handle('app:setNativeThemeSource', async (_event, source: 'system' | 'light' | 'dark') => {
    return deps.setNativeThemeSource(source)
  })

  ipcMain.handle(
    'editor:openInEditor',
    async (
      _event,
      options: {
        editorId?: ExternalEditorId
        workspaceId?: string
        filePath?: string
        path?: string
        line?: number
        column?: number
      }
    ) => {
      try {
        let finalPath = options.filePath ?? options.path
        if (options.workspaceId) {
          const access = await resolveAuthorizedWorkspaceAccess({
            workspaceId: options.workspaceId,
            operation: 'open-external-editor',
            relativePath: finalPath ?? '.',
          })
          finalPath = access.fullPath!
        }
        if (!finalPath) {
          return { success: false, error: 'Path is required' }
        }
        if (!options.editorId) {
          return { success: false, error: 'No editor selected' }
        }
        await deps.openInEditor({
          editorId: options.editorId,
          filePath: finalPath,
          line: options.line,
          column: options.column,
        })
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  ipcMain.handle('window:isFullScreen', () => {
    return deps.isWindowFullScreen()
  })

  ipcMain.handle('window:openSettings', async (_event, payload?: { route?: string }) => {
    return deps.openSettingsWindow(payload?.route)
  })
}
