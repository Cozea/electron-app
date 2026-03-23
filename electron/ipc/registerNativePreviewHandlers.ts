import type { BrowserWindow, IpcMain } from 'electron'

import { NativePreviewHostService } from '../services/NativePreviewHostService'

interface RegisterNativePreviewHandlersDeps {
  getWindows: () => BrowserWindow[]
}

export function registerNativePreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterNativePreviewHandlersDeps,
): void {
  const service = NativePreviewHostService.getInstance()

  service.onSessionUpdated((session) => {
    for (const window of deps.getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('nativePreview:sessionUpdated', session)
      }
    }
  })

  ipcMain.handle('nativePreview:listDevices', async (_event, options?: { platform?: 'ios' | 'android' }) => {
    return service.listDevices(options)
  })

  ipcMain.handle('nativePreview:listSessions', () => {
    return service.listSessions()
  })

  ipcMain.handle('nativePreview:startSession', async (_event, options) => {
    return service.startSession(options)
  })

  ipcMain.handle('nativePreview:stopSession', async (_event, options: { sessionId: string }) => {
    return service.stopSession(options)
  })

  ipcMain.handle('nativePreview:getSessionState', async (_event, options: { sessionId: string }) => {
    return service.getSessionState(options)
  })

  ipcMain.handle('nativePreview:sendInput', async (_event, options) => {
    return service.sendInput(options)
  })

  ipcMain.handle('nativePreview:captureScreenshot', async (_event, options: { sessionId: string }) => {
    return service.captureScreenshot(options)
  })

  ipcMain.handle('nativePreview:runAutomation', async (_event, options) => {
    return service.runAutomation(options)
  })

  ipcMain.handle('nativePreview:openDevice', async (_event, options: { platform: 'ios' | 'android'; deviceId?: string }) => {
    return service.openDevice(options)
  })
}
