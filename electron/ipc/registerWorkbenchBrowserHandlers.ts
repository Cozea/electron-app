import type { IpcMain, Rectangle } from 'electron'

import { WorkbenchBrowserService } from '../services/WorkbenchBrowserService'
import type { WorkbenchBrowserViewState } from '../../shared/electronApiTypes'

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
      options: { tileId: string; initialUrl?: string },
    ): Promise<WorkbenchBrowserViewState> => {
      return service.ensureTile(options.tileId, options.initialUrl)
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
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.reload(options.tileId)
    },
  )
}
