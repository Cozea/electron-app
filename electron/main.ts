import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard, nativeTheme, type WebFrameMain } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs' // Used by DevServer logic
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { cancelToolRuns, runTool } from './tools'
import { autoUpdater } from 'electron-updater'
import { BRIDGE_SCRIPT } from '../shared/previewBridgeScript'
import xxhashInit, { type XXHashAPI } from 'xxhash-wasm'
import * as pty from 'node-pty' // Still used for DevServer PTY
import { resolvePathWithinDirectory } from './pathUtils'
import { notifyFileChanged, notifyFileDeleted } from './yjsNotify'
import { markInternalFsChange, startProjectWatcher, stopProjectWatcher } from './projectWatcher'
import { createApplicationMenu } from './menu'
import { getManifestFromWorker } from './workers/fileOpsManager'

// Services
import { AuthService } from './services/AuthService'
import { TerminalService } from './services/TerminalService'
import { IntegrationService } from './services/IntegrationService'
import { DatabaseService } from './services/DatabaseService'
import { PerformanceService, type PerfBatch } from './services/PerformanceService'
import { DiagnosticsService } from './services/DiagnosticsService'
import { DependenciesService } from './services/DependenciesService'

// xxhash instance for file hashing
// The hasher object contains h64Raw for direct hashing of Uint8Array
let xxhasher: XXHashAPI | null = null

// Dev server process management
// Maps projectPath to running PTY instance for proper terminal emulation
const devServerProcesses = new Map<string, pty.IPty>()

// ============================================
// Terminal Management (VS Code-style multi-terminal)
// ============================================
// Logic moved to TerminalService

const execAsync = promisify(exec)
const mainStart = performance.now()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Dev server URL from electron-vite (ELECTRON_RENDERER_URL) or legacy var
export const VITE_DEV_SERVER_URL =
  process.env['VITE_DEV_SERVER_URL'] || process.env['ELECTRON_RENDERER_URL']

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'out/main')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'out/renderer')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const PROTOCOL = 'cozea'

// Default settings
interface AppSettings {
  projectsDirectory: string
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

let win: InstanceType<typeof BrowserWindow> | null
const performanceService = PerformanceService.getInstance()

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
      releaseName: info?.releaseName,
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
      releaseName: info?.releaseName,
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
  const type = urlObj.searchParams.get('type') // 'subscription' or 'credits'

  // Focus the window
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()

    // Navigate to billing page with appropriate query params
    const isSuccess = urlPath === '/success' || urlPath === '//success'
    const isCanceled = urlPath === '/canceled' || urlPath === '//canceled'

    let queryString = ''
    if (isSuccess) {
      queryString = `?success=${type || 'true'}`
    } else if (isCanceled) {
      queryString = '?canceled=true'
    }

    if (queryString) {
      if (VITE_DEV_SERVER_URL) {
        win.loadURL(`${VITE_DEV_SERVER_URL}/workspace/billing${queryString}`)
      } else {
        // For production, load index.html - the SPA will handle routing
        win.loadFile(path.join(RENDERER_DIST, 'index.html'))
        // Send a message to navigate after the page loads
        win.webContents.once('did-finish-load', () => {
          win?.webContents.send('navigate', `/workspace/billing${queryString}`)
        })
      }
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
  if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
    handleAuthCallback(url)
  } else if (url.startsWith(`${PROTOCOL}://billing/`)) {
    handleBillingCallback(url)
  } else if (url.startsWith(`${PROTOCOL}://oauth/callback`)) {
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
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
        handleAuthCallback(url)
      } else if (url.startsWith(`${PROTOCOL}://billing/`)) {
        handleBillingCallback(url)
      } else if (url.startsWith(`${PROTOCOL}://oauth/callback`)) {
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
      }
    }
  })
}

