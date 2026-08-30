import { app, BrowserWindow, protocol, shell, ipcMain, nativeTheme, session } from 'electron'
import { syncShellEnvironment } from './syncShellEnvironment'
import windowStateKeeper from 'electron-window-state'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'

import { autoUpdater } from 'electron-updater'
import { Effect } from 'effect'
import type { AppSettings, GpuAccelerationDiagnostics, PreviewHeaderDiagnostic } from '../../../shared/electronApiTypes'
import { getGitRuntimeHealth } from './gitRuntime'
import { createApplicationMenu } from './menu'

// Services
import { TerminalService } from './services/TerminalService'
import { IntegrationService } from './services/IntegrationService'
import { AgentToolService } from './services/AgentToolService'
import { CollabEncryptionService } from './services/CollabEncryptionService'
import { forwardIntegrationOAuthCallback } from './integrationOAuthCallback'
import { registerContextMenuHandlers } from './ipc/registerContextMenuHandlers'
import { registerCoreHandlers } from './ipc/registerCoreHandlers'
import { registerDevServerHandlers } from './ipc/registerDevServerHandlers'
import { registerNativePreviewHandlers } from './ipc/registerNativePreviewHandlers'
import { registerPreviewHandlers } from './ipc/registerPreviewHandlers'
import { registerProjectHandlers } from './ipc/registerProjectHandlers'
import { registerRuntimeHandlers } from './ipc/registerRuntimeHandlers'
import { registerSettingsStorageHandlers } from './ipc/registerSettingsStorageHandlers'
import { registerWorkspaceSyncHandlers } from './ipc/registerWorkspaceSyncHandlers'
import { registerYjsHandlers } from './ipc/registerYjsHandlers'
import { registerOrgDevAppHandlers } from './ipc/registerOrgDevAppHandlers'
import { registerWorkbenchSessionHandlers } from './ipc/registerWorkbenchSessionHandlers'
import { registerWorkspaceHandlers } from './ipc/registerWorkspaceHandlers'
import { registerTerminalWorkspaceHandlers } from './ipc/registerTerminalWorkspaceHandlers'
import { OrgDevAppArtifactService } from './services/OrgDevAppArtifactService'
import { ORG_DEVAPP_SCHEME } from '../../../shared/orgDevAppProtocol'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ORG_DEVAPP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])
import { forEachBroadcastWindow, setBroadcastMainWindow } from './broadcastWindows'
import { loadSyncState } from './services/syncJournalStore'
import { initWorkspaceCatalogRuntime, disposeWorkspaceCatalogRuntime, waitForWorkspaceCatalogRuntime } from './workspaces/WorkspaceCatalogRuntime'
import { WorkspaceCatalog } from './workspaces/WorkspaceCatalog'
import { readSubstrateShadowServerFlags, readSubstrateFeatureFlags } from './substrate/flags'
import { getSharedSubstrateNdjsonWriter } from './substrate/obs'
import { listSubstrateRemoteEnvironments } from './substrate/remoteEnvironments'
import {
  createDesktopBackendPool,
  getDesktopBackendPool,
  getPrimaryShadowServerManager,
} from './substrate/backend/DesktopBackendPool'
import { PRIMARY_BACKEND_INSTANCE_ID } from './substrate/backend/types'
import { reconcileWslBackend } from './substrate/wsl/wslBackend'
import { registerSubstrateRemoteHandlers } from './ipc/registerSubstrateRemoteHandlers'
import { bootstrapSubstrateVcs } from './substrate/vcs/bootstrap'
import { registerSubstrateVcsIpcHandlers } from './substrate/vcs/registerIpcHandlers'
import {
  startShadowHostedRuntimeMonitor,
  type ShadowHostedRuntimeMonitorController,
} from './substrate/shadowHostedRuntimeMonitor'
import {
  getShadowServerManager,
  resolveShadowServerEntryPath,
  type ShadowServerManager,
} from './substrate/ShadowServerManager'

import { DevServerService } from './services/DevServerService'
import { LocalAutomationResolverService } from './runtime/LocalAutomationResolverService'
import { PreviewSnapshotService } from './services/PreviewSnapshotService'
import { listAvailableBrowsers, openUrlInBrowser } from './lib/externalBrowser'
import { listAvailableEditors, openFileInExternalEditor } from './lib/externalEditor'

// ============================================
// Terminal Management (VS Code-style multi-terminal)
// ============================================
// Logic moved to TerminalService

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, main bundle lives in `.../app.asar/out/main`, and renderer in `.../app.asar/out/renderer`.
// In dev/build, main bundle lives in `<repo>/out/main`, renderer in `<repo>/out/renderer`.
// So APP_ROOT must point to the repo root (dev) or `app.asar` root (prod), not the `out/` folder.
process.env.APP_ROOT = path.join(__dirname, '..', '..')

// Dev server URL from electron-vite (ELECTRON_RENDERER_URL) or legacy var
export const VITE_DEV_SERVER_URL =
  process.env['VITE_DEV_SERVER_URL'] || process.env['ELECTRON_RENDERER_URL']

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'out/main')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'out/renderer')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const DEFAULT_PROTOCOL = VITE_DEV_SERVER_URL ? 'cozea-dev' : 'cozea'
const PROTOCOL = process.env.COZEA_PROTOCOL || DEFAULT_PROTOCOL
const LEGACY_PROTOCOL = 'cozea'
const SUPPORTED_PROTOCOLS = PROTOCOL === LEGACY_PROTOCOL ? [PROTOCOL] : [PROTOCOL, LEGACY_PROTOCOL]
const RENDERER_BOOTSTRAP_ROUTE_QUERY_KEY = 'cozeaRoute'
const ASSISTANT_RUNTIME_WS_URL =
  process.env.COZEA_ASSISTANT_RUNTIME_WS_URL?.trim() || null
const ASSISTANT_RUNTIME_WS_URL_ARG = ASSISTANT_RUNTIME_WS_URL
  ? `--cozea-assistant-ws-url=${ASSISTANT_RUNTIME_WS_URL}`
  : null
