import { randomUUID } from 'node:crypto'

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
import { NativePreviewSessionStore } from './nativePreview/sessionStore'
import type { NativePreviewHost, NativePreviewSessionRecord } from './nativePreview/types'
import { IOSPreviewHost } from './nativePreview/ios/IOSPreviewHost'
import { AndroidPreviewHost } from './nativePreview/android/AndroidPreviewHost'
import { NativePreviewStreamServer } from './nativePreview/NativePreviewStreamServer'

export class NativePreviewHostService {
  private static instance: NativePreviewHostService

  private readonly sessionStore = new NativePreviewSessionStore()
  private readonly listeners = new Set<(session: NativePreviewSession) => void>()
  private readonly streamServer = new NativePreviewStreamServer()
  private readonly hosts = new Map<NativePreviewPlatform, NativePreviewHost>([
    ['ios', new IOSPreviewHost()],
    ['android', new AndroidPreviewHost()],
  ])

  static getInstance(): NativePreviewHostService {
    if (!NativePreviewHostService.instance) {
      NativePreviewHostService.instance = new NativePreviewHostService()
    }
    return NativePreviewHostService.instance
  }

  onSessionUpdated(callback: (session: NativePreviewSession) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private emit(session: NativePreviewSessionRecord): void {
    for (const listener of this.listeners) {
      listener(session)
    }
  }

  async listDevices(options?: { platform?: NativePreviewPlatform }): Promise<NativePreviewListDevicesResult> {
    try {
      if (options?.platform) {
        const host = this.hosts.get(options.platform)
        if (!host) {
          return {
            success: false,
            error: `Unsupported native preview platform: ${options.platform}`,
          }
        }
        return {
          success: true,
          devices: await host.listDevices(),
        }
      }

      const devices = (await Promise.all(Array.from(this.hosts.values()).map((host) => host.listDevices()))).flat()
      return {
        success: true,
        devices,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  listSessions(): NativePreviewListSessionsResult {
    return {
      success: true,
      sessions: this.sessionStore.list(),
    }
  }

  async getSessionState(options: { sessionId: string }): Promise<NativePreviewGetSessionStateResult> {
    const session = this.sessionStore.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    return {
      success: true,
      session,
    }
  }

  async startSession(input: NativePreviewStartSessionInput): Promise<NativePreviewStartSessionResult> {
    const host = this.hosts.get(input.platform)
    if (!host) {
      return {
        success: false,
        error: `Unsupported native preview platform: ${input.platform}`,
      }
    }

    const existing = this.sessionStore.findByProjectAndPlatform(input.projectPath, input.platform)
    if (existing && existing.state !== 'stopped' && existing.state !== 'error') {
      const reused = await this.updateSession(existing.id, {
        launcher: input.launcher,
        buildMode: input.buildMode,
        terminalId: input.terminalId ?? existing.terminalId,
      })
      if (reused) {
        await this.ensureSessionStream(reused)
      }
      const current = this.sessionStore.get(existing.id) ?? reused ?? existing
      return {
        success: true,
        session: current,
      }
    }

    const session: NativePreviewSessionRecord = existing
      ? {
          ...existing,
          launcher: input.launcher,
          buildMode: input.buildMode,
          state: 'idle',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          message: 'Preparing native preview session...',
          error: undefined,
          device: undefined,
          streamUrl: undefined,
          verificationStatus: 'idle',
          terminalId: input.terminalId,
        }
      : {
          id: randomUUID(),
          projectPath: input.projectPath,
          platform: input.platform,
          launcher: input.launcher,
          buildMode: input.buildMode,
          state: 'idle',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          message: 'Preparing native preview session...',
          verificationStatus: 'idle',
          terminalId: input.terminalId,
        }

    this.sessionStore.set(session)
    this.emit(session)

    try {
      const startedSession = await host.startSession(input, {
        session,
        terminalId: input.terminalId,
        updateSession: this.updateSession.bind(this),
      })
      const next = this.sessionStore.set({
        ...session,
        ...startedSession,
        updatedAt: Date.now(),
      })
      await this.ensureSessionStream(next)
      const current = this.sessionStore.get(next.id) ?? next
      this.emit(current)
      return {
        success: true,
        session: current,
      }
    } catch (error) {
      const failed = await this.updateSession(session.id, {
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to start native preview session.',
      })
      return {
        success: false,
        session: failed ?? session,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async stopSession(options: { sessionId: string }): Promise<NativePreviewStopSessionResult> {
    const session = this.sessionStore.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    const host = this.hosts.get(session.platform)
    if (!host) {
      return {
        success: false,
        error: `Unsupported native preview platform: ${session.platform}`,
      }
    }

    try {
      await host.stopSession(session)
      this.streamServer.detachSession(session.id)
      await this.updateSession(session.id, {
        state: 'stopped',
        message: 'Native preview stopped.',
        streamUrl: undefined,
      })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sendInput(input: NativePreviewInputPayload): Promise<NativePreviewSendInputResult> {
    const session = this.sessionStore.get(input.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    const host = this.hosts.get(session.platform)
    if (!host) {
      return {
        success: false,
        error: `Unsupported native preview platform: ${session.platform}`,
      }
    }

    try {
      await host.sendInput(session, input)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async captureScreenshot(options: { sessionId: string }): Promise<NativePreviewCaptureScreenshotResult> {
    const session = this.sessionStore.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    const host = this.hosts.get(session.platform)
    if (!host) {
      return {
        success: false,
        error: `Unsupported native preview platform: ${session.platform}`,
      }
    }

    try {
      const dataUrl = await host.captureScreenshot(session)
      return {
        success: Boolean(dataUrl),
        dataUrl: dataUrl ?? undefined,
        error: dataUrl ? undefined : 'Screenshot capture is not available for this session.',
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async runAutomation(input: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult> {
    const session = this.sessionStore.get(input.sessionId)
    if (!session) {
      return {
        success: false,
        status: 'failed',
        error: 'Native preview session not found.',
      }
    }

    const host = this.hosts.get(session.platform)
    if (!host) {
      return {
        success: false,
        status: 'failed',
        error: `Unsupported native preview platform: ${session.platform}`,
      }
    }

    await this.updateSession(session.id, {
      verificationStatus: 'running',
      message: 'Running launch verification...',
    })

    const result = await host.runAutomation(session, input)
    await this.updateSession(session.id, {
      verificationStatus: result.status,
      message: result.success ? 'Launch verification finished.' : (result.error ?? 'Launch verification failed.'),
    })
    return result
  }

  async openDevice(options: { platform: NativePreviewPlatform; deviceId?: string }): Promise<NativePreviewOpenDeviceResult> {
    const host = this.hosts.get(options.platform)
    if (!host) {
      return {
        success: false,
        error: `Unsupported native preview platform: ${options.platform}`,
      }
    }

    try {
      await host.openDevice({ deviceId: options.deviceId })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async updateSession(
    sessionId: string,
    patch: Partial<NativePreviewSessionRecord>,
  ): Promise<NativePreviewSessionRecord | null> {
    const session = this.sessionStore.update(sessionId, patch)
    if (session) {
      this.emit(session)
    }
    return session
  }

  private async ensureSessionStream(session: NativePreviewSessionRecord): Promise<void> {
    if (session.state === 'stopped' || session.state === 'error') {
      this.streamServer.detachSession(session.id)
      return
    }

    const host = this.hosts.get(session.platform)
    if (!host) return

    const transport = session.platform === 'android' ? 'fmp4' : 'mjpeg'
    const streamUrl = await this.streamServer.attachSession(session.id, transport)

    if (session.streamUrl !== streamUrl) {
      await this.updateSession(session.id, { streamUrl })
    }

    const currentSession = this.sessionStore.get(session.id)
    if (!currentSession || currentSession.state === 'stopped' || currentSession.state === 'error') {
      return
    }

    await host.startStreaming(currentSession, {
      onImageFrame: (frame) => {
        this.streamServer.publishFrame(currentSession.id, frame)
      },
      onVideoChunk: (chunk) => {
        this.streamServer.publishVideoChunk(currentSession.id, chunk)
      },
      onError: (error) => {
        void this.handleStreamError(currentSession.id, error)
      },
    })
  }

  private async handleStreamError(sessionId: string, error: string): Promise<void> {
    const session = this.sessionStore.get(sessionId)
    if (!session || session.state === 'stopped' || session.state === 'error') {
      return
    }

    const host = this.hosts.get(session.platform)
    if (host) {
      await host.stopSession(session).catch(() => null)
    }
    this.streamServer.detachSession(sessionId)
    await this.updateSession(sessionId, {
      state: 'error',
      error,
      message: 'Native preview stream failed.',
      streamUrl: undefined,
    })
  }
}
