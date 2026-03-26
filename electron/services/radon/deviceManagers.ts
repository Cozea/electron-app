import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

import type { NativePreviewDeviceDescriptor } from '../../../shared/electronApiTypes'
import { getManagedIosDeviceSetPath, getManagedAndroidDeviceSetPath } from './devicePaths'
import { createManagedEmulator } from './androidProvisioning'
import fs from 'node:fs/promises'

const execFileAsync = promisify(execFile)
const MANAGED_DEVICE_NAME = 'Cozea iPhone'

type AndroidToolName = 'adb' | 'emulator'

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
  isAvailable?: boolean
}

interface SimctlDeviceType {
  identifier: string
  name: string
}

interface BootedAndroidDevice {
  serial: string
  avdName: string
}

function normalizeIosState(state: string): NativePreviewDeviceDescriptor['state'] {
  const normalized = state.toLowerCase()
  if (normalized === 'booted') return 'booted'
  if (normalized === 'shutdown') return 'shutdown'
  return 'available'
}

async function runSimctl(args: string[], options?: { deviceSet?: string }): Promise<string> {
  const simctlArgs = ['simctl']
  if (options?.deviceSet) {
    simctlArgs.push('--set', options.deviceSet)
  }
  simctlArgs.push(...args)

  const { stdout } = await execFileAsync('xcrun', simctlArgs, {
    maxBuffer: 1024 * 1024 * 8,
  })
  return stdout
}

async function runSimctlJson<T>(args: string[], options?: { deviceSet?: string }): Promise<T> {
  const stdout = await runSimctl([...args, '-j'], options)
  return JSON.parse(stdout) as T
}

async function lookupPathCommand(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command])
    const resolved = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    return resolved ?? null
  } catch {
    return null
  }
}

function getAndroidSdkRoots(): string[] {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    '/usr/local/share/android-commandlinetools',
    '/opt/homebrew/share/android-commandlinetools',
  ]

  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))]
}

