import { app, safeStorage, dialog, shell, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

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

export class AuthService {
  private static instance: AuthService
  private sessionPath: string | null = null
  private authServerUrl: string
  private isProduction: boolean
  private protocol: string
  private readonly waitlistMessage = "You're on the waitlist. We'll notify you when access is ready."

    private constructor() {
        this.authServerUrl = process.env.AUTH_SERVER_URL || 'https://api.cozea.app'
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

    async handleAuthCallback(url: string, win: BrowserWindow | null): Promise<void> {
        const urlObj = new URL(url)
        const callbackError = urlObj.searchParams.get('error')

        if (callbackError === 'waitlisted') {
            win?.webContents.send('auth:error', this.waitlistMessage)
            return
        }

        if (callbackError) {
            win?.webContents.send('auth:error', 'Authentication failed')
            return
        }

        const token = urlObj.searchParams.get('token')

        if (!token) {
            console.error('No token in callback URL')
            win?.webContents.send('auth:error', 'No token received')
            return
        }

        try {
            const response = await fetch(`${this.authServerUrl}/auth/desktop/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            })

            if (!response.ok) {
                throw new Error('Token exchange failed')
            }

            const session = (await response.json()) as Session
            this.saveSession(session)

            win?.webContents.send('auth:success', session)
        } catch (err) {
            console.error('Auth callback error:', err)
            win?.webContents.send('auth:error', 'Authentication failed')
        }
    }

    registerIpcHandlers(): void {
        ipcMain.handle('auth:login', async () => {
            const loginUrl = new URL('/auth/login', this.authServerUrl)
            loginUrl.searchParams.set('client', 'desktop')
            loginUrl.searchParams.set('redirectUri', `${this.protocol}://auth/callback`)
            await shell.openExternal(loginUrl.toString())
            return { success: true }
        })

        ipcMain.handle('auth:logout', async () => {
            this.clearSession()
            try {
                await fetch(`${this.authServerUrl}/auth/logout`, { method: 'POST' })
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
                return null
            }

            try {
                const response = await fetch(`${this.authServerUrl}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: session.refreshToken }),
                })

                if (!response.ok) {
                    this.clearSession()
                    return null
                }

                const data = (await response.json()) as { accessToken: string; refreshToken: string }
                const newSession = {
                    ...session,
                    accessToken: data.accessToken,
                    refreshToken: data.refreshToken,
                }
                this.saveSession(newSession)
                return newSession
            } catch {
                this.clearSession()
                return null
            }
        })
    }
}
