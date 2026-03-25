import type { BrowserWindow, IpcMain } from 'electron'

import { NativePreviewHostService } from '../services/NativePreviewHostService'
import { RadonHostService } from '../services/RadonHostService'

interface RegisterNativePreviewHandlersDeps {
  getWindows: () => BrowserWindow[]
}

function broadcast(deps: RegisterNativePreviewHandlersDeps, channel: string, payload: unknown): void {
  for (const window of deps.getWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function registerNativePreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterNativePreviewHandlersDeps,
): void {
  const nativePreview = NativePreviewHostService.getInstance()
  const radon = RadonHostService.getInstance()

  nativePreview.onSessionUpdated((session) => {
    broadcast(deps, 'nativePreview:sessionUpdated', session)
  })

  radon.onSessionUpdated((session) => {
    broadcast(deps, 'radon:sessionUpdated', session)
  })

  radon.onLicenseChanged((state) => {
    broadcast(deps, 'radon:licenseChanged', state)
  })

  radon.onRuntimeEvent((event) => {
    broadcast(deps, 'radon:runtimeEvent', event)
  })

  radon.onToolsUpdated((event) => {
    broadcast(deps, 'radon:toolsUpdated', event)
  })

  radon.onLogEvent((event) => {
    broadcast(deps, 'radon:logEvent', event)
  })

  ipcMain.handle('nativePreview:listDevices', (_event, options) => nativePreview.listDevices(options))
  ipcMain.handle('nativePreview:listSessions', () => nativePreview.listSessions())
  ipcMain.handle('nativePreview:startSession', (_event, options) => nativePreview.startSession(options))
  ipcMain.handle('nativePreview:stopSession', (_event, options) => nativePreview.stopSession(options))
  ipcMain.handle('nativePreview:getSessionState', (_event, options) => nativePreview.getSessionState(options))
  ipcMain.handle('nativePreview:sendInput', (_event, options) => nativePreview.sendInput(options))
  ipcMain.handle('nativePreview:captureScreenshot', (_event, options) => nativePreview.captureScreenshot(options))
  ipcMain.handle('nativePreview:runAutomation', (_event, options) => nativePreview.runAutomation(options))
  ipcMain.handle('nativePreview:openDevice', (_event, options) => nativePreview.openDevice(options))
  ipcMain.handle('nativePreview:activateLicense', (_event, options) => nativePreview.activateLicense(options))

  ipcMain.handle('radon:getLicenseState', () => radon.getLicenseState())
  ipcMain.handle('radon:activateLicense', (_event, options) => radon.activateLicense(options))
  ipcMain.handle('radon:removeLicense', () => radon.removeLicense())
  ipcMain.handle('radon:getProjectCapabilities', (_event, options) => radon.getProjectCapabilities(options))
  ipcMain.handle('radon:listDevices', (_event, options) => radon.listDevices(options))
  ipcMain.handle('radon:listSessions', () => radon.listSessions())
  ipcMain.handle('radon:startSession', (_event, options) => radon.startSession(options))
  ipcMain.handle('radon:stopSession', (_event, options) => radon.stopSession(options))
  ipcMain.handle('radon:focusSession', (_event, options) => radon.focusSession(options))
  ipcMain.handle('radon:sendDeviceCommand', (_event, options) => radon.sendDeviceCommand(options))
  ipcMain.handle('radon:captureScreenshot', (_event, options) => radon.captureScreenshot(options))
  ipcMain.handle('radon:openDevice', (_event, options) => radon.openDevice(options))
  ipcMain.handle('radon:getAvailableTools', (_event, options) => radon.getAvailableTools(options))
  ipcMain.handle('radon:openComponentPreview', (_event, options) => radon.openComponentPreview(options))
  ipcMain.handle('radon:showStorybookStory', (_event, options) => radon.showStorybookStory(options))
  ipcMain.handle('radon:openNavigation', (_event, options) => radon.openNavigation(options))
  ipcMain.handle('radon:requestInspect', (_event, options) => radon.requestInspect(options))
}