function getToolCandidates(tool: AndroidToolName): string[] {
  const relativePath = tool === 'adb'
    ? path.join('platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    : path.join('emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator')

  const sdkCandidates = getAndroidSdkRoots().map((sdkRoot) => path.join(sdkRoot, relativePath))
  const pathCandidates = process.platform === 'win32'
    ? []
    : [`/usr/local/bin/${tool}`, `/opt/homebrew/bin/${tool}`]

  return [...sdkCandidates, ...pathCandidates]
}

async function resolveCommandPath(tool: AndroidToolName): Promise<string | null> {
  const fromPath = await lookupPathCommand(tool)
  if (fromPath) {
    return fromPath
  }

  for (const candidate of getToolCandidates(tool)) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

async function safeExec(commandPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(commandPath, args, {
    maxBuffer: 1024 * 1024 * 8,
  })
  return stdout
}

export class IOSDeviceManager {
  async listDevices(skipCreate = false): Promise<NativePreviewDeviceDescriptor[]> {
    if (process.platform !== 'darwin') {
      return []
    }

    const deviceSet = getManagedIosDeviceSetPath()
    const result = await runSimctlJson<{ devices: Record<string, SimctlDevice[]> }>(
      ['list', 'devices', 'available'],
      { deviceSet },
    )
    const devices: NativePreviewDeviceDescriptor[] = []

    for (const [runtimeId, runtimeDevices] of Object.entries(result.devices ?? {})) {
      for (const device of runtimeDevices) {
        devices.push({
          id: device.udid,
          name: device.name,
          platform: 'ios',
          kind: 'simulator',
          state: normalizeIosState(device.state),
          runtimeId,
          isManaged: device.name === MANAGED_DEVICE_NAME,
        })
      }
    }

    if (devices.length === 0 && !skipCreate) {
      try {
        const created = await this.ensureDefaultDevice()
        devices.push(created)
      } catch {
        // Ignore creation errors during listing
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

  async ensureDefaultDevice(preferredId?: string): Promise<NativePreviewDeviceDescriptor> {
    const existingDevices = await this.listDevices(true)

    if (preferredId) {
      const preferred = existingDevices.find((device) => device.id === preferredId)
      if (preferred) {
        return preferred
      }
    }

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

    const createdId = (await runSimctl(
      ['create', MANAGED_DEVICE_NAME, deviceType.identifier, runtime.identifier],
      { deviceSet: getManagedIosDeviceSetPath() },
    )).trim()
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

  async bootDevice(deviceId: string): Promise<NativePreviewDeviceDescriptor> {
    const deviceSet = getManagedIosDeviceSetPath()
    try {
      await runSimctl(['boot', deviceId], { deviceSet })
    } catch {
      // Ignore errors when already booted.
    }

    await runSimctl(['bootstatus', deviceId, '-b'], { deviceSet })
    const devices = await this.listDevices()
    const booted = devices.find((device) => device.id === deviceId)
    if (!booted) {
      throw new Error(`Unable to find iOS simulator ${deviceId} after boot.`)
    }

    return {
      ...booted,
      state: 'booted',
    }
  }

  async openDevice(deviceId?: string): Promise<NativePreviewDeviceDescriptor> {
    const device = await this.ensureDefaultDevice(deviceId)
    const booted = await this.bootDevice(device.id)
    await execFileAsync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', booted.id])
    return booted
  }
}

export class AndroidDeviceManager {
  private adbPathPromise: Promise<string | null> | null = null
  private emulatorPathPromise: Promise<string | null> | null = null

  private async getCommandPath(tool: AndroidToolName): Promise<string | null> {
    if (tool === 'adb') {
      if (!this.adbPathPromise) {
        this.adbPathPromise = resolveCommandPath('adb')
      }
      return this.adbPathPromise
    }

    if (!this.emulatorPathPromise) {
      this.emulatorPathPromise = resolveCommandPath('emulator')
    }
    return this.emulatorPathPromise
  }

  async isAvailable(): Promise<boolean> {
    const adbPath = await this.getCommandPath('adb')
    return Boolean(adbPath)
  }

  async getAdbExecutable(): Promise<string> {
    const adbPath = await this.getCommandPath('adb')
    if (!adbPath) {
      throw new Error('adb binary not found. Install Android platform-tools or configure ANDROID_SDK_ROOT.')
    }
    return adbPath
  }

  async getEmulatorExecutable(): Promise<string> {
    const emulatorPath = await this.getCommandPath('emulator')
    if (!emulatorPath) {
      throw new Error('Android emulator binary not found. Install the Android emulator toolchain or configure ANDROID_SDK_ROOT.')
    }
    return emulatorPath
  }

  private async listAvdNames(): Promise<string[]> {
    const emulatorPath = await this.getCommandPath('emulator')
    if (!emulatorPath) {
      return []
    }

    try {
      const { stdout } = await execFileAsync(emulatorPath, ['-list-avds'])
      return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  private async resolveBootedDevice(serial: string): Promise<BootedAndroidDevice | null> {
    try {
      const adbPath = await this.getCommandPath('adb')
      if (!adbPath) {
        return null
      }

      const stdout = await safeExec(adbPath, ['-s', serial, 'emu', 'avd', 'name'])
      const avdName = stdout.trim()
      if (!avdName) return null
      return { serial, avdName }
    } catch {
      return null
    }
  }

  private async listConnectedDevices(): Promise<Array<NativePreviewDeviceDescriptor & { serial: string }>> {
    const adbPath = await this.getCommandPath('adb')
    if (!adbPath) {
      return []
    }

    const stdout = await safeExec(adbPath, ['devices', '-l'])
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(1)

    const devices: Array<NativePreviewDeviceDescriptor & { serial: string }> = []

    for (const line of lines) {
      const [serial = '', state = '', ...rest] = line.split(/\s+/)
      if (!serial) continue

      const meta = Object.fromEntries(
        rest
          .map((part) => part.split(':', 2))
          .filter((pair) => pair.length === 2),
      )
      const isEmulator = serial.startsWith('emulator-')
      const availabilityState: NativePreviewDeviceDescriptor['state'] =
        state === 'device'
          ? 'booted'
          : state === 'offline'
            ? 'offline'
            : 'available'

      if (isEmulator) {
        const resolved = await this.resolveBootedDevice(serial)
        const avdName = resolved?.avdName ?? meta.avd ?? serial
        devices.push({
          id: avdName,
          name: avdName.replace(/_/g, ' '),
          platform: 'android',
          kind: 'emulator',
          state: availabilityState,
          runtimeId: serial,
          serial,
        })
        continue
      }

      const model = meta.model?.replace(/_/g, ' ') || meta.device?.replace(/_/g, ' ') || serial
      devices.push({
        id: serial,
        name: model,
        platform: 'android',
        kind: 'physical',
        state: availabilityState,
        runtimeId: serial,
        serial,
      })
    }

    return devices
  }

  async listDevices(): Promise<NativePreviewDeviceDescriptor[]> {
    const available = await this.isAvailable()
    if (!available) {
      return []
    }

    const [avdNames, connectedDevices] = await Promise.all([
      this.listAvdNames(),
      this.listConnectedDevices(),
    ])

    const devices: NativePreviewDeviceDescriptor[] = [...connectedDevices]
    const connectedIds = new Set(connectedDevices.filter((device) => device.kind === 'emulator').map((device) => device.id))

    for (const avdName of avdNames) {
      if (connectedIds.has(avdName)) continue
      devices.push({
        id: avdName,
        name: avdName.replace(/_/g, ' '),
        platform: 'android',
        kind: 'emulator',
        state: 'shutdown',
      })
    }

    return devices.sort((a, b) => {
      const rank = (device: NativePreviewDeviceDescriptor) => {
        if (device.state === 'booted') return 0
        if (device.kind === 'emulator') return 1
        if (device.kind === 'physical') return 2
        return 3
      }
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })
  }

  async ensureDefaultDevice(preferredId?: string): Promise<NativePreviewDeviceDescriptor> {
    const devices = await this.listDevices()

    if (preferredId) {
      const preferred = devices.find((device) => device.id === preferredId)
      if (preferred) {
        return preferred
      }
    }

    const preferred =
      devices.find((device) => device.state === 'booted' && device.kind === 'emulator')
      ?? devices.find((device) => device.kind === 'emulator')
      ?? devices.find((device) => device.kind === 'physical' && device.state === 'booted')
      ?? devices.find((device) => device.kind === 'physical')

    if (!preferred) {
      const createdId = await createManagedEmulator('Cozea Emulator')
      if (createdId) {
        return {
          id: createdId,
          name: 'Cozea Emulator',
          platform: 'android',
          kind: 'emulator',
          state: 'shutdown',
          runtimeId: createdId,
          isManaged: true,
        }
      }
      throw new Error('No Android device is available. Install an Android system image.')
    }

    return preferred
  }

  async bootDevice(deviceId: string, options?: { showWindow?: boolean }): Promise<NativePreviewDeviceDescriptor> {
    const emulatorPath = await this.getEmulatorExecutable()
    const existingDevices = await this.listDevices()
    const existing = existingDevices.find((device) => device.id === deviceId)

    if (existing?.kind === 'physical') {
      return existing
    }

    if (existing?.state === 'booted') {
      return existing
    }

    const emulatorArgs = [`@${deviceId}`]
    if (!options?.showWindow) {
      emulatorArgs.push('-no-window', '-no-boot-anim')
    }

    const env: Record<string, string | undefined> = { ...process.env }
    const avdHome = getManagedAndroidDeviceSetPath()
    if (avdHome) {
      env.ANDROID_AVD_HOME = avdHome
    }

    const emulatorProcess = spawn(emulatorPath, emulatorArgs, {
      detached: true,
      stdio: 'ignore',
      env,
    })
    emulatorProcess.unref()

    const startedAt = Date.now()
    while (Date.now() - startedAt < 120_000) {
      const devices = await this.listDevices()
      const booted = devices.find((device) => device.id === deviceId && device.state === 'booted')
      if (booted) {
        return booted
      }
      await sleep(2_000)
    }

    throw new Error(`Timed out while booting Android emulator "${deviceId}".`)
  }

  async openDevice(deviceId?: string): Promise<NativePreviewDeviceDescriptor> {
    const device = await this.ensureDefaultDevice(deviceId)
    if (device.kind === 'physical') {
      return device
    }
    return this.bootDevice(device.id, { showWindow: true })
  }

  async forwardPort(device: NativePreviewDeviceDescriptor, port: number): Promise<void> {
    const adbPath = await this.getAdbExecutable()
    const serial = device.runtimeId || device.id
    if (!serial) {
      throw new Error(`Unable to determine the adb serial for Android device "${device.name}".`)
    }

    await safeExec(adbPath, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`])
  }
}
