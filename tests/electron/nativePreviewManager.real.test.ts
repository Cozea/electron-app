import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { NativePreviewManager } from '../../electron/services/nativePreview/NativePreviewManager'
import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewStartSessionRequest,
} from '../../shared/nativePreviewTypes'

const SHOULD_RUN =
  process.platform === 'darwin' && process.env.RUN_NATIVE_PREVIEW_REAL_TESTS === '1'

const REQUEST_BASE: Omit<NativePreviewStartSessionRequest, 'deviceId'> = {
  projectPath: '/tmp/example-project',
  platform: 'ios',
}

function readSimulators(): NativePreviewIosSimulatorDevice[] {
  const output = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
  })
  const parsed = JSON.parse(output) as {
    devices?: Record<string, Array<Record<string, unknown>>>
  }

  const devices = Object.values(parsed.devices ?? {})
    .flat()
    .map((device) => ({
      udid: String(device.udid ?? ''),
      name: String(device.name ?? ''),
      state: String(device.state ?? ''),
      isAvailable: Boolean(device.isAvailable ?? true),
      runtimeIdentifier: String(device.runtimeIdentifier ?? ''),
      lastBootedAt:
        typeof device.lastBootedAt === 'string' ? device.lastBootedAt : null,
    }))

  return devices.filter((device) => device.udid && device.isAvailable)
}

function ensureBootedDevice(): NativePreviewIosSimulatorDevice {
  const devices = readSimulators()
  const selected =
    devices.find((device) => device.state === 'Booted') ??
    devices.find((device) => /iPhone/i.test(device.name)) ??
    devices[0]

  if (!selected) {
    throw new Error('No available iOS simulator device found for native preview test.')
  }

  execFileSync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', selected.udid], {
    stdio: 'ignore',
  })
  spawnSync('xcrun', ['simctl', 'boot', selected.udid], {
    stdio: 'ignore',
  })
  execFileSync('xcrun', ['simctl', 'bootstatus', selected.udid, '-b'], {
    stdio: 'ignore',
  })

  return selected
}

function readImageSize(filePath: string): { width: number; height: number } {
  const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
    encoding: 'utf8',
  })

  const widthMatch = output.match(/pixelWidth:\s+(\d+)/)
  const heightMatch = output.match(/pixelHeight:\s+(\d+)/)
  if (!widthMatch || !heightMatch) {
    throw new Error(`Failed to read screenshot size for ${filePath}`)
  }

  return {
    width: Number(widthMatch[1]),
    height: Number(heightMatch[1]),
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timed out while waiting for ${label}.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function waitForRunning(manager: NativePreviewManager, request: NativePreviewStartSessionRequest) {
  await vi.waitFor(() => {
    const state = manager.getSessionState(request)
    expect(state?.status).toBe('running')
    expect(state?.streamUrl).toBeTruthy()
  }, { timeout: 60_000 })
}

describe('NativePreviewManager real helper integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.runIf(SHOULD_RUN)(
    'starts a real iOS session and rotates into landscape before screenshot capture',
    async () => {
      const device = ensureBootedDevice()
      const request: NativePreviewStartSessionRequest = {
        ...REQUEST_BASE,
        deviceId: device.udid,
      }

      const manager = new NativePreviewManager()
      const stateEvents: Array<string> = []
      const helperLines: string[] = []
      const originalHandleStdoutLine = (manager as any).handleStdoutLine?.bind(manager)
      if (originalHandleStdoutLine) {
        ;(manager as any).handleStdoutLine = (sessionKey: string, line: string) => {
          helperLines.push(line)
          return originalHandleStdoutLine(sessionKey, line)
        }
      }
      const unsubscribe = manager.subscribe((event) => {
        stateEvents.push(
          JSON.stringify({
            sessionKey: event.sessionKey,
            status: event.state?.status ?? null,
            streamUrl: event.state?.streamUrl ?? null,
            lastError: event.state?.lastError ?? null,
          })
        )
      })

      try {
        const startResult = await withTimeout(
          manager.startSession(request),
          45_000,
          'native preview session start'
        )
        expect(startResult.success, startResult.error ?? 'native preview session start failed').toBe(true)
        await withTimeout(
          waitForRunning(manager, request),
          45_000,
          `native preview session running; events=${stateEvents.join(' | ')}; helper=${helperLines.join(' | ')}`
        )

        await new Promise((resolve) => setTimeout(resolve, 1_500))

        const portraitShot = await manager.captureScreenshot(request)
        expect(
          portraitShot.success,
          `${portraitShot.error ?? 'portrait screenshot failed'}; helper=${helperLines.join(' | ')}`
        ).toBe(true)
        expect(portraitShot.filePath).toBeTruthy()
        expect(fs.existsSync(portraitShot.filePath!)).toBe(true)

        const portraitSize = readImageSize(portraitShot.filePath!)

        const rotateResult = await manager.rotate({
          ...request,
          rotation: 'LandscapeLeft',
        })
        expect(rotateResult.success).toBe(true)

        await new Promise((resolve) => setTimeout(resolve, 2_500))

        const landscapeShot = await manager.captureScreenshot(request)
        expect(
          landscapeShot.success,
          `${landscapeShot.error ?? 'landscape screenshot failed'}; helper=${helperLines.join(' | ')}`
        ).toBe(true)
        expect(landscapeShot.filePath).toBeTruthy()
        expect(fs.existsSync(landscapeShot.filePath!)).toBe(true)

        const landscapeSize = readImageSize(landscapeShot.filePath!)

        expect(portraitSize.height).toBeGreaterThan(portraitSize.width)
        expect(landscapeSize.width).toBeGreaterThan(landscapeSize.height)
      } finally {
        await manager.stopSession(request)
        unsubscribe()
      }
    },
    180_000
  )
})
