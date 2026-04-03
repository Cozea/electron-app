import { describe, expect, it } from 'vitest'

import { parseSimctlDevices } from '../../electron/services/nativePreview/IosSimulatorDiscoveryService'

describe('IosSimulatorDiscoveryService', () => {
  it('parses and sorts available simulators with booted devices first', () => {
    const devices = parseSimctlDevices(JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-3': [
          {
            udid: 'shutdown-late',
            name: 'iPhone 17',
            state: 'Shutdown',
            isAvailable: true,
            lastBootedAt: '2026-03-01T00:00:00Z',
          },
          {
            udid: 'booted',
            name: 'iPhone 17 Pro',
            state: 'Booted',
            isAvailable: true,
            lastBootedAt: '2026-03-26T00:00:00Z',
          },
          {
            udid: 'shutdown-recent',
            name: 'iPhone Air',
            state: 'Shutdown',
            isAvailable: true,
            lastBootedAt: '2026-03-20T00:00:00Z',
          },
          {
            udid: 'ignored-unavailable',
            name: 'Unavailable',
            state: 'Shutdown',
            isAvailable: false,
          },
        ],
      },
    }))

    expect(devices.map((device) => device.udid)).toEqual([
      'booted',
      'shutdown-recent',
      'shutdown-late',
    ])
  })
})
