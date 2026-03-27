import type { BrowserWindow, IpcMain } from 'electron'

import type {
  NativePreviewActionResult,
  NativePreviewCaptureScreenshotRequest,
  NativePreviewCaptureScreenshotResult,
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
} from '../../shared/nativePreviewTypes'
import { NativePreviewManager } from '../services/nativePreview/NativePreviewManager'

interface RegisterNativePreviewHandlersDeps {
  getMainWindow: () => BrowserWindow | null
}

const NOT_IMPLEMENTED_MESSAGE = 'Native iOS preview actions are not implemented yet.'

function buildNotImplementedResult(error = NOT_IMPLEMENTED_MESSAGE): NativePreviewActionResult {
  return {
    success: false,
    error,
  }
}

export function registerNativePreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterNativePreviewHandlersDeps
): void {
  const manager = NativePreviewManager.getInstance()

  manager.subscribe((event) => {
    deps.getMainWindow()?.webContents.send('nativePreview:stateChanged', event)
  })

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
    async (_event, _request: NativePreviewSendTouchesRequest): Promise<NativePreviewActionResult> => {
      return buildNotImplementedResult()
    }
  )

  ipcMain.handle(
    'nativePreview:sendWheel',
    async (_event, _request: NativePreviewSendWheelRequest): Promise<NativePreviewActionResult> => {
      return buildNotImplementedResult()
    }
  )

  ipcMain.handle(
    'nativePreview:sendKey',
    async (_event, _request: NativePreviewSendKeyRequest): Promise<NativePreviewActionResult> => {
      return buildNotImplementedResult()
    }
  )

  ipcMain.handle(
    'nativePreview:sendButton',
    async (_event, _request: NativePreviewSendButtonRequest): Promise<NativePreviewActionResult> => {
      return buildNotImplementedResult()
    }
  )

  ipcMain.handle(
    'nativePreview:rotate',
    async (_event, _request: NativePreviewRotateRequest): Promise<NativePreviewActionResult> => {
      return buildNotImplementedResult()
    }
  )

  ipcMain.handle(
    'nativePreview:captureScreenshot',
    async (
      _event,
      _request: NativePreviewCaptureScreenshotRequest
    ): Promise<NativePreviewCaptureScreenshotResult> => {
      return buildNotImplementedResult()
    }
  )

  ipcMain.handle(
    'nativePreview:copyLastScreenshot',
    async (
      _event,
      _request: NativePreviewCaptureScreenshotRequest
    ): Promise<NativePreviewActionResult> => {
      return buildNotImplementedResult()
    }
  )
}
