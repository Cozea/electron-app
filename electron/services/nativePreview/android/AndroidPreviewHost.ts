import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, realpath } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import path from 'node:path'
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
import { buildScriptInvocation, hasScript, loadNativeProjectProfile, runForegroundCommand } from '../projectProfile'
import type {
  NativePreviewHost,
  NativePreviewHostStartContext,
  NativePreviewSessionRecord,
  NativePreviewStreamCallbacks,
} from '../types'
import { AndroidDeviceManager } from './AndroidDeviceManager'

const execFileAsync = promisify(execFile)

interface AndroidActiveCapture {
  listener: Server
  deviceSocket: Socket | null
  serverProcess: ChildProcessWithoutNullStreams | null
  ffmpegProcess: ChildProcessWithoutNullStreams | null
  socketName: string
  serial: string
  startupPromise: Promise<void>
  stopRequested: boolean
}

interface ScrcpyInstallation {
  serverPath: string
  version: string
}

const ANDROID_SCRCPY_SERVER_REMOTE_PATH = '/data/local/tmp/scrcpy-server.jar'
const ANDROID_SCRCPY_MAX_SIZE = 1080
const ANDROID_SCRCPY_VIDEO_BIT_RATE = 8_000_000
const ANDROID_SCRCPY_STARTUP_TIMEOUT_MS = 15_000

export class AndroidPreviewHost implements NativePreviewHost {
  readonly platform = 'android' as const
  private readonly captures = new Map<string, AndroidActiveCapture>()
  private scrcpyInstallationPromise: Promise<ScrcpyInstallation> | null = null

  constructor(
    private readonly deviceManager = new AndroidDeviceManager(),
    private readonly maestroService = new MaestroService(),
  ) {}

  async listDevices(): Promise<NativePreviewDeviceDescriptor[]> {
    return this.deviceManager.listDevices()
  }

  async startSession(input: NativePreviewStartSessionInput, context: NativePreviewHostStartContext): Promise<NativePreviewSessionRecord> {
    const session = context.session
    const projectProfile = await loadNativeProjectProfile(session.projectPath)
    const device = await this.deviceManager.ensureDefaultDevice()

    await context.updateSession(session.id, {
      state: 'booting_device',
      device,
      message: `Booting ${device.name}...`,
    })

    const bootedDevice = await this.deviceManager.bootDevice(device.id)

    await context.updateSession(session.id, {
      state: projectProfile.framework === 'react-native' || hasScript(projectProfile, 'android')
        ? 'building_app'
        : 'launching_app',
      device: bootedDevice,
      message: projectProfile.framework === 'react-native' || hasScript(projectProfile, 'android')
        ? 'Building app for Android Emulator...'
        : 'Launching app in Android Emulator...',
    })

    if (projectProfile.framework === 'expo') {
      await this.launchExpoPreview({
        device: bootedDevice,
        devServerPort: input.devServerPort,
        preferCliShortcut: projectProfile.hasExpoDevClient,
        terminalId: context.terminalId,
      })
    } else if (projectProfile.framework === 'react-native') {
      await this.launchReactNativePreview(session.projectPath, bootedDevice.runtimeId)
    } else if (hasScript(projectProfile, 'android')) {
      const invocation = buildScriptInvocation(projectProfile.packageManager, 'android')
      await runForegroundCommand({
        cwd: session.projectPath,
        command: invocation.command,
        args: invocation.args,
      })
    }

    return (await context.updateSession(session.id, {
      state: 'stream_ready',
      message: 'Streaming Android preview...',
    })) as NativePreviewSessionRecord
  }

  async stopSession(session: NativePreviewSessionRecord): Promise<void> {
    const capture = this.captures.get(session.id)
    if (!capture) return

    capture.stopRequested = true
    capture.deviceSocket?.destroy()
    capture.ffmpegProcess?.kill('SIGTERM')
    capture.serverProcess?.kill('SIGTERM')
    capture.listener.close()
    await this.deviceManager.removeReverseAbstractSocket(capture.serial, capture.socketName)
    this.captures.delete(session.id)
  }