const ELECTRON_REMOTE_DEBUGGING_PORT = process.env.ELECTRON_REMOTE_DEBUGGING_PORT?.trim() || null
const ASSISTANT_RUNTIME_HTTP_URL = (() => {
  if (!ASSISTANT_RUNTIME_WS_URL) return null
  try {
    const parsed = new URL(ASSISTANT_RUNTIME_WS_URL)
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${parsed.host}`
  } catch {
    return null
  }
})()
const DEV_SERVER_ORIGIN = (() => {
  if (!VITE_DEV_SERVER_URL) return null
  try {
    return new URL(VITE_DEV_SERVER_URL).origin
  } catch {
    return null
  }
})()
const MAIN_BOOT_STARTED_AT = performance.now()

function shouldLogBootTimings(): boolean {
  return !app.isPackaged || process.env.COZEA_BOOT_TIMINGS === '1'
}

function logBootTiming(label: string, startedAt = MAIN_BOOT_STARTED_AT): void {
  if (!shouldLogBootTimings()) return
  console.info('[BootTiming]', label, {
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  })
}

function scheduleBootWork(
  label: string,
  work: () => void | Promise<void>,
  delayMs = 0,
): void {
  setTimeout(() => {
    const startedAt = performance.now()
    try {
      const result = work()
      if (result && typeof (result as Promise<void>).finally === 'function') {
        void (result as Promise<void>).finally(() => logBootTiming(label, startedAt))
        return
      }
      logBootTiming(label, startedAt)
    } catch (error) {
      console.warn(`[Boot] ${label} failed`, error)
      logBootTiming(`${label}:failed`, startedAt)
    }
  }, delayMs)
}
const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "media-src 'self' data: blob: https: http:",
].join('; ')
const DEV_CONTENT_SECURITY_POLICY = APP_CONTENT_SECURITY_POLICY.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'"
)

if (ELECTRON_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_REMOTE_DEBUGGING_PORT)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

function matchesProtocolUrl(url: string, routePrefix: string): boolean {
  return SUPPORTED_PROTOCOLS.some((scheme) => url.startsWith(`${scheme}://${routePrefix}`))
}

function findProtocolArg(commandLine: string[]): string | undefined {
  return commandLine.find((arg) => SUPPORTED_PROTOCOLS.some((scheme) => arg.startsWith(`${scheme}://`)))
}

function extractNavigationPath(protocolUrl: string): string | null {
  try {
    const parsedUrl = new URL(protocolUrl)
    const scheme = parsedUrl.protocol.replace(':', '')
    if (!SUPPORTED_PROTOCOLS.includes(scheme)) return null

    const host = parsedUrl.hostname.replace(/^\/+/, '')
    const pathname = parsedUrl.pathname.replace(/^\/+/, '')
    const routePath = `/${[host, pathname].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/')
    if (
      routePath === '/' ||
      routePath.startsWith('/auth/callback') ||
      routePath.startsWith('/billing/') ||
      routePath.startsWith('/oauth/callback')
    ) {
      return null
    }

    return `${routePath}${parsedUrl.search}${parsedUrl.hash}`
  } catch {
    return null
  }
}

function sendNavigateEvent(path: string): void {
  const targetWindow = win
  if (!isBrowserWindowAlive(targetWindow)) return

  const emitNavigate = () => {
    if (targetWindow.isDestroyed()) return
    targetWindow.webContents.send('navigate', path)
    setTimeout(() => {
      if (!isBrowserWindowAlive(targetWindow)) return
      targetWindow.webContents.send('navigate', path)
    }, 120)
    setTimeout(() => {
      if (!isBrowserWindowAlive(targetWindow)) return
      targetWindow.webContents.send('navigate', path)
    }, 360)
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once('did-finish-load', emitNavigate)
  } else {
    emitNavigate()
  }
}

function extractNavigationPathFromFileUrl(rawUrl: string): string | null {
  try {
    const parsedUrl = new URL(rawUrl)
    if (parsedUrl.protocol !== 'file:') {
      return null
    }

    const filePath = fileURLToPath(parsedUrl)
    const resolvedFilePath = path.resolve(filePath)
    const rendererIndexPath = path.resolve(path.join(RENDERER_DIST, 'index.html'))

    if (resolvedFilePath === rendererIndexPath) {
      const bootstrapRoute = parsedUrl.searchParams.get(RENDERER_BOOTSTRAP_ROUTE_QUERY_KEY)
      if (bootstrapRoute && bootstrapRoute.startsWith('/')) {
        return bootstrapRoute
      }
      if (parsedUrl.hash.startsWith('#/')) {
        return `${parsedUrl.hash.slice(1)}${parsedUrl.search}`
      }
      return null
    }

    if (fs.existsSync(resolvedFilePath)) {
      return null
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
  } catch {
    return null
  }
}

function extractRendererRoutePath(rawUrl: string): string | null {
  if (!rawUrl) return null

  const protocolPath = extractNavigationPath(rawUrl)
  if (protocolPath) {
    return protocolPath
  }

  if (VITE_DEV_SERVER_URL) {
    try {
      const parsedUrl = new URL(rawUrl)
      if (DEV_SERVER_ORIGIN && parsedUrl.origin === DEV_SERVER_ORIGIN) {
        return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
      }
    } catch {
      // fall through to file-url handling
    }
  }

  return extractNavigationPathFromFileUrl(rawUrl)
}

async function loadRendererAtRoute(
  targetWindow: AppBrowserWindow,
  routePath: string | null,
): Promise<void> {
  if (VITE_DEV_SERVER_URL) {
    if (routePath) {
      const targetUrl = new URL(routePath, VITE_DEV_SERVER_URL)
      await targetWindow.loadURL(targetUrl.toString())
      return
    }

    await targetWindow.loadURL(VITE_DEV_SERVER_URL)
    return
  }

  if (routePath && routePath !== '/') {
    const rendererBootstrapUrl = pathToFileURL(path.join(RENDERER_DIST, 'index.html'))
    rendererBootstrapUrl.searchParams.set(RENDERER_BOOTSTRAP_ROUTE_QUERY_KEY, routePath)
    await targetWindow.loadURL(rendererBootstrapUrl.toString())
    return
  }

  await targetWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
}

// Lazy-loaded paths (app.getPath not available at module load time in ESM)
let _settingsPath: string | null = null
let _defaultSettings: AppSettings | null = null

function getSettingsPath(): string {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json')
  return _settingsPath
}

function getDefaultSettings(): AppSettings {
  if (!_defaultSettings) {
    _defaultSettings = {
      projectsDirectory: path.join(app.getPath('home'), 'Developer', 'Cozea'),
      previewHeaderCompatibilityEnabled: true,
      approvedExternalReadRoots: [],
      deactivateTransparency: false,
    }
  }
  return _defaultSettings
}

/** Backing color for opaque windows (transparency deactivated, Windows, Linux).
 * Must track the renderer's --background (src/index.css) so pre-paint and
 * resize flashes match the page. */
function getThemedOpaqueBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#d4d4d4'
}

/** Windows caption-control glyph color; must stay legible against the page. */
function getThemedCaptionSymbolColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#f5f5f6' : '#111827'
}

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(getSettingsPath())) {
      const data = fs.readFileSync(getSettingsPath(), 'utf-8')
      return { ...getDefaultSettings(), ...JSON.parse(data) }
    }
  } catch (err) {
    console.error('Failed to load settings:', err)
  }
  return getDefaultSettings()
}

function saveSettings(settings: Partial<AppSettings>): void {
  try {
    const current = loadSettings()
    const updated = { ...current, ...settings }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

async function syncProjectsDirectoryToWorkspaceCatalog(): Promise<void> {
  const projectsDirectory = loadSettings().projectsDirectory?.trim()
  if (!projectsDirectory) return

  try {
    await fs.promises.mkdir(projectsDirectory, { recursive: true })
    const runtime = await waitForWorkspaceCatalogRuntime()
    await runtime.runPromise(
      Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) =>
        catalog.setSetting('projectsDirectory', projectsDirectory),
      ),
    )
  } catch (error) {
    console.warn('[Settings] Failed to sync projects directory to workspace catalog.', error)
  }
}

type ResponseHeaderMap = Record<string, string | string[]>

function findHeaderKey(headers: ResponseHeaderMap, targetName: string): string | null {
  const normalizedTargetName = targetName.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedTargetName) {
      return key
    }
  }
  return null
}

function removeFrameAncestorsDirective(policy: string): { policy: string | null; removed: boolean } {
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)
  const nextDirectives = directives.filter((directive) => !directive.toLowerCase().startsWith('frame-ancestors'))
  return {
    policy: nextDirectives.length > 0 ? nextDirectives.join('; ') : null,
    removed: nextDirectives.length !== directives.length,
  }
}

function toHeaderValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

function setHeaderValue(headers: ResponseHeaderMap, targetName: string, value: string): void {
  const existingKey = findHeaderKey(headers, targetName)
  headers[existingKey ?? targetName] = [value]
}

function hasHeaderValue(headers: ResponseHeaderMap, targetName: string, expectedValues: string[]): boolean {
  const key = findHeaderKey(headers, targetName)
  if (!key) return false
  const normalizedExpected = new Set(expectedValues.map((value) => value.trim().toLowerCase()))
  return toHeaderValues(headers[key]).some((value) => normalizedExpected.has(value.trim().toLowerCase()))
}

function isLoopbackPreviewUrl(rawUrl: string): boolean {
  try {
    const parsedUrl = new URL(rawUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return false
    return (
      parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '127.0.0.1' ||
      parsedUrl.hostname === '[::1]' ||
      parsedUrl.hostname === '::1'
    )
  } catch {
    return false
  }
}

function isRendererDevServerUrl(rawUrl: string): boolean {
  if (!DEV_SERVER_ORIGIN) return false
  try {
    return new URL(rawUrl).origin === DEV_SERVER_ORIGIN
  } catch {
    return false
  }
}

let previewHeaderPolicyInstalled = false
let previewHeaderCompatDisabledLogged = false
let gpuDiagnostics: GpuAccelerationDiagnostics = {
  hardwareAccelerationEnabled: true,
  featureStatus: {},
  gpuCompositing: null,
  webgl: null,
  webgl2: null,
  rasterization: null,
  videoDecode: null,
  updatedAt: 0,
}

function readGpuFeatureStatus(): Record<string, string> {
  try {
    const rawStatus = app.getGPUFeatureStatus() as unknown as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(rawStatus).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function refreshGpuDiagnostics(): void {
  const featureStatus = readGpuFeatureStatus()
  gpuDiagnostics = {
    hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
    featureStatus,
    gpuCompositing: featureStatus.gpu_compositing ?? null,
    webgl: featureStatus.webgl ?? null,
    webgl2: featureStatus.webgl2 ?? null,
    rasterization: featureStatus.rasterization ?? null,
    videoDecode: featureStatus.video_decode ?? null,
    updatedAt: Date.now(),
  }
}
const previewHeaderDiagnostics = new Map<string, PreviewHeaderDiagnostic>()
const PREVIEW_HEADER_DIAGNOSTIC_TTL_MS = 60_000
const PREVIEW_HEADER_DIAGNOSTIC_MAX_ENTRIES = 400
const ASSISTANT_RUNTIME_STATUS_CHANNEL = 'assistantRuntime:status'
const ASSISTANT_RUNTIME_STATUS_HANDLE = 'assistantRuntime:getStatus'
const SUBSTRATE_SHADOW_STATUS_HANDLE = 'substrateShadow:getStatus'

type AssistantRuntimePhase = 'idle' | 'starting' | 'ready' | 'error'

interface AssistantRuntimeStatus {
  phase: AssistantRuntimePhase
  wsUrl: string | null
  lastError: string | null
  updatedAt: number
}

let assistantRuntimeStatus: AssistantRuntimeStatus = {
  phase: 'idle',
  wsUrl: ASSISTANT_RUNTIME_WS_URL,
  lastError: null,
  updatedAt: Date.now(),
}
let assistantRuntimeGeneration = 0
let shadowHostedRuntimeMonitor: ShadowHostedRuntimeMonitorController | null = null
let appIsQuitting = false
let assistantRuntimeBridgeHandlersRegistered = false

function logAssistantBridge(event: string, details?: Record<string, unknown>): void {
  if (details && Object.keys(details).length > 0) {
    console.info('[CozeaChatBridge]', event, details)
    return
  }
  console.info('[CozeaChatBridge]', event)
}

function readAssistantRuntimeStatus(): AssistantRuntimeStatus {
  return { ...assistantRuntimeStatus }
}

function broadcastAssistantRuntimeStatus(): void {
  const payload = readAssistantRuntimeStatus()
  forEachBroadcastWindow((browserWindow) => {
    if (browserWindow.webContents.isDestroyed()) return
    browserWindow.webContents.send(ASSISTANT_RUNTIME_STATUS_CHANNEL, payload)
  })
}

function setAssistantRuntimeStatus(
  patch: Partial<Omit<AssistantRuntimeStatus, 'updatedAt'>>,
): void {
  const previousStatus = assistantRuntimeStatus
  const nextStatus: AssistantRuntimeStatus = {
    ...assistantRuntimeStatus,
    ...patch,
    updatedAt: Date.now(),
  }

  if (
    nextStatus.phase === assistantRuntimeStatus.phase &&
    nextStatus.wsUrl === assistantRuntimeStatus.wsUrl &&
    nextStatus.lastError === assistantRuntimeStatus.lastError
  ) {
    assistantRuntimeStatus = nextStatus
    return
  }

  assistantRuntimeStatus = nextStatus
  logAssistantBridge('runtime-status', {
    previousPhase: previousStatus.phase,
    nextPhase: nextStatus.phase,
    lastError: nextStatus.lastError,
  })
  broadcastAssistantRuntimeStatus()
}

function ensureAssistantRuntimeStarted(): void {
  assistantRuntimeGeneration += 1
  beginShadowHostedRuntimeMonitor(assistantRuntimeGeneration)
}

let shadowServerManager: ShadowServerManager | null = null
let shadowServerStartInFlight: Promise<void> | null = null
let substrateWslSettingsPath: string | null = null

function resolveSubstrateWslSettingsPath(): string {
  if (!substrateWslSettingsPath) {
    substrateWslSettingsPath = path.join(app.getPath('userData'), 'substrate-wsl-backend.json')
  }
  return substrateWslSettingsPath
}

function logSubstrateShadow(event: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(`[SubstrateShadow] ${event}`, details)
    return
  }
  console.info(`[SubstrateShadow] ${event}`)
}

async function ensureSubstrateShadowServerStarted(): Promise<void> {
  // The shadow owns the T3 process that serves orchestration streams, preview
  // automation brokering, and short-lived signed media URLs for thread artifacts.
  const flags = readSubstrateShadowServerFlags()
  const obs = getSharedSubstrateNdjsonWriter()
  if (!flags.enabled) {
    logSubstrateShadow('skip-disabled', { flagId: flags.flagId })
    return
  }

  if (shadowServerStartInFlight) {
    await shadowServerStartInFlight
    return
  }

  shadowServerStartInFlight = (async () => {
    const logsRootDirectory = path.join(app.getPath('logs'), 'substrate-shadow')
    const entryPath = resolveShadowServerEntryPath(__dirname)
    const pool =
      getDesktopBackendPool() ??
      createDesktopBackendPool({
        entryPath,
        logsRootDirectory,
      })
    logSubstrateShadow('starting', {
      host: flags.host,
      port: flags.port,
      entryPath,
      logsRootDirectory,
      pool: true,
      previewAutomation: true,
    })
    obs.writeSpan({
      name: 'substrate.shadow.start',
      attrs: {
        host: flags.host,
        port: flags.port,
        logsRootDirectory,
        pool: true,
        previewAutomation: true,
      },
    })
    const status = await pool.register({
      id: PRIMARY_BACKEND_INSTANCE_ID,
      kind: 'local',
      label: process.platform === 'darwin' ? 'This Mac / local' : 'Local machine',
      host: flags.host,
      port: flags.port,
      logDirectory: pool.resolvePrimaryLogDirectory(),
      t3BaseDir: pool.resolveInstanceT3BaseDir(PRIMARY_BACKEND_INSTANCE_ID),
    })
    shadowServerManager = pool.getPrimaryManager()
    logSubstrateShadow('started', {
      phase: status.phase,
      baseUrl: status.baseUrl,
      readyPath: status.readyPath,
      pid: status.pid,
    })
    obs.writeSpan({
      name: 'substrate.shadow.ready',
      attrs: {
        phase: status.phase,
        baseUrl: status.baseUrl,
        readyPath: status.readyPath,
        pid: status.pid,
      },
    })
    const featureFlags = readSubstrateFeatureFlags()
    if (status.phase === 'ready' && featureFlags.primary) {
      assistantRuntimeGeneration += 1
      beginShadowHostedRuntimeMonitor(assistantRuntimeGeneration)
      try {
        await reconcileWslBackend({
          pool,
          settingsPath: resolveSubstrateWslSettingsPath(),
        })
      } catch (error) {
        logSubstrateShadow('wsl-reconcile-failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })()

  try {
    await shadowServerStartInFlight
  } finally {
    shadowServerStartInFlight = null
  }
}

async function stopSubstrateShadowServer(): Promise<void> {
  const pool = getDesktopBackendPool()
  if (pool) {
    try {
      await pool.stopAll()
      shadowServerManager = null
      logSubstrateShadow('stopped')
    } catch (error) {
      logSubstrateShadow('stop-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }
  const manager = shadowServerManager ?? getShadowServerManager()
  if (!manager) {
    return
  }
  try {
    await manager.stop()
    logSubstrateShadow('stopped')
  } catch (error) {
    logSubstrateShadow('stop-failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function registerSubstrateShadowBridgeHandlers(): void {
  ipcMain.removeHandler(SUBSTRATE_SHADOW_STATUS_HANDLE)
  ipcMain.handle(SUBSTRATE_SHADOW_STATUS_HANDLE, () => {
    const featureFlags = readSubstrateFeatureFlags()
    const manager = shadowServerManager ?? getPrimaryShadowServerManager() ?? getShadowServerManager()
    const remoteEnvironments = listSubstrateRemoteEnvironments({
      wslSettingsPath: resolveSubstrateWslSettingsPath(),
    })
    if (!manager) {
      const flags = featureFlags.shadowServer
      return {
        phase: flags.enabled ? 'stopped' : 'stopped',
        enabled: flags.enabled,
        flagId: flags.flagId,
        host: flags.host,
        port: flags.port,
        baseUrl: `http://${flags.host}:${flags.port}`,
        readyPath: '/.well-known/cozea/substrate/ready',
        pin: null,
        pid: null,
        lastError: null,
        startedAtMs: null,
        readyAtMs: null,
        features: {
          rpcChat: featureFlags.rpcChat,
          providers: featureFlags.providers,
          vcs: featureFlags.vcs,
          primary: featureFlags.primary,
          obsNdjson: featureFlags.obsNdjson,
          inProcessAssistant: false,
        },
        remoteEnvironments,
      }
    }
    return {
      ...manager.getStatus(),
      features: {
        rpcChat: featureFlags.rpcChat,
        providers: featureFlags.providers,
        vcs: featureFlags.vcs,
        primary: featureFlags.primary,
        obsNdjson: featureFlags.obsNdjson,
        inProcessAssistant: false,
      },
      remoteEnvironments,
    }
  })
}

