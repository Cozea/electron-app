import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import type {
  NativePreviewActionResult,
  NativePreviewCaptureScreenshotRequest,
  NativePreviewCaptureScreenshotResult,
  NativePreviewRotation,
  NativePreviewRotateRequest,
  NativePreviewSendButtonRequest,
  NativePreviewSendKeyRequest,
  NativePreviewSendTouchesRequest,
  NativePreviewSendWheelRequest,
  NativePreviewSessionLocator,
  NativePreviewSessionState,
  NativePreviewStartSessionRequest,
  NativePreviewStartSessionResult,
  NativePreviewStateChangedEvent,
  NativePreviewStopSessionRequest,
  NativePreviewStopSessionResult,
} from '../../../../../shared/nativePreviewTypes'
import { buildNativePreviewSessionKey } from '../../../../../shared/nativePreviewTypes'
import { resolveAuthorizedWorkspaceAccess } from '../../workspaces/authorization.ts'
import { NativePreviewRuntimeBridgeService } from './NativePreviewRuntimeBridgeService'

type NativePreviewStateListener = (event: NativePreviewStateChangedEvent) => void

type PendingCommandResult =
  | { type: 'ack' }
  | { type: 'error'; message: string }
  | { type: 'screenshot_ready'; filePath: string }

interface PendingCommand {
  resolve: (result: PendingCommandResult) => void
  timeout: NodeJS.Timeout
}

interface ManagedNativePreviewSession {
  process: ChildProcessWithoutNullStreams
  state: NativePreviewSessionState
  nextCommandId: number
  pendingCommands: Map<string, PendingCommand>
  keyboardSetupTimer: NodeJS.Timeout | null
  runtimeBridgeUnsubscribe: (() => void) | null
  startup:
    | {
        resolve: () => void
        reject: (error: Error) => void
        settled: boolean
        timeout: NodeJS.Timeout
      }
    | null
  stopping: boolean
}

const HELPER_START_TIMEOUT_MS = 15_000
const COMMAND_TIMEOUT_MS = 5_000
const STOP_TIMEOUT_MS = 1_500
const HELPER_EXECUTABLE_NAME =
  process.platform === 'win32' ? 'cozea-ios-preview-helper.exe' : 'cozea-ios-preview-helper'
const SWIFT_HELPER_EXECUTABLE_NAME =
  process.platform === 'win32' ? 'cozea-ios-preview-helper-swift.exe' : 'cozea-ios-preview-helper-swift'

function resolveAppRoot(): string {
  if (process.env.APP_ROOT) {
    return path.resolve(process.env.APP_ROOT)
  }

  return path.resolve(__dirname, '../../..')
}

function resolveHelperRoot(): string {
  return path.join(resolveAppRoot(), 'native', 'ios-preview-helper')
}

function resolveSwiftHelperRoot(): string {
  return path.join(resolveAppRoot(), 'native', 'ios-preview-helper-swift')
}

function resolveHelperExecutableCandidates(): string[] {
  const helperRoot = resolveHelperRoot()
  const swiftHelperRoot = resolveSwiftHelperRoot()

  return [
    process.env.COZEA_IOS_PREVIEW_HELPER_PATH || '',
    path.join(swiftHelperRoot, '.build', SWIFT_HELPER_EXECUTABLE_NAME),
    path.join(helperRoot, 'target', 'debug', HELPER_EXECUTABLE_NAME),
    path.join(helperRoot, 'target', 'release', HELPER_EXECUTABLE_NAME),
  ].filter(Boolean)
}

function canUseCargo(): boolean {
  const result = spawnSync('cargo', ['--version'], {
    stdio: 'ignore',
  })

  return result.status === 0
}

function canUseSwiftc(): boolean {
  const result = spawnSync('xcrun', ['swiftc', '--version'], {
    stdio: 'ignore',
  })

  return result.status === 0
}

