import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import * as pty from 'node-pty'
import { systemPreferences } from 'electron'

import type {
  NativePreviewBuildMode,
  NativePreviewCaptureScreenshotResult,
  NativePreviewGetSessionStateResult,
  NativePreviewListDevicesResult,
  NativePreviewListSessionsResult,
  NativePreviewOpenDeviceResult,
  NativePreviewPlatform,
  NativePreviewRunAutomationInput,
  NativePreviewRunAutomationResult,
  NativePreviewStartSessionInput,
  NativePreviewStartSessionResult,
  NativePreviewStopSessionResult,
  RadonCommandError,
  RadonDeviceCommand,
  RadonDeviceCommandResult,
  RadonFeatureName,
  RadonRuntimeEvent,
  RadonLicenseState,
  RadonLogEvent,
  RadonProjectCapabilities,
  RadonRotation,
  RadonSession,
  RadonSessionCapabilities,
  RadonToolDescriptor,
  RadonToolsUpdatedEvent,
} from '../../shared/electronApiTypes'
import { resolveRadonSimulatorBinaryPath } from '../lib/radonPaths'
import { AndroidDeviceManager, IOSDeviceManager } from './radon/deviceManagers'
import { getManagedIosDeviceSetPath, getManagedAndroidDeviceSetPath } from './radon/devicePaths'
import {
  DEFAULT_RADON_FEATURES,
  isRadonFeatureAvailable,
  resolveRadonFeatures,
} from './radon/features'
import {
  buildButtonCommand,
  buildCaptureReplayCommand,
  buildScreenshotCommand,
  buildStartRecordingCommand,
  buildStopRecordingCommand,
  buildTouchCommand,
  nextRotation,
  parseSimulatorServerEvent,
  type SimulatorServerEvent,
} from './radon/protocol'
import { RadonRuntimeBridgeServer, type RadonRuntimeEnvelope } from './radon/runtimeBridge'

const execFileAsync = promisify(execFile)

type SessionProcessDeviceType = 'ios' | 'android' | 'android_device'

interface RadonSessionRecord extends RadonSession {
  buildMode: NativePreviewBuildMode
  terminalId?: string
  devServerPort?: number
  deviceType: SessionProcessDeviceType
}

interface PendingMediaRequest {
  resolve: (event: SimulatorServerEvent) => void
  reject: (error: Error) => void
  successTypes: Set<SimulatorServerEvent['type']>
  errorTypes: Set<SimulatorServerEvent['type']>
}

interface SessionController {
  process: pty.IPty
  deviceType: SessionProcessDeviceType
  rotation: RadonRotation
  stopRequested: boolean
  started: boolean
  pending: Map<string, PendingMediaRequest>
  stdoutBuffer: string
  startupResolve?: () => void
  startupReject?: (error: Error) => void
  startupTimer?: NodeJS.Timeout
}

interface PackageJsonLike {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

interface RuntimeInspectTarget {
  x?: unknown
  y?: unknown
  requestStack?: unknown
}

interface RuntimeToolDefinition {
  id: string
  title: string
  feature?: RadonFeatureName
  dependencyNames?: string[]
  runtimePlugins?: string[]
}

const RADON_TOOL_DEFINITIONS: RuntimeToolDefinition[] = [
  {
    id: 'network',
    title: 'Network',
    feature: 'NetworkInspection',
    runtimePlugins: ['network'],
  },
  {
    id: 'redux',
    title: 'Redux',
    feature: 'ReduxDevTools',
    dependencyNames: ['redux', '@reduxjs/toolkit'],
    runtimePlugins: ['redux-devtools'],
  },
  {
    id: 'react-query',
    title: 'React Query',
    feature: 'ReactQueryDevTools',
    dependencyNames: ['@tanstack/react-query', 'react-query'],
    runtimePlugins: ['react-query'],
  },
  {
    id: 'apollo-client',
    title: 'Apollo Client',
    dependencyNames: ['@apollo/client'],
    runtimePlugins: ['apollo-client-devtools'],
  },
  {
    id: 'mmkv',
    title: 'MMKV',
    dependencyNames: ['react-native-mmkv', '@dev-plugins/react-native-mmkv'],
    runtimePlugins: ['@dev-plugins/react-native-mmkv'],
  },
]

export class RadonHostService {
  private static instance: RadonHostService

  private readonly iosManager = new IOSDeviceManager()
  private readonly androidManager = new AndroidDeviceManager()

  private readonly sessions = new Map<string, RadonSessionRecord>()
  private readonly sessionControllers = new Map<string, SessionController>()
  private readonly sessionKeyToId = new Map<string, string>()
  private readonly focusedSessionByProject = new Map<string, string>()