function createWindow() {
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
    },
    // Dynamic background color to prevent white flash - set to transparent for vibrancy
    backgroundColor: undefined,
    vibrancy: 'sidebar', // options: 'sidebar' | 'under-window' | 'hud' | 'popover' ...
    visualEffectState: 'active', // keep vibrancy active even when window is backgrounded
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
  })

  // Set application menu
  createApplicationMenu()

  // Register window state listeners
  mainWindowState.manage(win)

  // Show window when ready to prevent flickering
  win.once('ready-to-show', () => {
    performanceService.recordMainMetric('window.ready_to_show', performance.now() - mainStart)
    win?.show()
    win?.focus()
  })

  win.webContents.once('did-finish-load', () => {
    performanceService.recordMainMetric('window.did_finish_load', performance.now() - mainStart)
  })

  // Update background color on system theme change
  nativeTheme.on('updated', () => {
    const bgColor = nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff'
    win?.setBackgroundColor(bgColor)
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
TerminalService.getInstance().registerIpcHandlers()
IntegrationService.getInstance().registerIpcHandlers()
DatabaseService.getInstance().registerIpcHandlers()
DiagnosticsService.getInstance().registerIpcHandlers()
DependenciesService.getInstance().registerIpcHandlers()
performanceService.start()

// Local tool execution (agent runtime)
ipcMain.handle('tools:run', async (_event, request: {
  name: string
  input: Record<string, unknown>
  projectPath?: string
  runId?: string
  toolCallId?: string
}) => {
  return runTool(request)
})

ipcMain.handle('performance:report', async (_event, payload: PerfBatch) => {
  return performanceService.reportRendererBatch(payload)
})

ipcMain.handle('tools:cancel', async (_event, request: { runId: string }) => {
  return cancelToolRuns(request.runId)
})

// Auto-updater IPC handlers
ipcMain.handle('updates:getState', () => updateState)

ipcMain.handle('updates:check', async () => {
  if (!isAutoUpdateEnabled()) return updateState
  await checkForUpdates()
  return updateState
})

ipcMain.handle('updates:download', async () => {
  if (!isAutoUpdateEnabled()) return updateState
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    setUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return updateState
})

ipcMain.handle('updates:install', async () => {
  if (!isAutoUpdateEnabled()) {
    return { success: false, error: 'Updates are disabled in development builds.' }
  }
  try {
    autoUpdater.quitAndInstall()
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

// Open URL in system browser
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  await shell.openExternal(url)
  return { success: true }
})

// Window state handlers
ipcMain.handle('window:isFullScreen', () => {
  return win?.isFullScreen() ?? false
})

interface PreviewInjectBridgeResult {
  success: boolean
  error?: string
}

function isAllowedPreviewUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

async function findFrameByUrl(
  targetUrl: string,
  options?: { attempts?: number; delayMs?: number }
): Promise<WebFrameMain | null> {
  const attempts = options?.attempts ?? 15
  const delayMs = options?.delayMs ?? 50

  if (!win) return null

  let targetOrigin: string | null = null
  try {
    targetOrigin = new URL(targetUrl).origin
  } catch {
    targetOrigin = null
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const frames = win.webContents.mainFrame.frames.filter((f) => f !== win?.webContents.mainFrame)

    const exact = frames.find((f) => f.url === targetUrl)
    if (exact) return exact

    if (targetOrigin) {
      const sameOrigin = frames.find((f) => {
        try {
          return new URL(f.url).origin === targetOrigin
        } catch {
          return false
        }
      })
      if (sameOrigin) return sameOrigin
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return null
}

// Inject the preview bridge into the project's dev-server iframe (cross-origin safe via WebFrameMain)
ipcMain.handle(
  'preview:injectBridge',
  async (_event, { url }: { url: string }): Promise<PreviewInjectBridgeResult> => {
    if (!win) return { success: false, error: 'No window available' }
    if (!url || typeof url !== 'string') return { success: false, error: 'Missing url' }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { success: false, error: 'Invalid url' }
    }

    if (!isAllowedPreviewUrl(parsedUrl)) {
      return { success: false, error: 'Only localhost preview URLs are supported' }
    }

    // Avoid injecting into the app's own main frame origin.
    try {
      const mainUrl = win.webContents.getURL()
      const mainOrigin = new URL(mainUrl).origin
      if (mainOrigin === parsedUrl.origin) {
        return { success: false, error: 'Refusing to inject into main frame origin' }
      }
    } catch {
      // ignore parse errors (e.g. about:blank during startup)
    }

    const frame = await findFrameByUrl(url)
    if (!frame) {
      return { success: false, error: 'Preview frame not found' }
    }

    try {
      await frame.executeJavaScript(BRIDGE_SCRIPT)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to inject preview bridge'
      return { success: false, error: message }
    }
  }
)

// Capture a screenshot of a URL using a hidden BrowserWindow
ipcMain.handle(
  'preview:captureScreenshot',
  async (
    _event,
    { url, width = 1280, height = 800 }: { url: string; width?: number; height?: number }
  ): Promise<{ success: boolean; base64?: string; error?: string }> => {
    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { success: false, error: 'Invalid URL' }
    }

    // Only allow localhost URLs for security
    if (!isAllowedPreviewUrl(parsedUrl)) {
      return { success: false, error: 'Only localhost URLs are supported' }
    }

    // Create a hidden browser window for capturing
    const captureWindow = new BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
      },
    })

    try {
      // Set a timeout for loading
      const loadTimeout = 30000 // 30 seconds
      const loadPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Page load timeout'))
        }, loadTimeout)

        captureWindow.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })

        captureWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
          clearTimeout(timer)
          reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`))
        })
      })

      // Load the URL
      await captureWindow.loadURL(url)
      await loadPromise

      // Wait a bit for any animations/rendering to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Capture the page
      const image = await captureWindow.webContents.capturePage()
      const base64 = image.toPNG().toString('base64')

      return { success: true, base64 }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Screenshot capture failed'
      console.error('[Preview] Screenshot capture failed:', err)
      return { success: false, error: message }
    } finally {
      // Always clean up the window
      captureWindow.destroy()
    }
  }
)

// Settings handlers
ipcMain.handle('settings:get', () => {
  return loadSettings()
})

ipcMain.handle('settings:set', (_event, settings: Partial<AppSettings>) => {
  saveSettings(settings)
  return { success: true }
})

// Dialog to select a directory
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!win) return { success: false, error: 'No window available' }

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Projects Directory',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }

  return { success: true, path: result.filePaths[0] }
})

// Storage usage calculation
interface StorageUsage {
  projects: number
  dependencies: number
  buildCache: number
  logs: number
  total: number
  diskTotal: number
  diskFree: number
}

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    if (!fs.existsSync(dirPath)) return 0

    // Use native du command for fast directory size calculation
    if (process.platform === 'win32') {
      // Windows: use PowerShell
      const { stdout } = await execAsync(
        `powershell -command "(Get-ChildItem -Path '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { timeout: 30000 }
      )
      const size = parseInt(stdout.trim(), 10)
      return isNaN(size) ? 0 : size
    } else {
      // macOS/Linux: use du command (-s for summary, -k for KB)
      const { stdout } = await execAsync(
        `du -sk "${dirPath}" 2>/dev/null || echo "0"`,
        { timeout: 30000 }
      )
      const sizeKB = parseInt(stdout.split('\t')[0], 10)
      return isNaN(sizeKB) ? 0 : sizeKB * 1024 // Convert KB to bytes
    }
  } catch {
    return 0
  }
}

