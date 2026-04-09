import { app, safeStorage, dialog, shell, ipcMain, BrowserWindow } from 'electron'

import { forEachBroadcastWindow } from '../broadcastWindows'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:http'

// Types
export interface OrganizationMembership {
    id: string
    organizationId: string
    organizationName: string
    role: string
    status: 'active' | 'inactive' | 'pending'
}

export interface Session {
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

type AuthRefreshResult =
  | {
      ok: true
      session: Session
    }
  | {
      ok: false
      reason: 'expired' | 'retryable' | 'missing_session'
      statusCode?: number
    }

interface AuthRefreshErrorPayload {
    error?: string
    code?: string
    requestId?: string
    retryable?: boolean
    details?: Record<string, unknown>
}

async function parseJsonBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function getRefreshErrorPayload(payload: unknown): AuthRefreshErrorPayload | null {
    if (!payload || typeof payload !== 'object') return null
    const data = payload as Record<string, unknown>
    return {
        error: typeof data.error === 'string' ? data.error : undefined,
        code: typeof data.code === 'string' ? data.code : undefined,
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
        retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
        details:
            data.details && typeof data.details === 'object'
                ? (data.details as Record<string, unknown>)
                : undefined,
    }
}

const DEV_AUTH_CALLBACK_TIMEOUT_MS = 2 * 60 * 1000

function renderDevAuthCallbackPage(options: { title: string; message: string }): string {
    const title = options.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const message = options.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      .panel {
        width: min(560px, calc(100vw - 40px));
        border-radius: 16px;
        border: 1px solid #dbe2ef;
        background: #ffffff;
        padding: 24px;
      }
      h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.2; }
      p { margin: 0; color: #334155; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`
}

export class AuthService {
  private static instance: AuthService
  private sessionPath: string | null = null
  private authServerUrl: string
  private isProduction: boolean
  private protocol: string
  private readonly waitlistMessage = "You're on the waitlist. We'll notify you when access is ready."
  private activeDevLoginClose: (() => Promise<void>) | null = null

    private constructor() {
        this.authServerUrl = (
            process.env.AUTH_SERVER_URL ||
            process.env.VITE_AUTH_SERVER_URL ||
            'https://api.cozea.app'
        ).replace(/\/+$/, '')
        // In electron-vite dev, ELECTRON_RENDERER_URL is set; VITE_DEV_SERVER_URL may be absent.
        const devServerUrl = process.env['VITE_DEV_SERVER_URL'] || process.env['ELECTRON_RENDERER_URL']
        this.isProduction = !devServerUrl
        this.protocol = process.env.COZEA_PROTOCOL || (this.isProduction ? 'cozea' : 'cozea-dev')
    }

    static getInstance(): AuthService {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService()
        }
        return AuthService.instance
    }

    private getSessionPath(): string {
        if (!this.sessionPath) {
            this.sessionPath = join(app.getPath('userData'), 'session.enc')
        }
        return this.sessionPath
    }

    saveSession(session: Session): void {
        const jsonData = JSON.stringify(session)

        if (safeStorage.isEncryptionAvailable()) {
            const encryptedData = safeStorage.encryptString(jsonData)
            writeFileSync(this.getSessionPath(), encryptedData)
        } else if (this.isProduction) {
            dialog.showErrorBox(
                'Security Error',
                'Session encryption is not available on this system. Please ensure your operating system keychain is properly configured.'
            )
            throw new Error('Session encryption required in production')
        } else {
            console.warn('safeStorage not available, storing session unencrypted (dev mode only)')
            writeFileSync(this.getSessionPath(), jsonData)
        }
    }

    loadSession(): Session | null {
        try {
            if (!existsSync(this.getSessionPath())) {
                return null
            }

            const fileData = readFileSync(this.getSessionPath())

            if (safeStorage.isEncryptionAvailable()) {
                try {
                    const decryptedData = safeStorage.decryptString(fileData)
                    return JSON.parse(decryptedData)
                } catch {
                    // Backward compatibility: Try parsing as plain JSON
                    const plainData = fileData.toString('utf-8')
                    return JSON.parse(plainData)
                }
            } else {
                const data = fileData.toString('utf-8')
                return JSON.parse(data)
            }
        } catch (err) {
            console.error('Failed to load session:', err)
        }
        return null
    }

    clearSession(): void {
        try {
            if (existsSync(this.getSessionPath())) {
                unlinkSync(this.getSessionPath())
            }
            // Clear legacy unencrypted file if exists
            const oldSessionPath = this.getSessionPath().replace('.enc', '.json')
            if (existsSync(oldSessionPath)) {
                unlinkSync(oldSessionPath)
            }
        } catch (err) {
            console.error('Failed to clear session:', err)
        }
    }

    private emitAuthSuccess(session: Session, win?: BrowserWindow | null): void {
        if (win && !win.isDestroyed()) {
            win.webContents.send('auth:success', session)
            return
        }
        forEachBroadcastWindow((browserWindow) => {
            if (browserWindow.webContents.isDestroyed()) return
            browserWindow.webContents.send('auth:success', session)
        })
    }

