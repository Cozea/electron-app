import { app, BrowserWindow, shell, ipcMain, nativeTheme, session } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { cancelToolRuns, runTool } from './tools'
import { autoUpdater } from 'electron-updater'
import * as pty from 'node-pty' // Still used for DevServer PTY
import type { AppSettings, PreviewHeaderDiagnostic } from '../shared/electronApiTypes'
import { getGitRuntimeHealth } from './gitRuntime'
import { createApplicationMenu } from './menu'

// Services
import { AuthService } from './services/AuthService'
import { TerminalService } from './services/TerminalService'
import { IntegrationService } from './services/IntegrationService'
import { DatabaseService } from './services/DatabaseService'
import { DiagnosticsService } from './services/DiagnosticsService'
import { DependenciesService } from './services/DependenciesService'
import { ProviderAuthService } from './services/ProviderAuthService'
import { LocalAiRuntimeService } from './services/LocalAiRuntimeService'
import { registerContextMenuHandlers } from './ipc/registerContextMenuHandlers'
import { registerCoreHandlers } from './ipc/registerCoreHandlers'
import { registerDevServerHandlers } from './ipc/registerDevServerHandlers'
import { registerPreviewHandlers } from './ipc/registerPreviewHandlers'
import { registerProjectHandlers } from './ipc/registerProjectHandlers'
import { registerRuntimeHandlers } from './ipc/registerRuntimeHandlers'
import { registerSettingsStorageHandlers } from './ipc/registerSettingsStorageHandlers'
import { registerSyncHandlers } from './ipc/registerSyncHandlers'
import { loadSyncState } from './services/syncReplicaStore'

interface DevServerProcessEntry {
  runId: string
  projectPath: string
  command: string
  port: number
  startedAt: number
  ptyProcess: pty.IPty
}

// Dev server process management
// Maps projectPath to running PTY-backed dev server metadata.
const devServerProcesses = new Map<string, DevServerProcessEntry>()

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
    if (routePath === '/' || routePath.startsWith('/auth/callback') || routePath.startsWith('/billing/') || routePath.startsWith('/oauth/callback')) {
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
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once('did-finish-load', emitNavigate)
  } else {
    emitNavigate()
  }
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
    }
  }
  return _defaultSettings
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

let previewHeaderPolicyInstalled = false
let previewHeaderCompatDisabledLogged = false
const previewHeaderDiagnostics = new Map<string, PreviewHeaderDiagnostic>()
const PREVIEW_HEADER_DIAGNOSTIC_TTL_MS = 60_000
const PREVIEW_HEADER_DIAGNOSTIC_MAX_ENTRIES = 400

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

    if (!isLoopbackPreviewUrl(details.url)) {
      callback({})
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
        capturedAt: Date.now(),
      })
      callback({})
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
        capturedAt: Date.now(),
      })
      callback({})
      return
    }

    const responseHeaders: ResponseHeaderMap = { ...details.responseHeaders }
    let removedXFrameOptions = false
    let removedFrameAncestors = false

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

    if (!removedXFrameOptions && !removedFrameAncestors) {
      rememberPreviewHeaderDiagnostic({
        url: details.url,
        resourceType,
        compatibilityEnabled: true,
        rewritten: false,
        removed: [],
        capturedAt: Date.now(),
      })
      callback({})
      return
    }

    const removedHeaderNames: string[] = []
    if (removedXFrameOptions) removedHeaderNames.push('x-frame-options')
    if (removedFrameAncestors) removedHeaderNames.push('content-security-policy:frame-ancestors')

    rememberPreviewHeaderDiagnostic({
      url: details.url,
      resourceType,
      compatibilityEnabled: true,
      rewritten: true,
      removed: removedHeaderNames,
      capturedAt: Date.now(),
    })

    console.log('[PreviewHeaders] Rewrote localhost preview response headers', {
      url: details.url,
      resourceType: details.resourceType,
      removed: removedHeaderNames,
    })

    callback({
      responseHeaders,
      statusLine: details.statusLine,
    })
  })
}

type AppBrowserWindow = InstanceType<typeof BrowserWindow>