function stopShadowHostedRuntimeMonitor(): void {
  shadowHostedRuntimeMonitor?.stop()
  shadowHostedRuntimeMonitor = null
}

function beginShadowHostedRuntimeMonitor(generation: number): void {
  stopShadowHostedRuntimeMonitor()
  const featureFlags = readSubstrateFeatureFlags()
  const shadowManager = shadowServerManager ?? getPrimaryShadowServerManager() ?? getShadowServerManager()
  const shadowBaseUrl = shadowManager?.baseUrl ?? `http://${featureFlags.shadowServer.host}:${featureFlags.shadowServer.port}`
  shadowHostedRuntimeMonitor = startShadowHostedRuntimeMonitor({
    generation,
    onStarting: () => {
      setAssistantRuntimeStatus({
        phase: 'starting',
        lastError: null,
      })
    },
    onReady: () => {
      logAssistantBridge('shadow-hosted-runtime-ready', { generation })
      setAssistantRuntimeStatus({
        phase: 'ready',
        lastError: null,
      })
    },
    onError: (message) => {
      logAssistantBridge('shadow-hosted-runtime-error', { generation, message })
      setAssistantRuntimeStatus({
        phase: 'error',
        lastError:
          message.trim().length > 0
            ? message
            : 'Shadow-hosted assistant runtime failed to become ready.',
      })
    },
    onLog: (event, details) => logAssistantBridge(event, details),
    shouldApply: (activeGeneration) =>
      !appIsQuitting && activeGeneration === assistantRuntimeGeneration,
    httpOrigin: ASSISTANT_RUNTIME_HTTP_URL ?? undefined,
    shadowBaseUrl,
    preferT3Server: featureFlags.t3Server,
  })
}

