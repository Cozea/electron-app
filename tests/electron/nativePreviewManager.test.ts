import { spawn } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { NativePreviewManager } from '../../electron/services/nativePreview/NativePreviewManager'
import type {
  NativePreviewSessionLocator,
  NativePreviewStartSessionRequest,
  NativePreviewStateChangedEvent,
} from '../../shared/nativePreviewTypes'

const REQUEST: NativePreviewStartSessionRequest = {
  projectPath: '/tmp/example-project',
  deviceId: 'SIM-123',
  platform: 'ios',
}

const HELPER_SCRIPT = String.raw`
const readline = require('node:readline')

let rotation = 'Portrait'
const mode = process.env.COZEA_TEST_HELPER_MODE || 'normal'

function emit(line) {
  process.stdout.write(line + '\n')
}

emit('ready ' + (process.env.COZEA_TEST_DEVICE_ID || 'SIM-123'))
setTimeout(() => {
  if (mode !== 'no-stream') {
    emit('stream_ready ' + (process.env.COZEA_TEST_STREAM_URL || 'http://127.0.0.1:4123/stream.mjpeg'))
  }
}, 10)

const reader = readline.createInterface({ input: process.stdin })
reader.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  const [command, ...parts] = trimmed.split(/\s+/)
  const requestId = parts[0]
  const rest = parts.slice(1).join(' ')

  if (command === 'shutdown') {
    emit('ack ' + requestId)
    emit('stopped')
    process.exit(0)
  }

  if (command === 'ping') {
    emit('ack ' + requestId)
    return
  }

  if (command === 'screenshot') {
    if (mode === 'screenshot-error') {
      emit('error ' + requestId + ' no_frame_available')
      return
    }
    emit('screenshot_ready ' + requestId + ' /tmp/' + rotation + '.png')
    return
  }

  if (command === 'rotate') {
    rotation = parts.join(' ')
    return
  }
})
`

function createManagerWithFakeHelper(options?: {
  helperMode?: 'normal' | 'no-stream' | 'screenshot-error'
  streamUrl?: string
}) {
  const manager = new NativePreviewManager()
  const streamUrl = options?.streamUrl ?? 'http://127.0.0.1:4123/stream.mjpeg'

  ;(manager as any).spawnHelper = () => ({
    success: true,
    process: spawn(process.execPath, ['-e', HELPER_SCRIPT], {
      stdio: 'pipe',
      env: {
        ...process.env,
        COZEA_TEST_DEVICE_ID: REQUEST.deviceId,
        COZEA_TEST_HELPER_MODE: options?.helperMode ?? 'normal',
        COZEA_TEST_STREAM_URL: streamUrl,
      },
    }),
  })

  return manager
}

async function waitForRunning(
  manager: NativePreviewManager,
  locator: NativePreviewSessionLocator
) {
  await vi.waitFor(() => {
    const state = manager.getSessionState(locator)
    expect(state?.status).toBe('running')
    expect(state?.streamUrl).toBeTruthy()
  })
}

describe('NativePreviewManager', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
  })

  it('treats helper ready and stream readiness as separate states', async () => {
    const manager = createManagerWithFakeHelper()
    const events: NativePreviewStateChangedEvent[] = []
    const unsubscribe = manager.subscribe((event) => {
      events.push(event)
    })

    const result = await manager.startSession(REQUEST)
    expect(result.success).toBe(true)
    expect(result.state?.status).toBe('starting')
    expect(result.state?.streamUrl).toBeNull()

    await waitForRunning(manager, REQUEST)

    expect(events.some((event) => event.state?.status === 'starting')).toBe(true)
    expect(events.some((event) => event.state?.status === 'running')).toBe(true)

    unsubscribe()
    await manager.stopSession(REQUEST)
  })

  it('uses the current rotation when capturing screenshots', async () => {
    const manager = createManagerWithFakeHelper()

    await manager.startSession(REQUEST)
    await waitForRunning(manager, REQUEST)

    const rotateResult = await manager.rotate({
      ...REQUEST,
      rotation: 'LandscapeLeft',
    })
    expect(rotateResult.success).toBe(true)

    const screenshotResult = await manager.captureScreenshot({
      ...REQUEST,
      copyToClipboard: true,
    })
    expect(screenshotResult).toEqual({
      success: true,
      filePath: '/tmp/LandscapeLeft.png',
    })

    await manager.stopSession(REQUEST)
  })

  it('surfaces helper screenshot errors', async () => {
    const manager = createManagerWithFakeHelper({
      helperMode: 'screenshot-error',
    })

    await manager.startSession(REQUEST)
    await waitForRunning(manager, REQUEST)

    const screenshotResult = await manager.captureScreenshot(REQUEST)
    expect(screenshotResult.success).toBe(false)
    expect(screenshotResult.error).toContain('no_frame_available')

    await manager.stopSession(REQUEST)
  })

  it('marks the session app-ready when the runtime bridge emits appReady', async () => {
    const manager = createManagerWithFakeHelper()
    let bridgeListener: ((envelope: { event: string; payload?: unknown }) => void) | null = null

    ;(manager as any).getRuntimeBridge = async () => ({
      onEnvelope(listener: (envelope: { event: string; payload?: unknown }) => void) {
        bridgeListener = listener
        return () => {
          if (bridgeListener === listener) {
            bridgeListener = null
          }
        }
      },
    })

    await manager.startSession(REQUEST)
    await waitForRunning(manager, REQUEST)

    expect(manager.getSessionState(REQUEST)?.appReady).toBe(false)
    expect(manager.getSessionState(REQUEST)?.appKey).toBeNull()

    bridgeListener?.({
      event: 'RNIDE_message',
      payload: {
        id: 7,
        type: 'appReady',
        data: { appKey: 'main' },
      },
    })

    await vi.waitFor(() => {
      const state = manager.getSessionState(REQUEST)
      expect(state?.appReady).toBe(true)
      expect(state?.appKey).toBe('main')
    })

    await manager.stopSession(REQUEST)
  })
})
