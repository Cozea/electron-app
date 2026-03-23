import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'

import type { NativePreviewDeviceDescriptor } from '../../../../shared/electronApiTypes'

const execFileAsync = promisify(execFile)

type AndroidToolName = 'adb' | 'emulator'

interface BootedAndroidDevice {
  serial: string
  avdName: string
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
    : [
        `/usr/local/bin/${tool}`,
        `/opt/homebrew/bin/${tool}`,
      ]

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
    const [emulatorPath, adbPath] = await Promise.all([
      this.getCommandPath('emulator'),
      this.getCommandPath('adb'),
    ])
    return Boolean(emulatorPath && adbPath)
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

    const stdout = await safeExec(emulatorPath, ['-list-avds'])
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
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

  private async listBootedDevices(): Promise<BootedAndroidDevice[]> {
    const adbPath = await this.getCommandPath('adb')
    if (!adbPath) {
      return []
    }

    const stdout = await safeExec(adbPath, ['devices'])
    const serials = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(1)
      .map((line) => line.split(/\s+/))
      .filter((parts) => parts[1] === 'device' && parts[0]?.startsWith('emulator-'))
      .map((parts) => parts[0])

    const resolved = await Promise.all(serials.map((serial) => this.resolveBootedDevice(serial)))
    return resolved.filter((device): device is BootedAndroidDevice => Boolean(device))
  }

  async listDevices(): Promise<NativePreviewDeviceDescriptor[]> {
    const available = await this.isAvailable()
    if (!available) {
      return []
    }

    const [avdNames, bootedDevices] = await Promise.all([
      this.listAvdNames(),
      this.listBootedDevices(),
    ])

    const bootedMap = new Map(bootedDevices.map((device) => [device.avdName, device]))
    const devices: NativePreviewDeviceDescriptor[] = []

    for (const booted of bootedDevices) {
      devices.push({
        id: booted.avdName,
        name: booted.avdName.replace(/_/g, ' '),
        platform: 'android',
        kind: 'emulator',
        state: 'booted',
        runtimeId: booted.serial,
      })
    }

    for (const avdName of avdNames) {
      if (bootedMap.has(avdName)) continue
      devices.push({
        id: avdName,
        name: avdName.replace(/_/g, ' '),
        platform: 'android',
        kind: 'emulator',
        state: 'shutdown',
      })
    }

    return devices.sort((a, b) => {
      if (a.state === 'booted' && b.state !== 'booted') return -1
      if (b.state === 'booted' && a.state !== 'booted') return 1
      return a.name.localeCompare(b.name)
    })
  }

  async ensureDefaultDevice(): Promise<NativePreviewDeviceDescriptor> {
    const devices = await this.listDevices()
    const preferred =
      devices.find((device) => device.state === 'booted')
      ?? devices[0]

    if (!preferred) {
      throw new Error('No Android emulator is available. Install an AVD in Android Studio first.')
    }

    return preferred
  }

  async bootDevice(deviceId: string, options?: { showWindow?: boolean }): Promise<NativePreviewDeviceDescriptor> {
    const emulatorPath = await this.getEmulatorExecutable()

    const existingDevices = await this.listDevices()
    const existing = existingDevices.find((device) => device.id === deviceId)
    if (existing?.state === 'booted') {
      return existing
    }

    const emulatorArgs = [`@${deviceId}`]
    if (!options?.showWindow) {
      emulatorArgs.push('-no-window', '-no-boot-anim')
    }

    const emulatorProcess = spawn(emulatorPath, emulatorArgs, {
      detached: true,
      stdio: 'ignore',
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
    const device = deviceId
      ? (await this.listDevices()).find((entry) => entry.id === deviceId) ?? null
      : await this.ensureDefaultDevice()

    if (!device) {
      throw new Error('No Android emulator is available.')
    }

    if (device.state === 'booted') {
      return device
    }

    return this.bootDevice(device.id, { showWindow: true })
  }

  async reversePort(serial: string, port: number): Promise<void> {
    const adbPath = await this.getAdbExecutable()
    await safeExec(adbPath, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`])
  }

  async reverseAbstractSocket(serial: string, socketName: string, localPort: number): Promise<void> {
    const adbPath = await this.getAdbExecutable()
    await safeExec(adbPath, ['-s', serial, 'reverse', `localabstract:${socketName}`, `tcp:${localPort}`])
  }

  async removeReverseAbstractSocket(serial: string, socketName: string): Promise<void> {
    try {
      const adbPath = await this.getCommandPath('adb')
      if (!adbPath) {
        return
      }

      await safeExec(adbPath, ['-s', serial, 'reverse', '--remove', `localabstract:${socketName}`])
    } catch {
      // Best-effort cleanup.
    }
  }

  async pushFile(serial: string, localPath: string, remotePath: string): Promise<void> {
    const adbPath = await this.getAdbExecutable()
    await safeExec(adbPath, ['-s', serial, 'push', localPath, remotePath])
  }

  async openUrl(serial: string, url: string): Promise<void> {
    const adbPath = await this.getAdbExecutable()
    await safeExec(adbPath, ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url])
  }

  async sendTap(device: NativePreviewDeviceDescriptor, x: number, y: number): Promise<void> {
    const serial = device.runtimeId
    if (!serial) {
      throw new Error('Android emulator serial is unavailable for input forwarding.')
    }

    const adbPath = await this.getAdbExecutable()
    await safeExec(adbPath, ['-s', serial, 'shell', 'input', 'tap', `${Math.round(x)}`, `${Math.round(y)}`])
  }
}