function registerAssistantRuntimeBridgeHandlers(): void {
  if (assistantRuntimeBridgeHandlersRegistered) {
    logAssistantBridge('ipc-bridge-handlers-reused', {
      statusHandle: ASSISTANT_RUNTIME_STATUS_HANDLE,
    })
    return
  }

  ipcMain.removeHandler(ASSISTANT_RUNTIME_STATUS_HANDLE)
  logAssistantBridge('ipc-bridge-handlers-registered', {
    statusChannel: ASSISTANT_RUNTIME_STATUS_CHANNEL,
    statusHandle: ASSISTANT_RUNTIME_STATUS_HANDLE,
  })
  ipcMain.handle(ASSISTANT_RUNTIME_STATUS_HANDLE, () => readAssistantRuntimeStatus())
  assistantRuntimeBridgeHandlersRegistered = true
}

function prunePreviewHeaderDiagnostics(now = Date.now()): void {
  for (const [url, entry] of previewHeaderDiagnostics.entries()) {
    if (now - entry.capturedAt > PREVIEW_HEADER_DIAGNOSTIC_TTL_MS) {
      previewHeaderDiagnostics.delete(url)
    }
  }

  if (previewHeaderDiagnostics.size <= PREVIEW_HEADER_DIAGNOSTIC_MAX_ENTRIES) {
    return
  }

  const sortedEntries = Array.from(previewHeaderDiagnostics.entries()).sort(
    (a, b) => a[1].capturedAt - b[1].capturedAt
  )
  const overflow = sortedEntries.length - PREVIEW_HEADER_DIAGNOSTIC_MAX_ENTRIES
  for (let index = 0; index < overflow; index += 1) {
    previewHeaderDiagnostics.delete(sortedEntries[index][0])
  }
}

