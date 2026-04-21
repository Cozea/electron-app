import type { BrowserWindow, IpcMain } from 'electron'

import type { WorkbenchSessionSnapshot } from '../../shared/electronApiTypes'
import type { NativePreviewSessionLocator } from '../../shared/nativePreviewTypes'
import { WorkbenchBrowserService } from '../services/WorkbenchBrowserService'
import { WorkbenchSessionManager } from '../services/WorkbenchSessionManager'
import { NativePreviewManager } from '../services/nativePreview/NativePreviewManager'

interface RegisterWorkbenchSessionHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  browserService: WorkbenchBrowserService
}

const WORKBENCH_SESSION_STATE_CHANGED_CHANNEL = 'workbenchSession:stateChanged'

export function registerWorkbenchSessionHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkbenchSessionHandlersDeps,
): void {
  const service = WorkbenchSessionManager.getInstance({
    browserService: deps.browserService,
    nativePreviewManager: NativePreviewManager.getInstance(),
  })

  const publishState = (snapshot: WorkbenchSessionSnapshot) => {
    deps.getMainWindow()?.webContents.send(WORKBENCH_SESSION_STATE_CHANGED_CHANNEL, snapshot)
  }

  service.on('stateChanged', publishState)

  ipcMain.handle(
    'workbenchSession:ensureSession',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; projectPath?: string | null }) => {
      return service.ensureSession(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:activateSession',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; projectPath?: string | null }) => {
      return service.activateSession(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:backgroundSession',
    (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        mode?: 'backgroundWarm' | 'backgroundFrozen'
      },
    ) => {
      return service.backgroundSession(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:closeSession',
    async (_event, options: { sessionKey?: string | null; projectId: string; laneId: string }) => {
      return { success: await service.closeSession(options) }
    },
  )

  ipcMain.handle(
    'workbenchSession:getSession',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string }) => {
      return service.getSession(options)
    },
  )

  ipcMain.handle('workbenchSession:listSessions', () => {
    return service.listSessions()
  })

  ipcMain.handle(
    'workbenchSession:setPinned',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; pinned: boolean }) => {
      return service.setPinned(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:getTerminalBinding',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; tileId: string }) => {
      return service.getTerminalBinding(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:bindTerminal',
    (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        tileId: string
        terminalId: string
        projectPath?: string | null
      },
    ) => {
      return service.bindTerminal(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:releaseTerminal',
    (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        tileId: string
        close?: boolean
      },
    ) => {
      return service.releaseTerminal(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:getBrowserBinding',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; tileId: string }) => {
      return service.getBrowserBinding(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:bindBrowser',
    (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        tileId: string
        browserTileId: string
        projectPath?: string | null
      },
    ) => {
      return service.bindBrowser(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:releaseBrowser',
    (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        tileId: string
        destroy?: boolean
      },
    ) => {
      return service.releaseBrowser(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:setNativePreviewSession',
    (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        locator: NativePreviewSessionLocator | null
        stopPrevious?: boolean
      },
    ) => {
      return service.setNativePreviewSession(options)
    },
  )
}