  private readonly sessionListeners = new Set<(session: RadonSession) => void>()
  private readonly licenseListeners = new Set<(state: RadonLicenseState) => void>()
  private readonly runtimeListeners = new Set<(event: RadonRuntimeEvent) => void>()
  private readonly toolsListeners = new Set<(event: RadonToolsUpdatedEvent) => void>()
  private readonly logListeners = new Set<(event: RadonLogEvent) => void>()
  private readonly runtimeBridges = new Map<string, RadonRuntimeBridgeServer>()
  private readonly runtimePluginsByProject = new Map<string, string[]>()
  private readonly pendingInspectRequests = new Map<number, {
    sessionId: string
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private nextInspectRequestId = 1

  private cachedLicenseState: RadonLicenseState = {
    status: 'missing',
    tokenPresent: false,
    tokenVerified: false,
    features: { ...DEFAULT_RADON_FEATURES },
    missingFeatures: Object.keys(DEFAULT_RADON_FEATURES)
      .filter((feature) => DEFAULT_RADON_FEATURES[feature as RadonFeatureName] !== 'AVAILABLE') as RadonFeatureName[],
  }

  private cachedToken: string | null = null

  static getInstance(): RadonHostService {
    if (!RadonHostService.instance) {
      RadonHostService.instance = new RadonHostService()
    }
    return RadonHostService.instance
  }

  onSessionUpdated(callback: (session: RadonSession) => void): () => void {
    this.sessionListeners.add(callback)
    return () => this.sessionListeners.delete(callback)
  }

  onLicenseChanged(callback: (state: RadonLicenseState) => void): () => void {
    this.licenseListeners.add(callback)
    return () => this.licenseListeners.delete(callback)
  }

  onRuntimeEvent(callback: (event: RadonRuntimeEvent) => void): () => void {
    this.runtimeListeners.add(callback)
    return () => this.runtimeListeners.delete(callback)
  }

  onToolsUpdated(callback: (event: RadonToolsUpdatedEvent) => void): () => void {
    this.toolsListeners.add(callback)
    return () => this.toolsListeners.delete(callback)
  }

  onLogEvent(callback: (event: RadonLogEvent) => void): () => void {
    this.logListeners.add(callback)
    return () => this.logListeners.delete(callback)
  }

  async getLicenseState(): Promise<RadonLicenseState> {
    if (!this.cachedToken) {
      return this.cachedLicenseState
    }

    this.cachedLicenseState = await this.verifyLicenseToken(this.cachedToken)
    return this.cachedLicenseState
  }

  async activateLicense(options: { licenseKey: string; email: string }): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const binary = resolveRadonSimulatorBinaryPath()
      const { stdout } = await execFileAsync(binary, ['fingerprint'])
      const fingerprint = stdout.trim()

      const response = await fetch('https://portal.ide.swmansion.com/api/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: options.licenseKey,
          name: options.email,
          fingerprint,
        }),
      })

      const data = await response.json() as { token?: string; message?: string; code?: string }
      if (!response.ok || !data.token) {
        return {
          success: false,
          error: data.message || data.code || 'Failed to activate license key',
        }
      }

      this.cachedToken = data.token
      this.cachedLicenseState = await this.verifyLicenseToken(data.token)
      this.emitLicenseChanged()
      return {
        success: true,
        token: data.token,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async removeLicense(): Promise<{ success: boolean }> {
    this.cachedToken = null
    this.cachedLicenseState = {
      status: 'missing',
      tokenPresent: false,
      tokenVerified: false,
      features: { ...DEFAULT_RADON_FEATURES },
      missingFeatures: Object.keys(DEFAULT_RADON_FEATURES)
        .filter((feature) => DEFAULT_RADON_FEATURES[feature as RadonFeatureName] !== 'AVAILABLE') as RadonFeatureName[],
    }
    this.emitLicenseChanged()
    return { success: true }
  }

  async getProjectCapabilities(options: { projectPath: string }): Promise<RadonProjectCapabilities> {
    const pkg = await this.readPackageJson(options.projectPath)
    const scripts = pkg?.scripts ?? {}
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
    const supportsNativePreview = Boolean(deps.expo || deps['react-native'] || scripts.ios || scripts.android)
    const supportsWebPreview = Boolean(scripts.web || deps['react-native-web'])
    const supportedPlatforms: NativePreviewPlatform[] = []
    const supportedEntryModes = ['app'] as RadonProjectCapabilities['supportedEntryModes']

    if (deps.expo || deps['react-native'] || scripts.ios) {
      supportedPlatforms.push('ios')
    }
    if (deps.expo || deps['react-native'] || scripts.android) {
      supportedPlatforms.push('android')
    }

    if (deps['@storybook/react-native']) {
      supportedEntryModes.push('storybook')
    }

    if (supportsNativePreview && isRadonFeatureAvailable(this.cachedLicenseState.features, 'ComponentPreview')) {
      supportedEntryModes.push('component_preview')
    }

    return {
      supportsNativePreview,
      supportsWebPreview,
      supportedPlatforms,
      defaultPlatform: supportedPlatforms[0] ?? null,
      supportedEntryModes,
      runtimeInjectionRequired: true,
      availableTools: this.buildToolDescriptors(pkg),
    }
  }

  async ensureRuntimeBridge(projectPath: string): Promise<number> {
    return (await this.getRuntimeBridge(projectPath)).port
  }

  async listDevices(options?: { platform?: NativePreviewPlatform }): Promise<NativePreviewListDevicesResult> {
    try {
      const devices = await this.resolveDevices(options?.platform)
      return {
        success: true,
        devices,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  public dispose(): void {
    console.log('[RadonHostService] Disposing active sessions before quit...')
    for (const [sessionId, controller] of this.sessionControllers.entries()) {
      controller.stopRequested = true
      if (controller.startupTimer) clearTimeout(controller.startupTimer)
      
      const processToKill = controller.process
      try {
        processToKill.write('\x04') // Send EOF (Ctrl+D) to gracefully close stdin
      } catch {
        // ignore write errors during shutdown
      }
      processToKill.kill('SIGTERM')
      
      // Since app is quitting, give it 1 second then forcefully kill
      setTimeout(() => {
        try {
          console.log(`[RadonHostService] Force killing simulator server for session ${sessionId}`)
          processToKill.kill('SIGKILL')
        } catch {
          // already dead
        }
      }, 1000)
    }
    
    for (const bridge of this.runtimeBridges.values()) {
      bridge.dispose()
    }
    
    this.sessionControllers.clear()
    this.runtimeBridges.clear()
  }

  listSessions(): NativePreviewListSessionsResult {
    return {
      success: true,
      sessions: [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    }
  }

  async getSessionState(options: { sessionId: string }): Promise<NativePreviewGetSessionStateResult> {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    return {
      success: true,
      session,
    }
  }

  async startSession(input: NativePreviewStartSessionInput): Promise<NativePreviewStartSessionResult> {
    const device = await this.resolvePreferredDevice(input.platform, input.deviceId)
    const sessionKey = this.getSessionKey(input.projectPath, input.platform, device.id)
    const existingSessionId = this.sessionKeyToId.get(sessionKey)
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId)
      if (existing && existing.state !== 'stopped' && existing.state !== 'error') {
        await this.focusSession({ sessionId: existing.id })
        return {
          success: true,
          session: existing,
        }
      }
    }

    const token = input.radonToken?.trim() || this.cachedToken || null
    if (!token) {
      const noLicenseError = this.createCommandError('no_license', 'Radon license token is required to start native preview.')
      const failedSession = this.createSessionRecord(input, device, {
        state: 'error',
        error: noLicenseError.message,
        lastError: noLicenseError,
      })
      this.upsertSession(failedSession)
      return {
        success: false,
        session: failedSession,
        error: noLicenseError.message,
      }
    }

    this.cachedToken = token
    this.cachedLicenseState = await this.verifyLicenseToken(token)
    this.emitLicenseChanged()
    if (this.cachedLicenseState.status !== 'valid') {
      const licenseError = this.createCommandError('no_license', this.cachedLicenseState.error || 'Radon license token is not valid.')
      const failedSession = this.createSessionRecord(input, device, {
        state: 'error',
        error: licenseError.message,
        lastError: licenseError,
      })
      this.upsertSession(failedSession)
      return {
        success: false,
        session: failedSession,
        error: licenseError.message,
      }
    }

    const deviceAccessError = this.validateDeviceAccess(device)
    if (deviceAccessError) {
      const failedSession = this.createSessionRecord(input, device, {
        state: 'error',
        error: deviceAccessError.message,
        lastError: deviceAccessError,
      })
      this.upsertSession(failedSession)
      return {
        success: false,
        session: failedSession,
        error: deviceAccessError.message,
      }
    }

    const session = this.createSessionRecord(input, device, {
      state: 'booting_device',
      message: `Preparing ${device.name}...`,
      focused: true,
    })
    this.upsertSession(session)

    try {
      const bootedDevice = await this.ensureDeviceReady(input.platform, device)
      const runtimeBridgePort = await this.ensureRuntimeBridge(input.projectPath)
      if (bootedDevice.platform === 'android') {
        await this.androidManager.forwardPort(bootedDevice, runtimeBridgePort)
      }
      const updatedSession = this.updateSession(session.id, {
        device: bootedDevice,
        state: 'launching_app',
        message: `Starting preview for ${bootedDevice.name}...`,
      })
      await this.launchSessionProcess(updatedSession, token)
      this.focusedSessionByProject.set(updatedSession.projectPath, updatedSession.id)
      this.markProjectFocus(updatedSession.projectPath, updatedSession.id)

      return {
        success: true,
        session: this.sessions.get(updatedSession.id) ?? updatedSession,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedSession = this.updateSession(session.id, {
        state: 'error',
        error: message,
        message,
        lastError: this.classifyRuntimeError(message),
      })
      return {
        success: false,
        session: failedSession,
        error: message,
      }
    }
  }

  async stopSession(options: { sessionId: string }): Promise<NativePreviewStopSessionResult> {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    const controller = this.sessionControllers.get(options.sessionId)
    if (controller) {
      controller.stopRequested = true
      if (controller.startupTimer) clearTimeout(controller.startupTimer)
      
      const processToKill = controller.process
      
      try {
        processToKill.write('\x04') // Send EOF (Ctrl+D) to gracefuly close stdin
      } catch {
        // Ignore write errors during shutdown
      }
      
      try {
        processToKill.kill('SIGTERM')
      } catch {
        // ignore
      }
      
      setTimeout(() => {
        try {
          console.log(`[RadonHostService] Force killing simulator server for session ${options.sessionId}`)
          processToKill.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 3000)

      this.sessionControllers.delete(options.sessionId)
    }

    this.updateSession(options.sessionId, {
      state: 'stopped',
      message: 'Native preview stopped.',
    })
    this.cancelPendingInspectRequestsForSession(options.sessionId, 'Inspect request cancelled because the native preview session stopped.')
    return { success: true }
  }

  async focusSession(options: { sessionId: string }): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    this.focusedSessionByProject.set(session.projectPath, session.id)
    this.markProjectFocus(session.projectPath, session.id)
    return { success: true }
  }

  async openDevice(options: { platform: NativePreviewPlatform; deviceId?: string }): Promise<NativePreviewOpenDeviceResult> {
    try {
      const device = options.platform === 'ios'
        ? await this.iosManager.openDevice(options.deviceId)
        : await this.androidManager.openDevice(options.deviceId)

      this.emitLog({
        source: 'host',
        level: 'info',
        message: `Opened ${device.platform} device ${device.name}.`,
      })

      return {
        success: true,
        device,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async sendDeviceCommand(options: {
    sessionId: string
    command: RadonDeviceCommand
    payload?: Record<string, unknown>
  }): Promise<RadonDeviceCommandResult> {
    const session = this.sessions.get(options.sessionId)
    const controller = this.sessionControllers.get(options.sessionId)

    if (!session || !controller) {
      const commandError = this.createCommandError('stream_lost', 'Native preview session is not running.')
      return {
        success: false,
        error: commandError.message,
        commandError,
      }
    }

    try {
      const unsupported = this.validateCommandSupport(session, options.command)
      if (unsupported) {
        return {
          success: false,
          error: unsupported.message,
          commandError: unsupported,
        }
      }

      switch (options.command) {
        case 'tap': {
          const x = this.readRatio(options.payload?.x)
          const y = this.readRatio(options.payload?.y)
          this.writeCommand(controller, buildTouchCommand('down', x, y, controller.rotation))
          this.writeCommand(controller, buildTouchCommand('up', x, y, controller.rotation))
          return { success: true }
        }
        case 'touch_down':
        case 'touch_move':
        case 'touch_up': {
          const phase = options.command === 'touch_down' ? 'down' : options.command === 'touch_move' ? 'move' : 'up'
          const x = this.readRatio(options.payload?.x)
          const y = this.readRatio(options.payload?.y)
          this.writeCommand(controller, buildTouchCommand(phase, x, y, controller.rotation))
          return { success: true }
        }
        case 'home':
          this.writeCommand(controller, buildButtonCommand('home'))
          return { success: true }
        case 'app_switch':
          this.writeCommand(controller, buildButtonCommand('appSwitch'))
          return { success: true }
        case 'volume_up':
          this.writeCommand(controller, buildButtonCommand('volumeUp'))
          return { success: true }
        case 'volume_down':
          this.writeCommand(controller, buildButtonCommand('volumeDown'))
          return { success: true }
        case 'action_button':
          this.writeCommand(controller, buildButtonCommand('actionButton'))
          return { success: true }
        case 'rotate_clockwise': {
          const rotation = nextRotation(controller.rotation, 'clockwise')
          controller.rotation = rotation
          this.writeCommand(controller, `rotate ${rotation}\n`)
          this.updateSession(session.id, { rotation })
          return { success: true }
        }
        case 'rotate_counterclockwise': {
          const rotation = nextRotation(controller.rotation, 'counterclockwise')
          controller.rotation = rotation
          this.writeCommand(controller, `rotate ${rotation}\n`)
          this.updateSession(session.id, { rotation })
          return { success: true }
        }
        case 'show_touches':
          this.writeCommand(controller, 'pointer show true\n')
          return { success: true }
        case 'hide_touches':
          this.writeCommand(controller, 'pointer show false\n')
          return { success: true }
        case 'capture_screenshot':
          return this.captureScreenshot({ sessionId: session.id })
        case 'start_recording':
          this.writeCommand(controller, buildStartRecordingCommand())
          return { success: true }
        case 'stop_recording':
          return this.stopRecording(session.id, controller)
        case 'capture_replay':
          return this.captureReplay(session.id, controller)
        case 'copy_last_screenshot':
          this.writeCommand(controller, `copy_screenshot -r ${controller.rotation}\n`)
          return { success: true }
        case 'open_dev_menu':
          return {
            success: false,
            error: 'Opening the React Native dev menu is not wired into Cozea yet.',
            commandError: this.createCommandError('command_unsupported', 'Opening the React Native dev menu is not wired into Cozea yet.'),
          }
        default:
          return {
            success: false,
            error: `Unsupported Radon device command: ${options.command}`,
            commandError: this.createCommandError('command_unsupported', `Unsupported Radon device command: ${options.command}`),
          }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: message,
        commandError: this.classifyRuntimeError(message),
      }
    }
  }

  async captureScreenshot(options: { sessionId: string }): Promise<NativePreviewCaptureScreenshotResult> {
    const session = this.sessions.get(options.sessionId)
    const controller = this.sessionControllers.get(options.sessionId)
    if (!session || !controller) {
      return {
        success: false,
        error: 'Native preview session is not running.',
      }
    }

    const id = `screenshot-${Date.now()}`
    try {
      const event = await this.waitForMediaEvent(session.id, id, ['screenshot_ready'], ['screenshot_error'], () => {
        this.writeCommand(controller, buildScreenshotCommand(controller.rotation, id))
      })

      if (event.type !== 'screenshot_ready') {
        return { success: false, error: 'Screenshot capture did not finish successfully.' }
      }

      const dataUrl = await this.filePathToDataUrl(event.fileUrl)
      return {
        success: true,
        dataUrl,
        fileUrl: event.fileUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async runAutomation(_input?: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult> {
    return {
      success: false,
      status: 'unavailable',
      error: 'Automation has not been ported to the Radon-backed host yet.',
    }
  }

  async getAvailableTools(options: { sessionId: string }): Promise<{ success: boolean; tools?: RadonToolDescriptor[]; error?: string }> {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      return {
        success: false,
        error: 'Native preview session not found.',
      }
    }

    const pkg = await this.readPackageJson(session.projectPath)
    return {
      success: true,
      tools: this.buildToolDescriptors(pkg, this.runtimePluginsByProject.get(session.projectPath)),
    }
  }

  async openComponentPreview(options: { sessionId: string; previewId: string }): Promise<{ success: boolean; error?: string }> {
    const availability = this.ensureRuntimeMessagingAvailable(options.sessionId, {
      requireAppReady: true,
      feature: 'ComponentPreview',
      featureMessage: 'Component preview requires the Radon ComponentPreview feature.',
    })
    if (!availability.ok) {
      return {
        success: false,
        error: availability.error.message,
      }
    }

    const sent = availability.bridge.sendRuntimeMessage({
      type: 'openPreview',
      data: { previewId: options.previewId },
    })
    return sent
      ? { success: true }
      : { success: false, error: 'Component preview command could not be delivered to the app runtime.' }
  }

  async showStorybookStory(options: { sessionId: string; storyId: string }): Promise<{ success: boolean; error?: string }> {
    const availability = this.ensureRuntimeMessagingAvailable(options.sessionId, {
      requireAppReady: true,
      feature: 'StorybookIntegration',
      featureMessage: 'Storybook preview requires the Radon StorybookIntegration feature.',
    })
    if (!availability.ok) {
      return {
        success: false,
        error: availability.error.message,
      }
    }

    const story = this.parseStoryId(options.storyId)
    if (!story) {
      return {
        success: false,
        error: 'Storybook story ids must use the "Component Title::Story Name" format.',
      }
    }

    const sent = availability.bridge.sendRuntimeMessage({
      type: 'showStorybookStory',
      data: story,
    })
    return sent
      ? { success: true }
      : { success: false, error: 'Storybook command could not be delivered to the app runtime.' }
  }

  async openNavigation(options: { sessionId: string; route: string }): Promise<{ success: boolean; error?: string }> {
    const availability = this.ensureRuntimeMessagingAvailable(options.sessionId, {
      requireAppReady: true,
    })
    if (!availability.ok) {
      return {
        success: false,
        error: availability.error.message,
      }
    }

    const sent = availability.bridge.sendRuntimeMessage({
      type: 'openNavigation',
      data: { id: options.route },
    })
    return sent
      ? { success: true }
      : { success: false, error: 'Navigation command could not be delivered to the app runtime.' }
  }

  async requestInspect(options: { sessionId: string; target?: unknown }): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const availability = this.ensureRuntimeMessagingAvailable(options.sessionId, {
      requireAppReady: true,
      feature: 'ElementInspector',
      featureMessage: 'Element inspection requires the Radon ElementInspector feature.',
    })
    if (!availability.ok) {
      return {
        success: false,
        error: availability.error.message,
      }
    }

    const target = (options.target ?? {}) as RuntimeInspectTarget
    const inspectId = this.nextInspectRequestId++
    const x = this.readRatio(target.x)
    const y = this.readRatio(target.y)
    const requestStack = Boolean(target.requestStack)

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingInspectRequests.delete(inspectId)
          reject(new Error('Timed out while waiting for the app runtime to respond to the inspect request.'))
        }, 10_000)

        this.pendingInspectRequests.set(inspectId, {
          sessionId: options.sessionId,
          resolve: (value) => {
            clearTimeout(timeout)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reject(error)
          },
          timeout,
        })

        const sent = availability.bridge.sendRuntimeMessage({
          type: 'inspect',
          data: {
            id: inspectId,
            x,
            y,
            requestStack,
          },
        })

        if (!sent) {
          const pending = this.pendingInspectRequests.get(inspectId)
          if (pending) {
            clearTimeout(pending.timeout)
            this.pendingInspectRequests.delete(inspectId)
          }
          reject(new Error('Inspect command could not be delivered to the app runtime.'))
        }
      })

      return {
        success: true,
        result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async getRuntimeBridge(projectPath: string): Promise<RadonRuntimeBridgeServer> {
    const existing = this.runtimeBridges.get(projectPath)
    if (existing) {
      return existing
    }

    const bridge = await RadonRuntimeBridgeServer.create()
    bridge.onEnvelope((envelope) => {
      this.handleRuntimeEnvelope(projectPath, envelope)
    })
    bridge.onConnectionChanged((connected) => {
      const session = this.resolveRuntimeSession(projectPath)
      if (!session) {
        return
      }

      if (!connected) {
        if (session.appReady) {
          this.updateSession(session.id, {
            appReady: false,
            state: session.streamUrl ? 'stream_ready' : session.state,
            message: 'Waiting for the app runtime to reconnect...',
          })
        }
        this.emitRuntimeEvent({
          projectPath,
          sessionId: session.id,
          type: 'runtimeDisconnected',
        })
        this.emitLog({
          source: 'runtime',
          level: 'warn',
          message: 'The Radon runtime bridge disconnected.',
          projectPath,
          sessionId: session.id,
        })
        return
      }

      this.emitRuntimeEvent({
        projectPath,
        sessionId: session.id,
        type: 'runtimeConnected',
      })
      this.emitLog({
        source: 'runtime',
        level: 'info',
        message: `The Radon runtime bridge connected on port ${(bridge.port)}.`,
        projectPath,
        sessionId: session.id,
      })
    })
    this.runtimeBridges.set(projectPath, bridge)
    return bridge
  }

  private handleRuntimeEnvelope(projectPath: string, envelope: RadonRuntimeEnvelope): void {
    if (envelope.event !== 'RNIDE_message' || !envelope.payload || typeof envelope.payload !== 'object') {
      return
    }

    const runtimeMessage = envelope.payload as { type?: unknown; data?: unknown }
    if (typeof runtimeMessage.type !== 'string') {
      return
    }

    const session = this.resolveRuntimeSession(projectPath)
    const sessionId = session?.id

    if (runtimeMessage.type === 'appReady' && sessionId) {
      this.updateSession(sessionId, {
        appReady: true,
        state: 'app_ready',
        message: 'App connected to the Radon runtime.',
      })
    } else if (runtimeMessage.type === 'fastRefreshStarted' && sessionId) {
      this.updateSession(sessionId, {
        appReady: false,
        state: 'stream_ready',
        message: 'Fast refresh in progress...',
      })
    } else if (runtimeMessage.type === 'fastRefreshComplete' && sessionId) {
      this.updateSession(sessionId, {
        state: session?.appReady ? 'app_ready' : 'stream_ready',
        message: session?.appReady ? 'App connected to the Radon runtime.' : 'Waiting for the app runtime...',
      })
    } else if (runtimeMessage.type === 'devtoolPluginsChanged') {
      const plugins = Array.isArray((runtimeMessage.data as { plugins?: unknown })?.plugins)
        ? ((runtimeMessage.data as { plugins: unknown[] }).plugins
          .filter((plugin): plugin is string => typeof plugin === 'string'))
        : []
      this.runtimePluginsByProject.set(projectPath, plugins)

      if (sessionId) {
        void this.readPackageJson(projectPath)
          .then((pkg) => {
            this.emitToolsUpdated({
              projectPath,
              sessionId,
              tools: this.buildToolDescriptors(pkg, plugins),
            })
          })
          .catch(() => {
            // Ignore tool descriptor rebuild failures during runtime sync.
          })
      }
    } else if (runtimeMessage.type === 'inspectData') {
      const messageId = typeof (runtimeMessage.data as { id?: unknown })?.id === 'number'
        ? (runtimeMessage.data as { id: number }).id
        : null
      if (messageId !== null) {
        const pending = this.pendingInspectRequests.get(messageId)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingInspectRequests.delete(messageId)
          pending.resolve(runtimeMessage.data)
        }
      }
    }

    this.emitRuntimeEvent({
      projectPath,
      sessionId,
      type: runtimeMessage.type,
      payload: runtimeMessage.data,
    })
  }

  private resolveRuntimeSession(projectPath: string): RadonSessionRecord | null {
    const focusedSessionId = this.focusedSessionByProject.get(projectPath)
    if (focusedSessionId) {
      const focusedSession = this.sessions.get(focusedSessionId)
      if (focusedSession) {
        return focusedSession
      }
    }

    const candidates = [...this.sessions.values()]
      .filter((session) => session.projectPath === projectPath && session.state !== 'stopped' && session.state !== 'error')
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return candidates[0] ?? null
  }

  private ensureRuntimeMessagingAvailable(
    sessionId: string,
    options?: {
      requireAppReady?: boolean
      feature?: RadonFeatureName
      featureMessage?: string
    },
  ): { ok: true; session: RadonSessionRecord; bridge: RadonRuntimeBridgeServer } | { ok: false; error: RadonCommandError } {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return {
        ok: false,
        error: this.createCommandError('stream_lost', 'Native preview session is not running.'),
      }
    }

    if (session.state === 'stopped' || session.state === 'error') {
      return {
        ok: false,
        error: this.createCommandError('stream_lost', 'Native preview session is not running.'),
      }
    }

    if (options?.feature && !isRadonFeatureAvailable(this.cachedLicenseState.features, options.feature)) {
      return {
        ok: false,
        error: this.createCommandError('feature_unavailable', options.featureMessage ?? `The "${options.feature}" feature is not available on the current Radon plan.`),
      }
    }

    const bridge = this.runtimeBridges.get(session.projectPath)
    if (!bridge) {
      return {
        ok: false,
        error: this.createCommandError('runtime_not_injected', 'The Radon runtime bridge has not connected yet. Confirm the dev server was started with the injected Radon environment.'),
      }
    }

    if (!bridge.isConnected()) {
      return {
        ok: false,
        error: this.createCommandError(
          session.appReady ? 'metro_disconnected' : 'runtime_not_injected',
          session.appReady
            ? 'The Radon runtime bridge disconnected from the running app.'
            : 'The Radon runtime bridge has not connected yet. Confirm the dev server was started with the injected Radon environment.',
        ),
      }
    }

    if (options?.requireAppReady && !session.appReady) {
      return {
        ok: false,
        error: this.createCommandError('app_not_ready', 'Wait for the app to finish loading before using this runtime-backed action.'),
      }
    }

    return {
      ok: true,
      session,
      bridge,
    }
  }

  private async readPackageJson(projectPath: string): Promise<PackageJsonLike | null> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json')
      const contents = await readFile(packageJsonPath, 'utf8')
      return JSON.parse(contents) as PackageJsonLike
    } catch {
      return null
    }
  }

  private buildToolDescriptors(pkg: PackageJsonLike | null, runtimePlugins?: string[]): RadonToolDescriptor[] {
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
    const runtimePluginSet = runtimePlugins ? new Set(runtimePlugins) : null

    return RADON_TOOL_DEFINITIONS.map((tool) => {
      const present = runtimePluginSet
        ? (tool.runtimePlugins?.some((plugin) => runtimePluginSet.has(plugin)) ?? false)
        : (tool.dependencyNames?.some((name) => Boolean(deps[name])) ?? tool.id === 'network')

      if (!present) {
        return {
          id: tool.id,
          title: tool.title,
          status: 'unavailable',
          enabled: false,
        }
      }

      const enabled = tool.feature
        ? isRadonFeatureAvailable(this.cachedLicenseState.features, tool.feature)
        : true
      return {
        id: tool.id,
        title: tool.title,
        status: enabled ? 'available' : 'disabled',
        enabled,
      }
    })
  }

  private parseStoryId(storyId: string): { componentTitle: string; storyName: string } | null {
    const [componentTitle, storyName, ...rest] = storyId.split('::')
    if (!componentTitle || !storyName || rest.length > 0) {
      return null
    }
    return {
      componentTitle,
      storyName,
    }
  }

  private cancelPendingInspectRequestsForSession(sessionId: string, message: string): void {
    for (const [requestId, pending] of this.pendingInspectRequests.entries()) {
      if (pending.sessionId !== sessionId) {
        continue
      }
      clearTimeout(pending.timeout)
      this.pendingInspectRequests.delete(requestId)
      pending.reject(new Error(message))
    }
  }

  private async resolveDevices(platform?: NativePreviewPlatform): Promise<NativePreviewListDevicesResult['devices']> {
    if (platform === 'ios') {
      return this.iosManager.listDevices()
    }

    if (platform === 'android') {
      return this.androidManager.listDevices()
    }

    const [ios, android] = await Promise.all([
      this.iosManager.listDevices(),
      this.androidManager.listDevices(),
    ])
    return [...ios, ...android]
  }

  private async resolvePreferredDevice(platform: NativePreviewPlatform, preferredId?: string) {
    return platform === 'ios'
      ? this.iosManager.ensureDefaultDevice(preferredId)
      : this.androidManager.ensureDefaultDevice(preferredId)
  }

  private async ensureDeviceReady(platform: NativePreviewPlatform, device: NonNullable<RadonSessionRecord['device']>) {
    if (platform === 'ios') {
      return this.iosManager.bootDevice(device.id)
    }

    if (device.kind === 'physical') {
      return device
    }

    return this.androidManager.bootDevice(device.id)
  }

  private createSessionRecord(
    input: NativePreviewStartSessionInput,
    device: NonNullable<RadonSessionRecord['device']>,
    overrides?: Partial<RadonSessionRecord>,
  ): RadonSessionRecord {
    const now = Date.now()
    const deviceType: SessionProcessDeviceType = input.platform === 'ios'
      ? 'ios'
      : device.kind === 'physical'
        ? 'android_device'
        : 'android'

    return {
      id: overrides?.id ?? `${input.platform}-${device.id}-${now}`,
      projectPath: input.projectPath,
      platform: input.platform,
      launcher: input.launcher,
      buildMode: input.buildMode,
      state: 'idle',
      startedAt: now,
      updatedAt: now,
      device,
      deviceId: device.id,
      terminalId: input.terminalId,
      devServerPort: input.devServerPort,
      entryMode: input.entryMode ?? 'app',
      verificationStatus: 'idle',
      focused: true,
      rotation: 'Portrait',
      transport: 'mjpeg',
      capabilities: this.buildCapabilities(device),
      appReady: false,
      deviceType,
      ...overrides,
    }
  }

  private buildCapabilities(device: NonNullable<RadonSessionRecord['device']>): RadonSessionCapabilities {
    const rotate = isRadonFeatureAvailable(this.cachedLicenseState.features, 'DeviceRotation')
      && !(device.platform === 'android' && device.kind === 'physical')
    const screenshot = isRadonFeatureAvailable(this.cachedLicenseState.features, 'Screenshot')
    const recording = isRadonFeatureAvailable(this.cachedLicenseState.features, 'ScreenRecording')
    const replay = isRadonFeatureAvailable(this.cachedLicenseState.features, 'ScreenReplay')
    return {
      transport: 'mjpeg',
      touch: true,
      rotate,
      showTouches: true,
      screenshot,
      recording,
      replay,
      devMenu: false,
      entryModes: ['app'],
      buttons: {
        home: true,
        appSwitch: true,
        volumeUp: true,
        volumeDown: true,
        actionButton: device.platform === 'android',
      },
    }
  }

  private validateDeviceAccess(device: NonNullable<RadonSessionRecord['device']>): RadonCommandError | null {
    const feature = this.getRequiredDeviceFeature(device)
    if (!feature) {
      return null
    }

    if (isRadonFeatureAvailable(this.cachedLicenseState.features, feature)) {
      return null
    }

    return this.createCommandError(
      'feature_unavailable',
      `${device.name} requires the Radon feature "${feature}" on the current subscription.`,
    )
  }

  private getRequiredDeviceFeature(device: NonNullable<RadonSessionRecord['device']>): RadonFeatureName | null {
    if (device.platform === 'ios') {
      return /ipad/i.test(device.name) ? 'IOSTabletSimulators' : 'IOSSmartphoneSimulators'
    }

    if (device.kind === 'physical') {
      return 'AndroidPhysicalDevice'
    }

    return /(tablet|tab)/i.test(device.name) ? 'AndroidTabletEmulators' : 'AndroidSmartphoneEmulators'
  }

  private validateCommandSupport(session: RadonSessionRecord, command: RadonDeviceCommand): RadonCommandError | null {
    const capabilities = session.capabilities
    if (!capabilities) {
      return null
    }

    const unsupported = (message: string) => this.createCommandError('feature_unavailable', message)

    switch (command) {
      case 'rotate_clockwise':
      case 'rotate_counterclockwise':
        return capabilities.rotate ? null : unsupported('Device rotation is not available for the current Radon plan or device.')
      case 'capture_screenshot':
      case 'copy_last_screenshot':
        return capabilities.screenshot ? null : unsupported('Screenshots are not available for the current Radon plan.')
      case 'start_recording':
      case 'stop_recording':
        return capabilities.recording ? null : unsupported('Screen recording is not available for the current Radon plan.')
      case 'capture_replay':
        return capabilities.replay ? null : unsupported('Screen replay is not available for the current Radon plan.')
      case 'open_dev_menu':
        return capabilities.devMenu ? null : this.createCommandError('command_unsupported', 'Opening the React Native dev menu is not wired into Cozea yet.')
      default:
        return null
    }
  }

  private getSessionKey(projectPath: string, platform: NativePreviewPlatform, deviceId: string): string {
    return `${projectPath}::${platform}::${deviceId}`
  }

  private upsertSession(session: RadonSessionRecord): RadonSessionRecord {
    this.sessions.set(session.id, session)
    this.sessionKeyToId.set(this.getSessionKey(session.projectPath, session.platform, session.deviceId ?? session.device?.id ?? 'unknown'), session.id)
    this.emitSessionUpdated(session)
    return session
  }

  private updateSession(sessionId: string, patch: Partial<RadonSessionRecord>): RadonSessionRecord {
    const current = this.sessions.get(sessionId)
    if (!current) {
      throw new Error(`Unknown Radon session ${sessionId}`)
    }

    const next: RadonSessionRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, next)
    this.sessionKeyToId.set(this.getSessionKey(next.projectPath, next.platform, next.deviceId ?? next.device?.id ?? 'unknown'), sessionId)
    this.emitSessionUpdated(next)
    return next
  }

  private emitSessionUpdated(session: RadonSession): void {
    for (const listener of this.sessionListeners) {
      listener(session)
    }
  }

  private emitRuntimeEvent(event: RadonRuntimeEvent): void {
    for (const listener of this.runtimeListeners) {
      listener(event)
    }
  }

  private emitToolsUpdated(event: RadonToolsUpdatedEvent): void {
    for (const listener of this.toolsListeners) {
      listener(event)
    }
  }

  private emitLicenseChanged(): void {
    for (const listener of this.licenseListeners) {
      listener(this.cachedLicenseState)
    }
  }

  private emitLog(event: Omit<RadonLogEvent, 'timestamp'> & { timestamp?: number }): void {
    const resolved: RadonLogEvent = {
      timestamp: event.timestamp ?? Date.now(),
      ...event,
    }
    for (const listener of this.logListeners) {
      listener(resolved)
    }
  }

  private async launchSessionProcess(session: RadonSessionRecord, token: string): Promise<SessionController> {
    if (process.platform === 'darwin') {
      const screenStatus = systemPreferences.getMediaAccessStatus('screen')
      if (screenStatus !== 'granted') {
        const errorMsg = `macOS Screen Recording permission is missing (status: ${screenStatus}). Please grant access to your Terminal/IDE in System Settings -> Privacy & Security -> Screen & System Audio Recording, then restart the app.`
        throw new Error(errorMsg)
      }
    }

    const binary = resolveRadonSimulatorBinaryPath()
    const targetDeviceId = session.deviceType === 'ios'
      ? session.device?.id || session.deviceId || ''
      : session.device?.runtimeId || session.device?.id || session.deviceId || ''
    const args = [session.deviceType, '--id', targetDeviceId]
    // (Need to keep the import for signature compatibility even if we don't use it directly)
    if (getManagedAndroidDeviceSetPath()) {
      // noop
    }
    
    if (session.deviceType === 'ios') {
      const deviceSet = getManagedIosDeviceSetPath()
      if (deviceSet) {
        args.push('--device-set', deviceSet)
      }
    }
    if (token) {
      args.push('-t', token)
      fs.appendFileSync('logs.txt', `[simulator-server] Checking token validity...\n`)
      const tokenState = await this.verifyLicenseToken(token)
      fs.appendFileSync('logs.txt', `[simulator-server] Token State: ${JSON.stringify(tokenState)}\n`)
    } else {
      fs.appendFileSync('logs.txt', `[simulator-server] WARNING: No token was passed to launchSessionProcess!\n`)
    }

    const simulatorProcess = pty.spawn(binary, args, {
      cwd: path.dirname(binary),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 30,
      name: 'xterm-color',
    })

    const controller: SessionController = {
      process: simulatorProcess,
      deviceType: session.deviceType,
      rotation: session.rotation ?? 'Portrait',
      stopRequested: false,
      started: false,
      pending: new Map(),
      stdoutBuffer: '',
    }

    this.sessionControllers.set(session.id, controller)
    this.attachProcessListeners(session, controller)

    try {
      await new Promise<void>((resolve, reject) => {
        controller.startupResolve = () => {
          controller.started = true
          resolve()
        }
        controller.startupReject = reject
        controller.startupTimer = setTimeout(() => {
          reject(new Error(`Timed out while waiting for ${session.device?.name || session.platform} preview stream.`))
        }, 30_000)
      })
    } catch (error) {
      this.sessionControllers.delete(session.id)
      controller.stopRequested = true
      try {
        simulatorProcess.kill('SIGTERM')
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          simulatorProcess.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 2000)
      throw error
    } finally {
      if (controller.startupTimer) {
        clearTimeout(controller.startupTimer)
      }
    }

    return controller
  }

  private attachProcessListeners(session: RadonSessionRecord, controller: SessionController): void {
    controller.process.onData((data: string) => {
      // Strip ANSI color codes since the pseudo-terminal outputs them
      // eslint-disable-next-line no-control-regex
      const cleanData = data.replace(/\x1b\[[0-9;]*m/g, '')
      controller.stdoutBuffer += cleanData
      controller.stdoutBuffer = this.flushBuffer(session.id, controller.stdoutBuffer, false)
    })

    // Pseudo-terminals combine stderr and stdout into onData, so we don't have onStderr.

    controller.process.onExit(async ({ exitCode: code, signal }) => {
      fs.appendFileSync('logs.txt', `[simulator-server] EXIT: Process exited with code ${code} and signal ${signal}. Stop requested: ${controller.stopRequested}\n`)
      this.cancelPendingInspectRequestsForSession(session.id, 'Inspect request cancelled because the native preview session exited.')
      if (controller.stopRequested) {
        this.updateSession(session.id, {
          state: 'stopped',
          message: 'Native preview stopped.',
        })
        return
      }

      let errorCode: RadonCommandError['code'] = 'unknown'
      let message = code === 77
        ? 'No sufficient license was provided in time to prevent preview shutdown.'
        : `Preview stream closed unexpectedly${code !== null ? ` (code ${code})` : signal ? ` (${signal})` : ''}.`

      // Check if token expired causing the exit
      if (this.cachedToken) {
        const tokenState = await this.verifyLicenseToken(this.cachedToken)
        if (tokenState.status === 'expired') {
          this.cachedLicenseState = tokenState
          this.emitLicenseChanged()
          message = 'Session expired. Please upgrade or renew your Radon token.'
          errorCode = 'no_license'
        }
      }

      controller.startupReject?.(new Error(message))
      this.updateSession(session.id, {
        state: 'error',
        error: message,
        message,
        lastError: this.createCommandError(errorCode, message),
      })
      this.sessionControllers.delete(session.id)
    })
  }

  private flushBuffer(sessionId: string, buffer: string, stderr: boolean): string {
    let working = buffer
    let lineBreakIndex = working.indexOf('\n')
    while (lineBreakIndex >= 0) {
      const line = working.slice(0, lineBreakIndex).trim()
      working = working.slice(lineBreakIndex + 1)
      if (line) {
        this.handleProcessLine(sessionId, line, stderr)
      }
      lineBreakIndex = working.indexOf('\n')
    }
    return working
  }

  private handleProcessLine(sessionId: string, line: string, stderr: boolean): void {
    const session = this.sessions.get(sessionId)
    const controller = this.sessionControllers.get(sessionId)
    if (!session || !controller) return

    fs.appendFileSync('logs.txt', `[simulator-server] ${stderr ? 'STDERR' : 'STDOUT'}: ${line}\n`);

    this.emitLog({
      sessionId,
      projectPath: session.projectPath,
      source: 'simulator-server',
      level: stderr ? 'warn' : 'info',
      message: line,
    })

    if (stderr) {
      if (/Device .+ is not connected or not available/.test(line)) {
        controller.startupReject?.(new Error('Could not connect to the selected device.'))
      }
      return
    }

    const event = parseSimulatorServerEvent(line)
    if (!event) {
      return
    }

    if (event.type === 'stream_ready') {
      controller.startupResolve?.()
      controller.startupResolve = undefined
      controller.startupReject = undefined
      this.updateSession(sessionId, {
        streamUrl: event.streamUrl,
        state: 'stream_ready',
        message: 'Streaming native preview...',
      })
      return
    }

    if (!('id' in event)) {
      return
    }

    const pending = this.sessionControllers.get(sessionId)?.pending.get(event.id)
    if (!pending) {
      return
    }

    if (pending.successTypes.has(event.type)) {
      pending.resolve(event)
      this.sessionControllers.get(sessionId)?.pending.delete(event.id)
      return
    }

    if (pending.errorTypes.has(event.type)) {
      const errorMessage = 'errorMessage' in event ? event.errorMessage : 'Simulator server reported an error.'
      pending.reject(new Error(errorMessage))
      this.sessionControllers.get(sessionId)?.pending.delete(event.id)
    }
  }

  private async waitForMediaEvent(
    sessionId: string,
    id: string,
    successTypes: SimulatorServerEvent['type'][],
    errorTypes: SimulatorServerEvent['type'][],
    send: () => void,
  ): Promise<SimulatorServerEvent> {
    const controller = this.sessionControllers.get(sessionId)
    if (!controller) {
      throw new Error('Native preview session is not running.')
    }

    return new Promise<SimulatorServerEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        controller.pending.delete(id)
        reject(new Error(`Timed out while waiting for ${id} to finish.`))
      }, 30_000)

      controller.pending.set(id, {
        successTypes: new Set(successTypes),
        errorTypes: new Set(errorTypes),
        resolve: (event) => {
          clearTimeout(timeout)
          resolve(event)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      })

      send()
    })
  }

  private async stopRecording(sessionId: string, controller: SessionController): Promise<RadonDeviceCommandResult> {
    try {
      const event = await this.waitForMediaEvent(sessionId, 'recording', ['video_ready'], ['video_error'], () => {
        this.writeCommand(controller, `video recording save -r ${controller.rotation}\n`)
        this.writeCommand(controller, buildStopRecordingCommand())
      })

      if (event.type !== 'video_ready') {
        return { success: false, error: 'Recording capture did not finish successfully.' }
      }

      return {
        success: true,
        fileUrl: event.fileUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async captureReplay(sessionId: string, controller: SessionController): Promise<RadonDeviceCommandResult> {
    try {
      const event = await this.waitForMediaEvent(sessionId, 'replay', ['replay_ready'], ['replay_error'], () => {
        this.writeCommand(controller, buildCaptureReplayCommand(controller.rotation))
      })

      if (event.type !== 'replay_ready') {
        return { success: false, error: 'Replay capture did not finish successfully.' }
      }

      return {
        success: true,
        fileUrl: event.fileUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private writeCommand(controller: SessionController, command: string): void {
    try {
      controller.process.write(command)
    } catch {
      throw new Error('Simulator server process is not available.')
    }
  }

  private readRatio(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value ?? 0.5)
    if (!Number.isFinite(numeric)) return 0.5
    if (numeric < 0) return 0
    if (numeric > 1) return 1
    return numeric
  }

  private async verifyLicenseToken(token: string): Promise<RadonLicenseState> {
    try {
      const binary = resolveRadonSimulatorBinaryPath()
      // Filter out stderr logs so we only match the actual token string!
      const { stdout } = await execFileAsync(binary, ['verify_token', token])
      const normalized = stdout.split('\n').filter(line => line && !line.startsWith('[')).join('\n').trim()
      const tokenMetadata = resolveRadonFeatures(token)

      if (normalized.startsWith('token_valid')) {
        const [, plan] = normalized.split(' ', 2)
        return {
          status: 'valid',
          tokenPresent: true,
          tokenVerified: true,
          plan: tokenMetadata.plan || plan,
          features: tokenMetadata.features,
          missingFeatures: tokenMetadata.missingFeatures,
        }
      }

      if (normalized.includes('expired')) {
        return {
          status: 'expired',
          tokenPresent: true,
          tokenVerified: false,
          error: 'The Radon license token has expired.',
          plan: tokenMetadata.plan,
          features: tokenMetadata.features,
          missingFeatures: tokenMetadata.missingFeatures,
        }
      }

      if (normalized.includes('fingerprint_mismatch')) {
        return {
          status: 'fingerprint_mismatch',
          tokenPresent: true,
          tokenVerified: false,
          error: 'This Radon token was activated for a different device fingerprint.',
          plan: tokenMetadata.plan,
          features: tokenMetadata.features,
          missingFeatures: tokenMetadata.missingFeatures,
        }
      }

      return {
        status: 'corrupted',
        tokenPresent: true,
        tokenVerified: false,
        error: 'The Radon license token could not be verified.',
        plan: tokenMetadata.plan,
        features: tokenMetadata.features,
        missingFeatures: tokenMetadata.missingFeatures,
      }
    } catch (error) {
      return {
        status: 'unknown',
        tokenPresent: Boolean(token),
        tokenVerified: false,
        error: error instanceof Error ? error.message : String(error),
        ...resolveRadonFeatures(token),
      }
    }
  }

  private createCommandError(code: RadonCommandError['code'], message: string): RadonCommandError {
    return {
      code,
      message,
      recoverable: code !== 'command_unsupported',
    }
  }

  private classifyRuntimeError(message: string): RadonCommandError {
    const normalized = message.toLowerCase()
    if (normalized.includes('license')) {
      return this.createCommandError('no_license', message)
    }
    if (normalized.includes('device')) {
      return this.createCommandError('no_device', message)
    }
    if (normalized.includes('requires the radon feature')) {
      return this.createCommandError('feature_unavailable', message)
    }
    if (normalized.includes('injected radon environment')) {
      return this.createCommandError('runtime_not_injected', message)
    }
    if (normalized.includes('finish loading')) {
      return this.createCommandError('app_not_ready', message)
    }
    if (normalized.includes('bridge disconnected')) {
      return this.createCommandError('metro_disconnected', message)
    }
    if (normalized.includes('timed out')) {
      return this.createCommandError('stream_lost', message)
    }
    return this.createCommandError('unknown', message)
  }

  private markProjectFocus(projectPath: string, focusedSessionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.projectPath !== projectPath) continue
      if (session.focused === (session.id === focusedSessionId)) continue
      this.updateSession(session.id, { focused: session.id === focusedSessionId })
    }
  }

  private async filePathToDataUrl(fileUrl: string): Promise<string> {
    const filePath = fileUrl.startsWith('file://') ? decodeURIComponent(new URL(fileUrl).pathname) : fileUrl
    const bytes = await readFile(filePath)
    const extension = path.extname(filePath).toLowerCase()
    const mimeType = extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.png'
        ? 'image/png'
        : 'application/octet-stream'
    return `data:${mimeType};base64,${bytes.toString('base64')}`
  }
}