async function getDiskSpace(dirPath: string): Promise<{ total: number; free: number }> {
  try {
    if (process.platform === 'win32') {
      // Windows: use PowerShell to get drive info
      const driveLetter = path.parse(dirPath).root || 'C:\\'
      const { stdout } = await execAsync(
        `powershell -command "Get-PSDrive -Name '${driveLetter[0]}' | Select-Object Used,Free | ConvertTo-Json"`,
        { timeout: 10000 }
      )
      const info = JSON.parse(stdout)
      return {
        total: (info.Used || 0) + (info.Free || 0),
        free: info.Free || 0,
      }
    } else {
      // macOS/Linux: use df command
      const { stdout } = await execAsync(
        `df -k "${dirPath}" 2>/dev/null | tail -1`,
        { timeout: 10000 }
      )
      const parts = stdout.trim().split(/\s+/)
      // df output: Filesystem 1K-blocks Used Available Use% Mounted
      const totalKB = parseInt(parts[1], 10)
      const availableKB = parseInt(parts[3], 10)
      return {
        total: isNaN(totalKB) ? 0 : totalKB * 1024,
        free: isNaN(availableKB) ? 0 : availableKB * 1024,
      }
    }
  } catch {
    return { total: 0, free: 0 }
  }
}

ipcMain.handle('storage:getUsage', async (): Promise<StorageUsage> => {
  const settings = loadSettings()
  const projectsDir = settings.projectsDirectory
  const userDataDir = app.getPath('userData')
  const logsDir = app.getPath('logs')

  // Calculate sizes in parallel
  const [projectsSize, logsSize] = await Promise.all([
    getDirectorySize(projectsDir),
    getDirectorySize(logsDir),
  ])

  // For dependencies, we need to scan node_modules folders within projects
  let dependenciesSize = 0
  let buildCacheSize = 0

  if (fs.existsSync(projectsDir)) {
    try {
      const projects = fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())

      const sizes = await Promise.all(
        projects.map(async (project) => {
          const projectPath = path.join(projectsDir, project.name)
          const nodeModulesPath = path.join(projectPath, 'node_modules')
          const distPath = path.join(projectPath, 'dist')
          const buildPath = path.join(projectPath, 'build')
          const nextCachePath = path.join(projectPath, '.next')

          const [nodeModules, dist, build, nextCache] = await Promise.all([
            getDirectorySize(nodeModulesPath),
            getDirectorySize(distPath),
            getDirectorySize(buildPath),
            getDirectorySize(nextCachePath),
          ])

          return {
            dependencies: nodeModules,
            buildCache: dist + build + nextCache,
          }
        })
      )

      for (const size of sizes) {
        dependenciesSize += size.dependencies
        buildCacheSize += size.buildCache
      }
    } catch (err) {
      console.error('Failed to scan project directories:', err)
    }
  }

  // Also check for app-level cache (separate from project build cache)
  const appCachePath = path.join(userDataDir, 'Cache')
  const appCache = await getDirectorySize(appCachePath)

  // Get disk space for the projects directory
  const diskSpace = await getDiskSpace(projectsDir)

  // Calculate actual project files (ensure non-negative)
  const projectFilesSize = Math.max(0, projectsSize - dependenciesSize - buildCacheSize)

  // Total build cache includes both project build artifacts and app cache
  const totalBuildCache = buildCacheSize + appCache

  return {
    projects: projectFilesSize,
    dependencies: dependenciesSize,
    buildCache: totalBuildCache,
    logs: logsSize,
    total: projectFilesSize + dependenciesSize + totalBuildCache + logsSize,
    diskTotal: diskSpace.total,
    diskFree: diskSpace.free,
  }
})