  async startStreaming(session: NativePreviewSessionRecord, callbacks: NativePreviewStreamCallbacks): Promise<void> {
    const serial = session.device?.runtimeId
    if (!serial) {
      throw new Error('Android preview session is missing an emulator serial.')
    }

    const existing = this.captures.get(session.id)
    if (existing) {
      await existing.startupPromise
      return
    }

    const installation = await this.resolveScrcpyInstallation()
    const listener = createServer()
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', () => {
        listener.off('error', reject)
        resolve()
      })
    })

    const address = listener.address()
    if (!address || typeof address === 'string') {
      listener.close()
      throw new Error('Failed to bind a local Android preview socket.')
    }

    const socketName = `scrcpy_${randomBytes(4).toString('hex')}`
    const localPort = address.port

    let resolveStartup!: () => void
    let rejectStartup!: (error: Error) => void
    const startupPromise = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve
      rejectStartup = reject
    })

    const capture: AndroidActiveCapture = {
      listener,
      deviceSocket: null,
      serverProcess: null,
      ffmpegProcess: null,
      socketName,
      serial,
      startupPromise,
      stopRequested: false,
    }

    this.captures.set(session.id, capture)

    const finishWithError = async (error: Error): Promise<void> => {
      if (capture.stopRequested) {
        return
      }

      capture.stopRequested = true
      capture.deviceSocket?.destroy()
      capture.ffmpegProcess?.kill('SIGTERM')
      capture.serverProcess?.kill('SIGTERM')
      capture.listener.close()
      await this.deviceManager.removeReverseAbstractSocket(serial, socketName)
      this.captures.delete(session.id)
      callbacks.onError(error.message)
    }

    const startupTimeout = setTimeout(() => {
      rejectStartup(new Error('Timed out while waiting for the Android preview stream to start.'))
      void finishWithError(new Error('Timed out while waiting for the Android preview stream to start.'))
    }, ANDROID_SCRCPY_STARTUP_TIMEOUT_MS)

    const socketPromise = new Promise<Socket>((resolve, reject) => {
      listener.once('connection', resolve)
      listener.once('error', reject)
    })

    try {
      await this.deviceManager.pushFile(serial, installation.serverPath, ANDROID_SCRCPY_SERVER_REMOTE_PATH)
      await this.deviceManager.reverseAbstractSocket(serial, socketName, localPort)
      const adbPath = await this.deviceManager.getAdbExecutable()

      const serverProcess = spawn(adbPath, [
        '-s',
        serial,
        'shell',
        `CLASSPATH=${ANDROID_SCRCPY_SERVER_REMOTE_PATH}`,
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        installation.version,
        `scid=${socketName.slice('scrcpy_'.length)}`,
        'log_level=error',
        'audio=false',
        'control=false',
        'cleanup=false',
        'raw_stream=true',
        `max_size=${ANDROID_SCRCPY_MAX_SIZE}`,
        `video_bit_rate=${ANDROID_SCRCPY_VIDEO_BIT_RATE}`,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      capture.serverProcess = serverProcess

      const serverStderrChunks: Buffer[] = []
      serverProcess.stderr.on('data', (chunk: Buffer) => {
        serverStderrChunks.push(chunk)
      })

      serverProcess.on('error', (error) => {
        clearTimeout(startupTimeout)
        rejectStartup(error)
        void finishWithError(error)
      })

      serverProcess.on('close', (code) => {
        if (capture.stopRequested) {
          return
        }

        const stderr = Buffer.concat(serverStderrChunks).toString('utf8').trim()
        const message = stderr || `scrcpy server exited unexpectedly (code ${code ?? 'unknown'}).`
        clearTimeout(startupTimeout)
        rejectStartup(new Error(message))
        void finishWithError(new Error(message))
      })

      const deviceSocket = await socketPromise
      capture.deviceSocket = deviceSocket
      listener.close()

      const ffmpegProcess = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-analyzeduration',
        '0',
        '-probesize',
        '32',
        '-f',
        'h264',
        '-i',
        'pipe:0',
        '-an',
        '-c:v',
        'copy',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof+separate_moof+omit_tfhd_offset',
        '-frag_duration',
        '100000',
        '-flush_packets',
        '1',
        '-f',
        'mp4',
        'pipe:1',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      capture.ffmpegProcess = ffmpegProcess

      let firstChunkReceived = false
      const ffmpegStderrChunks: Buffer[] = []

      ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
        callbacks.onVideoChunk(chunk)
        if (!firstChunkReceived) {
          firstChunkReceived = true
          clearTimeout(startupTimeout)
          resolveStartup()
        }
      })

      ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
        ffmpegStderrChunks.push(chunk)
      })

      const closeInput = (): void => {
        if (ffmpegProcess.stdin.destroyed) return
        ffmpegProcess.stdin.end()
      }

      deviceSocket.on('data', (chunk: Buffer) => {
        if (!ffmpegProcess.stdin.destroyed) {
          ffmpegProcess.stdin.write(chunk)
        }
      })

      deviceSocket.on('end', closeInput)
      deviceSocket.on('close', closeInput)
      deviceSocket.on('error', (error) => {
        clearTimeout(startupTimeout)
        rejectStartup(error)
        void finishWithError(error)
      })

      ffmpegProcess.on('error', (error) => {
        clearTimeout(startupTimeout)
        rejectStartup(error)
        void finishWithError(error)
      })

      ffmpegProcess.on('close', (code) => {
        if (capture.stopRequested) {
          return
        }

        const stderr = Buffer.concat(ffmpegStderrChunks).toString('utf8').trim()
        const message = stderr || `Android preview remuxer exited unexpectedly (code ${code ?? 'unknown'}).`
        clearTimeout(startupTimeout)
        rejectStartup(new Error(message))
        void finishWithError(new Error(message))
      })

      await startupPromise
    } catch (error) {
      clearTimeout(startupTimeout)
      await this.stopSession(session).catch(() => null)
      throw error
    }
  }

  async sendInput(session: NativePreviewSessionRecord, input: NativePreviewInputPayload): Promise<void> {
    if (input.type !== 'tap') return
    if (!session.device || typeof input.x !== 'number' || typeof input.y !== 'number') return
    await this.deviceManager.sendTap(session.device, input.x, input.y)
  }

  async getLatestFrame(): Promise<null> {
    return null
  }

  async captureScreenshot(): Promise<string | null> {
    return null
  }

  async runAutomation(session: NativePreviewSessionRecord, input: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult> {
    return this.maestroService.run(session, input)
  }

  async openDevice(options: { deviceId?: string }): Promise<void> {
    await this.deviceManager.openDevice(options.deviceId)
  }

  private async launchExpoPreview(options: {
    device: NativePreviewDeviceDescriptor
    devServerPort?: number
    preferCliShortcut?: boolean
    terminalId?: string
  }): Promise<void> {
    const serial = options.device.runtimeId
    let launchError: string | null = null

    if (options.preferCliShortcut && options.terminalId) {
      await this.waitForExpoPrompt(options.terminalId, 'a')
      const sent = await TerminalService.getInstance().sendInput(options.terminalId, 'a')
      if (sent) {
        return
      }
    }

    if (serial && options.devServerPort) {
      try {
        await this.deviceManager.reversePort(serial, options.devServerPort)
        await this.deviceManager.openUrl(serial, `exp://127.0.0.1:${options.devServerPort}`)
        return
      } catch (error) {
        launchError = error instanceof Error ? error.message : String(error)
      }
    }

    if (options.terminalId) {
      await this.waitForExpoPrompt(options.terminalId, 'a')
      const sent = await TerminalService.getInstance().sendInput(options.terminalId, 'a')
      if (sent) {
        return
      }
    }

    throw new Error(launchError ?? 'Unable to launch the Expo app on the Android Emulator.')
  }

  private async launchReactNativePreview(projectPath: string, serial?: string): Promise<void> {
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const args = ['react-native', 'run-android', ...(serial ? ['--deviceId', serial] : [])]
    await runForegroundCommand({
      cwd: projectPath,
      command: npxCommand,
      args,
    })
  }

  private async waitForExpoPrompt(terminalId: string, shortcut: 'a' | 'i'): Promise<void> {
    const expectedPrompt = shortcut === 'a' ? 'Press a' : 'Press i'
    const fallbackPrompt = shortcut === 'a' ? 'open Android' : 'open iOS simulator'
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

  private async resolveScrcpyInstallation(): Promise<ScrcpyInstallation> {
    if (!this.scrcpyInstallationPromise) {
      this.scrcpyInstallationPromise = this.resolveScrcpyInstallationInternal()
    }

    return this.scrcpyInstallationPromise
  }

  private async resolveScrcpyInstallationInternal(): Promise<ScrcpyInstallation> {
    const scrcpyBinary = await this.resolveScrcpyExecutable()
    const { stdout } = await execFileAsync(scrcpyBinary, ['--version'])
    const versionLine = stdout.split(/\r?\n/)[0] ?? ''
    const versionMatch = versionLine.match(/scrcpy\s+([0-9][^\s<]*)/i)
    const version = versionMatch?.[1]
    if (!version) {
      throw new Error('Unable to determine the installed scrcpy version.')
    }

    const resolvedBinaryPath = await realpath(scrcpyBinary)
    const serverPath = path.resolve(resolvedBinaryPath, '..', '..', 'share', 'scrcpy', 'scrcpy-server')

    await access(serverPath)

    return {
      serverPath,
      version,
    }
  }

  private async resolveScrcpyExecutable(): Promise<string> {
    const fromPath = await this.lookupPathCommand('scrcpy')
    if (fromPath) {
      return fromPath
    }

    const candidates = process.platform === 'win32'
      ? []
      : [
          '/usr/local/bin/scrcpy',
          '/opt/homebrew/bin/scrcpy',
        ]

    for (const candidate of candidates) {
      try {
        await access(candidate)
        return candidate
      } catch {
        // Try the next candidate.
      }
    }

    throw new Error('scrcpy binary not found. Install scrcpy or add it to PATH before starting Android preview.')
  }

  private async lookupPathCommand(command: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command])
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    } catch {
      return null
    }
  }
}
