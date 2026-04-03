import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewListIosSimulatorsResult,
} from '../../../shared/nativePreviewTypes'

const execFileAsync = promisify(execFile)

interface SimctlListDevicesJson {
  devices?: Record<string, Array<{
    udid?: string
    name?: string
    state?: string
    isAvailable?: boolean
    lastBootedAt?: string
  }>>
}

export function compareSimulators(
  left: NativePreviewIosSimulatorDevice,
  right: NativePreviewIosSimulatorDevice
): number {
  const leftBooted = left.state === 'Booted'
  const rightBooted = right.state === 'Booted'
  if (leftBooted !== rightBooted) {
    return leftBooted ? -1 : 1
  }

  const leftLastBooted = left.lastBootedAt ? Date.parse(left.lastBootedAt) : Number.NEGATIVE_INFINITY
  const rightLastBooted = right.lastBootedAt ? Date.parse(right.lastBootedAt) : Number.NEGATIVE_INFINITY
  if (leftLastBooted !== rightLastBooted) {
    return rightLastBooted - leftLastBooted
  }

  return left.name.localeCompare(right.name)
}

export function parseSimctlDevices(payload: string): NativePreviewIosSimulatorDevice[] {
  const parsed = JSON.parse(payload) as SimctlListDevicesJson
  const devices: NativePreviewIosSimulatorDevice[] = []

  for (const [runtimeIdentifier, runtimeDevices] of Object.entries(parsed.devices ?? {})) {
    for (const device of runtimeDevices) {
      if (!device.udid || !device.name || device.isAvailable !== true) {
        continue
      }

      devices.push({
        udid: device.udid,
        name: device.name,
        runtimeIdentifier,
        state: device.state ?? 'Unknown',
        isAvailable: true,
        lastBootedAt: device.lastBootedAt ?? null,
      })
    }
  }

  devices.sort(compareSimulators)
  return devices
}

export class IosSimulatorDiscoveryService {
  private static instance: IosSimulatorDiscoveryService | null = null

  public static getInstance(): IosSimulatorDiscoveryService {
    if (!IosSimulatorDiscoveryService.instance) {
      IosSimulatorDiscoveryService.instance = new IosSimulatorDiscoveryService()
    }

    return IosSimulatorDiscoveryService.instance
  }

  public async listSimulators(): Promise<NativePreviewListIosSimulatorsResult> {
    if (process.platform !== 'darwin') {
      return {
        success: false,
        error: 'iOS simulator discovery is only available on macOS.',
      }
    }

    try {
      const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
      return {
        success: true,
        devices: parseSimctlDevices(stdout),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list iOS simulators.',
      }
    }
  }
}