// List local projects with their sizes
interface LocalProject {
  name: string
  path: string
  size: number
  lastModified: number
}

ipcMain.handle('storage:listProjects', async (): Promise<LocalProject[]> => {
  const settings = loadSettings()
  const projectsDir = settings.projectsDirectory

  if (!fs.existsSync(projectsDir)) {
    return []
  }

  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))

    const projects = await Promise.all(
      entries.map(async (entry) => {
        const projectPath = path.join(projectsDir, entry.name)
        const size = await getDirectorySize(projectPath)

        // Get last modified time
        let lastModified = Date.now()
        try {
          const stats = fs.statSync(projectPath)
          lastModified = stats.mtimeMs
        } catch {
          // Ignore stat errors
        }

        return {
          name: entry.name,
          path: projectPath,
          size,
          lastModified,
        }
      })
    )

    // Sort by last modified (most recent first)
    return projects.sort((a, b) => b.lastModified - a.lastModified)
  } catch (err) {
    console.error('Failed to list projects:', err)
    return []
  }
})

// Project folder management
interface CreateProjectFolderResult {
  success: boolean
  localPath?: string
  error?: string
}

ipcMain.handle(
  'project:createFolder',
  async (
    _event,
    { slug, initGit = true }: { slug: string; initGit?: boolean }
  ): Promise<CreateProjectFolderResult> => {
    const settings = loadSettings()
    const projectsDir = settings.projectsDirectory
    const projectPath = path.join(projectsDir, slug)

    try {
      // Ensure projects directory exists
      if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true })
      }

      // Check if project folder already exists
      if (fs.existsSync(projectPath)) {
        return {
          success: false,
          error: `Project folder already exists: ${projectPath}`,
        }
      }

      // Create project folder
      fs.mkdirSync(projectPath, { recursive: true })
      console.log(`[Project] Created folder: ${projectPath}`)

      // Initialize git repository if requested
      if (initGit) {
        const { execSync } = await import('child_process')
        try {
          execSync('git init', { cwd: projectPath, stdio: 'pipe' })
          console.log(`[Project] Initialized git repo: ${projectPath}`)

          // Create initial .gitignore
          const gitignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Cache
.cache/
.turbo/
`
          fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignoreContent)
          console.log(`[Project] Created .gitignore`)
        } catch (gitErr) {
          console.warn(`[Project] Git init failed (git may not be installed):`, gitErr)
          // Don't fail the whole operation if git isn't available
        }
      }

      return {
        success: true,
        localPath: projectPath,
      }
    } catch (err) {
      console.error('[Project] Failed to create folder:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create project folder',
      }
    }
  }
)

// Get local path for a project by slug (returns path if exists, null otherwise)
ipcMain.handle(
  'project:getLocalPath',
  (_event, { slug }: { slug: string }): string | null => {
    const settings = loadSettings()
    const projectPath = path.join(settings.projectsDirectory, slug)
    return fs.existsSync(projectPath) ? projectPath : null
  }
)

// Check if a local project folder exists
ipcMain.handle(
  'project:exists',
  (_event, { slug }: { slug: string }): boolean => {
    const settings = loadSettings()
    const projectPath = path.join(settings.projectsDirectory, slug)
    return fs.existsSync(projectPath)
  }
)

// Write a file to project folder
ipcMain.handle(
  'project:writeFile',
  async (
    _event,
    {
      projectPath,
      filePath,
      content,
    }: {
      projectPath: string
      filePath: string // relative path, e.g., "config/config.json"
      content: string
    }
  ): Promise<{
    success: boolean
    fullPath?: string
    sizeBytes?: number
    error?: string
  }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath)
      const dir = path.dirname(fullPath)

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Prevent the project watcher from treating this as an "external" change.
      markInternalFsChange(fullPath)
      fs.writeFileSync(fullPath, content, 'utf-8')
      const stats = fs.statSync(fullPath)
      console.log(`[Project] Wrote file: ${fullPath}`)

      // Notify Yjs of the file change for collaborative editing
      notifyFileChanged(fullPath, content, { origin: 'agent' })

      return {
        success: true,
        fullPath,
        sizeBytes: stats.size,
      }
    } catch (error) {
      console.error('[Project] Failed to write file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Read a file from project folder
ipcMain.handle(
  'project:readFile',
  async (
    _event,
    { projectPath, filePath }: { projectPath: string; filePath: string }
  ): Promise<{
    success: boolean
    content?: string
    sizeBytes?: number
    error?: string
  }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath)

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File not found' }
      }

      const content = fs.readFileSync(fullPath, 'utf-8')
      const stats = fs.statSync(fullPath)

      return {
        success: true,
        content,
        sizeBytes: stats.size,
      }
    } catch (error) {
      console.error('[Project] Failed to read file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Read a file from project folder (base64, binary-safe)
ipcMain.handle(
  'project:readFileBase64',
  async (
    _event,
    { projectPath, filePath }: { projectPath: string; filePath: string }
  ): Promise<{
    success: boolean
    base64?: string
    sizeBytes?: number
    error?: string
  }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath)

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File not found' }
      }

      const buffer = fs.readFileSync(fullPath)
      const stats = fs.statSync(fullPath)

      return {
        success: true,
        base64: buffer.toString('base64'),
        sizeBytes: stats.size,
      }
    } catch (error) {
      console.error('[Project] Failed to read file (base64):', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// List all files in project folder (recursive)
ipcMain.handle(
  'project:listFiles',
  async (
    _event,
    { projectPath }: { projectPath: string }
  ): Promise<{
    success: boolean
    files?: { path: string; sizeBytes: number }[]
    error?: string
  }> => {
    try {
      const files: { path: string; sizeBytes: number }[] = []

      function walkDir(dir: string, relativePath = '') {
        if (!fs.existsSync(dir)) return

        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const relPath = path.join(relativePath, entry.name)
          const fullPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            // Skip .git and node_modules
            if (entry.name !== '.git' && entry.name !== 'node_modules') {
              walkDir(fullPath, relPath)
            }
          } else {
            const stats = fs.statSync(fullPath)
            files.push({ path: relPath, sizeBytes: stats.size })
          }
        }
      }

      walkDir(projectPath)
      return { success: true, files }
    } catch (error) {
      console.error('[Project] Failed to list files:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Rename/move a file or directory within project folder
ipcMain.handle(
  'project:renameFile',
  async (
    _event,
    {
      projectPath,
      oldPath,
      newPath,
    }: {
      projectPath: string
      oldPath: string
      newPath: string
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fullOldPath = resolvePathWithinDirectory(projectPath, oldPath)
      const fullNewPath = resolvePathWithinDirectory(projectPath, newPath)

      if (!fs.existsSync(fullOldPath)) {
        return { success: false, error: 'Source file not found' }
      }

      // Create parent directory of new path if it doesn't exist
      const newDir = path.dirname(fullNewPath)
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true })
      }

      fs.renameSync(fullOldPath, fullNewPath)
      console.log(`[Project] Renamed: ${oldPath} -> ${newPath}`)

      return { success: true }
    } catch (error) {
      console.error('[Project] Failed to rename file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Delete a file or directory within project folder
ipcMain.handle(
  'project:deletePath',
  async (
    _event,
    {
      projectPath,
      targetPath,
    }: {
      projectPath: string
      targetPath: string
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, targetPath)

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'Target not found' }
      }

      const stats = fs.statSync(fullPath)
      if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(fullPath)
      }

      console.log(`[Project] Deleted: ${targetPath}`)
      return { success: true }
    } catch (error) {
      console.error('[Project] Failed to delete path:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Copy a file or directory within project folder
ipcMain.handle(
  'project:copyPath',
  async (
    _event,
    {
      projectPath,
      sourcePath,
      destinationPath,
    }: {
      projectPath: string
      sourcePath: string
      destinationPath: string
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fullSource = resolvePathWithinDirectory(projectPath, sourcePath)
      const fullDestination = resolvePathWithinDirectory(projectPath, destinationPath)

      if (!fs.existsSync(fullSource)) {
        return { success: false, error: 'Source not found' }
      }
      if (fs.existsSync(fullDestination)) {
        return { success: false, error: 'Destination already exists' }
      }

      const destinationDir = path.dirname(fullDestination)
      if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true })
      }

      const stats = fs.statSync(fullSource)
      if (stats.isDirectory()) {
        fs.cpSync(fullSource, fullDestination, { recursive: true })
      } else {
        fs.copyFileSync(fullSource, fullDestination)
      }

      console.log(`[Project] Copied: ${sourcePath} -> ${destinationPath}`)
      return { success: true }
    } catch (error) {
      console.error('[Project] Failed to copy path:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Watch/unwatch a project folder for external filesystem edits.
ipcMain.handle(
  'project:watchStart',
  (_event, { projectPath }: { projectPath: string }): { success: boolean; error?: string } => {
    return startProjectWatcher(projectPath)
  }
)

ipcMain.handle(
  'project:watchStop',
  (_event, { projectPath }: { projectPath: string }): { success: boolean; error?: string } => {
    return stopProjectWatcher(projectPath)
  }
)

// Read directory contents (one level)
interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

ipcMain.handle(
  'fs:readDir',
  async (_event, dirPath: string): Promise<FileEntry[]> => {
    try {
      if (!fs.existsSync(dirPath)) {
        return []
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const result: FileEntry[] = []

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        const isDirectory = entry.isDirectory()

        try {
          const stats = fs.statSync(fullPath)
          result.push({
            name: entry.name,
            path: fullPath,
            type: isDirectory ? 'directory' : 'file',
            size: isDirectory ? undefined : stats.size,
            modifiedAt: stats.mtime.toISOString(),
          })
        } catch {
          // Skip files we can't stat
        }
      }

      return result
    } catch (error) {
      console.error('[FS] Failed to read directory:', error)
      return []
    }
  }
)

// Read file content
ipcMain.handle(
  'fs:readFile',
  async (_event, filePath: string): Promise<string | null> => {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      return fs.readFileSync(filePath, 'utf-8')
    } catch (error) {
      console.error('[FS] Failed to read file:', error)
      return null
    }
  }
)

// ============================================
// Sync IPC Handlers (for file synchronization)
// ============================================

// Hash a single file using xxhash
ipcMain.handle(
  'sync:hashFile',
  async (
    _event,
    { filePath }: { filePath: string }
  ): Promise<{ hash: string; size: number }> => {
    if (!xxhasher) throw new Error('xxhash not initialized')

    const content = fs.readFileSync(filePath)
    const hash = xxhasher.h64Raw(content).toString(16).padStart(16, '0')

    return { hash, size: content.length }
  }
)

// Get local manifest (all files with hashes)
ipcMain.handle(
  'sync:getLocalManifest',
  async (
    _event,
    {
      projectPath,
      excludePatterns,
    }: {
      projectPath: string
      excludePatterns?: string[]
    }
  ): Promise<{
    manifest: Array<{ path: string; hash: string; size: number; mtime: number }>
    totalFiles: number
  }> => {
    try {
      return await getManifestFromWorker(projectPath, excludePatterns)
    } catch (error) {
      console.warn('[Sync] Worker manifest failed, falling back to main thread:', error)
    }

    if (!xxhasher) throw new Error('xxhash not initialized')

    const defaultExcludes = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']
    const excludes = new Set([...defaultExcludes, ...(excludePatterns || [])])

    const manifest: Array<{ path: string; hash: string; size: number; mtime: number }> = []

    function walkDir(dir: string, relativePath = '') {
      if (!fs.existsSync(dir)) return

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        // Skip excluded directories/files
        if (excludes.has(entry.name)) continue
        // Skip hidden files except .env.example
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue

        const relPath = path.join(relativePath, entry.name)
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          walkDir(fullPath, relPath)
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(fullPath)
            const stats = fs.statSync(fullPath)
            const hash = xxhasher!.h64Raw(content).toString(16).padStart(16, '0')

            manifest.push({
              path: relPath.replace(/\\/g, '/'), // Normalize to forward slashes
              hash,
              size: stats.size,
              mtime: stats.mtimeMs,
            })
          } catch (err) {
            console.warn(`[Sync] Could not read file: ${fullPath}`, err)
          }
        }
      }
    }

    if (fs.existsSync(projectPath)) {
      walkDir(projectPath)
    }

    console.log(`[Sync] Generated manifest with ${manifest.length} files for ${projectPath}`)
    return { manifest, totalFiles: manifest.length }
  }
)

// Write multiple files atomically
ipcMain.handle(
  'sync:writeFiles',
  async (
    _event,
    {
      projectPath,
      files,
    }: {
      projectPath: string
      files: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>
    }
  ): Promise<{
    results: Array<{ path: string; success: boolean; error?: string }>
    successCount: number
  }> => {
    const results: Array<{ path: string; success: boolean; error?: string }> = []

    for (const file of files) {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, file.path)
        const dir = path.dirname(fullPath)

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        // Prevent the project watcher from treating this as an "external" change.
        markInternalFsChange(fullPath)
        if (file.encoding === 'base64') {
          fs.writeFileSync(fullPath, Buffer.from(file.content, 'base64'))
        } else {
          fs.writeFileSync(fullPath, file.content, 'utf-8')
        }
        results.push({ path: file.path, success: true })
        console.log(`[Sync] Wrote file: ${file.path}`)

        // Notify Yjs of the file change for collaborative editing
        if (file.encoding !== 'base64') {
          notifyFileChanged(fullPath, file.content, { origin: 'sync' })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        results.push({ path: file.path, success: false, error: errorMsg })
        console.error(`[Sync] Failed to write file: ${file.path}`, err)
      }
    }

    return { results, successCount: results.filter((r) => r.success).length }
  }
)

// Delete multiple files
ipcMain.handle(
  'sync:deleteFiles',
  async (
    _event,
    {
      projectPath,
      paths,
    }: {
      projectPath: string
      paths: string[]
    }
  ): Promise<{
    results: Array<{ path: string; success: boolean }>
  }> => {
    const results: Array<{ path: string; success: boolean }> = []

    for (const relPath of paths) {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, relPath)
        if (fs.existsSync(fullPath)) {
          // Prevent the project watcher from treating this as an "external" change.
          markInternalFsChange(fullPath)
          fs.unlinkSync(fullPath)
          console.log(`[Sync] Deleted file: ${relPath}`)
        }
        results.push({ path: relPath, success: true })

        // Notify Yjs so the in-memory doc stays in sync with disk.
        notifyFileDeleted(fullPath, { origin: 'sync' })
      } catch (err) {
        console.error(`[Sync] Failed to delete file: ${relPath}`, err)
        results.push({ path: relPath, success: false })
      }
    }

    return { results }
  }
)

// ============================================
// Dev Server IPC Handlers
// ============================================

// Start a dev server for a project using PTY for proper terminal emulation
ipcMain.handle(
  'devServer:start',
  async (
    _event,
    {
      projectPath,
      command,
      port,
      cols = 80,
      rows = 24,
    }: {
      projectPath: string
      command: string
      port: number
      cols?: number
      rows?: number
    }
  ): Promise<{ success: boolean; pid?: number; error?: string }> => {
    // Check if server is already running for this project
    if (devServerProcesses.has(projectPath)) {
      return { success: false, error: 'Dev server already running for this project' }
    }

    try {
      console.log(`[DevServer] Starting PTY: ${command} in ${projectPath} (${cols}x${rows})`)

      // Determine shell based on platform
      const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

      // Spawn the process using node-pty for proper terminal emulation
      const ptyProcess = pty.spawn(shell, ['-c', command], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: String(port),
          FORCE_COLOR: '1',
          TERM: 'xterm-256color',
        } as Record<string, string>,
      })

      devServerProcesses.set(projectPath, ptyProcess)

      // Stream output to renderer (PTY combines stdout and stderr)
      ptyProcess.onData((data: string) => {
        // Don't log every output line to reduce console spam
        win?.webContents.send('devServer:output', { projectPath, output: data, stream: 'stdout' })
      })

      // Handle process exit
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[DevServer] PTY exited with code ${exitCode}`)
        devServerProcesses.delete(projectPath)
        win?.webContents.send('devServer:exit', { projectPath, code: exitCode })
      })

      return { success: true, pid: ptyProcess.pid }
    } catch (err) {
      console.error('[DevServer] Failed to start PTY:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to start dev server',
      }
    }
  }
)