function rememberPreviewHeaderDiagnostic(entry: PreviewHeaderDiagnostic): void {
  previewHeaderDiagnostics.set(entry.url, entry)
  prunePreviewHeaderDiagnostics(entry.capturedAt)
}

function getLatestPreviewHeaderDiagnostic(url: string): PreviewHeaderDiagnostic | null {
  prunePreviewHeaderDiagnostics()
  const direct = previewHeaderDiagnostics.get(url)
  if (direct) return direct

  let targetOrigin: string | null = null
  try {
    targetOrigin = new URL(url).origin
  } catch {
    targetOrigin = null
  }
  if (!targetOrigin) return null

  let latest: PreviewHeaderDiagnostic | null = null
  for (const diagnostic of previewHeaderDiagnostics.values()) {
    let diagnosticOrigin: string | null = null
    try {
      diagnosticOrigin = new URL(diagnostic.url).origin
    } catch {
      diagnosticOrigin = null
    }
    if (!diagnosticOrigin || diagnosticOrigin !== targetOrigin) continue
    if (!latest || diagnostic.capturedAt > latest.capturedAt) {
      latest = diagnostic
    }
  }
  return latest
}

function installPreviewHeaderCompatibilityPolicy(): void {
  if (previewHeaderPolicyInstalled) return
  previewHeaderPolicyInstalled = true

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
      callback({})
      return
    }

    const isLoopbackUrl = isLoopbackPreviewUrl(details.url)
    const isDevRendererUrl = isRendererDevServerUrl(details.url)

    if (!isLoopbackUrl && !isDevRendererUrl) {
      callback({})
      return
    }

    const responseHeaders: ResponseHeaderMap = details.responseHeaders
      ? { ...details.responseHeaders }
      : {}
    let responseHeadersChanged = false

    if (isDevRendererUrl) {
      const cspKey = findHeaderKey(responseHeaders, 'content-security-policy')
      if (!cspKey) {
        setHeaderValue(responseHeaders, 'Content-Security-Policy', DEV_CONTENT_SECURITY_POLICY)
        responseHeadersChanged = true
      }
    }

    if (!isLoopbackUrl) {
      callback(
        responseHeadersChanged
          ? {
              responseHeaders,
              statusLine: details.statusLine,
            }
          : {}
      )
      return
    }

    const resourceType = details.resourceType === 'mainFrame' ? 'mainFrame' : 'subFrame'

    const previewHeaderCompatibilityEnabled = loadSettings().previewHeaderCompatibilityEnabled
    if (!previewHeaderCompatibilityEnabled) {
      if (!previewHeaderCompatDisabledLogged) {
        previewHeaderCompatDisabledLogged = true
        console.log('[PreviewHeaders] Localhost header compatibility policy is disabled by settings')
      }
      rememberPreviewHeaderDiagnostic({
        url: details.url,
        resourceType,
        compatibilityEnabled: false,
        rewritten: false,
        removed: [],
        ensured: [],
        capturedAt: Date.now(),
      })
      callback(
        responseHeadersChanged
          ? {
              responseHeaders,
              statusLine: details.statusLine,
            }
          : {}
      )
      return
    }

    if (previewHeaderCompatDisabledLogged) {
      previewHeaderCompatDisabledLogged = false
    }

    if (!details.responseHeaders) {
      rememberPreviewHeaderDiagnostic({
        url: details.url,
        resourceType,
        compatibilityEnabled: true,
        rewritten: false,
        removed: [],
        ensured: [],
        capturedAt: Date.now(),
      })
      callback(
        responseHeadersChanged
          ? {
              responseHeaders,
              statusLine: details.statusLine,
            }
          : {}
      )
      return
    }
    let removedXFrameOptions = false
    let removedFrameAncestors = false
    const ensuredHeaderNames: string[] = []

    const xFrameOptionsKey = findHeaderKey(responseHeaders, 'x-frame-options')
    if (xFrameOptionsKey) {
      delete responseHeaders[xFrameOptionsKey]
      removedXFrameOptions = true
    }

    const cspKey = findHeaderKey(responseHeaders, 'content-security-policy')
    if (cspKey) {
      const rewrittenPolicies: string[] = []
      for (const value of toHeaderValues(responseHeaders[cspKey])) {
        const rewritten = removeFrameAncestorsDirective(value)
        removedFrameAncestors = removedFrameAncestors || rewritten.removed
        if (rewritten.policy) rewrittenPolicies.push(rewritten.policy)
      }

      if (removedFrameAncestors) {
        if (rewrittenPolicies.length > 0) {
          responseHeaders[cspKey] = rewrittenPolicies
        } else {
          delete responseHeaders[cspKey]
        }
      }
    }

    if (resourceType === 'subFrame') {
      // The renderer dev shell is COEP/COOP isolated in dev. Embedded localhost previews
      // must advertise compatible policies as well or Chromium blocks the iframe before
      // the preview bridge can inject.
      if (!hasHeaderValue(responseHeaders, 'cross-origin-embedder-policy', ['credentialless', 'require-corp'])) {
        setHeaderValue(responseHeaders, 'Cross-Origin-Embedder-Policy', 'credentialless')
        ensuredHeaderNames.push('cross-origin-embedder-policy:credentialless')
      }

      if (!hasHeaderValue(responseHeaders, 'cross-origin-resource-policy', ['cross-origin'])) {
        setHeaderValue(responseHeaders, 'Cross-Origin-Resource-Policy', 'cross-origin')
        ensuredHeaderNames.push('cross-origin-resource-policy:cross-origin')
      }
    }

    if (!removedXFrameOptions && !removedFrameAncestors && ensuredHeaderNames.length === 0) {
      rememberPreviewHeaderDiagnostic({
        url: details.url,
        resourceType,
        compatibilityEnabled: true,
        rewritten: false,
        removed: [],
        ensured: [],
        capturedAt: Date.now(),
      })
      callback(
        responseHeadersChanged
          ? {
              responseHeaders,
              statusLine: details.statusLine,
            }
          : {}
      )
      return
    }

    const removedHeaderNames: string[] = []
    if (removedXFrameOptions) removedHeaderNames.push('x-frame-options')
    if (removedFrameAncestors) removedHeaderNames.push('content-security-policy:frame-ancestors')
    responseHeadersChanged = true

    rememberPreviewHeaderDiagnostic({
      url: details.url,
      resourceType,
      compatibilityEnabled: true,
      rewritten: true,
      removed: removedHeaderNames,
      ensured: ensuredHeaderNames,
      capturedAt: Date.now(),
    })

    callback({
      responseHeaders,
      statusLine: details.statusLine,
    })
  })
}

