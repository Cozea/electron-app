import { BrowserWindow, ipcMain, shell, type WebContents } from 'electron'

import { forEachBroadcastWindow } from '../broadcastWindows'
import { createServer, type Server } from 'node:http'

import { SourceControlProviderService } from './sourceControlProviderService'

type SourceControlProvider = 'github' | 'gitlab'

const DEV_SOURCE_CONTROL_CALLBACK_TIMEOUT_MS = 2 * 60 * 1000

function renderDevSourceControlCallbackPage(options: {
  title: string
  message: string
}): string {
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

interface SourceControlOAuthCallbackResult {
  success: boolean
  provider: SourceControlProvider | 'unknown'
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
  externalId?: string
  externalAccountName?: string
  scopes?: string[]
  metadata?: Record<string, unknown>
  error?: string
}

export class ProjectSourceControlService {
  private static instance: ProjectSourceControlService
  private authServerUrl: string
  private isProduction: boolean
  private protocol: string
  private activeDevOAuthClose: (() => Promise<void>) | null = null
  private providerService = SourceControlProviderService.getInstance()

  private constructor() {
    const devServerUrl =
      process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL
    this.isProduction = !devServerUrl
    this.authServerUrl = (
      process.env.AUTH_SERVER_URL ||
      process.env.VITE_AUTH_SERVER_URL ||
      'https://api.cozea.app'
    ).replace(/\/+$/, '')
    this.protocol =
      process.env.COZEA_PROTOCOL || (this.isProduction ? 'cozea' : 'cozea-dev')
  }

  static getInstance(): ProjectSourceControlService {
    if (!ProjectSourceControlService.instance) {
      ProjectSourceControlService.instance = new ProjectSourceControlService()
    }
    return ProjectSourceControlService.instance
  }

  private getCallbackUri(): string {
    return `${this.protocol}://source-control/callback`
  }

  private emitOAuthSuccess(
    payload: SourceControlOAuthCallbackResult,
    sender?: WebContents | null
  ): void {
    if (sender && !sender.isDestroyed()) {
      sender.send('sourceControl:oauthSuccess', payload)
      return
    }

    forEachBroadcastWindow((window) => {
      if (window.webContents.isDestroyed()) return
      window.webContents.send('sourceControl:oauthSuccess', payload)
    })
  }

  private emitOAuthError(
    payload: { provider: string; error: string },
    sender?: WebContents | null
  ): void {
    if (sender && !sender.isDestroyed()) {
      sender.send('sourceControl:oauthError', payload)
      return
    }

    forEachBroadcastWindow((window) => {
      if (window.webContents.isDestroyed()) return
      window.webContents.send('sourceControl:oauthError', payload)
    })
  }

  private async parseJsonBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) {
      return null
    }

    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  private getErrorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') {
      return fallback
    }

    const record = payload as Record<string, unknown>
    const candidates = [record.error, record.message]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate
      }
    }

    return fallback
  }

  private async startDevLoopbackOAuthBridge(): Promise<{
    redirectUri: string
    waitForCallback: Promise<string>
    close: () => Promise<void>
  }> {
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null
    let server: Server
    let rejectPending: ((reason?: unknown) => void) | null = null

    const waitForCallback = new Promise<string>((resolve, reject) => {
      rejectPending = reject
      server = createServer((req, res) => {
        const requestUrl = req.url || '/'
        const url = new URL(requestUrl, 'http://localhost')

        if (url.pathname !== '/source-control/callback') {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        const provider = url.searchParams.get('provider') || 'unknown'
        const error = url.searchParams.get('error')
        const token = url.searchParams.get('token')

        if (error) {
          res.statusCode = 200
          res.setHeader('content-type', 'text/html')
          res.end(
            renderDevSourceControlCallbackPage({
              title: 'Source control connection failed',
              message: `The ${provider} authorization did not finish. You can close this tab and retry in Cozea.`,
            }),
          )
          if (!settled) {
            settled = true
            resolve(url.toString())
          }
          return
        }

        if (!token) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(
            renderDevSourceControlCallbackPage({
              title: 'Missing token',
              message:
                'No source control token was returned. You can close this tab and retry in Cozea.',
            }),
          )
          if (!settled) {
            settled = true
            reject(new Error('No source control token received'))
          }
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/html')
        res.end(
          renderDevSourceControlCallbackPage({
            title: 'Source control connected',
            message: 'You can close this tab and return to Cozea.',
          }),
        )
        if (!settled) {
          settled = true
          resolve(url.toString())
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
      throw new Error('Unable to allocate local source control callback port')
    }

    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true
        rejectPending?.(
          new Error('Source control authorization timed out. Please try again.')
        )
      }
    }, DEV_SOURCE_CONTROL_CALLBACK_TIMEOUT_MS)

    const close = async () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    const wrappedWaitForCallback = waitForCallback.then(
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
      redirectUri: `http://127.0.0.1:${port}/source-control/callback`,
      waitForCallback: wrappedWaitForCallback,
      close,
    }
  }

  private async beginDevLoopbackOAuth(args: {
    provider: SourceControlProvider
    orgId: string
    metadata?: Record<string, unknown>
    sender?: WebContents | null
  }): Promise<void> {
    if (this.activeDevOAuthClose) {
      await this.activeDevOAuthClose().catch(() => undefined)
      this.activeDevOAuthClose = null
    }

    const bridge = await this.startDevLoopbackOAuthBridge()
    this.activeDevOAuthClose = bridge.close

    try {
      const response = await fetch(`${this.authServerUrl}/auth/source-control/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: args.provider,
          orgId: args.orgId,
          redirectUri: bridge.redirectUri,
          metadata: args.metadata,
        }),
      })

      const payload = await this.parseJsonBody(response)
      if (!response.ok) {
        throw new Error(
          this.getErrorMessage(
            payload,
            'Failed to start source control authorization.',
          ),
        )
      }

      const authorizationUrl =
        payload &&
        typeof payload === 'object' &&
        typeof (payload as { authorizationUrl?: unknown }).authorizationUrl === 'string'
          ? (payload as { authorizationUrl: string }).authorizationUrl
          : null

      if (!authorizationUrl) {
        throw new Error('Auth server did not return an authorization URL.')
      }

      await shell.openExternal(authorizationUrl)
    } catch (error) {
      this.activeDevOAuthClose = null
      await bridge.close().catch(() => undefined)
      throw error
    }

    void bridge.waitForCallback
      .then(async (callbackUrl) => {
        const result = await this.handleOAuthCallback(callbackUrl)
        if (result.success) {
          this.emitOAuthSuccess(result, args.sender)
          return
        }

        this.emitOAuthError(
          {
            provider: result.provider,
            error: result.error || 'OAuth failed',
          },
          args.sender,
        )
      })
      .catch((error) => {
        console.error('Dev source control auth error:', error)
        this.emitOAuthError(
          {
            provider: args.provider,
            error:
              error instanceof Error
                ? error.message
                : 'Source control authorization failed.',
          },
          args.sender,
        )
      })
      .finally(() => {
        if (this.activeDevOAuthClose === bridge.close) {
          this.activeDevOAuthClose = null
        }
      })
  }

  async handleOAuthCallback(url: string): Promise<SourceControlOAuthCallbackResult> {
    const callbackUrl = new URL(url)
    const providerParam = callbackUrl.searchParams.get('provider')
    const provider =
      providerParam === 'github' || providerParam === 'gitlab'
        ? providerParam
        : 'unknown'
    const error = callbackUrl.searchParams.get('error')

    if (error) {
      return {
        success: false,
        provider,
        error,
      }
    }

    const token = callbackUrl.searchParams.get('token')
    if (!token) {
      return {
        success: false,
        provider,
        error: 'Missing source control exchange token',
      }
    }

    const response = await fetch(`${this.authServerUrl}/auth/source-control/desktop/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    const payload = await this.parseJsonBody(response)
    if (!response.ok) {
      return {
        success: false,
        provider,
        error: this.getErrorMessage(payload, `Source control token exchange failed (${response.status})`),
      }
    }

    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        provider,
        error: 'Source control token exchange returned an invalid payload',
      }
    }

    const data = payload as Record<string, unknown>
    const resolvedProvider =
      data.provider === 'github' || data.provider === 'gitlab'
        ? data.provider
        : provider

    return {
      success: true,
      provider: resolvedProvider,
      accessToken:
        typeof data.accessToken === 'string' ? data.accessToken : undefined,
      refreshToken:
        typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
      tokenExpiresAt:
        typeof data.tokenExpiresAt === 'number' ? data.tokenExpiresAt : undefined,
      externalId:
        typeof data.externalId === 'string' ? data.externalId : undefined,
      externalAccountName:
        typeof data.externalAccountName === 'string'
          ? data.externalAccountName
          : undefined,
      scopes:
        Array.isArray(data.scopes) && data.scopes.every((value) => typeof value === 'string')
          ? (data.scopes as string[])
          : undefined,
      metadata:
        data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
          ? (data.metadata as Record<string, unknown>)
          : undefined,
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle(
      'sourceControl:startOAuth',
      async (
        event,
        options: { provider: SourceControlProvider; orgId: string; metadata?: Record<string, unknown> }
      ) => {
        if (!this.isProduction) {
          await this.beginDevLoopbackOAuth({
            provider: options.provider,
            orgId: options.orgId,
            metadata: options.metadata,
            sender: event.sender,
          })
          return { success: true }
        }

        const response = await fetch(`${this.authServerUrl}/auth/source-control/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: options.provider,
            orgId: options.orgId,
            redirectUri: this.getCallbackUri(),
            metadata: options.metadata,
          }),
        })

        const payload = await this.parseJsonBody(response)
        if (!response.ok) {
          return {
            success: false,
            error: this.getErrorMessage(
              payload,
              'Failed to start source control authorization.',
            ),
          }
        }

        const authorizationUrl =
          payload &&
          typeof payload === 'object' &&
          typeof (payload as { authorizationUrl?: unknown }).authorizationUrl === 'string'
            ? (payload as { authorizationUrl: string }).authorizationUrl
            : null

        if (!authorizationUrl) {
          return {
            success: false,
            error: 'Auth server did not return an authorization URL.',
          }
        }

        await shell.openExternal(authorizationUrl)
        return { success: true }
      }
    )

    ipcMain.handle(
      'sourceControl:listRepositoryOwners',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          accessToken?: string
          providerHost?: string
          authStrategy?: 'oauth' | 'github_app_installation'
          bypassCache?: boolean
        }
      ) => {
        return this.providerService.listRepositoryOwners(options)
      }
    )

    ipcMain.handle(
      'sourceControl:listRepositoriesPage',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          accessToken?: string
          providerHost?: string
          authStrategy?: 'oauth' | 'github_app_installation'
          ownerId?: string
          ownerLogin?: string
          ownerKind?: 'user' | 'organization' | 'group'
          search?: string
          page: number
          pageSize: number
          bypassCache?: boolean
        }
      ) => {
        return this.providerService.listRepositoriesPage(options)
      }
    )

    ipcMain.handle(
      'sourceControl:listBranches',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          accessToken?: string
          providerHost?: string
          authStrategy?: 'oauth' | 'github_app_installation'
          repositoryId?: string
          repositoryFullName: string
          defaultBranch?: string
          bypassCache?: boolean
        }
      ) => {
        return this.providerService.listRepositoryBranches(options)
      }
    )

    ipcMain.handle(
      'sourceControl:listRepositoryLanguages',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          accessToken?: string
          providerHost?: string
          authStrategy?: 'oauth' | 'github_app_installation'
          repoUrl: string
          repositoryId?: string
          bypassCache?: boolean
        }
      ) => {
        return this.providerService.listRepositoryLanguages(options)
      }
    )

    ipcMain.handle(
      'sourceControl:getRepositoryReadmeSnippet',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          accessToken?: string
          providerHost?: string
          authStrategy?: 'oauth' | 'github_app_installation'
          repoUrl: string
          repositoryId?: string
          branch?: string
          bypassCache?: boolean
        }
      ) => {
        return this.providerService.getRepositoryReadmeSnippet(options)
      }
    )

    ipcMain.handle(
      'sourceControl:createRepository',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          accessToken?: string
          providerHost?: string
          authStrategy?: 'oauth' | 'github_app_installation'
          ownerId?: string
          ownerLogin?: string
          ownerKind?: 'user' | 'organization' | 'group'
          name: string
          private: boolean
        }
      ) => {
        return this.providerService.createRepository(options)
      }
    )

    ipcMain.handle(
      'sourceControl:syncRepositoryAccess',
      async (
        _event,
        options: {
          provider: SourceControlProvider
          repoUrl: string
          accessToken?: string
          providerHost?: string
          action: 'grant' | 'revoke'
          role: 'project_manager' | 'developer' | 'designer' | 'viewer'
          inviteEmail?: string
          providerAccountHandle?: string
        }
      ) => {
        return this.providerService.syncRepositoryAccess(options)
      }
    )

    ipcMain.handle(
      'sourceControl:invalidateProviderCache',
      async (
        _event,
        options?: {
          provider?: SourceControlProvider
        }
      ) => {
        this.providerService.invalidateCache(options)
        return { success: true }
      }
    )
  }
}