// Stop a dev server for a project
ipcMain.handle(
  'devServer:stop',
  async (
    _event,
    { projectPath }: { projectPath: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const ptyProcess = devServerProcesses.get(projectPath)
    if (!ptyProcess) {
      return { success: true } // Already stopped
    }

    try {
      console.log(`[DevServer] Stopping PTY for ${projectPath}`)

      // Kill the PTY process (node-pty handles killing the process tree)
      ptyProcess.kill()

      devServerProcesses.delete(projectPath)
      return { success: true }
    } catch (err) {
      console.error('[DevServer] Failed to stop PTY:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to stop dev server',
      }
    }
  }
)

// Resize a running PTY
ipcMain.handle(
  'devServer:resize',
  (
    _event,
    { projectPath, cols, rows }: { projectPath: string; cols: number; rows: number }
  ): { success: boolean } => {
    const ptyProcess = devServerProcesses.get(projectPath)
    if (!ptyProcess) {
      return { success: false }
    }

    try {
      ptyProcess.resize(cols, rows)
      return { success: true }
    } catch (err) {
      console.error('[DevServer] Failed to resize PTY:', err)
      return { success: false }
    }
  }
)

// Check if a dev server is running for a project
ipcMain.handle(
  'devServer:isRunning',
  (_event, { projectPath }: { projectPath: string }): boolean => {
    return devServerProcesses.has(projectPath)
  }
)

// ============================================
// Terminal IPC Handlers (VS Code-style multi-terminal)
// ============================================

// Legacy Terminal IPC Handlers Removed (Moved to TerminalService)

// ============================================
// Context Menu for Terminal Selection
// ============================================

export interface ContextMenuAction {
  id: string
  label: string
  accelerator?: string
}

ipcMain.handle(
  'contextMenu:showTerminalSelection',
  async (
    _event,
    { selectedText, x, y }: { selectedText: string; x: number; y: number }
  ): Promise<{ action: string | null }> => {
    return new Promise((resolve) => {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => {
            clipboard.writeText(selectedText)
            resolve({ action: 'copy' })
          },
        },
        { type: 'separator' },
        {
          label: 'Ask AI about this',
          click: () => {
            resolve({ action: 'askAI' })
          },
        },
        {
          label: 'Explain this error',
          click: () => {
            resolve({ action: 'explainError' })
          },
        },
        { type: 'separator' },
        {
          label: 'Search Google',
          click: () => {
            const query = encodeURIComponent(selectedText)
            shell.openExternal(`https://www.google.com/search?q=${query}`)
            resolve({ action: 'searchGoogle' })
          },
        },
        {
          label: 'Search Stack Overflow',
          click: () => {
            const query = encodeURIComponent(selectedText)
            shell.openExternal(`https://stackoverflow.com/search?q=${query}`)
            resolve({ action: 'searchStackOverflow' })
          },
        },
      ]

      const menu = Menu.buildFromTemplate(template)

      menu.popup({
        window: win || undefined,
        x,
        y,
        callback: () => {
          // Menu closed without selection
          resolve({ action: null })
        },
      })
    })
  }
)

