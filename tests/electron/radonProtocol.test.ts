import { describe, expect, it } from 'vitest'

import {
  buildTouchCommand,
  legacyInputToDeviceCommand,
  nextRotation,
  parseSimulatorServerEvent,
} from '../../electron/services/radon/protocol'

describe('radon protocol helpers', () => {
  it('parses stream-ready output', () => {
    const event = parseSimulatorServerEvent('stream_ready http://127.0.0.1:8123/stream.mjpeg')
    expect(event).toEqual({
      type: 'stream_ready',
      streamUrl: 'http://127.0.0.1:8123/stream.mjpeg',
    })
  })

  it('maps legacy preview key payloads to Radon commands', () => {
    expect(legacyInputToDeviceCommand({
      sessionId: 'abc',
      type: 'key',
      key: 'home',
    })).toEqual({ command: 'home' })

    expect(legacyInputToDeviceCommand({
      sessionId: 'abc',
      type: 'tap',
      x: 0.25,
      y: 0.75,
    })).toEqual({
      command: 'tap',
      payload: {
        x: 0.25,
        y: 0.75,
      },
    })
  })

  it('rotates touch coordinates with landscape transforms', () => {
    expect(buildTouchCommand('down', 0.25, 0.75, 'LandscapeLeft')).toBe('touch down 0.25,0.25\n')
    expect(nextRotation('Portrait', 'clockwise')).toBe('LandscapeRight')
    expect(nextRotation('LandscapeRight', 'counterclockwise')).toBe('Portrait')
  })
})
