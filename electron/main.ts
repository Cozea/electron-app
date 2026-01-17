import { app, BrowserWindow, shell, ipcMain, safeStorage, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { runTool } from './tools'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Determine if this is a production build (not running with vite dev server)
const isProductionBuild = !process.env['VITE_DEV_SERVER_URL']

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Auth configuration
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'
const PROTOCOL = 'cozea'

// Session storage path (encrypted)
const SESSION_PATH = path.join(app.getPath('userData'), 'session.enc')

let win: BrowserWindow | null

// Session management
interface OrganizationMembership {
  id: string
  organizationId: string
  organizationName: string
  role: string
  status: 'active' | 'inactive' | 'pending'
}

interface Session {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    profileImageUrl: string | null
  }
  organizations: OrganizationMembership[]
}

function saveSession(session: Session): void {
  const jsonData = JSON.stringify(session)

  // Use safeStorage if available (encrypts using OS keychain)
  if (safeStorage.isEncryptionAvailable()) {
    const encryptedData = safeStorage.encryptString(jsonData)
    fs.writeFileSync(SESSION_PATH, encryptedData)
  } else if (isProductionBuild) {
    // In production, encryption is required for security
    dialog.showErrorBox(
      'Security Error',
      'Session encryption is not available on this system. Please ensure your operating system keychain is properly configured.'
    )
    throw new Error('Session encryption required in production')
  } else {
    // Fallback to plain storage in development only
    console.warn('safeStorage not available, storing session unencrypted (dev mode only)')
    fs.writeFileSync(SESSION_PATH, jsonData)
  }
}

function loadSession(): Session | null {
  try {
    if (!fs.existsSync(SESSION_PATH)) {
      return null
    }

    const fileData = fs.readFileSync(SESSION_PATH)

    // Try to decrypt if safeStorage is available
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decryptedData = safeStorage.decryptString(fileData)
        return JSON.parse(decryptedData)
      } catch {
        // File might be unencrypted (from before encryption was enabled)
        // Try parsing as plain JSON
        const plainData = fileData.toString('utf-8')
        return JSON.parse(plainData)
      }
    } else {
      // No encryption available, read as plain text
      const data = fileData.toString('utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Failed to load session:', err)
  }
  return null
}

function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_PATH)) {
      fs.unlinkSync(SESSION_PATH)
    }
    // Also try to clear old unencrypted session file if it exists
    const oldSessionPath = SESSION_PATH.replace('.enc', '.json')
    if (fs.existsSync(oldSessionPath)) {
      fs.unlinkSync(oldSessionPath)
    }
  } catch (err) {
    console.error('Failed to clear session:', err)
  }
}

// Handle custom protocol callback
async function handleAuthCallback(url: string): Promise<void> {
  const urlObj = new URL(url)
  const token = urlObj.searchParams.get('token')

  if (!token) {
    console.error('No token in callback URL')
    win?.webContents.send('auth:error', 'No token received')
    return
  }

  try {
    // Exchange one-time token for session
    const response = await fetch(`${AUTH_SERVER_URL}/auth/desktop/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    if (!response.ok) {
      throw new Error('Token exchange failed')
    }

    const session = await response.json() as Session
    saveSession(session)

    // Notify renderer of successful auth
    win?.webContents.send('auth:success', session)
  } catch (err) {
    console.error('Auth callback error:', err)
    win?.webContents.send('auth:error', 'Authentication failed')
  }
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
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
    handleAuthCallback(url)
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
    if (url && url.startsWith(`${PROTOCOL}://auth/callback`)) {
      handleAuthCallback(url)
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// IPC Handlers
ipcMain.handle('auth:login', async () => {
  // Open system browser to auth server
  const loginUrl = `${AUTH_SERVER_URL}/auth/login?client=desktop`
  await shell.openExternal(loginUrl)
  return { success: true }
})

ipcMain.handle('auth:logout', async () => {
  clearSession()
  // Also notify server
  try {
    await fetch(`${AUTH_SERVER_URL}/auth/logout`, { method: 'POST' })
  } catch {
    // Ignore errors - local session is cleared
  }
  return { success: true }
})

ipcMain.handle('auth:getSession', () => {
  return loadSession()
})

ipcMain.handle('auth:updateOrganizations', (_event, organizations: OrganizationMembership[]) => {
  const session = loadSession()
  if (!session) {
    return { success: false, error: 'No session found' }
  }

  const updatedSession = {
    ...session,
    organizations,
  }
  saveSession(updatedSession)
  return { success: true }
})

ipcMain.handle('auth:refresh', async () => {
  const session = loadSession()
  if (!session?.refreshToken) {
    return null
  }

  try {
    const response = await fetch(`${AUTH_SERVER_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })

    if (!response.ok) {
      clearSession()
      return null
    }

    const data = await response.json() as { accessToken: string; refreshToken: string }
    const newSession = {
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    }
    saveSession(newSession)
    return newSession
  } catch {
    clearSession()
    return null
  }
})

// Local tool execution (agent runtime)
ipcMain.handle('tools:run', async (_event, request: { name: string; input: Record<string, unknown> }) => {
  return runTool(request)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
