import type { BrowserWindow, IpcMain } from 'electron'

import type { WorkbenchSessionSnapshot } from '../../../../shared/electronApiTypes'
import type { NativePreviewSessionLocator } from '../../../../shared/nativePreviewTypes'
import { WorkbenchSessionManager } from '../services/WorkbenchSessionManager'
import { NativePreviewManager } from '../services/nativePreview/NativePreviewManager'

interface RegisterWorkbenchSessionHandlersDeps {
  getMainWindow: () => BrowserWindow | null
}

const WORKBENCH_SESSION_STATE_CHANGED_CHANNEL = 'workbenchSession:stateChanged'

export function registerWorkbenchSessionHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkbenchSessionHandlersDeps,
): void {
  const service = WorkbenchSessionManager.getInstance({
    nativePreviewManager: NativePreviewManager.getInstance(),
  })

  const publishState = (snapshot: WorkbenchSessionSnapshot) => {
    deps.getMainWindow()?.webContents.send(
      WORKBENCH_SESSION_STATE_CHANGED_CHANNEL,
      snapshot,
    )
  }

  service.on('stateChanged', publishState)

  ipcMain.handle(
    'workbenchSession:ensureSession',
    async (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      return await service.ensureSession(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:activateSession',
    async (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      return await service.activateSession(options)
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
        workspaceId?: string | null
        mode?: 'backgroundWarm' | 'backgroundFrozen'
      },
    ) => {
      return service.backgroundSession(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:closeSession',
    async (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      return { success: await service.closeSession(options) }
    },
  )

  ipcMain.handle(
    'workbenchSession:getSession',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      return service.getSession(options)
    },
  )

  ipcMain.handle('workbenchSession:listSessions', () => {
    return service.listSessions()
  })

  ipcMain.handle(
    'workbenchSession:setPinned',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null; pinned: boolean }) => {
      return service.setPinned(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:getTerminalBinding',
    (_event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null; tileId: string }) => {
      return service.getTerminalBinding(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:bindTerminal',
    async (
      _event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        tileId: string
        terminalId: string
        workspaceId?: string | null
      },
    ) => {
      return await service.bindTerminal(options)
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
        workspaceId?: string | null
        tileId: string
        close?: boolean
      },
    ) => {
      return service.releaseTerminal(options)
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
        workspaceId?: string | null
        locator: NativePreviewSessionLocator | null
        stopPrevious?: boolean
      },
    ) => {
      return service.setNativePreviewSession(options)
    },
  )
}