type AppBrowserWindow = InstanceType<typeof BrowserWindow>

let win: AppBrowserWindow | null = null
let canCreateMainWindow = false
const orgDevAppArtifactService = new OrgDevAppArtifactService(
  () => path.join(app.getPath('userData'), 'org-devapp-artifacts'),
)
const DEFAULT_SETTINGS_ROUTE = '/settings/account'
const SETTINGS_ROUTES = new Set([
  '/settings/account',
  '/settings/appearance',
  '/settings/storage',
  '/settings/tooling',
  '/settings/organizations',
])

function normalizeSettingsRoute(route?: string): string {
  if (!route) return DEFAULT_SETTINGS_ROUTE
  const queryIndex = route.indexOf('?')
  const pathOnly = queryIndex === -1 ? route : route.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : route.slice(queryIndex + 1)
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
  const normalizedPath = withLeadingSlash.replace(/\/+$/, '') || '/'
  if (!SETTINGS_ROUTES.has(normalizedPath)) {
    return DEFAULT_SETTINGS_ROUTE
  }

  return query ? `${normalizedPath}?${query}` : normalizedPath
}

function isBrowserWindowAlive(windowRef: AppBrowserWindow | null): windowRef is AppBrowserWindow {
  return Boolean(windowRef && !windowRef.isDestroyed())
}

function attachPreviewDebugLogging(targetWindow: AppBrowserWindow, label: 'main'): void {
  targetWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      const isLocalPreview = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+/i.test(validatedURL)
      if (!isMainFrame && !isLocalPreview) return

      const frameType = isMainFrame ? 'main-frame' : 'sub-frame'
      console.error(
        `[Renderer:${label}] did-fail-load (${frameType}) ${errorCode} ${errorDescription} ${validatedURL}`
      )
    }
  )
}

