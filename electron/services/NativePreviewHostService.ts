import type {
  NativePreviewCaptureScreenshotResult,
  NativePreviewGetSessionStateResult,
  NativePreviewInputPayload,
  NativePreviewListDevicesResult,
  NativePreviewListSessionsResult,
  NativePreviewOpenDeviceResult,
  NativePreviewPlatform,
  NativePreviewRunAutomationInput,
  NativePreviewRunAutomationResult,
  NativePreviewSendInputResult,
  NativePreviewSession,
  NativePreviewStartSessionInput,
  NativePreviewStartSessionResult,
  NativePreviewStopSessionResult,
} from '../../shared/electronApiTypes'
import { RadonHostService } from './RadonHostService'
import { legacyInputToDeviceCommand } from './radon/protocol'

export class NativePreviewHostService {
  private static instance: NativePreviewHostService

  private readonly radon = RadonHostService.getInstance()

  static getInstance(): NativePreviewHostService {
    if (!NativePreviewHostService.instance) {
      NativePreviewHostService.instance = new NativePreviewHostService()
    }
    return NativePreviewHostService.instance
  }

  onSessionUpdated(callback: (session: NativePreviewSession) => void): () => void {
    return this.radon.onSessionUpdated((session) => callback(session))
  }

  async listDevices(options?: { platform?: NativePreviewPlatform }): Promise<NativePreviewListDevicesResult> {
    return this.radon.listDevices(options)
  }

  listSessions(): NativePreviewListSessionsResult {
    return this.radon.listSessions()
  }

  async getSessionState(options: { sessionId: string }): Promise<NativePreviewGetSessionStateResult> {
    return this.radon.getSessionState(options)
  }

  async startSession(input: NativePreviewStartSessionInput): Promise<NativePreviewStartSessionResult> {
    return this.radon.startSession({
      ...input,
      entryMode: input.entryMode ?? 'app',
    })
  }

  async stopSession(options: { sessionId: string }): Promise<NativePreviewStopSessionResult> {
    return this.radon.stopSession(options)
  }

  async sendInput(input: NativePreviewInputPayload): Promise<NativePreviewSendInputResult> {
    const mapped = legacyInputToDeviceCommand(input)
    if (!mapped) {
      return {
        success: false,
        error: `Unsupported native preview input payload: ${input.type}`,
      }
    }

    const result = await this.radon.sendDeviceCommand({
      sessionId: input.sessionId,
      command: mapped.command,
      payload: mapped.payload,
    })

    return {
      success: result.success,
      error: result.error,
    }
  }

  async captureScreenshot(options: { sessionId: string }): Promise<NativePreviewCaptureScreenshotResult> {
    return this.radon.captureScreenshot(options)
  }

  async runAutomation(input?: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult> {
    return this.radon.runAutomation(input)
  }

  async openDevice(options?: { platform: NativePreviewPlatform; deviceId?: string }): Promise<NativePreviewOpenDeviceResult> {
    if (!options) {
      return {
        success: false,
        error: 'Platform is required when opening a native preview device.',
      }
    }
    return this.radon.openDevice(options)
  }

  async activateLicense(options: { licenseKey: string; email: string }): Promise<{ success: boolean; token?: string; error?: string }> {
    return this.radon.activateLicense(options)
  }
}