ipcMain.handle(
  'contextMenu:showFileTreeMenu',
  async (
    event,
    {
      targetPath,
      isDirectory,
      x,
      y,
    }: { targetPath: string; isDirectory: boolean; x: number; y: number }
  ): Promise<{ action: string | null }> => {
    return new Promise((resolve) => {
      let resolved = false
      const window = BrowserWindow.fromWebContents(event.sender) ?? win
      const revealLabel =
        process.platform === 'darwin'
          ? 'Reveal in Finder'
          : process.platform === 'win32'
            ? 'Show in Explorer'
            : 'Show in File Manager'

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'New File',
          click: () => {
            resolved = true
            resolve({ action: 'new-file' })
          },
        },
        {
          label: 'New Folder',
          click: () => {
            resolved = true
            resolve({ action: 'new-folder' })
          },
        },
        {
          label: 'Rename',
          click: () => {
            resolved = true
            resolve({ action: 'rename' })
          },
        },
        {
          label: 'Duplicate',
          click: () => {
            resolved = true
            resolve({ action: 'duplicate' })
          },
        },
        {
          label: 'Delete',
          click: () => {
            resolved = true
            resolve({ action: 'delete' })
          },
        },
        { type: 'separator' },
        {
          label: revealLabel,
          click: () => {
            shell.showItemInFolder(targetPath)
            resolved = true
            resolve({ action: 'reveal' })
          },
        },
        {
          label: 'Copy Path',
          click: () => {
            clipboard.writeText(targetPath)
            resolved = true
            resolve({ action: 'copy-path' })
          },
        },
        {
          label: 'Copy Relative Path',
          click: () => {
            resolved = true
            resolve({ action: 'copy-relative-path' })
          },
        },
        { type: 'separator' },
        {
          label: isDirectory ? 'Copy Folder Name' : 'Copy File Name',
          click: () => {
            clipboard.writeText(path.basename(targetPath))
            resolved = true
            resolve({ action: 'copy-name' })
          },
        },
      ]

      const menu = Menu.buildFromTemplate(template)

      menu.popup({
        window: window || undefined,
        x,
        y,
        callback: () => {
          if (!resolved) {
            resolve({ action: null })
          }
        },
      })
    })
  }
)

app.on('window-all-closed', () => {
  // Kill all running dev servers when app closes
  for (const [projectPath, ptyProcess] of devServerProcesses) {
    console.log(`[DevServer] Killing PTY for ${projectPath}`)
    try {
      ptyProcess.kill()
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

app.whenReady().then(async () => {
  performanceService.recordMainMetric('app.when_ready', performance.now() - mainStart)
  // Initialize xxhash for file sync
  xxhasher = await xxhashInit()
  console.log('[Sync] xxhash initialized')

  registerAutoUpdater()
  createWindow()
  startUpdateChecks()
})