async function openSettingsWindow(route?: string): Promise<{ success: boolean; error?: string }> {
  const targetRoute = normalizeSettingsRoute(route)
  const targetWindow = win

  try {
    if (!isBrowserWindowAlive(targetWindow)) {
      return { success: false, error: 'Main window is not available.' }
    }

    if (targetWindow.isMinimized()) targetWindow.restore()
    targetWindow.show()
    targetWindow.focus()

    const sendOpenSettings = () => {
      if (targetWindow.isDestroyed()) return
      targetWindow.webContents.send('settings:open', targetRoute)
    }

    if (targetWindow.webContents.isLoadingMainFrame()) {
      targetWindow.webContents.once('did-finish-load', sendOpenSettings)
    } else {
      sendOpenSettings()
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

interface UpdateState {
  status: UpdateStatus
  version?: string
  releaseName?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
let updateState: UpdateState = { status: 'idle' }
let updateInterval: NodeJS.Timeout | null = null

const isAutoUpdateEnabled = () => app.isPackaged

function resolveReleaseLaneFromVersion(version: string): 'stable' | 'beta' | 'canary' {
  const normalized = version.trim().toLowerCase()
  if (normalized.includes('-canary')) return 'canary'
  if (normalized.includes('-beta')) return 'beta'
  return 'stable'
}

function resolveUpdaterChannelForReleaseLane(lane: 'stable' | 'beta' | 'canary'): 'latest' | 'beta' | 'alpha' {
  switch (lane) {
    case 'canary':
      return 'alpha'
    case 'beta':
      return 'beta'
    default:
      return 'latest'
  }
}

function broadcastUpdateState(state: UpdateState): void {
  forEachBroadcastWindow((window) => {
    if (window.webContents.isDestroyed()) return
    window.webContents.send('updates:status', state)
  })
}

function setUpdateState(next: Partial<UpdateState>): void {
  updateState = { ...updateState, ...next }
  broadcastUpdateState(updateState)
}

function normalizeReleaseNotes(releaseNotes: unknown): string | undefined {
  if (!releaseNotes) return undefined
  if (typeof releaseNotes === 'string') return releaseNotes
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((note) => {
        if (typeof note === 'string') return note
        if (note && typeof note === 'object' && 'note' in note) {
          return String((note as { note?: unknown }).note ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return String(releaseNotes)
}

function registerAutoUpdater(): void {
  if (!isAutoUpdateEnabled()) return

  const releaseLane = resolveReleaseLaneFromVersion(app.getVersion())
  const updaterChannel = resolveUpdaterChannelForReleaseLane(releaseLane)

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.channel = updaterChannel
  autoUpdater.allowPrerelease = updaterChannel !== 'latest'

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      version: info?.version,
      releaseName: info?.releaseName ?? undefined,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      error: undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateState({ status: 'not-available', error: undefined, progress: undefined })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
      error: undefined,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      version: info?.version,
      releaseName: info?.releaseName ?? undefined,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      error: undefined,
      progress: undefined,
    })
  })

  autoUpdater.on('error', (err) => {
    setUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

async function checkForUpdates(): Promise<void> {
  if (!isAutoUpdateEnabled()) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function startUpdateChecks(): void {
  if (!isAutoUpdateEnabled()) return
  void checkForUpdates()
  updateInterval = setInterval(() => {
    void checkForUpdates()
  }, UPDATE_CHECK_INTERVAL_MS)
}

function stopUpdateChecks(): void {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
}

function resolveProtocolLaunchArg(): string {
  const argvEntry = process.argv[1]
  if (argvEntry && !argvEntry.startsWith('-')) {
    return path.resolve(argvEntry)
  }
  return app.getAppPath()
}

function registerProtocolClient(scheme: string): void {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(scheme)
    return
  }

  // In dev, always register with the app entry arg. Without this macOS may launch
  // plain Electron and show the default splash page on deep-link callbacks.
  const launchArg = resolveProtocolLaunchArg()
  app.setAsDefaultProtocolClient(scheme, process.execPath, [launchArg])
}

// Register custom protocol(s)
for (const scheme of SUPPORTED_PROTOCOLS) {
  registerProtocolClient(scheme)
}

// Handle protocol on macOS
app.on('open-url', async (event, url) => {
  event.preventDefault()
  if (matchesProtocolUrl(url, 'oauth/callback')) {
    await forwardIntegrationOAuthCallback({
      url,
      integrationService: IntegrationService.getInstance(),
      sender: win?.webContents ?? null,
    })
  } else {
    const navigationPath = extractNavigationPath(url)
    if (navigationPath) {
      sendNavigateEvent(navigationPath)
    }
  }

  // Focus the window
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})


// Handle protocol on Windows/Linux (single instance)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, focus the window
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }

    // Handle protocol URL on Windows/Linux
    const url = findProtocolArg(commandLine)
    if (url) {
      if (matchesProtocolUrl(url, 'oauth/callback')) {
        void forwardIntegrationOAuthCallback({
          url,
          integrationService: IntegrationService.getInstance(),
          sender: win?.webContents ?? null,
        })
      } else {
        const navigationPath = extractNavigationPath(url)
        if (navigationPath) {
          sendNavigateEvent(navigationPath)
        }
      }
    }
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const isReleaseBuild = app.isPackaged
  const userSettings = loadSettings()
  // Restore the persisted theme source before computing native colors, so a
  // cold start doesn't follow the OS theme until the renderer syncs it.
  const persistedThemeSource = userSettings.nativeThemeSource
  if (persistedThemeSource === 'system' || persistedThemeSource === 'light' || persistedThemeSource === 'dark') {
    nativeTheme.themeSource = persistedThemeSource
  }
  const useTransparency = isMac && !userSettings.deactivateTransparency
  let routeRecoveryInFlight = false

  // Load window state
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  })

  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    show: false, // Hide initially for smooth launch
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Keep development windows paintable while macOS UI automation owns
      // foreground focus. Production retains Electron's power-saving default.
      backgroundThrottling: isReleaseBuild,
      devTools: !isReleaseBuild,
      additionalArguments: [
        '--cozea-window=main',
        ...(ASSISTANT_RUNTIME_WS_URL_ARG ? [ASSISTANT_RUNTIME_WS_URL_ARG] : []),
      ],
    },
    // Native material effects:
    // - macOS: transparent window + vibrancy so translucent sidebar can blur behind.
    // - Windows 11: system backdrop material.
    transparent: useTransparency,
    backgroundColor: useTransparency ? '#00000000' : getThemedOpaqueBackground(),
    vibrancy: useTransparency ? 'sidebar' : undefined, // options: 'sidebar' | 'under-window' | 'hud' | 'popover' ...
    visualEffectState: useTransparency ? 'active' : undefined,
    backgroundMaterial: isWindows ? 'mica' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : (isWindows ? 'hidden' : 'default'),
    titleBarOverlay: isWindows
      ? {
          color: '#00000000',
          symbolColor: getThemedCaptionSymbolColor(),
          height: 36,
        }
      : false,
    trafficLightPosition: isMac ? { x: 15, y: 10 } : undefined,
  })

  attachPreviewDebugLogging(win, 'main')

  const reloadCurrentRendererRoute = () => {
    const targetWindow = win
    if (!isBrowserWindowAlive(targetWindow)) return

    const routePath = extractRendererRoutePath(targetWindow.webContents.getURL())
    void loadRendererAtRoute(targetWindow, routePath).catch((error) => {
      console.error('[Renderer:main] Failed to reload current route', error)
    })
  }

  win.webContents.on(
    'did-fail-load',
    (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || routeRecoveryInFlight) {
        return
      }

      const routePath = extractRendererRoutePath(validatedURL)
      if (!routePath) {
        return
      }

      const targetWindow = win
      if (!isBrowserWindowAlive(targetWindow)) {
        return
      }

      routeRecoveryInFlight = true
      void loadRendererAtRoute(targetWindow, routePath)
        .catch((error) => {
          console.error('[Renderer:main] Failed to recover renderer route load', error)
        })
        .finally(() => {
          routeRecoveryInFlight = false
        })
    }
  )

  // Set application menu
  createApplicationMenu({
    onOpenSettings: () => {
      void openSettingsWindow()
    },
  })

  // Register window state listeners
  mainWindowState.manage(win)

  const emitFullScreenChange = () => {
    if (!win || win.isDestroyed()) return
    win.webContents.send('window:fullscreen-change', win.isFullScreen())
  }

  const emitPendingFullScreenChange = (nextValue: boolean) => {
    if (!win || win.isDestroyed()) return
    win.webContents.send('window:fullscreen-change', nextValue)
  }

  win.on('enter-full-screen', () => emitPendingFullScreenChange(true))
  win.on('leave-full-screen', () => emitPendingFullScreenChange(false))
  win.on('enter-html-full-screen', () => emitPendingFullScreenChange(true))
  win.on('leave-html-full-screen', () => emitPendingFullScreenChange(false))

  if (isReleaseBuild) {
    // Prevent browser-style navigations/popups in packaged builds.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
        void shell.openExternal(url)
      }
    })

    win.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase()
      const isReloadShortcut = input.key === 'F5' || (input.control || input.meta) && key === 'r'
      const isDevToolsShortcut =
        input.key === 'F12' ||
        ((input.control || input.meta) && input.alt && key === 'i') ||
        ((input.control || input.meta) && input.shift && key === 'i')
      if (isReloadShortcut || isDevToolsShortcut) {
        event.preventDefault()
        if (isReloadShortcut) {
          reloadCurrentRendererRoute()
        }
      }
    })
  } else {
    // Keep a local shortcut handler in dev so DevTools can be toggled
    // even when focus is inside embedded terminals.
    win.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase()
      const isReloadShortcut = input.key === 'F5' || (input.control || input.meta) && key === 'r'
      const isDevToolsShortcut =
        input.key === 'F12' ||
        ((input.control || input.meta) && input.alt && key === 'i') ||
        ((input.control || input.meta) && input.shift && key === 'i')

      if (isReloadShortcut) {
        event.preventDefault()
        reloadCurrentRendererRoute()
        return
      }

      if (isDevToolsShortcut) {
        event.preventDefault()
        win?.webContents.toggleDevTools()
      }
    })
  }

  // Show window when ready to prevent flickering
  win.once('ready-to-show', () => {
    win?.show()
    win?.focus()
    emitFullScreenChange()
    logBootTiming('main-window-ready-to-show')
  })

  // Re-theme the window backing on system theme change. The vibrancy window
  // must stay fully transparent; opaque windows (transparency deactivated on
  // macOS, Windows, Linux) follow the themed background so resize/load flashes
  // match the page instead of flashing black.
  const handleNativeThemeUpdated = () => {
    if (!win) return
    if (useTransparency) {
      win.setBackgroundColor('#00000000')
      return
    }
    win.setBackgroundColor(getThemedOpaqueBackground())
    if (isWindows) {
      win.setTitleBarOverlay({ symbolColor: getThemedCaptionSymbolColor() })
    }
  }
  nativeTheme.on('updated', handleNativeThemeUpdated)
  // createWindow runs again when the app is re-activated after all windows
  // closed; without cleanup each run would stack another listener capturing
  // a stale useTransparency.
  win.once('closed', () => {
    nativeTheme.removeListener('updated', handleNativeThemeUpdated)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    if (process.env.COZEA_OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  setBroadcastMainWindow(win)
}

// IPC Handlers
// Register Services
TerminalService.getInstance().registerIpcHandlers()
IntegrationService.getInstance().registerIpcHandlers()
CollabEncryptionService.getInstance().registerIpcHandlers()
AgentToolService.getInstance().registerIpcHandlers()

// Override terminal handlers to support workspaceId (UUID) → resolve to
// real filesystem path before delegating to TerminalService.
registerTerminalWorkspaceHandlers(ipcMain, TerminalService.getInstance())

registerCoreHandlers(ipcMain, {
  
  
  getUpdateState: () => updateState,
  isAutoUpdateEnabled,
  checkForUpdates,
  downloadUpdate: async () => {
    await autoUpdater.downloadUpdate()
  },
  installUpdate: () => autoUpdater.quitAndInstall(),
  setUpdateError: (message) => {
    setUpdateState({
      status: 'error',
      error: message,
    })
  },
  openExternal: (url) => shell.openExternal(url),
  listAvailableBrowsers,
  openInBrowser: ({ url, browserId }) => openUrlInBrowser(url, browserId),
  listAvailableEditors,
  openInEditor: ({ editorId, filePath, line, column }) => {
    if (editorId === 'cozea') {
      return Promise.resolve()
    }
    return openFileInExternalEditor({ editorId, filePath, line, column })
  },
  getGpuDiagnostics: () => gpuDiagnostics,
  setNativeThemeSource: async (source) => {
    nativeTheme.themeSource = source
    if (loadSettings().nativeThemeSource !== source) {
      saveSettings({ nativeThemeSource: source })
    }
  },
  isWindowFullScreen: () => win?.isFullScreen() ?? false,
  openSettingsWindow,
})

registerPreviewHandlers(ipcMain, {
  getMainWindow: () => win,
  getLatestPreviewHeaderDiagnostic,
})

registerNativePreviewHandlers(ipcMain, {
  getMainWindow: () => win,
})


registerSettingsStorageHandlers(ipcMain, {
  getMainWindow: () => win,
  loadSettings,
  saveSettings,
})

registerProjectHandlers(ipcMain, {
  loadSettings,
})

registerRuntimeHandlers(ipcMain)

registerWorkspaceSyncHandlers(ipcMain)

registerYjsHandlers(ipcMain)

registerOrgDevAppHandlers(ipcMain, {
  service: orgDevAppArtifactService,
})

registerWorkbenchSessionHandlers(ipcMain, {
  getMainWindow: () => win,
})

registerDevServerHandlers(ipcMain, {
  getMainWindow: () => win,
})

registerContextMenuHandlers(ipcMain, {
  getMainWindow: () => win,
})

app.on('window-all-closed', () => {
  orgDevAppArtifactService.dispose()
  setBroadcastMainWindow(null)
  win = null

  // Kill all DevServer background processes
  DevServerService.getInstance().killAll()
  PreviewSnapshotService.getInstance().dispose()
  // The native ranker is a long-lived child; never leave it behind after Electron exits.
  LocalAutomationResolverService.getInstance().dispose()

  // Kill all terminal instances when app closes
  TerminalService.getInstance().killAll()

  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  appIsQuitting = true
  logAssistantBridge('app-before-quit')
  orgDevAppArtifactService.dispose()
  PreviewSnapshotService.getInstance().dispose()
  LocalAutomationResolverService.getInstance().dispose()
  void disposeWorkspaceCatalogRuntime()
  stopUpdateChecks()
  void stopSubstrateShadowServer()
})

app.on('activate', () => {
  if (canCreateMainWindow && BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

registerAssistantRuntimeBridgeHandlers()
registerSubstrateShadowBridgeHandlers()
app.on('gpu-info-update', refreshGpuDiagnostics)

app.whenReady().then(() => {
  logBootTiming('app-ready')
  orgDevAppArtifactService.registerProtocol()
  refreshGpuDiagnostics()
  loadSyncState()
  logBootTiming('sync-state-loaded')

  // Register workspace IPC handlers synchronously so they're available as soon
  // as the renderer loads. Internally each handler awaits catalog readiness.
  registerWorkspaceHandlers(ipcMain, { loadSettings, saveSettings })

  scheduleBootWork('workspace-catalog-initialized', async () => {
    await initWorkspaceCatalogRuntime(app.getPath('userData'))
    await syncProjectsDirectoryToWorkspaceCatalog()
    logBootTiming('workspace-catalog-initialized')
  }, 0)

  installPreviewHeaderCompatibilityPolicy()
  registerAutoUpdater()
  canCreateMainWindow = true
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
    logBootTiming('main-window-created')
  }

  registerSubstrateRemoteHandlers({ wslSettingsPath: resolveSubstrateWslSettingsPath() })

  scheduleBootWork('shell-environment-synced', () => {
    if (process.platform === 'darwin') {
      syncShellEnvironment()
    }
  }, 0)
  // Phase 4: VCS facade + status invalidation (idempotent; also called from
  // registerWorkspaceSyncHandlers). Safe no-op registration when flag is off.
  bootstrapSubstrateVcs()
  registerSubstrateVcsIpcHandlers()

  scheduleBootWork('substrate-shadow-server-started', () => {
    void ensureSubstrateShadowServerStarted().catch((error) => {
      logSubstrateShadow('start-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, 250)
  scheduleBootWork('assistant-runtime-started', () => {
    ensureAssistantRuntimeStarted()
  }, 300)
  scheduleBootWork('update-checks-started', () => {
    startUpdateChecks()
  }, 1_000)

  void (async () => {
    const gitHealth = await getGitRuntimeHealth(true)
    if (!gitHealth.preflightOk) {
      console.error('[GitRuntime] Preflight failed:', gitHealth.error ?? 'Unknown error')
    } else {
      console.log(
        `[GitRuntime] Ready (${gitHealth.source}): ${gitHealth.gitVersion} @ ${gitHealth.executablePath ?? 'unknown'}`
      )
    }
  })()
})