let win: AppBrowserWindow | null = null

const DEFAULT_SETTINGS_ROUTE = '/settings/account'
const SETTINGS_ROUTES = new Set([
  '/settings/account',
  '/settings/billing',
  '/settings/ai',
  '/settings/appearance',
  '/settings/storage',
  '/settings/tooling',
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
  targetWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const isPreviewLog =
      message.includes('[PreviewBridge]') ||
      message.includes('[Bridge]') ||
      message.includes('[PagesPreview]') ||
      message.includes('credentialless')

    if (!isPreviewLog) return

    const prefix = `[Renderer:${label}]`
    const location = sourceId ? `${sourceId}:${line}` : `line:${line}`

    if (level >= 3) {
      console.error(`${prefix} ${message} (${location})`)
      return
    }
    if (level === 2) {
      console.warn(`${prefix} ${message} (${location})`)
      return
    }

    console.log(`${prefix} ${message} (${location})`)
  })

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

function broadcastUpdateState(state: UpdateState): void {
  BrowserWindow.getAllWindows().forEach((window) => {
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

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

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

// Session management logic moved to AuthService

// Handle billing callback (success/cancel from Stripe)
function handleBillingCallback(url: string): void {
  const urlObj = new URL(url)
  const urlPath = urlObj.pathname // '/success' or '/canceled'
  const type = urlObj.searchParams.get('type') // 'subscription'

  // Focus the window
  if (win) {
    // Open the billing settings section with callback status.
    const isSuccess = urlPath === '/success' || urlPath === '//success'
    const isCanceled = urlPath === '/canceled' || urlPath === '//canceled'

    let queryString = ''
    if (isSuccess) {
      queryString = `?success=${type || 'true'}`
    } else if (isCanceled) {
      queryString = '?canceled=true'
    }

    if (queryString) {
      void openSettingsWindow(`/settings/billing${queryString}`)
    }
  }
}

// Handle custom protocol callback
async function handleAuthCallback(url: string): Promise<void> {
  await AuthService.getInstance().handleAuthCallback(url, win)
}

// Register custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Handle protocol on macOS
app.on('open-url', async (event, url) => {
  event.preventDefault()
  if (matchesProtocolUrl(url, 'auth/callback')) {
    handleAuthCallback(url)
  } else if (matchesProtocolUrl(url, 'billing/')) {
    handleBillingCallback(url)
  } else if (matchesProtocolUrl(url, 'oauth/callback')) {
    // Handle integration OAuth callback
    try {
      await IntegrationService.getInstance().handleOAuthCallback(url)
      // Success handled by Service via win.webContents if needed, 
      // but wait, Service assumes it returns a result?
      // Let's check Service implementation. 
      // Service.handleOAuthCallback calls oauthHandler.handleOAuthCallback which returns Promise<Result>.
      // Service just returns that promise.
      // So main.ts needs to handle the response broadcasting.

      const result = await IntegrationService.getInstance().handleOAuthCallback(url)
      if (result.success) {
        win?.webContents.send('integrations:oauthSuccess', result)
      } else {
        win?.webContents.send('integrations:oauthError', { provider: result.provider, error: result.error || 'OAuth failed' })
      }
    } catch (err) {
      console.error('[OAuth] Callback handling error:', err)
      win?.webContents.send('integrations:oauthError', {
        provider: 'unknown',
        error: err instanceof Error ? err.message : 'OAuth callback failed',
      })
    }
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
      if (matchesProtocolUrl(url, 'auth/callback')) {
        handleAuthCallback(url)
      } else if (matchesProtocolUrl(url, 'billing/')) {
        handleBillingCallback(url)
      } else if (matchesProtocolUrl(url, 'oauth/callback')) {
        // Handle integration OAuth callback
        IntegrationService.getInstance().handleOAuthCallback(url)
          .then((result) => {
            if (result.success) {
              win?.webContents.send('integrations:oauthSuccess', result)
            } else {
              win?.webContents.send('integrations:oauthError', { provider: result.provider, error: result.error || 'OAuth failed' })
            }
          })
          .catch((err) => {
            console.error('[OAuth] Callback handling error:', err)
            win?.webContents.send('integrations:oauthError', {
              provider: 'unknown',
              error: err instanceof Error ? err.message : 'OAuth callback failed',
            })
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
  const themedOpaqueBackground = nativeTheme.shouldUseDarkColors ? '#101014' : '#f7f7f8'

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
      devTools: !isReleaseBuild,
      additionalArguments: ['--cozea-window=main'],
    },
    // Native material effects:
    // - macOS: transparent window + vibrancy so translucent sidebar can blur behind.
    // - Windows 11: system backdrop material.
    transparent: isMac,
    backgroundColor: isMac ? '#00000000' : themedOpaqueBackground,
    vibrancy: isMac ? 'sidebar' : undefined, // options: 'sidebar' | 'under-window' | 'hud' | 'popover' ...
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: isWindows ? 'mica' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : (isWindows ? 'hidden' : 'default'),
    titleBarOverlay: isWindows
      ? {
          color: '#00000000',
          symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f6' : '#111827',
          height: 36,
        }
      : false,
    trafficLightPosition: isMac ? { x: 15, y: 10 } : undefined,
  })

  attachPreviewDebugLogging(win, 'main')

  // Set application menu
  createApplicationMenu({
    onOpenSettings: () => {
      void openSettingsWindow()
    },
  })

  // Register window state listeners
  mainWindowState.manage(win)

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
      }
    })
  } else {
    // Keep a local shortcut handler in dev so DevTools can be toggled
    // even when focus is inside embedded terminals.
    win.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase()
      const isDevToolsShortcut =
        input.key === 'F12' ||
        ((input.control || input.meta) && input.alt && key === 'i') ||
        ((input.control || input.meta) && input.shift && key === 'i')

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
  })

  // Update background color on system theme change
  nativeTheme.on('updated', () => {
    if (!win) return
    if (process.platform === 'darwin') {
      // Keep transparent on macOS so vibrancy remains visible.
      win.setBackgroundColor('#00000000')
      return
    }
    const bgColor = nativeTheme.shouldUseDarkColors ? '#101014' : '#f7f7f8'
    win.setBackgroundColor(bgColor)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// IPC Handlers
// Register Services
AuthService.getInstance().registerIpcHandlers()
ProviderAuthService.getInstance().registerIpcHandlers()
LocalAiRuntimeService.getInstance().registerIpcHandlers()
TerminalService.getInstance().registerIpcHandlers()
IntegrationService.getInstance().registerIpcHandlers()
DatabaseService.getInstance().registerIpcHandlers()
DiagnosticsService.getInstance().registerIpcHandlers()
DependenciesService.getInstance().registerIpcHandlers()

registerCoreHandlers(ipcMain, {
  runTool,
  cancelToolRuns: async (runId) => cancelToolRuns(runId),
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
  isWindowFullScreen: () => win?.isFullScreen() ?? false,
  openSettingsWindow,
})

registerPreviewHandlers(ipcMain, {
  getMainWindow: () => win,
  getLatestPreviewHeaderDiagnostic,
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

registerSyncHandlers(ipcMain)

registerDevServerHandlers(ipcMain, {
  devServerProcesses,
  getMainWindow: () => win,
})

registerContextMenuHandlers(ipcMain, {
  getMainWindow: () => win,
})

app.on('window-all-closed', () => {
  win = null

  // Kill all running dev servers when app closes
  for (const [projectPath, processEntry] of devServerProcesses) {
    console.log(`[DevServer] Killing PTY for ${projectPath} (runId=${processEntry.runId})`)
    try {
      processEntry.ptyProcess.kill()
    } catch {
      // Ignore errors when killing on shutdown
    }
  }
  devServerProcesses.clear()

  // Kill all terminal instances when app closes
  TerminalService.getInstance().killAll()

  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  stopUpdateChecks()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  loadSyncState()
  installPreviewHeaderCompatibilityPolicy()
  registerAutoUpdater()
  createWindow()
  startUpdateChecks()

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
