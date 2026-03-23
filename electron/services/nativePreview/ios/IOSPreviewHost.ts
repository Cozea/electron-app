import { Buffer } from 'node:buffer'
import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

import type {
  NativePreviewDeviceDescriptor,
  NativePreviewInputPayload,
  NativePreviewRunAutomationInput,
  NativePreviewRunAutomationResult,
  NativePreviewStartSessionInput,
} from '../../../../shared/electronApiTypes'
import { TerminalService } from '../../TerminalService'
import { MaestroService } from '../automation/MaestroService'
import { JpegFrameParser } from '../frameParsers'
import { buildScriptInvocation, hasScript, loadNativeProjectProfile, runForegroundCommand } from '../projectProfile'
import type {
  NativePreviewHost,
  NativePreviewHostStartContext,
  NativePreviewSessionRecord,
  NativePreviewStreamCallbacks,
} from '../types'
import { IOSSimulatorManager } from './IOSSimulatorManager'

const execFileAsync = promisify(execFile)

interface IOSActiveCapture {
  latestFrame: Buffer | null
  ffmpegProcess: ChildProcessWithoutNullStreams
  startupPromise: Promise<void>
  stopRequested: boolean
}

interface IOSWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

const IOS_SIMULATOR_WINDOW_QUERY_SCRIPT = `
import Foundation
import CoreGraphics

let deviceName = ProcessInfo.processInfo.environment["DEVICE_NAME"] ?? ""
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
let match = windows.first { entry in
  let owner = entry[kCGWindowOwnerName as String] as? String ?? ""
  let title = entry[kCGWindowName as String] as? String ?? ""
  return owner == "Simulator" && title.localizedCaseInsensitiveContains(deviceName)
}

guard
  let window = match,
  let bounds = window[kCGWindowBounds as String] as? [String: Any]
else {
  fputs("Unable to locate a visible Simulator window for \\(deviceName).\\n", stderr)
  exit(1)
}

let payload: [String: Double] = [
  "x": bounds["X"] as? Double ?? 0,
  "y": bounds["Y"] as? Double ?? 0,
  "width": bounds["Width"] as? Double ?? 0,
  "height": bounds["Height"] as? Double ?? 0,
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
`

export class IOSPreviewHost implements NativePreviewHost {
  readonly platform = 'ios' as const
  private readonly captures = new Map<string, IOSActiveCapture>()

  constructor(
    private readonly simulatorManager = new IOSSimulatorManager(),
    private readonly maestroService = new MaestroService(),
  ) {}

  async listDevices(): Promise<NativePreviewDeviceDescriptor[]> {
    return this.simulatorManager.listDevices()
  }

  async startSession(input: NativePreviewStartSessionInput, context: NativePreviewHostStartContext): Promise<NativePreviewSessionRecord> {
    const session = context.session
    const projectProfile = await loadNativeProjectProfile(session.projectPath)
    const device = await this.simulatorManager.ensureDefaultDevice()

    await context.updateSession(session.id, {
      state: 'booting_device',
      device,
      message: `Booting ${device.name}...`,
    })

    await this.simulatorManager.bootDevice(device.id)

    await context.updateSession(session.id, {
      state: projectProfile.framework === 'react-native' || hasScript(projectProfile, 'ios')
        ? 'building_app'
        : 'launching_app',
      device: {
        ...device,
        state: 'booted',
      },
      message: projectProfile.framework === 'react-native' || hasScript(projectProfile, 'ios')
        ? 'Building app for iOS Simulator...'
        : 'Launching app in iOS Simulator...',
    })

    if (projectProfile.framework === 'expo') {
      await this.launchExpoPreview({
        deviceId: device.id,
        devServerPort: input.devServerPort,
        preferCliShortcut: projectProfile.hasExpoDevClient,
        terminalId: context.terminalId,
      })
    } else if (projectProfile.framework === 'react-native') {
      await this.launchReactNativePreview(session.projectPath, device.id)
    } else if (hasScript(projectProfile, 'ios')) {
      const invocation = buildScriptInvocation(projectProfile.packageManager, 'ios')
      await runForegroundCommand({
        cwd: session.projectPath,
        command: invocation.command,
        args: invocation.args,
      })
    }

    return (await context.updateSession(session.id, {
      state: 'stream_ready',
      message: 'Streaming iOS preview...',
    })) as NativePreviewSessionRecord
  }

  async stopSession(session: NativePreviewSessionRecord): Promise<void> {
    const capture = this.captures.get(session.id)
    if (!capture) return

    capture.stopRequested = true
    capture.ffmpegProcess.kill('SIGTERM')
    this.captures.delete(session.id)
  }

