import type { IpcMain, Rectangle } from 'electron'

import { WorkbenchBrowserService } from '../services/WorkbenchBrowserService'
import type { WorkbenchBrowserViewState } from '../../shared/electronApiTypes'
import type {
  BrowserFindInPageOptions,
  BrowserStorageScope,
} from '../../shared/browserHostTypes'

interface RegisterWorkbenchBrowserHandlersDeps {
  service: WorkbenchBrowserService
}

export function registerWorkbenchBrowserHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkbenchBrowserHandlersDeps,
): void {
  const { service } = deps

  ipcMain.handle(
    'workbenchBrowser:ensureTile',
    async (
      _event,
      options: {
        tileId: string
        initialUrl?: string
        storageScope?: BrowserStorageScope
        workspaceId?: string
      },
    ): Promise<WorkbenchBrowserViewState> => {
      return service.ensureTile(options.tileId, {
        initialUrl: options.initialUrl,
        storageScope: options.storageScope,
        workspaceId: options.workspaceId,
      })
    },
  )

  ipcMain.handle(
    'workbenchBrowser:destroyTile',
    (_event, options: { tileId: string }): boolean => {
      return service.destroyTile(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:setBounds',
    (
      _event,
      options: { tileId: string; bounds?: Rectangle; visible?: boolean },
    ): boolean => {
      return service.setBounds(options.tileId, options.bounds ?? null, Boolean(options.visible))
    },
  )

  ipcMain.handle(
    'workbenchBrowser:navigate',
    async (
      _event,
      options: { tileId: string; url: string },
    ): Promise<WorkbenchBrowserViewState | null> => {
      return service.navigate(options.tileId, options.url)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:getState',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.getState(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:goBack',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.goBack(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:goForward',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.goForward(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:reload',
    (_event, options: { tileId: string; hard?: boolean }): WorkbenchBrowserViewState | null => {
      return service.reload(options.tileId, options.hard)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:focus',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.focus(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:toggleDevTools',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.toggleDevTools(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:openExternal',
    async (_event, options: { tileId: string }) => {
      return service.openExternal(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:zoomIn',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.zoomIn(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:zoomOut',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.zoomOut(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:resetZoom',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.resetZoom(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:findInPage',
    (
      _event,
      options: { tileId: string; text: string } & BrowserFindInPageOptions,
    ): WorkbenchBrowserViewState | null => {
      return service.findInPage(options.tileId, options.text, options)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:stopFindInPage',
    (
      _event,
      options: { tileId: string; keepSelection?: boolean },
    ): WorkbenchBrowserViewState | null => {
      return service.stopFindInPage(options.tileId, options.keepSelection)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:getSelectedText',
    (_event, options: { tileId: string }): string => {
      return service.getSelectedText(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:captureScreenshot',
    async (_event, options: { tileId: string }): Promise<string | null> => {
      return service.captureScreenshot(options.tileId)
    },
  )
}
