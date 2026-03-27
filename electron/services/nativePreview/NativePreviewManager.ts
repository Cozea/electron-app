import type {
  NativePreviewSessionLocator,
  NativePreviewSessionState,
  NativePreviewStartSessionRequest,
  NativePreviewStartSessionResult,
  NativePreviewStateChangedEvent,
  NativePreviewStopSessionRequest,
  NativePreviewStopSessionResult,
} from '../../../shared/nativePreviewTypes'
import { buildNativePreviewSessionKey } from '../../../shared/nativePreviewTypes'

type NativePreviewStateListener = (event: NativePreviewStateChangedEvent) => void

const NOT_IMPLEMENTED_MESSAGE = 'Native iOS preview helper is scaffolded but not implemented yet.'

export class NativePreviewManager {
  private static instance: NativePreviewManager | null = null

  public static getInstance(): NativePreviewManager {
    if (!NativePreviewManager.instance) {
      NativePreviewManager.instance = new NativePreviewManager()
    }
    return NativePreviewManager.instance
  }

  private readonly listeners = new Set<NativePreviewStateListener>()
  private readonly sessionStates = new Map<string, NativePreviewSessionState>()

  public subscribe(listener: NativePreviewStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSessionState(locator: NativePreviewSessionLocator): NativePreviewSessionState | null {
    return this.sessionStates.get(buildNativePreviewSessionKey(locator)) ?? null
  }

  public async startSession(
    request: NativePreviewStartSessionRequest
  ): Promise<NativePreviewStartSessionResult> {
    const sessionKey = buildNativePreviewSessionKey(request)
    const now = Date.now()
    const state: NativePreviewSessionState = {
      sessionKey,
      projectPath: request.projectPath,
      deviceId: request.deviceId,
      platform: request.platform,
      deviceSetPath: request.deviceSetPath ?? null,
      helperPid: null,
      status: 'error',
      streamUrl: null,
      rotation: 'Portrait',
      lastError: NOT_IMPLEMENTED_MESSAGE,
      updatedAt: now,
    }

    this.sessionStates.set(sessionKey, state)
    this.emit({ sessionKey, state })

    return {
      success: false,
      error: NOT_IMPLEMENTED_MESSAGE,
      state,
    }
  }

  public async stopSession(
    request: NativePreviewStopSessionRequest
  ): Promise<NativePreviewStopSessionResult> {
    const sessionKey = buildNativePreviewSessionKey(request)
    this.sessionStates.delete(sessionKey)
    this.emit({ sessionKey, state: null })
    return { success: true }
  }

  private emit(event: NativePreviewStateChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
