import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { NativePreviewDeviceDescriptor } from '../../../../shared/electronApiTypes'

const execFileAsync = promisify(execFile)
const MANAGED_DEVICE_NAME = 'Cozea iPhone'

interface SimctlDevice {
  udid: string
  name: string
  state: string
  isAvailable?: boolean
}

interface SimctlRuntime {
  identifier: string
  name: string
  version?: string
  platform?: string
  isAvailable?: boolean
}

interface SimctlDeviceType {
  identifier: string
  name: string
}

async function runSimctl(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('xcrun', ['simctl', ...args], {
    maxBuffer: 1024 * 1024 * 8,
  })
  return stdout
}

async function runSimctlJson<T>(args: string[]): Promise<T> {
  const stdout = await runSimctl([...args, '-j'])
  return JSON.parse(stdout) as T
}

function normalizeState(state: string): NativePreviewDeviceDescriptor['state'] {
  const normalized = state.toLowerCase()
  if (normalized === 'booted') return 'booted'
  if (normalized === 'shutdown') return 'shutdown'
  return 'available'
}

export class IOSSimulatorManager {
  async listDevices(): Promise<NativePreviewDeviceDescriptor[]> {
    const result = await runSimctlJson<{ devices: Record<string, SimctlDevice[]> }>(['list', 'devices', 'available'])
    const devices: NativePreviewDeviceDescriptor[] = []

    for (const [runtimeId, runtimeDevices] of Object.entries(result.devices ?? {})) {
      for (const device of runtimeDevices) {
        devices.push({
          id: device.udid,
          name: device.name,
          platform: 'ios',
          kind: 'simulator',
          state: normalizeState(device.state),
          runtimeId,
          isManaged: device.name === MANAGED_DEVICE_NAME,
        })
      }
    }

    return devices.sort((a, b) => {
      if (a.state === 'booted' && b.state !== 'booted') return -1
      if (b.state === 'booted' && a.state !== 'booted') return 1
      if (a.isManaged && !b.isManaged) return -1
      if (b.isManaged && !a.isManaged) return 1
      return a.name.localeCompare(b.name)
    })
  }

  async ensureDefaultDevice(): Promise<NativePreviewDeviceDescriptor> {
    const existingDevices = await this.listDevices()
    const preferredExisting =
      existingDevices.find((device) => device.state === 'booted')
      ?? existingDevices.find((device) => device.isManaged)
      ?? existingDevices.find((device) => device.name.toLowerCase().startsWith('iphone'))

    if (preferredExisting) {
      return preferredExisting
    }

    const [runtimes, deviceTypes] = await Promise.all([
      runSimctlJson<{ runtimes: SimctlRuntime[] }>(['list', 'runtimes', 'available']),
      runSimctlJson<{ devicetypes: SimctlDeviceType[] }>(['list', 'devicetypes', 'available']),
    ])

    const runtime = [...(runtimes.runtimes ?? [])]
      .filter((entry) => entry.isAvailable !== false && /iOS/i.test(entry.name || entry.identifier))
      .sort((a, b) => (b.version || '').localeCompare(a.version || ''))[0]

    const preferredTypeNames = ['iPhone 16 Pro', 'iPhone 16', 'iPhone 15 Pro', 'iPhone 15']
    const deviceType =
      preferredTypeNames
        .map((name) => (deviceTypes.devicetypes ?? []).find((entry) => entry.name === name))
        .find(Boolean)
      ?? (deviceTypes.devicetypes ?? []).find((entry) => entry.name.startsWith('iPhone'))

    if (!runtime || !deviceType) {
      throw new Error('No iOS simulator runtime or device type is available.')
    }

    const createdId = (await runSimctl(['create', MANAGED_DEVICE_NAME, deviceType.identifier, runtime.identifier])).trim()
    return {
      id: createdId,
      name: MANAGED_DEVICE_NAME,
      platform: 'ios',
      kind: 'simulator',
      state: 'shutdown',
      runtimeId: runtime.identifier,
      isManaged: true,
    }
  }

  async bootDevice(deviceId: string): Promise<void> {
    try {
      await runSimctl(['boot', deviceId])
    } catch {
      // Ignore errors when already booted.
    }

    await runSimctl(['bootstatus', deviceId, '-b'])
  }

  async openDevice(deviceId: string): Promise<void> {
    await this.bootDevice(deviceId)
    await execFileAsync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId])
  }

  async ensurePreviewWindow(deviceId: string): Promise<void> {
    await this.bootDevice(deviceId)
    await execFileAsync('open', ['-g', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId])
  }
}
