import type { BrowserWindow, IpcMain } from 'electron'

import type {
  NativePreviewActionResult,
  NativePreviewCaptureScreenshotRequest,
  NativePreviewCaptureScreenshotResult,
  NativePreviewListIosSimulatorsResult,
  NativePreviewResolveLaunchConfigRequest,
  NativePreviewResolveLaunchConfigResult,
  NativePreviewRotateRequest,
  NativePreviewSendButtonRequest,
  NativePreviewSendKeyRequest,
  NativePreviewSendTouchesRequest,
  NativePreviewSendWheelRequest,
  NativePreviewSessionLocator,
  NativePreviewStartSessionRequest,
  NativePreviewStartSessionResult,
  NativePreviewStopSessionRequest,
  NativePreviewStopSessionResult,
} from '../../../../shared/nativePreviewTypes'
import { NativePreviewLaunchConfigService } from '../services/nativePreview/NativePreviewLaunchConfigService'
import { NativePreviewManager } from '../services/nativePreview/NativePreviewManager'
import { IosSimulatorDiscoveryService } from '../services/nativePreview/IosSimulatorDiscoveryService'

interface RegisterNativePreviewHandlersDeps {
  getMainWindow: () => BrowserWindow | null
}

export function registerNativePreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterNativePreviewHandlersDeps
): void {
  const manager = NativePreviewManager.getInstance()
  const launchConfigService = NativePreviewLaunchConfigService.getInstance()
  const simulatorDiscoveryService = IosSimulatorDiscoveryService.getInstance()

  manager.subscribe((event) => {
    deps.getMainWindow()?.webContents.send('nativePreview:stateChanged', event)
  })

  ipcMain.handle(
    'nativePreview:listIosSimulators',
    async (): Promise<NativePreviewListIosSimulatorsResult> => {
      return simulatorDiscoveryService.listSimulators()
    }
  )

  ipcMain.handle(
    'nativePreview:resolveLaunchConfig',
    async (
      _event,
      request: NativePreviewResolveLaunchConfigRequest
    ): Promise<NativePreviewResolveLaunchConfigResult> => {
      return launchConfigService.resolveLaunchConfig(request)
    }
  )

  ipcMain.handle(
    'nativePreview:startSession',
    async (
      _event,
      request: NativePreviewStartSessionRequest
    ): Promise<NativePreviewStartSessionResult> => {
      return manager.startSession(request)
    }
  )

  ipcMain.handle(
    'nativePreview:stopSession',
    async (
      _event,
      request: NativePreviewStopSessionRequest
    ): Promise<NativePreviewStopSessionResult> => {
      return manager.stopSession(request)
    }
  )

  ipcMain.handle(
    'nativePreview:getSessionState',
    async (_event, locator: NativePreviewSessionLocator) => {
      return manager.getSessionState(locator)
    }
  )

  ipcMain.handle(
    'nativePreview:sendTouches',
    async (_event, request: NativePreviewSendTouchesRequest): Promise<NativePreviewActionResult> => {
      return manager.sendTouches(request)
    }
  )

  ipcMain.handle(
    'nativePreview:sendWheel',
    async (_event, request: NativePreviewSendWheelRequest): Promise<NativePreviewActionResult> => {
      return manager.sendWheel(request)
    }
  )

  ipcMain.handle(
    'nativePreview:sendKey',
    async (_event, request: NativePreviewSendKeyRequest): Promise<NativePreviewActionResult> => {
      return manager.sendKey(request)
    }
  )

  ipcMain.handle(
    'nativePreview:sendButton',
    async (_event, request: NativePreviewSendButtonRequest): Promise<NativePreviewActionResult> => {
      return manager.sendButton(request)
    }
  )

  ipcMain.handle(
    'nativePreview:rotate',
    async (_event, request: NativePreviewRotateRequest): Promise<NativePreviewActionResult> => {
      return manager.rotate(request)
    }
  )

  ipcMain.handle(
    'nativePreview:captureScreenshot',
    async (
      _event,
      request: NativePreviewCaptureScreenshotRequest
    ): Promise<NativePreviewCaptureScreenshotResult> => {
      return manager.captureScreenshot(request)
    }
  )

  ipcMain.handle(
    'nativePreview:copyLastScreenshot',
    async (
      _event,
      request: NativePreviewCaptureScreenshotRequest
    ): Promise<NativePreviewActionResult> => {
      return manager.copyLastScreenshot(request)
    }
  )
}
