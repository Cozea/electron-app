import type {
  NativePreviewDeviceDescriptor,
  NativePreviewInputPayload,
  NativePreviewPlatform,
  NativePreviewRunAutomationInput,
  NativePreviewRunAutomationResult,
  NativePreviewSession,
  NativePreviewStartSessionInput,
} from '../../../shared/electronApiTypes'

export interface NativePreviewSessionRecord extends NativePreviewSession {
  terminalId?: string
}

export interface NativePreviewHostStartContext {
  session: NativePreviewSessionRecord
  terminalId?: string
  updateSession: (sessionId: string, patch: Partial<NativePreviewSessionRecord>) => Promise<NativePreviewSessionRecord | null>
}

export interface NativePreviewStreamCallbacks {
  onImageFrame: (frame: Buffer) => void
  onVideoChunk: (chunk: Buffer) => void
  onError: (error: string) => void
}

export interface NativePreviewHost {
  readonly platform: NativePreviewPlatform
  listDevices(): Promise<NativePreviewDeviceDescriptor[]>
  startSession(input: NativePreviewStartSessionInput, context: NativePreviewHostStartContext): Promise<NativePreviewSessionRecord>
  stopSession(session: NativePreviewSessionRecord): Promise<void>
  startStreaming(session: NativePreviewSessionRecord, callbacks: NativePreviewStreamCallbacks): Promise<void>
  sendInput(session: NativePreviewSessionRecord, input: NativePreviewInputPayload): Promise<void>
  getLatestFrame(session: NativePreviewSessionRecord): Promise<Buffer | null>
  captureScreenshot(session: NativePreviewSessionRecord): Promise<string | null>
  runAutomation(session: NativePreviewSessionRecord, input: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult>
  openDevice(options: { deviceId?: string }): Promise<void>
}
