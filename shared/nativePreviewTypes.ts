export type NativePreviewPlatform = 'ios'

export type NativePreviewLaunchKind = 'expo' | 'react-native'

export type NativePreviewRotation =
  | 'Portrait'
  | 'LandscapeLeft'
  | 'LandscapeRight'
  | 'PortraitUpsideDown'

export type NativePreviewSessionStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'

export interface NativePreviewSessionLocator {
  projectPath: string
  deviceId: string
  platform: NativePreviewPlatform
}

export interface NativePreviewStartSessionRequest extends NativePreviewSessionLocator {
  deviceSetPath?: string | null
}

export interface NativePreviewStopSessionRequest extends NativePreviewSessionLocator {}

export interface NativePreviewTouchPoint {
  xRatio: number
  yRatio: number
}

export interface NativePreviewSendTouchesRequest extends NativePreviewSessionLocator {
  type: 'start' | 'move' | 'end'
  touches: NativePreviewTouchPoint[]
  rotation?: NativePreviewRotation
}

export interface NativePreviewSendWheelRequest extends NativePreviewSessionLocator {
  point: NativePreviewTouchPoint
  deltaX: number
  deltaY: number
}

export interface NativePreviewSendKeyRequest extends NativePreviewSessionLocator {
  direction: 'down' | 'up'
  keyCode: number
}

export interface NativePreviewSendButtonRequest extends NativePreviewSessionLocator {
  button: string
  direction: 'down' | 'up'
}

export interface NativePreviewRotateRequest extends NativePreviewSessionLocator {
  rotation: NativePreviewRotation
}

export interface NativePreviewCaptureScreenshotRequest extends NativePreviewSessionLocator {
  copyToClipboard?: boolean
}

export interface NativePreviewSessionState extends NativePreviewSessionLocator {
  sessionKey: string
  deviceSetPath: string | null
  helperPid: number | null
  status: NativePreviewSessionStatus
  streamUrl: string | null
  rotation: NativePreviewRotation
  lastError: string | null
  updatedAt: number
}

export interface NativePreviewStateChangedEvent {
  sessionKey: string
  state: NativePreviewSessionState | null
}

export interface NativePreviewActionResult {
  success: boolean
  error?: string
}

export interface NativePreviewStartSessionResult extends NativePreviewActionResult {
  state?: NativePreviewSessionState
}

export interface NativePreviewStopSessionResult extends NativePreviewActionResult {}

export interface NativePreviewCaptureScreenshotResult extends NativePreviewActionResult {
  filePath?: string
}

export interface NativePreviewResolveLaunchConfigRequest {
  projectPath: string
  platform: NativePreviewPlatform
  preferredPort?: number | null
  resetCache?: boolean
}

export interface NativePreviewLaunchConfig {
  projectPath: string
  platform: NativePreviewPlatform
  kind: NativePreviewLaunchKind
  port: number
  label: string
  command: string
  env: Record<string, string>
  runtimeDir: string
  customMetroConfigPath: string | null
}

export interface NativePreviewResolveLaunchConfigResult extends NativePreviewActionResult {
  config?: NativePreviewLaunchConfig
}

export function buildNativePreviewSessionKey(locator: NativePreviewSessionLocator): string {
  return `${locator.platform}:${locator.deviceId}:${locator.projectPath}`
}