  async startStreaming(session: NativePreviewSessionRecord, callbacks: NativePreviewStreamCallbacks): Promise<void> {
    if (!session.device?.id || !session.device.name) {
      throw new Error('iOS preview session is missing a simulator device.')
    }

    const existing = this.captures.get(session.id)
    if (existing) {
      await existing.startupPromise
      return
    }

    await this.simulatorManager.ensurePreviewWindow(session.device.id)
    const bounds = await this.getVisibleWindowBounds(session.device.name)
    const parser = new JpegFrameParser()
    const stderrChunks: Buffer[] = []

    const ffmpegProcess = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-pixel_format',
      'bgr0',
      '-framerate',
      '30',
      '-i',
      '1:none',
      '-vf',
      `crop=${Math.round(bounds.width)}:${Math.round(bounds.height)}:${Math.round(bounds.x)}:${Math.round(bounds.y)},fps=12`,
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let firstFrameResolved = false
    let resolveStartup!: () => void
    let rejectStartup!: (error: Error) => void

    const startupPromise = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve
      rejectStartup = reject
    })

    const capture: IOSActiveCapture = {
      latestFrame: null,
      ffmpegProcess,
      startupPromise,
      stopRequested: false,
    }

    this.captures.set(session.id, capture)

    const startupTimeout = setTimeout(() => {
      if (firstFrameResolved) return
      const error = new Error('Timed out while waiting for the iOS preview stream to produce its first frame.')
      rejectStartup(error)
      callbacks.onError(error.message)
      capture.stopRequested = true
      ffmpegProcess.kill('SIGTERM')
      this.captures.delete(session.id)
    }, 15_000)

    ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      parser.push(chunk, (frame) => {
        capture.latestFrame = frame
        callbacks.onImageFrame(frame)
        if (!firstFrameResolved) {
          firstFrameResolved = true
          clearTimeout(startupTimeout)
          resolveStartup()
        }
      })
    })

    ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    ffmpegProcess.on('error', (error) => {
      clearTimeout(startupTimeout)
      if (!firstFrameResolved) {
        rejectStartup(error)
      }
      if (!capture.stopRequested) {
        callbacks.onError(error.message)
      }
      this.captures.delete(session.id)
    })

    ffmpegProcess.on('close', (code) => {
      clearTimeout(startupTimeout)
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      if (!firstFrameResolved) {
        rejectStartup(new Error(stderr || `The iOS preview stream exited before producing frames (code ${code ?? 'unknown'}).`))
      } else if (!capture.stopRequested) {
        callbacks.onError(stderr || `The iOS preview stream stopped unexpectedly (code ${code ?? 'unknown'}).`)
      }
      this.captures.delete(session.id)
    })

    await startupPromise
  }

  async sendInput(session: NativePreviewSessionRecord, input: NativePreviewInputPayload): Promise<void> {
    if (input.type !== 'tap' || typeof input.x !== 'number' || typeof input.y !== 'number') {
      return
    }

    await this.maestroService.tapPoint(session, input.x, input.y)
  }

  async getLatestFrame(session: NativePreviewSessionRecord): Promise<Buffer | null> {
    return this.captures.get(session.id)?.latestFrame ?? null
  }

  async captureScreenshot(session: NativePreviewSessionRecord): Promise<string | null> {
    const frame = await this.getLatestFrame(session)
    if (!frame) return null
    return `data:image/jpeg;base64,${frame.toString('base64')}`
  }

  async runAutomation(session: NativePreviewSessionRecord, input: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult> {
    return this.maestroService.run(session, input)
  }

  async openDevice(options: { deviceId?: string }): Promise<void> {
    if (options.deviceId) {
      await this.simulatorManager.openDevice(options.deviceId)
      return
    }
    const device = await this.simulatorManager.ensureDefaultDevice()
    await this.simulatorManager.openDevice(device.id)
  }

  private async launchExpoPreview(options: {
    deviceId: string
    devServerPort?: number
    preferCliShortcut?: boolean
    terminalId?: string
  }): Promise<void> {
    let launchError: string | null = null

    if (options.preferCliShortcut && options.terminalId) {
      await this.waitForExpoPrompt(options.terminalId, 'i')
      const sent = await TerminalService.getInstance().sendInput(options.terminalId, 'i')
      if (sent) {
        return
      }
    }

    if (options.devServerPort) {
      try {
        await execFileAsync('xcrun', [
          'simctl',
          'openurl',
          options.deviceId,
          `exp://127.0.0.1:${options.devServerPort}`,
        ])
        return
      } catch (error) {
        launchError = error instanceof Error ? error.message : String(error)
      }
    }

    if (options.terminalId) {
      await this.waitForExpoPrompt(options.terminalId, 'i')
      const sent = await TerminalService.getInstance().sendInput(options.terminalId, 'i')
      if (sent) {
        return
      }
    }

    throw new Error(launchError ?? 'Unable to launch the Expo app on the iOS Simulator.')
  }

  private async launchReactNativePreview(projectPath: string, deviceId: string): Promise<void> {
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    await runForegroundCommand({
      cwd: projectPath,
      command: npxCommand,
      args: ['react-native', 'run-ios', '--udid', deviceId],
    })
  }

  private async waitForExpoPrompt(terminalId: string, shortcut: 'i' | 'a'): Promise<void> {
    const expectedPrompt = shortcut === 'i' ? 'Press i' : 'Press a'
    const fallbackPrompt = shortcut === 'i' ? 'open iOS simulator' : 'open Android'
    const startedAt = Date.now()

    while (Date.now() - startedAt < 30_000) {
      const snapshot = TerminalService.getInstance().getTerminalSnapshot(terminalId)
      const output = snapshot?.stdout ?? ''
      if (output.includes(expectedPrompt) || output.includes(fallbackPrompt)) {
        return
      }
      await sleep(500)
    }
  }

  private async getVisibleWindowBounds(deviceName: string): Promise<IOSWindowBounds> {
    const { stdout } = await execFileAsync('swift', ['-e', IOS_SIMULATOR_WINDOW_QUERY_SCRIPT], {
      env: {
        ...process.env,
        DEVICE_NAME: deviceName,
      },
      maxBuffer: 1024 * 1024,
      timeout: 20_000,
    })

    const parsed = JSON.parse(stdout) as Partial<IOSWindowBounds>
    if (
      typeof parsed.x !== 'number'
      || typeof parsed.y !== 'number'
      || typeof parsed.width !== 'number'
      || typeof parsed.height !== 'number'
      || parsed.width <= 0
      || parsed.height <= 0
    ) {
      throw new Error(`Unable to determine the visible Simulator window bounds for ${deviceName}.`)
    }

    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
    }
  }
}