    private emitAuthError(message: string, win?: BrowserWindow | null): void {
        if (win && !win.isDestroyed()) {
            win.webContents.send('auth:error', message)
            return
        }
        forEachBroadcastWindow((browserWindow) => {
            if (browserWindow.webContents.isDestroyed()) return
            browserWindow.webContents.send('auth:error', message)
        })
    }

    private async exchangeOneTimeToken(token: string): Promise<Session> {
        const response = await fetch(`${this.authServerUrl}/auth/desktop/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        })

        if (!response.ok) {
            throw new Error(`Token exchange failed (${response.status})`)
        }

        return (await response.json()) as Session
    }

    private async startDevLoopbackAuthBridge(): Promise<{
        redirectUri: string
        waitForToken: Promise<string>
        close: () => Promise<void>
    }> {
        let settled = false
        let timeoutId: NodeJS.Timeout | null = null
        let server: Server
        let rejectPending: ((reason?: unknown) => void) | null = null

        const waitForToken = new Promise<string>((resolve, reject) => {
            rejectPending = reject
            server = createServer((req, res) => {
                const requestUrl = req.url || '/'
                const url = new URL(requestUrl, 'http://localhost')

                if (url.pathname !== '/auth/callback') {
                    res.statusCode = 404
                    res.end('Not found')
                    return
                }

                const error = url.searchParams.get('error')
                const errorDescription = url.searchParams.get('error_description')
                const token = url.searchParams.get('token')

                if (error) {
                    const message = errorDescription || error
                    res.statusCode = 400
                    res.setHeader('content-type', 'text/html')
                    res.end(
                        renderDevAuthCallbackPage({
                            title: 'Sign in failed',
                            message: `Authentication failed: ${message}. You can close this tab and retry in the app.`,
                        }),
                    )
                    if (!settled) {
                        settled = true
                        reject(new Error(message))
                    }
                    return
                }

                if (!token) {
                    res.statusCode = 400
                    res.setHeader('content-type', 'text/html')
                    res.end(
                        renderDevAuthCallbackPage({
                            title: 'Missing token',
                            message: 'No token was returned. You can close this tab and retry in the app.',
                        }),
                    )
                    if (!settled) {
                        settled = true
                        reject(new Error('No token received'))
                    }
                    return
                }

                res.statusCode = 200
                res.setHeader('content-type', 'text/html')
                res.end(
                    renderDevAuthCallbackPage({
                        title: 'Sign in complete',
                        message: 'You can close this tab and return to Cozea.',
                    }),
                )
                if (!settled) {
                    settled = true
                    resolve(token)
                }
            })
        })

        await new Promise<void>((resolve, reject) => {
            server.listen(0, '127.0.0.1', () => resolve())
            server.once('error', reject)
        })

        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        if (!port) {
            throw new Error('Unable to allocate local auth callback port')
        }

        timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true
                rejectPending?.(new Error('Authentication timed out. Please try again.'))
            }
        }, DEV_AUTH_CALLBACK_TIMEOUT_MS)

        const close = async () => {
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
            await new Promise<void>((resolve) => {
                server.close(() => resolve())
            })
        }

        const wrappedWaitForToken = waitForToken.then(
            async (value) => {
                await close()
                return value
            },
            async (error) => {
                await close()
                throw error
            },
        )

        return {
            redirectUri: `http://127.0.0.1:${port}/auth/callback`,
            waitForToken: wrappedWaitForToken,
            close,
        }
    }

    private async beginDevLoopbackLogin(): Promise<void> {
        if (this.activeDevLoginClose) {
            await this.activeDevLoginClose().catch(() => undefined)
            this.activeDevLoginClose = null
        }

        const bridge = await this.startDevLoopbackAuthBridge()
        this.activeDevLoginClose = bridge.close

        try {
            const loginUrl = new URL('/auth/login', this.authServerUrl)
            loginUrl.searchParams.set('client', 'web')
            loginUrl.searchParams.set('redirectUri', bridge.redirectUri)
            await shell.openExternal(loginUrl.toString())
        } catch (error) {
            this.activeDevLoginClose = null
            await bridge.close().catch(() => undefined)
            throw error
        }

        void bridge.waitForToken
            .then(async (token) => {
                const session = await this.exchangeOneTimeToken(token)
                this.saveSession(session)
                this.emitAuthSuccess(session)
            })
            .catch((error) => {
                console.error('Dev loopback auth error:', error)
                this.emitAuthError('Authentication failed. Please try again.')
            })
            .finally(() => {
                if (this.activeDevLoginClose === bridge.close) {
                    this.activeDevLoginClose = null
                }
            })
    }

