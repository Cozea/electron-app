import type {
  NativePreviewInputPayload,
  RadonDeviceCommand,
  RadonRotation,
} from '../../../shared/electronApiTypes'

export interface SimulatorServerScreenshotReadyEvent {
  type: 'screenshot_ready'
  id: string
  url: string
  fileUrl: string
}

export interface SimulatorServerScreenshotErrorEvent {
  type: 'screenshot_error'
  id: string
  errorMessage: string
}

export interface SimulatorServerVideoReadyEvent {
  type: 'video_ready' | 'replay_ready'
  id: string
  url: string
  fileUrl: string
  durationSecs: number | 'full'
}

export interface SimulatorServerVideoErrorEvent {
  type: 'video_error' | 'replay_error'
  id: string
  errorMessage: string
}

export interface SimulatorServerFpsEvent {
  type: 'fps_report'
  payload: Record<string, unknown>
}

export interface SimulatorServerStreamReadyEvent {
  type: 'stream_ready'
  streamUrl: string
}

export type SimulatorServerEvent =
  | SimulatorServerScreenshotReadyEvent
  | SimulatorServerScreenshotErrorEvent
  | SimulatorServerVideoReadyEvent
  | SimulatorServerVideoErrorEvent
  | SimulatorServerFpsEvent
  | SimulatorServerStreamReadyEvent

const ROTATION_ORDER: RadonRotation[] = [
  'Portrait',
  'LandscapeRight',
  'PortraitUpsideDown',
  'LandscapeLeft',
]

export function nextRotation(
  current: RadonRotation,
  direction: 'clockwise' | 'counterclockwise',
): RadonRotation {
  const currentIndex = ROTATION_ORDER.indexOf(current)
  const safeIndex = currentIndex >= 0 ? currentIndex : 0
  const delta = direction === 'clockwise' ? 1 : -1
  return ROTATION_ORDER[(safeIndex + delta + ROTATION_ORDER.length) % ROTATION_ORDER.length] ?? 'Portrait'
}

export function transformTouchPoint(
  xRatio: number,
  yRatio: number,
  rotation: RadonRotation,
): { xRatio: number; yRatio: number } {
  switch (rotation) {
    case 'LandscapeLeft':
      return { xRatio: 1 - yRatio, yRatio: xRatio }
    case 'LandscapeRight':
      return { xRatio: yRatio, yRatio: 1 - xRatio }
    case 'PortraitUpsideDown':
      return { xRatio: 1 - xRatio, yRatio: 1 - yRatio }
    default:
      return { xRatio, yRatio }
  }
}

export function buildTouchCommand(
  phase: 'down' | 'move' | 'up',
  xRatio: number,
  yRatio: number,
  rotation: RadonRotation,
): string {
  const transformed = transformTouchPoint(xRatio, yRatio, rotation)
  return `touch ${phase} ${transformed.xRatio},${transformed.yRatio}\n`
}

export function buildButtonCommand(button: string): string {
  return `button Down ${button}\nbutton Up ${button}\n`
}

export function buildScreenshotCommand(rotation: RadonRotation, id = 'screenshot'): string {
  return `screenshot ${id} -r ${rotation}\n`
}

export function buildStartRecordingCommand(): string {
  return 'video recording start -b 2000\n'
}

export function buildStopRecordingCommand(): string {
  return 'video recording stop\n'
}

export function buildCaptureReplayCommand(rotation: RadonRotation): string {
  return `video replay save -r ${rotation} -d 5 -d 10 -d 30\n`
}

export function parseSimulatorServerEvent(line: string): SimulatorServerEvent | null {
  const streamMatch = line.match(/(http:\/\/[^ ]*stream\.mjpeg)/)
  if (line.includes('stream_ready') && streamMatch) {
    return {
      type: 'stream_ready',
      streamUrl: streamMatch[1],
    }
  }

  const fpsMatch = line.match(/fps_report\s+(\{.*\})/)
  if (fpsMatch) {
    try {
      return {
        type: 'fps_report',
        payload: JSON.parse(fpsMatch[1]) as Record<string, unknown>,
      }
    } catch {
      return null
    }
  }

  const screenshotReadyMatch = line.match(/screenshot_ready (\S+) (\S+) (\S+)/)
  if (screenshotReadyMatch) {
    return {
      type: 'screenshot_ready',
      id: screenshotReadyMatch[1],
      url: screenshotReadyMatch[2],
      fileUrl: screenshotReadyMatch[3],
    }
  }

  const screenshotErrorMatch = line.match(/screenshot_error (\S+) (.*)/)
  if (screenshotErrorMatch) {
    return {
      type: 'screenshot_error',
      id: screenshotErrorMatch[1],
      errorMessage: screenshotErrorMatch[2],
    }
  }

  const videoReadyMatch = line.match(/video_ready (\S+) (\S+) (\S+)/)
  if (videoReadyMatch) {
    const [, id, url, fileUrl] = videoReadyMatch
    const durationMatch = fileUrl.match(/-([0-9]+)s\.[^./]+$/)
    return {
      type: id === 'replay' ? 'replay_ready' : 'video_ready',
      id,
      url,
      fileUrl,
      durationSecs: durationMatch ? Number.parseInt(durationMatch[1], 10) : 'full',
    }
  }

  const videoErrorMatch = line.match(/video_error (\S+) (.*)/)
  if (videoErrorMatch) {
    return {
      type: videoErrorMatch[1] === 'replay' ? 'replay_error' : 'video_error',
      id: videoErrorMatch[1],
      errorMessage: videoErrorMatch[2],
    }
  }

  return null
}

export function legacyInputToDeviceCommand(
  input: NativePreviewInputPayload,
): { command: RadonDeviceCommand; payload?: Record<string, unknown> } | null {
  switch (input.type) {
    case 'tap':
      return {
        command: 'tap',
        payload: { x: input.x ?? 0.5, y: input.y ?? 0.5 },
      }
    case 'down':
      return {
        command: 'touch_down',
        payload: { x: input.x ?? 0.5, y: input.y ?? 0.5 },
      }
    case 'move':
      return {
        command: 'touch_move',
        payload: { x: input.x ?? 0.5, y: input.y ?? 0.5 },
      }
    case 'up':
      return {
        command: 'touch_up',
        payload: { x: input.x ?? 0.5, y: input.y ?? 0.5 },
      }
    case 'key':
      switch (input.key) {
        case 'home':
          return { command: 'home' }
        case 'rotation clockwise':
          return { command: 'rotate_clockwise' }
        case 'rotation counterclockwise':
          return { command: 'rotate_counterclockwise' }
        case 'volume_down':
          return { command: 'volume_down' }
        case 'volume_up':
          return { command: 'volume_up' }
        case 'app_switch':
          return { command: 'app_switch' }
        default:
          return null
      }
    default:
      return null
  }
}