function ensureIosSimulatorBooted(deviceId: string): { success: true } | { success: false; error: string } {
  const openResult = spawnSync(
    'open',
    ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId],
    {
      stdio: 'ignore',
    }
  )
  if (openResult.status !== 0) {
    return {
      success: false,
      error: 'Failed to open Simulator.app for native preview.',
    }
  }

  const bootResult = spawnSync('xcrun', ['simctl', 'boot', deviceId], {
    stdio: 'ignore',
  })

  const bootStatusResult = spawnSync('xcrun', ['simctl', 'bootstatus', deviceId, '-b'], {
    stdio: 'ignore',
  })
  if (bootStatusResult.status !== 0) {
    return {
      success: false,
      error:
        bootResult.status !== 0
          ? `Failed to boot iOS simulator ${deviceId}.`
          : `Timed out waiting for iOS simulator ${deviceId} boot completion.`,
    }
  }

  return { success: true }
}

function ensureSwiftHelperBuilt(): { success: true; executablePath: string } | { success: false; error: string } {
  const helperRoot = resolveSwiftHelperRoot()
  const sourcePath = path.join(helperRoot, 'main.swift')
  const buildDir = path.join(helperRoot, '.build')
  const executablePath = path.join(buildDir, SWIFT_HELPER_EXECUTABLE_NAME)

  if (!fs.existsSync(sourcePath)) {
    return {
      success: false,
      error: 'Swift iOS preview helper source is missing.',
    }
  }

  const executableExists = fs.existsSync(executablePath)
  if (executableExists) {
    const sourceStat = fs.statSync(sourcePath)
    const executableStat = fs.statSync(executablePath)
    if (executableStat.mtimeMs >= sourceStat.mtimeMs) {
      return { success: true, executablePath }
    }
  }

  fs.mkdirSync(buildDir, { recursive: true })
  const result = spawnSync('xcrun', ['swiftc', sourcePath, '-o', executablePath], {
    cwd: helperRoot,
    env: process.env,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    return {
      success: false,
      error: normalizeHelperMessage(result.stderr || result.stdout || 'Failed to build Swift iOS preview helper.'),
    }
  }

  return { success: true, executablePath }
}

function encodeTouchPayload(request: NativePreviewSendTouchesRequest): string {
  const touches = request.touches
    .map((touch) => `${touch.xRatio},${touch.yRatio}`)
    .join(' ')
  return `${request.type} ${touches}`.trim()
}

function encodeWheelPayload(request: NativePreviewSendWheelRequest): string {
  return `${request.point.xRatio},${request.point.yRatio} --dx ${request.deltaX} --dy ${request.deltaY}`
}

function buildStartingState(request: NativePreviewStartSessionRequest): NativePreviewSessionState {
  return {
    sessionKey: buildNativePreviewSessionKey(request),
    workspaceId: request.workspaceId,
    deviceId: request.deviceId,
    platform: request.platform,
    deviceSetPath: request.deviceSetPath ?? null,
    helperPid: null,
    status: 'starting',
    streamUrl: null,
    appReady: false,
    appKey: null,
    rotation: 'Portrait',
    lastError: null,
    updatedAt: Date.now(),
  }
}

function normalizeHelperMessage(message: string): string {
  return message.trim() || 'Unknown native preview helper error'
}

export class NativePreviewManager {
  private static instance: NativePreviewManager | null = null

  public static getInstance(): NativePreviewManager {
    if (!NativePreviewManager.instance) {
      NativePreviewManager.instance = new NativePreviewManager()
    }
    return NativePreviewManager.instance
  }

  private readonly listeners = new Set<NativePreviewStateListener>()
  private readonly sessionStates = new Map<string, NativePreviewSessionState>()
  private readonly sessions = new Map<string, ManagedNativePreviewSession>()

  public subscribe(listener: NativePreviewStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSessionState(locator: NativePreviewSessionLocator): NativePreviewSessionState | null {
    return this.sessionStates.get(buildNativePreviewSessionKey(locator)) ?? null
  }

  public async startSession(
    request: NativePreviewStartSessionRequest
  ): Promise<NativePreviewStartSessionResult> {
    const sessionKey = buildNativePreviewSessionKey(request)

    let projectRootPath: string
    try {
      ;({ projectRootPath } = await resolveAuthorizedWorkspaceAccess({
        workspaceId: request.workspaceId,
        operation: 'read-file',
      }))
    } catch (error) {
      const state: NativePreviewSessionState = {
        ...buildStartingState(request),
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to resolve native preview workspace.',
      }
      this.sessionStates.set(sessionKey, state)
      this.emit({ sessionKey, state })

      return {
        success: false,
        error: state.lastError ?? 'Failed to resolve native preview workspace.',
        state,
      }
    }

    const existingSession = this.sessions.get(sessionKey)

    if (existingSession) {
      await this.stopSession(request)
    }

    const spawnResult = this.spawnHelper(request)
    if (!spawnResult.success) {
      const state: NativePreviewSessionState = {
        ...buildStartingState(request),
        status: 'error',
        lastError: spawnResult.error,
      }
      this.sessionStates.set(sessionKey, state)
      this.emit({ sessionKey, state })

      return {
        success: false,
        error: spawnResult.error,
        state,
      }
    }

    const startingState = buildStartingState(request)
    const startup = this.createStartupGate(sessionKey, startingState)
    const session: ManagedNativePreviewSession = {
      process: spawnResult.process,
      state: startingState,
      nextCommandId: 1,
      pendingCommands: new Map(),
      keyboardSetupTimer: null,
      runtimeBridgeUnsubscribe: null,
      startup,
      stopping: false,
    }

    this.sessions.set(sessionKey, session)
    this.sessionStates.set(sessionKey, startingState)
    this.emit({ sessionKey, state: startingState })
    this.attachProcess(sessionKey, session)
    void this.attachRuntimeBridge(sessionKey, projectRootPath)

    try {
      await new Promise<void>((resolve, reject) => {
        if (!session.startup) {
          resolve()
          return
        }
        session.startup.resolve = () => {
          session.startup!.settled = true
          clearTimeout(session.startup!.timeout)
          resolve()
        }
        session.startup.reject = (error) => {
          session.startup!.settled = true
          clearTimeout(session.startup!.timeout)
          reject(error)
        }
      })

      const finalState = this.sessionStates.get(sessionKey) ?? session.state
      return {
        success: true,
        state: finalState,
      }
    } catch (error) {
      const finalState = this.sessionStates.get(sessionKey) ?? session.state
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Native preview helper failed to start',
        state: finalState,
      }
    }
  }

  public async stopSession(
    request: NativePreviewStopSessionRequest
  ): Promise<NativePreviewStopSessionResult> {
    const sessionKey = buildNativePreviewSessionKey(request)
    const session = this.sessions.get(sessionKey)

    if (!session) {
      this.sessionStates.delete(sessionKey)
      this.emit({ sessionKey, state: null })
      return { success: true }
    }

    session.stopping = true
    this.updateState(sessionKey, {
      status: 'stopping',
      lastError: null,
    })

    try {
      await this.sendCommand(sessionKey, 'shutdown', '')
    } catch {
      // Best effort. We still terminate below.
    }

    await new Promise<void>((resolve) => {
      let settled = false
      let forceTimer: NodeJS.Timeout | null = null

      const finish = () => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(graceTimer)
        if (forceTimer) {
          clearTimeout(forceTimer)
        }
        if (session.keyboardSetupTimer) {
          clearTimeout(session.keyboardSetupTimer)
          session.keyboardSetupTimer = null
        }
        if (session.runtimeBridgeUnsubscribe) {
          session.runtimeBridgeUnsubscribe()
          session.runtimeBridgeUnsubscribe = null
        }
        session.process.removeListener('exit', handleExit)
        this.teardownSession(sessionKey)
        resolve()
      }

      const handleExit = () => {
        finish()
      }

      const graceTimer = setTimeout(() => {
        if (!session.process.killed) {
          session.process.kill('SIGTERM')
        }

        forceTimer = setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill('SIGKILL')
          }
          finish()
        }, STOP_TIMEOUT_MS)
      }, STOP_TIMEOUT_MS)

      session.process.once('exit', handleExit)
    })

    return { success: true }
  }

  public async sendTouches(
    request: NativePreviewSendTouchesRequest
  ): Promise<NativePreviewActionResult> {
    return this.executeRuntimeAction(request, `touch ${encodeTouchPayload(request)}`)
  }

  public async sendWheel(
    request: NativePreviewSendWheelRequest
  ): Promise<NativePreviewActionResult> {
    return this.executeRuntimeAction(request, `wheel ${encodeWheelPayload(request)}`)
  }

  public async sendKey(request: NativePreviewSendKeyRequest): Promise<NativePreviewActionResult> {
    return this.executeRuntimeAction(request, `key ${request.direction} ${request.keyCode}`)
  }

  public async sendButton(
    request: NativePreviewSendButtonRequest
  ): Promise<NativePreviewActionResult> {
    return this.executeRuntimeAction(request, `button ${request.direction} ${request.button}`)
  }

  public async rotate(request: NativePreviewRotateRequest): Promise<NativePreviewActionResult> {
    const result = await this.executeRuntimeAction(request, `rotate ${request.rotation}`)
    if (result.success) {
      this.updateState(buildNativePreviewSessionKey(request), {
        rotation: request.rotation,
      })
    }
    return result
  }

  public async captureScreenshot(
    request: NativePreviewCaptureScreenshotRequest
  ): Promise<NativePreviewCaptureScreenshotResult> {
    const sessionKey = buildNativePreviewSessionKey(request)
    const rotation = this.getSessionRotation(sessionKey)
    try {
      const result = await this.sendCommand(sessionKey, 'screenshot', `-r ${rotation}`)
      if (result.type === 'screenshot_ready') {
        if (request.copyToClipboard) {
          const copyResult = await this.executeRuntimeAction(request, `copy_screenshot -r ${rotation}`)
          if (!copyResult.success) {
            return {
              success: false,
              error: copyResult.error,
              filePath: result.filePath,
            }
          }
        }
        return {
          success: true,
          filePath: result.filePath,
        }
      }
      if (result.type === 'ack') {
        return {
          success: false,
          error: 'Native preview helper acknowledged screenshot request without a file path.',
        }
      }
      return {
        success: false,
        error: result.message,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture screenshot',
      }
    }
  }

  public async copyLastScreenshot(
    request: NativePreviewCaptureScreenshotRequest
  ): Promise<NativePreviewActionResult> {
    const rotation = this.getSessionRotation(buildNativePreviewSessionKey(request))
    return this.executeRuntimeAction(request, `copy_screenshot -r ${rotation}`)
  }

  private createStartupGate(
    sessionKey: string,
    startingState: NativePreviewSessionState
  ): ManagedNativePreviewSession['startup'] {
    const startup = {
      resolve: () => undefined,
      reject: () => undefined,
      settled: false,
      timeout: setTimeout(() => {
        const session = this.sessions.get(sessionKey)
        if (!session || !session.startup || session.startup.settled) {
          return
        }

        const error = new Error('Timed out waiting for native preview helper readiness.')
        this.failStartup(sessionKey, startingState, error.message)
        session.process.kill('SIGTERM')
      }, HELPER_START_TIMEOUT_MS),
    }

    return startup
  }

  private spawnHelper(
    request: NativePreviewStartSessionRequest
  ): { success: true; process: ChildProcessWithoutNullStreams } | { success: false; error: string } {
    const helperRoot = resolveHelperRoot()
    const swiftHelperRoot = resolveSwiftHelperRoot()
    const baseArgs = ['ios', '--udid', request.deviceId]
    if (request.deviceSetPath) {
      baseArgs.push('--device-set-path', request.deviceSetPath)
    }

    if (process.platform === 'darwin') {
      const bootResult = ensureIosSimulatorBooted(request.deviceId)
      if (!bootResult.success) {
        return bootResult
      }
    }

    if (process.platform === 'darwin') {
      const swiftBuild = ensureSwiftHelperBuilt()
      if (swiftBuild.success) {
        return {
          success: true,
          process: spawn(swiftBuild.executablePath, baseArgs, {
            cwd: swiftHelperRoot,
            env: process.env,
            stdio: 'pipe',
          }),
        }
      }
    }

    const executableCandidate = resolveHelperExecutableCandidates().find((candidate) => {
      return candidate.length > 0 && fs.existsSync(candidate)
    })

    if (executableCandidate) {
      return {
        success: true,
        process: spawn(executableCandidate, baseArgs, {
          cwd: helperRoot,
          env: process.env,
          stdio: 'pipe',
        }),
      }
    }

    if (canUseCargo()) {
      return {
        success: true,
        process: spawn(
          'cargo',
          ['run', '--manifest-path', path.join(helperRoot, 'Cargo.toml'), '--quiet', '--', ...baseArgs],
          {
            cwd: helperRoot,
            env: process.env,
            stdio: 'pipe',
          }
        ),
      }
    }

    if (process.platform === 'darwin' && canUseSwiftc()) {
      const swiftBuild = ensureSwiftHelperBuilt()
      if (swiftBuild.success) {
        return {
          success: true,
          process: spawn(swiftBuild.executablePath, baseArgs, {
            cwd: swiftHelperRoot,
            env: process.env,
            stdio: 'pipe',
          }),
        }
      }

      return {
        success: false,
        error: swiftBuild.error,
      }
    }

    return {
      success: false,
      error:
        'iOS preview helper binary is not available. Build native/ios-preview-helper or install cargo for dev fallback.',
    }
  }

  private attachProcess(sessionKey: string, session: ManagedNativePreviewSession): void {
    const stdoutReader = createInterface({ input: session.process.stdout })
    stdoutReader.on('line', (line) => {
      this.handleStdoutLine(sessionKey, line)
    })

    const stderrReader = createInterface({ input: session.process.stderr })
    stderrReader.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }
      this.updateState(sessionKey, {
        lastError: trimmed,
      })
    })

    session.process.once('error', (error) => {
      this.handleProcessFailure(sessionKey, normalizeHelperMessage(error.message))
    })

    session.process.once('exit', (code, signal) => {
      const activeSession = this.sessions.get(sessionKey)
      if (!activeSession) {
        return
      }

      if (activeSession.startup && !activeSession.startup.settled) {
        this.failStartup(
          sessionKey,
          activeSession.state,
          `Native preview helper exited before readiness (code=${code ?? 'null'} signal=${signal ?? 'null'}).`
        )
      } else if (!activeSession.stopping) {
        this.updateState(sessionKey, {
          status: 'error',
          lastError: `Native preview helper exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'}).`,
        })
      }

      this.teardownSession(sessionKey)
    })
  }

  private handleStdoutLine(sessionKey: string, line: string): void {
    const session = this.sessions.get(sessionKey)
    if (!session) {
      return
    }

    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const firstSpace = trimmed.indexOf(' ')
    const event = firstSpace >= 0 ? trimmed.slice(0, firstSpace) : trimmed
    const rest = firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : ''

    switch (event) {
      case 'ready': {
        this.updateState(sessionKey, {
          helperPid: session.process.pid ?? null,
          appReady: false,
          appKey: null,
          lastError: null,
        })
        if (session.startup && !session.startup.settled) {
          session.startup.resolve()
        }
        break
      }
      case 'stream_ready': {
        this.updateState(sessionKey, {
          status: 'running',
          streamUrl: rest || null,
          lastError: null,
        })
        break
      }
      case 'ack': {
        const pending = session.pendingCommands.get(rest)
        if (!pending) {
          break
        }
        clearTimeout(pending.timeout)
        session.pendingCommands.delete(rest)
        pending.resolve({ type: 'ack' })
        break
      }
      case 'error': {
        const [requestId, ...messageParts] = rest.split(' ')
        const message = normalizeHelperMessage(messageParts.join(' '))
        if (requestId === 'protocol') {
          this.updateState(sessionKey, { lastError: message })
          break
        }
        const pending = session.pendingCommands.get(requestId)
        if (!pending) {
          this.updateState(sessionKey, { lastError: message })
          break
        }
        clearTimeout(pending.timeout)
        session.pendingCommands.delete(requestId)
        pending.resolve({ type: 'error', message })
        break
      }
      case 'screenshot_ready': {
        const [requestId, ...pathParts] = rest.split(' ')
        const filePath = pathParts.join(' ').trim()
        const pending = session.pendingCommands.get(requestId)
        if (!pending) {
          break
        }
        clearTimeout(pending.timeout)
        session.pendingCommands.delete(requestId)
        pending.resolve({ type: 'screenshot_ready', filePath })
        break
      }
      case 'info':
        break
      case 'stopped':
        if (!session.stopping) {
          this.updateState(sessionKey, {
            status: 'stopped',
          })
        }
        break
      case 'fatal':
        this.handleProcessFailure(sessionKey, normalizeHelperMessage(rest))
        break
      default:
        this.updateState(sessionKey, {
          lastError: `Unrecognized helper event: ${trimmed}`,
        })
        break
    }
  }

  private async executeRuntimeAction(
    locator: NativePreviewSessionLocator,
    line: string
  ): Promise<NativePreviewActionResult> {
    try {
      await this.sendRuntimeCommand(buildNativePreviewSessionKey(locator), line)
      return {
        success: true,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `Failed to send native preview runtime command: ${line}`,
      }
    }
  }

  private getSessionRotation(sessionKey: string): NativePreviewRotation {
    return this.sessionStates.get(sessionKey)?.rotation ?? 'Portrait'
  }

  private async sendRuntimeCommand(sessionKey: string, line: string): Promise<void> {
    const session = this.sessions.get(sessionKey)
    if (!session) {
      throw new Error('Native preview session is not running.')
    }

    if (session.state.status !== 'running') {
      throw new Error('Native preview helper is not ready yet.')
    }

    await new Promise<void>((resolve, reject) => {
      session.process.stdin.write(`${line}\n`, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  private async sendCommand(
    sessionKey: string,
    command: string,
    payload: string
  ): Promise<PendingCommandResult> {
    const session = this.sessions.get(sessionKey)
    if (!session) {
      throw new Error('Native preview session is not running.')
    }

    if (session.state.status !== 'running' && command !== 'shutdown') {
      throw new Error('Native preview helper is not ready yet.')
    }

    const requestId = String(session.nextCommandId++)
    const line = payload.trim().length > 0 ? `${command} ${requestId} ${payload}` : `${command} ${requestId}`

    return new Promise<PendingCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pendingCommands.delete(requestId)
        reject(new Error(`Timed out waiting for native preview helper response to ${command}.`))
      }, COMMAND_TIMEOUT_MS)

      session.pendingCommands.set(requestId, {
        resolve,
        timeout,
      })

      session.process.stdin.write(`${line}\n`, (error) => {
        if (!error) {
          return
        }
        clearTimeout(timeout)
        session.pendingCommands.delete(requestId)
        reject(error)
      })
    })
  }

  private handleProcessFailure(sessionKey: string, message: string): void {
    const session = this.sessions.get(sessionKey)
    if (!session) {
      return
    }

    if (session.startup && !session.startup.settled) {
      this.failStartup(sessionKey, session.state, message)
      return
    }

    this.updateState(sessionKey, {
      status: 'error',
      lastError: message,
    })
  }

  private failStartup(
    sessionKey: string,
    fallbackState: NativePreviewSessionState,
    error: string
  ): void {
    const session = this.sessions.get(sessionKey)
    if (!session?.startup || session.startup.settled) {
      return
    }

    const errorState: NativePreviewSessionState = {
      ...fallbackState,
      status: 'error',
      lastError: error,
      updatedAt: Date.now(),
    }
    this.sessionStates.set(sessionKey, errorState)
    session.state = errorState
    this.emit({ sessionKey, state: errorState })
    session.startup.reject(new Error(error))
  }

  private updateState(
    sessionKey: string,
    patch: Partial<Omit<NativePreviewSessionState, 'sessionKey' | 'workspaceId' | 'deviceId' | 'platform'>>
  ): void {
    const currentState = this.sessionStates.get(sessionKey)
    if (!currentState) {
      return
    }

    const nextState: NativePreviewSessionState = {
      ...currentState,
      ...patch,
      updatedAt: Date.now(),
    }

    this.sessionStates.set(sessionKey, nextState)
    const session = this.sessions.get(sessionKey)
    if (session) {
      session.state = nextState
    }
    this.emit({ sessionKey, state: nextState })
  }

  private teardownSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey)
    const state = this.sessionStates.get(sessionKey)
    if (!session && !state) {
      return
    }

    if (session) {
      if (session.runtimeBridgeUnsubscribe) {
        session.runtimeBridgeUnsubscribe()
        session.runtimeBridgeUnsubscribe = null
      }
      if (session.startup && !session.startup.settled) {
        clearTimeout(session.startup.timeout)
      }
      for (const [requestId, pending] of session.pendingCommands.entries()) {
        clearTimeout(pending.timeout)
        pending.resolve({
          type: 'error',
          message: 'Native preview session ended before the command completed.',
        })
        session.pendingCommands.delete(requestId)
      }
    }

    this.sessions.delete(sessionKey)
    this.sessionStates.delete(sessionKey)
    this.emit({ sessionKey, state: null })
  }

  private emit(event: NativePreviewStateChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private async attachRuntimeBridge(sessionKey: string, projectPath: string): Promise<void> {
    const session = this.sessions.get(sessionKey)
    if (!session) {
      return
    }

    try {
      const bridge = await this.getRuntimeBridge(projectPath)
      const unsubscribe = bridge.onEnvelope((envelope) => {
        this.handleRuntimeEnvelope(sessionKey, envelope)
      })

      const activeSession = this.sessions.get(sessionKey)
      if (!activeSession) {
        unsubscribe()
        return
      }

      if (activeSession.runtimeBridgeUnsubscribe) {
        activeSession.runtimeBridgeUnsubscribe()
      }
      activeSession.runtimeBridgeUnsubscribe = unsubscribe
    } catch {
      // Keep helper-driven preview working even if the runtime bridge is unavailable.
    }
  }

  private async getRuntimeBridge(projectPath: string) {
    return NativePreviewRuntimeBridgeService.getInstance().getBridge(projectPath)
  }

  private handleRuntimeEnvelope(
    sessionKey: string,
    envelope: { event: string; payload?: unknown }
  ): void {
    if (envelope.event !== 'RNIDE_message') {
      return
    }

    const payload = envelope.payload as
      | {
          type?: string
          data?: {
            appKey?: unknown
          }
        }
      | undefined

    if (payload?.type !== 'appReady') {
      return
    }

    const currentState = this.sessionStates.get(sessionKey)
    if (!currentState || currentState.status === 'stopped' || currentState.status === 'error') {
      return
    }

    this.updateState(sessionKey, {
      appReady: true,
      appKey: typeof payload.data?.appKey === 'string' ? payload.data.appKey : null,
      lastError: null,
    })
  }
}