    async handleAuthCallback(url: string, win: BrowserWindow | null): Promise<void> {
        const urlObj = new URL(url)
        const callbackError = urlObj.searchParams.get('error')

        if (callbackError === 'waitlisted') {
            this.emitAuthError(this.waitlistMessage, win)
            return
        }

        if (callbackError) {
            this.emitAuthError('Authentication failed', win)
            return
        }

        const token = urlObj.searchParams.get('token')

        if (!token) {
            console.error('No token in callback URL')
            this.emitAuthError('No token received', win)
            return
        }

        try {
            const session = await this.exchangeOneTimeToken(token)
            this.saveSession(session)
            this.emitAuthSuccess(session, win)
        } catch (err) {
            console.error('Auth callback error:', err)
            this.emitAuthError('Authentication failed', win)
        }
    }

    registerIpcHandlers(): void {
        ipcMain.handle('auth:login', async () => {
            if (!this.isProduction) {
                await this.beginDevLoopbackLogin()
                return { success: true }
            }

            const loginUrl = new URL('/auth/login', this.authServerUrl)
            loginUrl.searchParams.set('client', 'desktop')
            loginUrl.searchParams.set('redirectUri', `${this.protocol}://auth/callback`)
            await shell.openExternal(loginUrl.toString())
            return { success: true }
        })

        ipcMain.handle('auth:logout', async (_event, options?: { accessToken?: string | null }) => {
            const session = this.loadSession()
            const accessToken =
                typeof options?.accessToken === 'string' && options.accessToken.length > 0
                    ? options.accessToken
                    : session?.accessToken
            this.clearSession()
            try {
                await fetch(`${this.authServerUrl}/auth/logout`, {
                    method: 'POST',
                    headers: accessToken
                        ? {
                              Authorization: `Bearer ${accessToken}`,
                          }
                        : undefined,
                })
            } catch {
                // Ignore errors
            }
            return { success: true }
        })

        ipcMain.handle('auth:getSession', () => {
            return this.loadSession()
        })

        ipcMain.handle('auth:updateOrganizations', (_event, organizations: OrganizationMembership[]) => {
            const session = this.loadSession()
            if (!session) {
                return { success: false, error: 'No session found' }
            }

            const updatedSession = { ...session, organizations }
            this.saveSession(updatedSession)
            return { success: true }
        })

        ipcMain.handle('auth:refresh', async () => {
            const session = this.loadSession()
            if (!session?.refreshToken) {
                console.warn('[Auth] Refresh skipped because no stored refresh token is available', {
                    hasSession: Boolean(session),
                    hasRefreshToken: Boolean(session?.refreshToken),
                    userId: session?.user?.id ?? null,
                })
                return {
                    ok: false,
                    reason: 'missing_session',
                } satisfies AuthRefreshResult
            }

            console.info('[Auth] Attempting access token refresh', {
                userId: session.user.id,
                organizationCount: Array.isArray(session.organizations) ? session.organizations.length : 0,
            })

            try {
                const response = await fetch(`${this.authServerUrl}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: session.refreshToken }),
                })

                if (!response.ok) {
                    const payload = getRefreshErrorPayload(await parseJsonBody(response))
                    if (response.status === 401 || response.status === 403) {
                        console.warn('[Auth] Refresh token was rejected by auth server', {
                            userId: session.user.id,
                            statusCode: response.status,
                            code: payload?.code ?? null,
                            requestId: payload?.requestId ?? null,
                            message: payload?.error ?? null,
                            details: payload?.details ?? null,
                        })
                        this.clearSession()
                        return {
                            ok: false,
                            reason: 'expired',
                            statusCode: response.status,
                        } satisfies AuthRefreshResult
                    }

                    console.warn('[Auth] Refresh request failed but session was preserved', {
                        userId: session.user.id,
                        statusCode: response.status,
                        code: payload?.code ?? null,
                        requestId: payload?.requestId ?? null,
                        message: payload?.error ?? null,
                        retryable: payload?.retryable ?? null,
                        details: payload?.details ?? null,
                    })
                    return {
                        ok: false,
                        reason: 'retryable',
                        statusCode: response.status,
                    } satisfies AuthRefreshResult
                }

                const data = (await response.json()) as { accessToken: string; refreshToken?: string }
                const nextRefreshToken =
                    typeof data.refreshToken === 'string' && data.refreshToken.length > 0
                        ? data.refreshToken
                        : session.refreshToken

                if (nextRefreshToken === session.refreshToken && (!data.refreshToken || data.refreshToken.length === 0)) {
                    console.warn('[Auth] Refresh succeeded without a rotated refresh token; preserving existing refresh token', {
                        userId: session.user.id,
                    })
                }

                const newSession = {
                    ...session,
                    accessToken: data.accessToken,
                    refreshToken: nextRefreshToken,
                }
                this.saveSession(newSession)
                console.info('[Auth] Access token refresh succeeded', {
                    userId: session.user.id,
                })
                return {
                    ok: true,
                    session: newSession,
                } satisfies AuthRefreshResult
            } catch (error) {
                console.warn('[Auth] Refresh request threw before completion; preserving session', {
                    userId: session.user.id,
                    name: error instanceof Error ? error.name : null,
                    message: error instanceof Error ? error.message : String(error),
                })
                return {
                    ok: false,
                    reason: 'retryable',
                } satisfies AuthRefreshResult
            }
        })
    }
}
