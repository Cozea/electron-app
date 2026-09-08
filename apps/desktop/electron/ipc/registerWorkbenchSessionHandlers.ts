import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

import type { WorkbenchSessionSnapshot } from '../../../../shared/electronApiTypes'
import type { NativePreviewSessionLocator } from '../../../../shared/nativePreviewTypes'
import { WorkbenchSessionManager } from '../services/WorkbenchSessionManager'
import { WorkbenchPresentationCoordinator } from '../services/WorkbenchPresentationCoordinator'
import { NativePreviewManager } from '../services/nativePreview/NativePreviewManager'
import { getCatalogSnapshot } from '../workspaces/CatalogSnapshot'

interface RegisterWorkbenchSessionHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  isTrustedURL: (url: string) => boolean
  browserSurfaces: {
    hasSurfaceForWorkbenchSession: (sessionKey: string) => boolean
    releaseSurfacesForWorkbenchSession: (sessionKey: string) => Promise<void>
  }
}

const WORKBENCH_SESSION_STATE_CHANGED_CHANNEL = 'workbenchSession:stateChanged'

export function registerWorkbenchSessionHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkbenchSessionHandlersDeps,
): void {
  const service = WorkbenchSessionManager.getInstance({
    nativePreviewManager: NativePreviewManager.getInstance(),
    browserSurfaces: deps.browserSurfaces,
  })
  const coordinator = WorkbenchPresentationCoordinator.getInstance(service, async (target) => {
    const entry = (await getCatalogSnapshot()).entries[target.projectId]
    return Boolean(
        entry?.status === 'ready' &&
        entry.workspace.workspaceId === target.workspaceId &&
        entry.workspace.workspaceRevision === target.workspaceRevision,
    )
  })

  const trusted = (event: IpcMainInvokeEvent): void => {
    const window = deps.getMainWindow()
    if (
      !window || window.isDestroyed() || event.sender !== window.webContents ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
      !deps.isTrustedURL(event.senderFrame.url)
    ) throw new Error('Untrusted workbench session sender')
  }

  const publishState = (snapshot: WorkbenchSessionSnapshot) => {
    deps.getMainWindow()?.webContents.send(
      WORKBENCH_SESSION_STATE_CHANGED_CHANNEL,
      snapshot,
    )
  }

  service.on('stateChanged', publishState)

  ipcMain.handle('workbenchSession:registerPresentationClient', (event) => {
    trusted(event)
    return coordinator.registerClient(event.sender)
  })

  ipcMain.handle('workbenchSession:setPresentation', async (event, command: unknown) => {
    trusted(event)
    return await coordinator.applyPresentationCommand(event.sender, command)
  })

  ipcMain.handle(
    'workbenchSession:ensureSession',
    async (event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      trusted(event)
      return await service.ensureSession(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:closeSession',
    async (event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      trusted(event)
      return { success: await service.closeSession(options) }
    },
  )

  ipcMain.handle(
    'workbenchSession:getSession',
    (event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }) => {
      trusted(event)
      return service.getSession(options)
    },
  )

  ipcMain.handle('workbenchSession:listSessions', (event) => {
    trusted(event)
    return service.listSessions()
  })

  ipcMain.handle(
    'workbenchSession:setPinned',
    (event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null; pinned: boolean }) => {
      trusted(event)
      return service.setPinned(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:getTerminalBinding',
    (event, options: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null; tileId: string }) => {
      trusted(event)
      return service.getTerminalBinding(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:bindTerminal',
    async (
      event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        tileId: string
        terminalId: string
        workspaceId?: string | null
      },
    ) => {
      trusted(event)
      return await service.bindTerminal(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:releaseTerminal',
    (
      event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        workspaceId?: string | null
        tileId: string
        close?: boolean
      },
    ) => {
      trusted(event)
      return service.releaseTerminal(options)
    },
  )

  ipcMain.handle(
    'workbenchSession:setNativePreviewSession',
    (
      event,
      options: {
        sessionKey?: string | null
        projectId: string
        laneId: string
        workspaceId?: string | null
        locator: NativePreviewSessionLocator | null
        stopPrevious?: boolean
      },
    ) => {
      trusted(event)
      return service.setNativePreviewSession(options)
    },
  )
}
