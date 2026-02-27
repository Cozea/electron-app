import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { randomBytes, createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import os from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ProviderAuthConnectResult,
  ProviderAuthDisconnectResult,
  ProviderAuthMethod,
  ProviderAuthProvider,
  ProviderAuthRequestAuthResult,
  ProviderAuthRequestEnvelope,
  ProviderAuthStatus,
} from '../../shared/electronApiTypes'

const execFileAsync = promisify(execFile)

interface ProviderCredential {
  provider: ProviderAuthProvider
  authType: 'oauth' | 'local_token' | 'api_key'
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  tokenEndpoint?: string
  clientId?: string
  clientSecret?: string
  baseUrl?: string
  headers?: Record<string, string>
  googleMode?: 'vertex' | 'gemini'
  googleProjectId?: string
  googleLocation?: string
  lastError?: string
  updatedAt: number
}

interface ProviderAuthStore {
  providers: Partial<Record<ProviderAuthProvider, ProviderCredential>>
}

interface OAuthCallbackResult {
  code: string
}

interface TokenExchangeResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  token_type?: string
}

interface OpenAiDeviceUserCodeResponse {
  device_auth_id: string
  user_code: string
  interval?: string
}

interface OpenAiDeviceTokenResponse {
  authorization_code: string
  code_verifier: string
}

const OPENAI_CLIENT_ID = process.env.COZEA_OPENAI_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_ISSUER = process.env.COZEA_OPENAI_OAUTH_ISSUER || 'https://auth.openai.com'
const OPENAI_SCOPE = process.env.COZEA_OPENAI_OAUTH_SCOPE || 'openid profile email offline_access'
const OPENAI_ORIGINATOR = process.env.COZEA_OPENAI_OAUTH_ORIGINATOR || 'opencode'
const OPENAI_CODEX_BASE_URL =
  process.env.COZEA_OPENAI_REQUEST_BASE_URL || 'https://chatgpt.com/backend-api/codex'
const OPENAI_API_BASE_URL = 'https://api.openai.com'
const OPENAI_REQUEST_ORIGINATOR =
  process.env.COZEA_OPENAI_REQUEST_ORIGINATOR || OPENAI_ORIGINATOR
const DEFAULT_OAUTH_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_CALLBACK_PORT = Number(process.env.COZEA_PROVIDER_AUTH_PORT || '1455')
const OPENAI_DEVICE_AUTH_TIMEOUT_MS = Number(
  process.env.COZEA_OPENAI_DEVICE_AUTH_TIMEOUT_MS || 5 * 60 * 1000
)
const OPENAI_DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS = 3000

const ANTHROPIC_CLIENT_ID =
  process.env.COZEA_ANTHROPIC_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const ANTHROPIC_CLIENT_SECRET = process.env.COZEA_ANTHROPIC_OAUTH_CLIENT_SECRET
const ANTHROPIC_AUTHORIZE_URL =
  process.env.COZEA_ANTHROPIC_OAUTH_AUTHORIZE_URL || 'https://claude.ai/oauth/authorize'
const ANTHROPIC_TOKEN_URL =
  process.env.COZEA_ANTHROPIC_OAUTH_TOKEN_URL || 'https://console.anthropic.com/v1/oauth/token'
const ANTHROPIC_SCOPE =
  process.env.COZEA_ANTHROPIC_OAUTH_SCOPE || 'org:create_api_key user:profile user:inference'
const ANTHROPIC_MANUAL_REDIRECT_URI =
  process.env.COZEA_ANTHROPIC_MANUAL_REDIRECT_URI || 'https://console.anthropic.com/oauth/code/callback'
const DEFAULT_GOOGLE_VERTEX_LOCATION =
  process.env.GOOGLE_VERTEX_LOCATION || process.env.VERTEX_LOCATION || 'global'
const GOOGLE_GEMINI_CLIENT_ID =
  process.env.COZEA_GOOGLE_GEMINI_OAUTH_CLIENT_ID ||
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GOOGLE_GEMINI_CLIENT_SECRET =
  process.env.COZEA_GOOGLE_GEMINI_OAUTH_CLIENT_SECRET || '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'
const GOOGLE_GEMINI_REDIRECT_URI =
  process.env.COZEA_GOOGLE_GEMINI_REDIRECT_URI || 'http://localhost:8085/oauth2callback'
const GOOGLE_GEMINI_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_GEMINI_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_GEMINI_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')
const GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
const GOOGLE_GEMINI_CODE_ASSIST_HEADERS = {
  'User-Agent': 'google-api-nodejs-client/9.15.1',
  'X-Goog-Api-Client': 'gl-node/22.17.0',
  'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
} as const
const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_API_VERSION = '2023-06-01'
const XAI_API_BASE_URL = 'https://api.x.ai'
const GITHUB_COPILOT_CLIENT_ID = process.env.COZEA_GITHUB_COPILOT_CLIENT_ID || 'Ov23li8tweQw6odWQebz'
const GITHUB_COPILOT_DEVICE_CODE_URL =
  process.env.COZEA_GITHUB_COPILOT_DEVICE_CODE_URL || 'https://github.com/login/device/code'
const GITHUB_COPILOT_ACCESS_TOKEN_URL =
  process.env.COZEA_GITHUB_COPILOT_ACCESS_TOKEN_URL || 'https://github.com/login/oauth/access_token'
const GITHUB_COPILOT_SCOPE = process.env.COZEA_GITHUB_COPILOT_SCOPE || 'read:user'
const GITHUB_COPILOT_API_BASE_URL = process.env.COZEA_GITHUB_COPILOT_API_BASE_URL || 'https://api.githubcopilot.com'
const GITLAB_CLIENT_ID = process.env.COZEA_GITLAB_OAUTH_CLIENT_ID
const GITLAB_CLIENT_SECRET = process.env.COZEA_GITLAB_OAUTH_CLIENT_SECRET
const GITLAB_AUTHORIZE_URL = process.env.COZEA_GITLAB_OAUTH_AUTHORIZE_URL || 'https://gitlab.com/oauth/authorize'
const GITLAB_TOKEN_URL = process.env.COZEA_GITLAB_OAUTH_TOKEN_URL || 'https://gitlab.com/oauth/token'
const GITLAB_SCOPE = process.env.COZEA_GITLAB_OAUTH_SCOPE || 'read_user api'
const GITLAB_API_BASE_URL = process.env.COZEA_GITLAB_API_BASE_URL || 'https://gitlab.com'

const ENABLED_PROVIDER_AUTH_PROVIDERS = ['openai', 'anthropic', 'google', 'xai', 'github-copilot', 'gitlab'] as const
const ENABLED_PROVIDER_AUTH_PROVIDER_SET = new Set<ProviderAuthProvider>(ENABLED_PROVIDER_AUTH_PROVIDERS)

function isProviderEnabled(provider: ProviderAuthProvider): boolean {
  return true
}

interface GoogleGeminiManualAuthSession {
  verifier: string
  state: string
  redirectUri: string
  createdAt: number
}

interface GoogleGeminiLoadCodeAssistPayload {
  cloudaicompanionProject?:
    | string
    | {
        id?: string
      }
  currentTier?: {
    id?: string
    name?: string
  }
  allowedTiers?: Array<{
    id?: string
    isDefault?: boolean
    userDefinedCloudaicompanionProject?: boolean
    name?: string
    description?: string
  }>
  ineligibleTiers?: Array<{
    reasonMessage?: string
  }>
}

interface GoogleGeminiOnboardPayload {
  name?: string
  done?: boolean
  response?: {
    cloudaicompanionProject?: {
      id?: string
    }
  }
}

function buildOpenAiRequestHeaders(): Record<string, string> {
  return {
    originator: OPENAI_REQUEST_ORIGINATOR,
    'User-Agent': `cozea/${app.getVersion()} (${os.platform()} ${os.release()}; ${os.arch()})`,
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractOpenAiAccountIdFromClaims(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined
  const accountId = claims.chatgpt_account_id
  if (typeof accountId === 'string' && accountId.length > 0) return accountId

  const authClaims = claims['https://api.openai.com/auth']
  if (typeof authClaims === 'object' && authClaims !== null) {
    const nestedAccountId = (authClaims as Record<string, unknown>).chatgpt_account_id
    if (typeof nestedAccountId === 'string' && nestedAccountId.length > 0) return nestedAccountId
  }

  const organizations = claims.organizations
  if (Array.isArray(organizations) && organizations.length > 0) {
    const first = organizations[0]
    if (typeof first === 'object' && first !== null) {
      const firstId = (first as Record<string, unknown>).id
      if (typeof firstId === 'string' && firstId.length > 0) return firstId
    }
  }

  return undefined
}

function parseGoogleProjectFromAdc(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const possibleIds = [parsed.project_id, parsed.quota_project_id, parsed.project, parsed.gcloud_project]
    for (const candidate of possibleIds) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim()
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

function parseAuthorizationCodeWithState(input: string): { code: string; state?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { code: '' }

  // Accept full callback URLs and extract query/hash params.
  try {
    const parsedUrl = new URL(trimmed)
    const queryCode = parsedUrl.searchParams.get('code')
    const queryState = parsedUrl.searchParams.get('state')
    if (queryCode) {
      return {
        code: queryCode,
        ...(queryState ? { state: queryState } : {}),
      }
    }

    const hash = parsedUrl.hash.replace(/^#/, '')
    if (hash) {
      const hashParams = new URLSearchParams(hash)
      const hashCode = hashParams.get('code')
      const hashState = hashParams.get('state')
      if (hashCode) {
        return {
          code: hashCode,
          ...(hashState ? { state: hashState } : {}),
        }
      }
    }
  } catch {
    // Not a URL, continue with raw parsing.
  }

  // Accept query-string-like payloads pasted directly.
  if (trimmed.includes('code=')) {
    const parsedQuery = new URLSearchParams(trimmed.replace(/^\?/, ''))
    const queryCode = parsedQuery.get('code')
    const queryState = parsedQuery.get('state')
    if (queryCode) {
      return {
        code: queryCode,
        ...(queryState ? { state: queryState } : {}),
      }
    }
  }

  // OpenCode fallback format: code#state.
  const splitIndex = trimmed.indexOf('#')
  if (splitIndex < 0) {
    return { code: trimmed }
  }
  const code = trimmed.slice(0, splitIndex).trim()
  const state = trimmed.slice(splitIndex + 1).trim()
  return {
    code,
    ...(state ? { state } : {}),
  }
}

function parseGoogleGeminiCallbackInput(input: string): { code?: string; state?: string } {
  const trimmed = input.trim()
  if (!trimmed) return {}

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return {
        code: url.searchParams.get('code') || undefined,
        state: url.searchParams.get('state') || undefined,
      }
    } catch {
      return {}
    }
  }

  const queryCandidate = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  if (queryCandidate.includes('=')) {
    const params = new URLSearchParams(queryCandidate)
    const code = params.get('code') || undefined
    const state = params.get('state') || undefined
    if (code || state) {
      return { code, state }
    }
  }

  return { code: trimmed }
}

/** Escape for use in HTML text content to avoid XSS */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Logo data URL for OAuth callback page (white logo on dark background = logo_dark_mode.png per Logo.tsx). Cached after first read. */
let oauthCallbackLogoDataUrl: string | null = null
function getOAuthCallbackLogoDataUrl(): string | null {
  if (oauthCallbackLogoDataUrl !== null) return oauthCallbackLogoDataUrl
  const appRoot = process.env.APP_ROOT || app.getAppPath()
  const candidates = [
    join(appRoot, 'src', 'assets', 'logos', 'logo_dark_mode.png'),
    join(appRoot, 'out', 'assets', 'logo_dark_mode.png'),
    join(app.getAppPath(), 'out', 'assets', 'logo_dark_mode.png'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const buf = readFileSync(p)
        oauthCallbackLogoDataUrl = `data:image/png;base64,${buf.toString('base64')}`
        return oauthCallbackLogoDataUrl
      } catch {
        break
      }
    }
  }
  return null
}

/** Shared OAuth callback page styles (refined dark theme, depth, polish) */
const OAUTH_CALLBACK_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    overflow: hidden;
    overscroll-behavior: none;
    -webkit-overflow-scrolling: auto;
    height: 100%;
    margin: 0;
  }
  body {
    min-height: 100vh;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(165deg, #1a1a1a 0%, #252525 50%, #1e1e1e 100%);
    color: #f4f4f5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    gap: 2.5rem;
    -webkit-font-smoothing: antialiased;
  }
  .logo-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.875rem;
  }
  .logo-wrap img {
    height: 56px;
    width: auto;
    display: block;
    opacity: 0.95;
  }
  .logo {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: rgba(255,255,255,0.92);
    margin: 0;
  }
  .card {
    background: linear-gradient(180deg, rgba(38,38,38,0.95) 0%, rgba(32,32,32,0.98) 100%);
    border-radius: 1.25rem;
    padding: 2.75rem 3rem;
    max-width: 28rem;
    width: 100%;
    text-align: center;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.2) inset,
      0 4px 6px -1px rgba(0,0,0,0.3),
      0 24px 48px -12px rgba(0,0,0,0.5);
    backdrop-filter: blur(8px);
  }
  .card .icon { margin-bottom: 1.5rem; }
  .card h1 {
    font-size: 1.375rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
    color: rgba(255,255,255,0.95);
    letter-spacing: -0.01em;
  }
  .card p {
    margin: 0;
    font-size: 0.9375rem;
    color: rgba(161,161,170,0.95);
    line-height: 1.55;
  }
`

/** Cozea-styled OAuth callback success page (app theme, centered, logo, elegant container) */
function getOAuthCallbackSuccessHtml(): string {
  const logoDataUrl = getOAuthCallbackLogoDataUrl()
  const logoHtml = logoDataUrl
    ? `<div class="logo-wrap"><img src="${logoDataUrl}" alt="Cozea" /><span class="logo">Cozea</span></div>`
    : '<div class="logo" aria-hidden="true">Cozea</div>'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorization complete – Cozea</title>
  <style>${OAUTH_CALLBACK_STYLES}
  .card.card-success { border-color: rgba(59,130,246,0.35); box-shadow: 0 0 0 1px rgba(0,0,0,0.2) inset, 0 4px 6px -1px rgba(0,0,0,0.3), 0 24px 48px -12px rgba(0,0,0,0.5), 0 0 40px -8px rgba(59,130,246,0.2); }
  .card-success .icon { color: #60a5fa; filter: drop-shadow(0 0 12px rgba(96,165,250,0.3)); }
  </style>
</head>
<body>
  ${logoHtml}
  <div class="card card-success">
    <div class="icon" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto; display: block;">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </div>
    <h1>Authorization complete</h1>
    <p>You can close this tab and return to Cozea.</p>
  </div>
</body>
</html>`
}

/** Cozea-styled OAuth callback error page (app theme, centered, logo, elegant container) */
function getOAuthCallbackErrorHtml(message: string): string {
  const safe = escapeHtml(message)
  const logoDataUrl = getOAuthCallbackLogoDataUrl()
  const logoHtml = logoDataUrl
    ? `<div class="logo-wrap"><img src="${logoDataUrl}" alt="Cozea" /><span class="logo">Cozea</span></div>`
    : '<div class="logo" aria-hidden="true">Cozea</div>'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorization failed – Cozea</title>
  <style>${OAUTH_CALLBACK_STYLES}
  .card.card-error { border-color: rgba(248,113,113,0.3); box-shadow: 0 0 0 1px rgba(0,0,0,0.2) inset, 0 4px 6px -1px rgba(0,0,0,0.3), 0 24px 48px -12px rgba(0,0,0,0.5), 0 0 40px -8px rgba(248,113,113,0.12); }
  .card-error .icon { color: #f87171; filter: drop-shadow(0 0 10px rgba(248,113,113,0.2)); }
  .card-error p { color: rgba(250,204,204,0.9); }
  </style>
</head>
<body>
  ${logoHtml}
  <div class="card card-error">
    <div class="icon" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto; display: block;">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    </div>
    <h1>Authorization failed</h1>
    <p>${safe}</p>
  </div>
</body>
</html>`
}

export class ProviderAuthService {
  private static instance: ProviderAuthService
  private storagePath: string | null = null
  private readonly isProduction: boolean
  private pendingGoogleGeminiManualAuth: GoogleGeminiManualAuthSession | null = null

  private constructor() {
    const devServerUrl = process.env['VITE_DEV_SERVER_URL'] || process.env['ELECTRON_RENDERER_URL']
    this.isProduction = !devServerUrl
  }

  static getInstance(): ProviderAuthService {
    if (!ProviderAuthService.instance) {
      ProviderAuthService.instance = new ProviderAuthService()
    }
    return ProviderAuthService.instance
  }

  private getStoragePath(): string {
    if (!this.storagePath) {
      this.storagePath = join(app.getPath('userData'), 'provider-auth.enc')
    }
    return this.storagePath
  }

  private loadStore(): ProviderAuthStore {
    const filePath = this.getStoragePath()
    if (!existsSync(filePath)) {
      return { providers: {} }
    }

    try {
      const fileData = readFileSync(filePath)
      let json = ''

      if (safeStorage.isEncryptionAvailable()) {
        try {
          json = safeStorage.decryptString(fileData)
        } catch {
          json = fileData.toString('utf8')
        }
      } else {
        json = fileData.toString('utf8')
      }

      const parsed = JSON.parse(json) as ProviderAuthStore
      return {
        providers: parsed.providers || {},
      }
    } catch {
      return { providers: {} }
    }
  }

  private saveStore(store: ProviderAuthStore): void {
    const filePath = this.getStoragePath()
    const json = JSON.stringify(store)

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json)
      writeFileSync(filePath, encrypted)
      return
    }

    if (this.isProduction) {
      dialog.showErrorBox(
        'Security Error',
        'Provider auth encryption is unavailable. Please ensure OS keychain access is enabled.'
      )
      throw new Error('Provider auth encryption required in production')
    }

    writeFileSync(filePath, json)
  }

  private updateProviderCredential(provider: ProviderAuthProvider, credential: ProviderCredential): ProviderAuthStatus {
    const store = this.loadStore()
    store.providers[provider] = credential
    this.saveStore(store)
    const status = this.toStatus(provider, credential)
    this.emitStatusChanged(provider)
    return status
  }

  private removeProviderCredential(provider: ProviderAuthProvider): void {
    const store = this.loadStore()
    delete store.providers[provider]
    this.saveStore(store)
    this.emitStatusChanged(provider)
  }

  private emitStatusChanged(provider?: ProviderAuthProvider): void {
    const store = this.loadStore()
    const allProviders = Array.from(new Set([...ENABLED_PROVIDER_AUTH_PROVIDERS, ...Object.keys(store.providers)])) as ProviderAuthProvider[]
    const providers: ProviderAuthProvider[] = provider
      ? (isProviderEnabled(provider) ? [provider] : [])
      : allProviders
    if (providers.length === 0) return
    const statuses = providers.map((id) => this.toStatus(id, store.providers[id]))
    const payload = {
      provider,
      statuses,
      updatedAt: Date.now(),
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      window.webContents.send('providerAuth:statusChanged', payload)
    }
  }

  private toStatus(
    provider: ProviderAuthProvider,
    credential?: ProviderCredential
  ): ProviderAuthStatus {
    if (!credential) {
      return {
        provider,
        connected: false,
      }
    }

    return {
      provider,
      connected: true,
      authType: credential.authType,
      expiresAt: credential.expiresAt,
      accountId: credential.accountId,
      googleMode: credential.googleMode,
      googleProjectId: credential.googleProjectId,
      googleLocation: credential.googleLocation,
      lastError: credential.lastError,
      updatedAt: credential.updatedAt,
    }
  }

  private buildPkce(): { verifier: string; challenge: string } {
    const verifier = base64UrlEncode(randomBytes(32))
    const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
    return { verifier, challenge }
  }

  private createState(): string {
    return base64UrlEncode(randomBytes(32))
  }

  private async startOAuthCallbackServer(expectedState: string): Promise<{
    redirectUri: string
    waitForCode: Promise<OAuthCallbackResult>
    close: () => Promise<void>
  }> {
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null
    const server: Server = createServer((req, res) => {
      const requestUrl = req.url || '/'
      const url = new URL(requestUrl, 'http://127.0.0.1')

      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (error) {
        const message = errorDescription || error
        res.statusCode = 400
        res.setHeader('content-type', 'text/html')
        res.end(getOAuthCallbackErrorHtml(message))
        if (!settled) {
          settled = true
          rejectPending?.(new Error(message))
        }
        return
      }

      if (!code) {
        res.statusCode = 400
        res.setHeader('content-type', 'text/html')
        res.end(getOAuthCallbackErrorHtml('Missing authorization code.'))
        if (!settled) {
          settled = true
          rejectPending?.(new Error('Missing authorization code'))
        }
        return
      }

      if (!state || state !== expectedState) {
        res.statusCode = 400
        res.setHeader('content-type', 'text/html')
        res.end(getOAuthCallbackErrorHtml('Invalid state.'))
        if (!settled) {
          settled = true
          rejectPending?.(new Error('Invalid oauth state'))
        }
        return
      }

      res.statusCode = 200
      res.setHeader('content-type', 'text/html')
      res.end(getOAuthCallbackSuccessHtml())
      if (!settled) {
        settled = true
        resolvePending?.({ code })
      }
    })
    let rejectPending: ((reason?: unknown) => void) | null = null
    let resolvePending: ((value: OAuthCallbackResult) => void) | null = null

    const waitForCode = new Promise<OAuthCallbackResult>((resolve, reject) => {
      resolvePending = resolve
      rejectPending = reject
    })

    const listen = async (port: number) =>
      await new Promise<void>((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => resolve())
        server.once('error', reject)
      })

    try {
      await listen(DEFAULT_CALLBACK_PORT)
    } catch {
      await listen(0)
    }

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : DEFAULT_CALLBACK_PORT
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`

    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true
        rejectPending?.(new Error('OAuth callback timeout - authorization took too long'))
      }
    }, DEFAULT_OAUTH_TIMEOUT_MS)

    const close = async () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    const wrappedWaitForCode = waitForCode.then(
      async (value) => {
        await close()
        return value
      },
      async (err) => {
        await close()
        throw err
      }
    )

    return { redirectUri, waitForCode: wrappedWaitForCode, close }
  }

  private async startOpenAiCallbackServer(expectedState: string): Promise<{
    redirectUri: string
    waitForCode: Promise<OAuthCallbackResult>
    close: () => Promise<void>
  }> {
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null
    let server: Server
    let rejectPending: ((reason?: unknown) => void) | null = null

    const waitForCode = new Promise<OAuthCallbackResult>((resolve, reject) => {
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
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (error) {
          const message = errorDescription || error
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml(message))
          if (!settled) {
            settled = true
            reject(new Error(message))
          }
          return
        }

        if (!code) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml('Missing authorization code.'))
          if (!settled) {
            settled = true
            reject(new Error('Missing authorization code'))
          }
          return
        }

        if (!state || state !== expectedState) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml('Invalid state.'))
          if (!settled) {
            settled = true
            reject(new Error('Invalid oauth state'))
          }
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/html')
        res.end(getOAuthCallbackSuccessHtml())
        if (!settled) {
          settled = true
          resolve({ code })
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.listen(DEFAULT_CALLBACK_PORT, '127.0.0.1', () => resolve())
      server.once('error', reject)
    }).catch(() => {
      throw new Error(
        `OpenAI OAuth callback port ${DEFAULT_CALLBACK_PORT} is unavailable. Close any app using it and retry.`
      )
    })

    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true
        rejectPending?.(new Error('OAuth callback timeout - authorization took too long'))
      }
    }, DEFAULT_OAUTH_TIMEOUT_MS)

    const close = async () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    const wrappedWaitForCode = waitForCode.then(
      async (value) => {
        await close()
        return value
      },
      async (err) => {
        await close()
        throw err
      }
    )

    return {
      redirectUri: `http://localhost:${DEFAULT_CALLBACK_PORT}/auth/callback`,
      waitForCode: wrappedWaitForCode,
      close,
    }
  }

  private async startAnthropicCallbackServer(expectedState: string): Promise<{
    redirectUri: string
    waitForCode: Promise<OAuthCallbackResult>
    close: () => Promise<void>
  }> {
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null
    let server: Server
    let rejectPending: ((reason?: unknown) => void) | null = null

    const waitForCode = new Promise<OAuthCallbackResult>((resolve, reject) => {
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
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (error) {
          const message = errorDescription || error
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml(message))
          if (!settled) {
            settled = true
            reject(new Error(message))
          }
          return
        }

        if (!code) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml('Missing authorization code.'))
          if (!settled) {
            settled = true
            reject(new Error('Missing authorization code'))
          }
          return
        }

        if (!state || state !== expectedState) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml('Invalid state.'))
          if (!settled) {
            settled = true
            reject(new Error('Invalid oauth state'))
          }
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/html')
        res.end(getOAuthCallbackSuccessHtml())
        if (!settled) {
          settled = true
          resolve({ code })
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.listen(DEFAULT_CALLBACK_PORT, '127.0.0.1', () => resolve())
      server.once('error', reject)
    }).catch(() => {
      throw new Error(
        `Anthropic OAuth callback port ${DEFAULT_CALLBACK_PORT} is unavailable. Close any app using it and retry.`
      )
    })

    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true
        rejectPending?.(new Error('OAuth callback timeout - authorization took too long'))
      }
    }, DEFAULT_OAUTH_TIMEOUT_MS)

    const close = async () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    const wrappedWaitForCode = waitForCode.then(
      async (value) => {
        await close()
        return value
      },
      async (err) => {
        await close()
        throw err
      }
    )

    return {
      redirectUri: `http://localhost:${DEFAULT_CALLBACK_PORT}/auth/callback`,
      waitForCode: wrappedWaitForCode,
      close,
    }
  }

  private async startGoogleGeminiCallbackServer(expectedState: string): Promise<{
    redirectUri: string
    waitForCode: Promise<OAuthCallbackResult>
    close: () => Promise<void>
  }> {
    const redirect = new URL(GOOGLE_GEMINI_REDIRECT_URI)
    const callbackPath = redirect.pathname || '/'
    const callbackPort = redirect.port
      ? Number.parseInt(redirect.port, 10)
      : redirect.protocol === 'https:'
        ? 443
        : 80
    const origin = `${redirect.protocol}//${redirect.host}`

    let settled = false
    let timeoutId: NodeJS.Timeout | null = null
    let server: Server
    let rejectPending: ((reason?: unknown) => void) | null = null

    const waitForCode = new Promise<OAuthCallbackResult>((resolve, reject) => {
      rejectPending = reject
      server = createServer((req, res) => {
        if (!req.url) {
          res.statusCode = 400
          res.end('Invalid request')
          return
        }

        const url = new URL(req.url, origin)
        if (url.pathname !== callbackPath) {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        const error = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (error) {
          const message = errorDescription || error
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml(message))
          if (!settled) {
            settled = true
            reject(new Error(message))
          }
          return
        }

        if (!code) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml('Missing authorization code.'))
          if (!settled) {
            settled = true
            reject(new Error('Missing authorization code'))
          }
          return
        }

        if (!state || state !== expectedState) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html')
          res.end(getOAuthCallbackErrorHtml('Invalid state.'))
          if (!settled) {
            settled = true
            reject(new Error('Invalid oauth state'))
          }
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/html')
        res.end(getOAuthCallbackSuccessHtml())
        if (!settled) {
          settled = true
          resolve({ code })
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.listen(callbackPort, '127.0.0.1', () => resolve())
      server.once('error', reject)
    }).catch(() => {
      throw new Error(
        `Google OAuth callback port ${callbackPort} is unavailable. Close any app using it and retry.`
      )
    })

    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true
        rejectPending?.(new Error('OAuth callback timeout - authorization took too long'))
      }
    }, DEFAULT_OAUTH_TIMEOUT_MS)

    const close = async () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    const wrappedWaitForCode = waitForCode.then(
      async (value) => {
        await close()
        return value
      },
      async (err) => {
        await close()
        throw err
      }
    )

    return {
      redirectUri: GOOGLE_GEMINI_REDIRECT_URI,
      waitForCode: wrappedWaitForCode,
      close,
    }
  }

  private buildGoogleGeminiAuthorizeUrl(params: {
    redirectUri: string
    challenge: string
    state: string
  }): string {
    const authUrl = new URL(GOOGLE_GEMINI_AUTHORIZE_URL)
    authUrl.searchParams.set('client_id', GOOGLE_GEMINI_CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', params.redirectUri)
    authUrl.searchParams.set('scope', GOOGLE_GEMINI_SCOPE)
    authUrl.searchParams.set('code_challenge', params.challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', params.state)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.hash = 'opencode'
    return authUrl.toString()
  }

  private async exchangeGoogleGeminiAuthorizationCode(params: {
    code: string
    verifier: string
    redirectUri: string
  }): Promise<TokenExchangeResponse> {
    const response = await fetch(GOOGLE_GEMINI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_GEMINI_CLIENT_ID,
        client_secret: GOOGLE_GEMINI_CLIENT_SECRET,
        code: params.code,
        grant_type: 'authorization_code',
        redirect_uri: params.redirectUri,
        code_verifier: params.verifier,
      }).toString(),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Google token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`
      )
    }

    return (await response.json()) as TokenExchangeResponse
  }

  private async fetchGoogleGeminiAccountEmail(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      })
      if (!response.ok) return undefined
      const payload = (await response.json()) as { email?: unknown }
      return typeof payload.email === 'string' && payload.email.trim().length > 0
        ? payload.email.trim()
        : undefined
    } catch {
      return undefined
    }
  }

  private resolveGoogleGeminiConfiguredProjectId(): string | undefined {
    const envProjectId =
      process.env.OPENCODE_GEMINI_PROJECT_ID?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() ||
      process.env.GOOGLE_VERTEX_PROJECT?.trim()
    return envProjectId || undefined
  }

  private normalizeGoogleProjectId(value: unknown): string | undefined {
    if (!value) return undefined
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : undefined
    }
    if (typeof value === 'object' && value !== null && 'id' in value) {
      const id = (value as { id?: unknown }).id
      if (typeof id === 'string') {
        const trimmed = id.trim()
        return trimmed.length > 0 ? trimmed : undefined
      }
    }
    return undefined
  }

  private pickGoogleGeminiOnboardTier(
    allowedTiers: NonNullable<GoogleGeminiLoadCodeAssistPayload['allowedTiers']> | undefined
  ): string {
    const FREE_TIER_ID = 'free-tier'
    const LEGACY_TIER_ID = 'legacy-tier'
    if (!allowedTiers || allowedTiers.length === 0) return LEGACY_TIER_ID
    const preferred = allowedTiers.find((tier) => tier?.isDefault) || allowedTiers[0]
    return preferred?.id || FREE_TIER_ID
  }

  private async loadGoogleGeminiManagedProject(
    accessToken: string,
    projectId?: string
  ): Promise<GoogleGeminiLoadCodeAssistPayload | null> {
    const metadata: Record<string, string> = {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      ...(projectId ? { duetProject: projectId } : {}),
    }

    const requestBody: Record<string, unknown> = { metadata }
    if (projectId) {
      requestBody.cloudaicompanionProject = projectId
    }

    try {
      const response = await fetch(`${GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
          ...GOOGLE_GEMINI_CODE_ASSIST_HEADERS,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) return null
      return (await response.json()) as GoogleGeminiLoadCodeAssistPayload
    } catch {
      return null
    }
  }

  private async onboardGoogleGeminiManagedProject(
    accessToken: string,
    tierId: string,
    projectId?: string
  ): Promise<string | undefined> {
    const FREE_TIER_ID = 'free-tier'
    const isFreeTier = tierId === FREE_TIER_ID

    if (!isFreeTier && !projectId) {
      throw new Error(
        'Google Gemini requires a Google Cloud project. Set OPENCODE_GEMINI_PROJECT_ID or GOOGLE_CLOUD_PROJECT and reconnect.'
      )
    }

    const metadata: Record<string, string> = {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      ...(!isFreeTier && projectId ? { duetProject: projectId } : {}),
    }

    const body: Record<string, unknown> = {
      tierId,
      metadata,
    }

    if (!isFreeTier && projectId) {
      body.cloudaicompanionProject = projectId
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...GOOGLE_GEMINI_CODE_ASSIST_HEADERS,
    }

    const response = await fetch(`${GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!response.ok) return undefined

    let payload = (await response.json()) as GoogleGeminiOnboardPayload
    if (!payload.done && payload.name) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        const operationResponse = await fetch(
          `${GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT}/v1internal/${payload.name}`,
          {
            method: 'GET',
            headers,
          }
        )
        if (!operationResponse.ok) return undefined
        payload = (await operationResponse.json()) as GoogleGeminiOnboardPayload
        if (payload.done) break
      }
    }

    const managedProjectId = payload.response?.cloudaicompanionProject?.id
    if (payload.done && managedProjectId) {
      return managedProjectId
    }
    if (payload.done && projectId) {
      return projectId
    }
    return undefined
  }

  private async resolveGoogleGeminiProjectId(
    accessToken: string,
    existingProjectId?: string
  ): Promise<string | undefined> {
    const configuredProjectId = existingProjectId || this.resolveGoogleGeminiConfiguredProjectId()
    const loadPayload = await this.loadGoogleGeminiManagedProject(accessToken, configuredProjectId)

    if (!loadPayload) {
      if (configuredProjectId) return configuredProjectId
      throw new Error(
        'Google Gemini requires a Google Cloud project. Set OPENCODE_GEMINI_PROJECT_ID or GOOGLE_CLOUD_PROJECT and reconnect.'
      )
    }

    const managedProjectId = this.normalizeGoogleProjectId(loadPayload.cloudaicompanionProject)
    if (managedProjectId) {
      return managedProjectId
    }

    const currentTierId = loadPayload.currentTier?.id
    if (currentTierId) {
      if (configuredProjectId) {
        return configuredProjectId
      }

      const reasons = (loadPayload.ineligibleTiers || [])
        .map((tier) => tier?.reasonMessage?.trim())
        .filter((reason): reason is string => !!reason)
      if (reasons.length > 0) {
        throw new Error(reasons.join(', '))
      }

      throw new Error(
        'Google Gemini requires a Google Cloud project. Set OPENCODE_GEMINI_PROJECT_ID or GOOGLE_CLOUD_PROJECT and reconnect.'
      )
    }

    const tierId = this.pickGoogleGeminiOnboardTier(loadPayload.allowedTiers)
    if (tierId !== 'free-tier' && !configuredProjectId) {
      throw new Error(
        'Google Gemini requires a Google Cloud project. Set OPENCODE_GEMINI_PROJECT_ID or GOOGLE_CLOUD_PROJECT and reconnect.'
      )
    }

    const onboardedProjectId = await this.onboardGoogleGeminiManagedProject(
      accessToken,
      tierId,
      configuredProjectId
    )
    if (onboardedProjectId) return onboardedProjectId
    if (configuredProjectId) return configuredProjectId

    throw new Error(
      'Google Gemini requires a Google Cloud project. Set OPENCODE_GEMINI_PROJECT_ID or GOOGLE_CLOUD_PROJECT and reconnect.'
    )
  }

  private async exchangeAuthorizationCode(params: {
    tokenUrl: string
    clientId: string
    code: string
    redirectUri: string
    codeVerifier?: string
    clientSecret?: string
  }): Promise<TokenExchangeResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
    })
    if (params.codeVerifier) {
      body.set('code_verifier', params.codeVerifier)
    }
    if (params.clientSecret) {
      body.set('client_secret', params.clientSecret)
    }

    const response = await fetch(params.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (!response.ok) {
      throw new Error(`Token exchange failed (${response.status})`)
    }
    return (await response.json()) as TokenExchangeResponse
  }

  private async exchangeAnthropicAuthorizationCode(params: {
    codeInput: string
    redirectUri: string
    codeVerifier: string
    oauthState?: string
  }): Promise<TokenExchangeResponse> {
    const parsed = parseAuthorizationCodeWithState(params.codeInput)
    const payload: Record<string, string> = {
      code: parsed.code,
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }

    const stateToSend = params.oauthState || parsed.state
    if (stateToSend) {
      payload.state = stateToSend
    }

    if (ANTHROPIC_CLIENT_SECRET) {
      payload.client_secret = ANTHROPIC_CLIENT_SECRET
    }

    const response = await fetch(ANTHROPIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Anthropic token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`
      )
    }
    return (await response.json()) as TokenExchangeResponse
  }

  private async refreshAccessToken(credential: ProviderCredential): Promise<ProviderCredential> {
    if (!credential.refreshToken || !credential.tokenEndpoint || !credential.clientId) {
      return credential
    }

    const response = credential.provider === 'anthropic'
      ? await fetch(credential.tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: credential.refreshToken,
            client_id: credential.clientId,
            ...(credential.clientSecret ? { client_secret: credential.clientSecret } : {}),
          }),
        })
      : await fetch(credential.tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: (() => {
            const body = new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: credential.refreshToken!,
              client_id: credential.clientId!,
            })
            if (credential.clientSecret) {
              body.set('client_secret', credential.clientSecret)
            }
            return body.toString()
          })(),
        })
    if (!response.ok) {
      throw new Error(`Refresh failed (${response.status})`)
    }

    const refreshed = (await response.json()) as TokenExchangeResponse
    const now = Date.now()
    const next: ProviderCredential = {
      ...credential,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || credential.refreshToken,
      expiresAt: refreshed.expires_in ? now + refreshed.expires_in * 1000 : credential.expiresAt,
      updatedAt: now,
      lastError: undefined,
    }

    if (credential.provider === 'openai') {
      const claims =
        parseJwtClaims(refreshed.id_token || '') || parseJwtClaims(refreshed.access_token)
      next.accountId = extractOpenAiAccountIdFromClaims(claims) || credential.accountId
    }

    return next
  }

  private async readCommandOutput(command: string, args: string[]): Promise<string | undefined> {
    try {
      const result = await execFileAsync(command, args)
      const value = result.stdout.trim()
      return value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  private async resolveGoogleVertexAccessToken(): Promise<string | null> {
    const envAccessToken = process.env.GOOGLE_ACCESS_TOKEN?.trim()
    if (envAccessToken) {
      return envAccessToken
    }

    const gcloudCommands: string[][] = [
      ['auth', 'application-default', 'print-access-token'],
      ['auth', 'print-access-token'],
    ]
    for (const args of gcloudCommands) {
      const token = await this.readCommandOutput('gcloud', args)
      if (token) {
        return token
      }
    }

    return null
  }

  private async resolveGoogleVertexProjectId(): Promise<string | undefined> {
    const envProjectId =
      process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GOOGLE_VERTEX_PROJECT?.trim()
    if (envProjectId) {
      return envProjectId
    }

    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (credentialsPath && existsSync(credentialsPath)) {
      try {
        const rawCredentials = readFileSync(credentialsPath, 'utf8')
        const parsedProject = parseGoogleProjectFromAdc(rawCredentials)
        if (parsedProject) {
          return parsedProject
        }
      } catch {
        // Fall through to gcloud config lookup.
      }
    }

    const gcloudProject = await this.readCommandOutput('gcloud', ['config', 'get-value', 'project'])
    if (gcloudProject && gcloudProject !== '(unset)') {
      return gcloudProject
    }

    return undefined
  }

  private async refreshGoogleVertexCredential(
    credential: ProviderCredential
  ): Promise<ProviderCredential> {
    const accessToken = await this.resolveGoogleVertexAccessToken()
    if (!accessToken) {
      throw new Error(
        'Google Vertex token refresh failed. Run `gcloud auth application-default login` (or `gcloud auth login`) and retry.'
      )
    }

    const projectId = credential.googleProjectId || (await this.resolveGoogleVertexProjectId())
    if (!projectId) {
      throw new Error(
        'Google Vertex requires a project ID. Set GOOGLE_CLOUD_PROJECT or run `gcloud config set project <PROJECT_ID>`.'
      )
    }

    const now = Date.now()
    return {
      ...credential,
      accessToken,
      expiresAt: now + 45 * 60 * 1000,
      googleMode: 'vertex',
      googleProjectId: projectId,
      googleLocation: credential.googleLocation || DEFAULT_GOOGLE_VERTEX_LOCATION,
      lastError: undefined,
      updatedAt: now,
    }
  }

  private async connectOpenAiOAuth(): Promise<ProviderAuthConnectResult> {
    const pkce = this.buildPkce()
    const state = this.createState()
    const callback = await this.startOpenAiCallbackServer(state)

    try {
      const authUrl = new URL(`${OPENAI_ISSUER}/oauth/authorize`)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', OPENAI_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', callback.redirectUri)
      authUrl.searchParams.set('scope', OPENAI_SCOPE)
      authUrl.searchParams.set('code_challenge', pkce.challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('id_token_add_organizations', 'true')
      authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
      authUrl.searchParams.set('originator', OPENAI_ORIGINATOR)
      authUrl.searchParams.set('state', state)

      await shell.openExternal(authUrl.toString())
      const callbackResult = await callback.waitForCode
      const tokenResponse = await this.exchangeAuthorizationCode({
        tokenUrl: `${OPENAI_ISSUER}/oauth/token`,
        clientId: OPENAI_CLIENT_ID,
        code: callbackResult.code,
        redirectUri: callback.redirectUri,
        codeVerifier: pkce.verifier,
      })

      const now = Date.now()
      const claims =
        parseJwtClaims(tokenResponse.id_token || '') || parseJwtClaims(tokenResponse.access_token)
      const accountId = extractOpenAiAccountIdFromClaims(claims)

      const status = this.updateProviderCredential('openai', {
        provider: 'openai',
        authType: 'oauth',
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: tokenResponse.expires_in ? now + tokenResponse.expires_in * 1000 : undefined,
        accountId,
        tokenEndpoint: `${OPENAI_ISSUER}/oauth/token`,
        clientId: OPENAI_CLIENT_ID,
        baseUrl: OPENAI_CODEX_BASE_URL,
        headers: buildOpenAiRequestHeaders(),
        updatedAt: now,
      })

      return { success: true, status }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenAI OAuth failed'
      const fallback = await this.connectOpenAiDeviceAuth()
      if (fallback.success) return fallback
      return {
        success: false,
        error: `${message}. Device auth fallback failed: ${fallback.error || 'unknown_error'}`,
      }
    } finally {
      await callback.close()
    }
  }

  private async connectOpenAiDeviceAuth(): Promise<ProviderAuthConnectResult> {
    try {
      const userAgent = `cozea/${app.getVersion()} (${os.platform()} ${os.release()}; ${os.arch()})`
      const initResponse = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
        },
        body: JSON.stringify({
          client_id: OPENAI_CLIENT_ID,
        }),
      })

      if (!initResponse.ok) {
        const detail = await initResponse.text().catch(() => '')
        throw new Error(
          `OpenAI device authorization init failed (${initResponse.status})${detail ? `: ${detail}` : ''}`
        )
      }

      const initData = (await initResponse.json()) as OpenAiDeviceUserCodeResponse
      const intervalMs = Math.max(Number.parseInt(initData.interval || '5', 10) || 5, 1) * 1000

      await shell.openExternal(`${OPENAI_ISSUER}/codex/device`)
      void dialog.showMessageBox({
        type: 'info',
        title: 'OpenAI Device Authorization',
        message: 'Complete OpenAI authorization in your browser.',
        detail: `Enter this code when prompted:\n\n${initData.user_code}`,
      })

      const startedAt = Date.now()
      while (Date.now() - startedAt < OPENAI_DEVICE_AUTH_TIMEOUT_MS) {
        const pollResponse = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
          },
          body: JSON.stringify({
            device_auth_id: initData.device_auth_id,
            user_code: initData.user_code,
          }),
        })

        if (pollResponse.ok) {
          const pollData = (await pollResponse.json()) as OpenAiDeviceTokenResponse
          const tokenResponse = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: pollData.authorization_code,
              redirect_uri: `${OPENAI_ISSUER}/deviceauth/callback`,
              client_id: OPENAI_CLIENT_ID,
              code_verifier: pollData.code_verifier,
            }).toString(),
          })

          if (!tokenResponse.ok) {
            const detail = await tokenResponse.text().catch(() => '')
            throw new Error(
              `OpenAI device token exchange failed (${tokenResponse.status})${detail ? `: ${detail}` : ''}`
            )
          }

          const tokens = (await tokenResponse.json()) as TokenExchangeResponse
          const now = Date.now()
          const claims =
            parseJwtClaims(tokens.id_token || '') || parseJwtClaims(tokens.access_token)
          const accountId = extractOpenAiAccountIdFromClaims(claims)

          const status = this.updateProviderCredential('openai', {
            provider: 'openai',
            authType: 'oauth',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_in ? now + tokens.expires_in * 1000 : undefined,
            accountId,
            tokenEndpoint: `${OPENAI_ISSUER}/oauth/token`,
            clientId: OPENAI_CLIENT_ID,
            baseUrl: OPENAI_CODEX_BASE_URL,
            headers: buildOpenAiRequestHeaders(),
            updatedAt: now,
          })

          return { success: true, status }
        }

        // OpenCode behavior: continue polling while authorization is pending.
        if (pollResponse.status !== 403 && pollResponse.status !== 404) {
          const detail = await pollResponse.text().catch(() => '')
          throw new Error(
            `OpenAI device authorization polling failed (${pollResponse.status})${detail ? `: ${detail}` : ''}`
          )
        }

        await new Promise((resolve) =>
          setTimeout(resolve, intervalMs + OPENAI_DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS)
        )
      }

      return {
        success: false,
        error: 'OpenAI device authorization timed out. Please retry and complete the browser step sooner.',
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OpenAI device authorization failed',
      }
    }
  }

  private async connectOpenAiApiKey(apiKeyInput?: string): Promise<ProviderAuthConnectResult> {
    const apiKey = apiKeyInput?.trim()
    if (!apiKey) {
      return {
        success: false,
        error: 'OpenAI API key is required.',
      }
    }

    try {
      const probe = await fetch(`${OPENAI_API_BASE_URL}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!probe.ok) {
        const detail = await probe.text().catch(() => '')
        return {
          success: false,
          error: detail
            ? `OpenAI API key validation failed (${probe.status}): ${detail}`
            : `OpenAI API key validation failed (${probe.status}).`,
        }
      }

      const now = Date.now()
      const status = this.updateProviderCredential('openai', {
        provider: 'openai',
        authType: 'api_key',
        accessToken: apiKey,
        updatedAt: now,
      })

      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OpenAI API key validation failed.',
      }
    }
  }

  private async connectAnthropic(params: {
    method?: ProviderAuthMethod
    authorizationCode?: string
  }): Promise<ProviderAuthConnectResult> {
    const method = params.method || 'oauth'
    const pkce = this.buildPkce()
    const state = this.createState()

    const buildAuthorizeUrl = (redirectUri: string) => {
      const url = new URL(ANTHROPIC_AUTHORIZE_URL)
      url.searchParams.set('code', 'true')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', ANTHROPIC_SCOPE)
      url.searchParams.set('code_challenge', pkce.challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', state)
      return url.toString()
    }

    const manualRedirectUri = ANTHROPIC_MANUAL_REDIRECT_URI

    if (method === 'manual_code' && !params.authorizationCode) {
      return {
        success: false,
        requiresManualCode: true,
        authorizationUrl: buildAuthorizeUrl(manualRedirectUri),
        error: 'Manual code required. Re-run connect with authorizationCode.',
      }
    }

    if (method === 'manual_code' && params.authorizationCode) {
      try {
        const tokenResponse = await this.exchangeAnthropicAuthorizationCode({
          codeInput: params.authorizationCode,
          redirectUri: manualRedirectUri,
          codeVerifier: pkce.verifier,
        })

        const now = Date.now()
        const status = this.updateProviderCredential('anthropic', {
          provider: 'anthropic',
          authType: 'oauth',
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt: tokenResponse.expires_in ? now + tokenResponse.expires_in * 1000 : undefined,
          tokenEndpoint: ANTHROPIC_TOKEN_URL,
          clientId: ANTHROPIC_CLIENT_ID,
          clientSecret: ANTHROPIC_CLIENT_SECRET,
          updatedAt: now,
        })
        return { success: true, status }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Anthropic manual authorization failed',
        }
      }
    }

    const callback = await this.startAnthropicCallbackServer(state)
    try {
      await shell.openExternal(buildAuthorizeUrl(callback.redirectUri))
      const callbackResult = await callback.waitForCode
      const tokenResponse = await this.exchangeAnthropicAuthorizationCode({
        codeInput: callbackResult.code,
        redirectUri: callback.redirectUri,
        codeVerifier: pkce.verifier,
        oauthState: state,
      })

      const now = Date.now()
      const status = this.updateProviderCredential('anthropic', {
        provider: 'anthropic',
        authType: 'oauth',
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: tokenResponse.expires_in ? now + tokenResponse.expires_in * 1000 : undefined,
        tokenEndpoint: ANTHROPIC_TOKEN_URL,
        clientId: ANTHROPIC_CLIENT_ID,
        clientSecret: ANTHROPIC_CLIENT_SECRET,
        updatedAt: now,
      })
      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        requiresManualCode: true,
        authorizationUrl: buildAuthorizeUrl(manualRedirectUri),
        error:
          err instanceof Error
            ? `${err.message}. Manual code fallback is available.`
            : 'Anthropic OAuth failed. Manual code fallback is available.',
      }
    } finally {
      await callback.close()
    }
  }

  private async connectGoogleVertex(): Promise<ProviderAuthConnectResult> {
    const accessToken = await this.resolveGoogleVertexAccessToken()
    const projectId = await this.resolveGoogleVertexProjectId()

    if (!accessToken) {
      return {
        success: false,
        error:
          'Google Vertex auth not found locally. Run `gcloud auth application-default login` (or `gcloud auth login`) and retry.',
      }
    }

    if (!projectId) {
      return {
        success: false,
        error:
          'Google Vertex project is not configured. Set GOOGLE_CLOUD_PROJECT or run `gcloud config set project <PROJECT_ID>`.',
      }
    }

    const now = Date.now()
    const status = this.updateProviderCredential('google', {
      provider: 'google',
      authType: 'local_token',
      accessToken,
      expiresAt: now + 45 * 60 * 1000,
      googleMode: 'vertex',
      googleProjectId: projectId,
      googleLocation: DEFAULT_GOOGLE_VERTEX_LOCATION,
      updatedAt: now,
    })
    return { success: true, status }
  }

  private async connectGoogleGemini(authorizationCode?: string): Promise<ProviderAuthConnectResult> {
    const finalizeGoogleGeminiCredential = async (
      tokenResponse: TokenExchangeResponse
    ): Promise<ProviderAuthConnectResult> => {
      if (!tokenResponse.access_token) {
        return {
          success: false,
          error: 'Google OAuth did not return an access token.',
        }
      }

      if (!tokenResponse.refresh_token) {
        return {
          success: false,
          error: 'Google OAuth did not return a refresh token. Reconnect and approve consent.',
        }
      }

      const now = Date.now()
      const accountId = await this.fetchGoogleGeminiAccountEmail(tokenResponse.access_token)
      const projectId = await this.resolveGoogleGeminiProjectId(tokenResponse.access_token)

      const status = this.updateProviderCredential('google', {
        provider: 'google',
        authType: 'oauth',
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: tokenResponse.expires_in ? now + tokenResponse.expires_in * 1000 : undefined,
        accountId,
        tokenEndpoint: GOOGLE_GEMINI_TOKEN_URL,
        clientId: GOOGLE_GEMINI_CLIENT_ID,
        clientSecret: GOOGLE_GEMINI_CLIENT_SECRET,
        baseUrl: GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT,
        headers: { ...GOOGLE_GEMINI_CODE_ASSIST_HEADERS },
        googleMode: 'gemini',
        googleProjectId: projectId,
        updatedAt: now,
      })

      return { success: true, status }
    }

    if (authorizationCode) {
      const manual = this.pendingGoogleGeminiManualAuth
      if (!manual || Date.now() - manual.createdAt > DEFAULT_OAUTH_TIMEOUT_MS) {
        this.pendingGoogleGeminiManualAuth = null
        return {
          success: false,
          requiresManualCode: true,
          error: 'Google manual auth session expired. Start Gemini connection again.',
        }
      }

      try {
        const parsed = parseGoogleGeminiCallbackInput(authorizationCode)
        if (!parsed.code) {
          return {
            success: false,
            requiresManualCode: true,
            error: 'Missing authorization code.',
          }
        }
        if (parsed.state && parsed.state !== manual.state) {
          return {
            success: false,
            requiresManualCode: true,
            error: 'State mismatch in callback input.',
          }
        }

        const tokenResponse = await this.exchangeGoogleGeminiAuthorizationCode({
          code: parsed.code,
          verifier: manual.verifier,
          redirectUri: manual.redirectUri,
        })
        this.pendingGoogleGeminiManualAuth = null
        return finalizeGoogleGeminiCredential(tokenResponse)
      } catch (err) {
        return {
          success: false,
          requiresManualCode: true,
          error: err instanceof Error ? err.message : 'Google manual authorization failed',
        }
      }
    }

    const pkce = this.buildPkce()
    const state = this.createState()
    let callback:
      | {
          redirectUri: string
          waitForCode: Promise<OAuthCallbackResult>
          close: () => Promise<void>
        }
      | null = null

    try {
      callback = await this.startGoogleGeminiCallbackServer(state)
      const authUrl = this.buildGoogleGeminiAuthorizeUrl({
        redirectUri: callback.redirectUri,
        challenge: pkce.challenge,
        state,
      })

      await shell.openExternal(authUrl)
      const callbackResult = await callback.waitForCode
      const tokenResponse = await this.exchangeGoogleGeminiAuthorizationCode({
        code: callbackResult.code,
        verifier: pkce.verifier,
        redirectUri: callback.redirectUri,
      })

      this.pendingGoogleGeminiManualAuth = null
      return finalizeGoogleGeminiCredential(tokenResponse)
    } catch (err) {
      const redirectUri = callback?.redirectUri || GOOGLE_GEMINI_REDIRECT_URI
      const authUrl = this.buildGoogleGeminiAuthorizeUrl({
        redirectUri,
        challenge: pkce.challenge,
        state,
      })
      this.pendingGoogleGeminiManualAuth = {
        verifier: pkce.verifier,
        state,
        redirectUri,
        createdAt: Date.now(),
      }

      return {
        success: false,
        requiresManualCode: true,
        authorizationUrl: authUrl,
        error:
          err instanceof Error
            ? `${err.message}. Manual code fallback is available.`
            : 'Google OAuth failed. Manual code fallback is available.',
      }
    } finally {
      await callback?.close()
    }
  }

  private async connectGoogleGeminiApiKey(apiKeyInput?: string): Promise<ProviderAuthConnectResult> {
    const apiKey = apiKeyInput?.trim()
    if (!apiKey) {
      return {
        success: false,
        error: 'Gemini API key is required.',
      }
    }

    try {
      const probeUrl = new URL('https://generativelanguage.googleapis.com/v1beta/models')
      probeUrl.searchParams.set('key', apiKey)

      const probe = await fetch(probeUrl.toString(), { method: 'GET' })
      if (!probe.ok) {
        const detail = await probe.text().catch(() => '')
        return {
          success: false,
          error: detail
            ? `Gemini API key validation failed (${probe.status}): ${detail}`
            : `Gemini API key validation failed (${probe.status}).`,
        }
      }

      const now = Date.now()
      const status = this.updateProviderCredential('google', {
        provider: 'google',
        authType: 'api_key',
        accessToken: apiKey,
        googleMode: 'gemini',
        updatedAt: now,
      })

      this.pendingGoogleGeminiManualAuth = null
      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Gemini API key validation failed.',
      }
    }
  }

  private async connectAnthropicApiKey(apiKeyInput?: string): Promise<ProviderAuthConnectResult> {
    const apiKey = apiKeyInput?.trim()
    if (!apiKey) {
      return {
        success: false,
        error: 'Anthropic API key is required.',
      }
    }

    try {
      const probe = await fetch(`${ANTHROPIC_API_BASE_URL}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
      })

      if (!probe.ok) {
        const detail = await probe.text().catch(() => '')
        return {
          success: false,
          error: detail
            ? `Anthropic API key validation failed (${probe.status}): ${detail}`
            : `Anthropic API key validation failed (${probe.status}).`,
        }
      }

      const now = Date.now()
      const status = this.updateProviderCredential('anthropic', {
        provider: 'anthropic',
        authType: 'api_key',
        accessToken: apiKey,
        updatedAt: now,
      })

      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Anthropic API key validation failed.',
      }
    }
  }

  private async connectXaiApiKey(apiKeyInput?: string): Promise<ProviderAuthConnectResult> {
    const apiKey = apiKeyInput?.trim()
    if (!apiKey) {
      return {
        success: false,
        error: 'xAI API key is required.',
      }
    }

    try {
      const probe = await fetch(`${XAI_API_BASE_URL}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!probe.ok) {
        const detail = await probe.text().catch(() => '')
        return {
          success: false,
          error: detail
            ? `xAI API key validation failed (${probe.status}): ${detail}`
            : `xAI API key validation failed (${probe.status}).`,
        }
      }

      const now = Date.now()
      const status = this.updateProviderCredential('xai', {
        provider: 'xai',
        authType: 'api_key',
        accessToken: apiKey,
        updatedAt: now,
      })

      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'xAI API key validation failed.',
      }
    }
  }

  private async connectGitHubCopilotOAuth(): Promise<ProviderAuthConnectResult> {
    try {
      const deviceResponse = await fetch(GITHUB_COPILOT_DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'cozea-desktop',
        },
        body: JSON.stringify({
          client_id: GITHUB_COPILOT_CLIENT_ID,
          scope: GITHUB_COPILOT_SCOPE,
        }),
      })

      if (!deviceResponse.ok) {
        const detail = await deviceResponse.text().catch(() => '')
        return {
          success: false,
          error: detail
            ? `Copilot device authorization failed (${deviceResponse.status}): ${detail}`
            : `Copilot device authorization failed (${deviceResponse.status}).`,
        }
      }

      const deviceData = (await deviceResponse.json()) as {
        verification_uri?: string
        user_code?: string
        device_code?: string
        interval?: number
        expires_in?: number
      }

      if (!deviceData.verification_uri || !deviceData.device_code) {
        return {
          success: false,
          error: 'Copilot device authorization response was missing required fields.',
        }
      }

      await shell.openExternal(deviceData.verification_uri)

      const intervalMs = Math.max((deviceData.interval || 5) * 1000, 1000)
      const expiresMs = Math.max((deviceData.expires_in || 900) * 1000, 60_000)
      const startedAt = Date.now()

      while (Date.now() - startedAt < expiresMs) {
        const pollResponse = await fetch(GITHUB_COPILOT_ACCESS_TOKEN_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'cozea-desktop',
          },
          body: JSON.stringify({
            client_id: GITHUB_COPILOT_CLIENT_ID,
            device_code: deviceData.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        })

        if (!pollResponse.ok) {
          const detail = await pollResponse.text().catch(() => '')
          return {
            success: false,
            error: detail
              ? `Copilot token polling failed (${pollResponse.status}): ${detail}`
              : `Copilot token polling failed (${pollResponse.status}).`,
          }
        }

        const pollData = (await pollResponse.json()) as {
          access_token?: string
          error?: string
          interval?: number
        }

        if (pollData.access_token) {
          const now = Date.now()
          const status = this.updateProviderCredential('github-copilot', {
            provider: 'github-copilot',
            authType: 'oauth',
            accessToken: pollData.access_token,
            refreshToken: pollData.access_token,
            baseUrl: GITHUB_COPILOT_API_BASE_URL,
            headers: {
              'openai-intent': 'conversation-edits',
            },
            updatedAt: now,
          })
          return { success: true, status }
        }

        if (pollData.error === 'authorization_pending') {
          await new Promise((resolve) => setTimeout(resolve, intervalMs + OPENAI_DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS))
          continue
        }

        if (pollData.error === 'slow_down') {
          const serverIntervalMs =
            typeof pollData.interval === 'number' && pollData.interval > 0
              ? pollData.interval * 1000
              : intervalMs + 5000
          await new Promise((resolve) => setTimeout(resolve, serverIntervalMs + OPENAI_DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS))
          continue
        }

        if (pollData.error) {
          return {
            success: false,
            error: `Copilot authorization failed: ${pollData.error}`,
          }
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs + OPENAI_DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS))
      }

      return {
        success: false,
        error: 'Copilot device authorization timed out. Please retry and complete the browser step sooner.',
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Copilot OAuth failed.',
      }
    }
  }

  private async connectGitlabOAuth(): Promise<ProviderAuthConnectResult> {
    if (!GITLAB_CLIENT_ID) {
      return {
        success: false,
        error: 'GitLab OAuth is not configured. Set COZEA_GITLAB_OAUTH_CLIENT_ID and retry.',
      }
    }

    const pkce = this.buildPkce()
    const state = this.createState()
    const callback = await this.startOAuthCallbackServer(state)

    try {
      const authUrl = new URL(GITLAB_AUTHORIZE_URL)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', GITLAB_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', callback.redirectUri)
      authUrl.searchParams.set('scope', GITLAB_SCOPE)
      authUrl.searchParams.set('code_challenge', pkce.challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)

      await shell.openExternal(authUrl.toString())
      const callbackResult = await callback.waitForCode

      const tokenResponse = await this.exchangeAuthorizationCode({
        tokenUrl: GITLAB_TOKEN_URL,
        clientId: GITLAB_CLIENT_ID,
        clientSecret: GITLAB_CLIENT_SECRET,
        code: callbackResult.code,
        redirectUri: callback.redirectUri,
        codeVerifier: pkce.verifier,
      })

      const now = Date.now()
      const status = this.updateProviderCredential('gitlab', {
        provider: 'gitlab',
        authType: 'oauth',
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: tokenResponse.expires_in ? now + tokenResponse.expires_in * 1000 : undefined,
        tokenEndpoint: GITLAB_TOKEN_URL,
        clientId: GITLAB_CLIENT_ID,
        clientSecret: GITLAB_CLIENT_SECRET,
        baseUrl: GITLAB_API_BASE_URL,
        updatedAt: now,
      })

      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'GitLab OAuth failed.',
      }
    } finally {
      await callback.close()
    }
  }

  async listProviders(): Promise<Array<{ provider: ProviderAuthProvider; methods: ProviderAuthMethod[] }>> {
    return [
      { provider: 'openai', methods: ['oauth', 'device', 'api_key'] },
      { provider: 'anthropic', methods: ['oauth', 'api_key'] },
      { provider: 'google', methods: ['vertex', 'gemini', 'gemini_api_key'] },
      { provider: 'xai', methods: ['api_key'] },
      { provider: 'github-copilot', methods: ['oauth'] },
      { provider: 'gitlab', methods: ['oauth'] },
    ]
  }

  async getStatus(provider?: ProviderAuthProvider): Promise<ProviderAuthStatus[]> {
    if (provider && !isProviderEnabled(provider)) {
      return []
    }
    const store = this.loadStore()
    const allProviders = Array.from(new Set([...ENABLED_PROVIDER_AUTH_PROVIDERS, ...Object.keys(store.providers)])) as ProviderAuthProvider[]
    const providers: ProviderAuthProvider[] = provider ? [provider] : allProviders
    return providers.map((id) => this.toStatus(id, store.providers[id]))
  }

  async connect(params: {
    provider: ProviderAuthProvider
    method?: ProviderAuthMethod
    authorizationCode?: string
    credentialPath?: string
    apiKey?: string
  }): Promise<ProviderAuthConnectResult> {
    if (params.provider === 'openai') {
      if (params.method === 'api_key') {
        return this.connectOpenAiApiKey(params.apiKey)
      }
      if (params.method === 'device') {
        return this.connectOpenAiDeviceAuth()
      }
      return this.connectOpenAiOAuth()
    }

    if (!isProviderEnabled(params.provider)) {
      return { success: false, error: 'This provider is disabled in this app build.' }
    }

    if (params.provider === 'google') {
      if (params.method === 'gemini_api_key') {
        return this.connectGoogleGeminiApiKey(params.apiKey)
      }
      if (params.method === 'gemini') {
        return this.connectGoogleGemini(params.authorizationCode)
      }
      return this.connectGoogleVertex()
    }

    if (params.provider === 'anthropic') {
      if (params.method === 'api_key') {
        return this.connectAnthropicApiKey(params.apiKey)
      }
      return this.connectAnthropic({
        method: params.method,
        authorizationCode: params.authorizationCode,
      })
    }

    if (params.provider === 'xai') {
      if (params.method !== 'api_key') {
        return { success: false, error: 'xAI currently supports API key auth in this build.' }
      }
      return this.connectXaiApiKey(params.apiKey)
    }

    if (params.provider === 'github-copilot') {
      return this.connectGitHubCopilotOAuth()
    }

    if (params.provider === 'gitlab') {
      return this.connectGitlabOAuth()
    }

    if (params.method === 'api_key' && params.apiKey) {
      this.updateProviderCredential(params.provider, {
        provider: params.provider,
        authType: 'api_key',
        accessToken: params.apiKey.trim(),
        updatedAt: Date.now(),
      })
      return { success: true }
    }

    return { success: false, error: 'Unsupported provider or auth method missing API key' }
  }

  async disconnect(provider: ProviderAuthProvider): Promise<ProviderAuthDisconnectResult> {
    if (!isProviderEnabled(provider)) {
      this.removeProviderCredential(provider)
      return { success: true }
    }
    if (provider === 'google') {
      this.pendingGoogleGeminiManualAuth = null
    }
    this.removeProviderCredential(provider)
    return { success: true }
  }

  async getRequestAuth(params: {
    provider: ProviderAuthProvider
    modelId: string
    organizationId: string
  }): Promise<ProviderAuthRequestAuthResult> {
    void params.modelId
    if (!isProviderEnabled(params.provider)) {
      return { success: false, code: 'invalid', error: 'This provider is disabled in this app build.' }
    }

    const store = this.loadStore()
    const current = store.providers[params.provider]
    if (!current) {
      return { success: false, code: 'not_connected', error: 'Provider is not connected.' }
    }

    let credential = current
    if (credential.expiresAt && credential.expiresAt <= Date.now() + 60_000) {
      try {
        credential =
          credential.provider === 'google' && credential.googleMode === 'vertex'
            ? await this.refreshGoogleVertexCredential(credential)
            : await this.refreshAccessToken(credential)
        this.updateProviderCredential(params.provider, credential)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to refresh provider token'
        this.updateProviderCredential(params.provider, {
          ...credential,
          lastError: message,
          updatedAt: Date.now(),
        })
        return { success: false, code: 'refresh_failed', error: message }
      }
    }

    if (!credential.accessToken) {
      return { success: false, code: 'invalid', error: 'Provider token is missing.' }
    }

    if (params.provider === 'google' && !credential.googleMode) {
      return {
        success: false,
        code: 'invalid',
        error: 'Google connection is missing source mode. Reconnect and choose Vertex or Gemini.',
      }
    }

    if (
      params.provider === 'google' &&
      credential.authType === 'api_key' &&
      credential.googleMode === 'gemini' &&
      credential.baseUrl === 'https://generativelanguage.googleapis.com'
    ) {
      credential = {
        ...credential,
        baseUrl: undefined,
        updatedAt: Date.now(),
      }
      this.updateProviderCredential(params.provider, credential)
    }

    if (params.provider === 'google' && credential.googleMode === 'gemini' && credential.authType === 'oauth') {
      try {
        if (!credential.googleProjectId) {
          const googleProjectId = await this.resolveGoogleGeminiProjectId(
            credential.accessToken,
            credential.googleProjectId
          )
          credential = {
            ...credential,
            googleProjectId,
            baseUrl: GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT,
            headers: {
              ...(credential.headers ?? {}),
              ...GOOGLE_GEMINI_CODE_ASSIST_HEADERS,
            },
            updatedAt: Date.now(),
          }
          this.updateProviderCredential(params.provider, credential)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Google Gemini project resolution failed.'
        return {
          success: false,
          code: 'invalid',
          error: message,
        }
      }
    }

    if (params.provider === 'google' && credential.googleMode === 'vertex' && !credential.googleProjectId) {
      return {
        success: false,
        code: 'invalid',
        error: 'Google Vertex requires a project ID. Reconnect Google and set GOOGLE_CLOUD_PROJECT.',
      }
    }

    if (
      params.provider === 'google' &&
      credential.googleMode === 'gemini' &&
      credential.authType === 'oauth' &&
      !credential.googleProjectId
    ) {
      return {
        success: false,
        code: 'invalid',
        error:
          'Google Gemini requires a project ID from Code Assist onboarding. Reconnect Google Gemini and retry.',
      }
    }

    if (credential.expiresAt && credential.expiresAt <= Date.now() + 5_000) {
      this.updateProviderCredential(params.provider, {
        ...credential,
        lastError: 'Provider connection expired. Reconnect to continue.',
        updatedAt: Date.now(),
      })
      return {
        success: false,
        code: 'expired',
        error: 'Provider connection expired. Reconnect to continue.',
      }
    }

    const isOpenAi = params.provider === 'openai'
    const useOpenAiCodexHeaders = isOpenAi && credential.authType !== 'api_key'
    const resolvedBaseUrl =
      useOpenAiCodexHeaders ? credential.baseUrl || OPENAI_CODEX_BASE_URL : credential.baseUrl
    const resolvedHeaders = useOpenAiCodexHeaders
      ? {
          ...buildOpenAiRequestHeaders(),
          ...(credential.headers ?? {}),
        }
      : credential.headers

    const envelope: ProviderAuthRequestEnvelope = {
      provider: params.provider,
      authType: credential.authType,
      accessToken: credential.accessToken,
      organizationId: params.organizationId,
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
      ...(credential.accountId ? { accountId: credential.accountId } : {}),
      ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
      ...(resolvedHeaders ? { headers: resolvedHeaders } : {}),
    }

    if (params.provider === 'google' && credential.googleMode) {
      envelope.google = {
        mode: credential.googleMode,
        ...(credential.googleProjectId ? { projectId: credential.googleProjectId } : {}),
        ...(credential.googleLocation ? { location: credential.googleLocation } : {}),
      }
    }

    return { success: true, envelope }
  }

  registerIpcHandlers(): void {
    ipcMain.handle('providerAuth:listProviders', async () => this.listProviders())
    ipcMain.handle('providerAuth:getStatus', async (_event, provider?: ProviderAuthProvider) =>
      this.getStatus(provider)
    )
    ipcMain.handle(
      'providerAuth:connect',
      async (
        _event,
        options: {
          provider: ProviderAuthProvider
          method?: ProviderAuthMethod
          authorizationCode?: string
          credentialPath?: string
          apiKey?: string
        }
      ) => this.connect(options)
    )
    ipcMain.handle('providerAuth:disconnect', async (_event, provider: ProviderAuthProvider) =>
      this.disconnect(provider)
    )
    ipcMain.handle(
      'providerAuth:getRequestAuth',
      async (
        _event,
        options: { provider: ProviderAuthProvider; modelId: string; organizationId: string }
      ) => this.getRequestAuth(options)
    )
  }
}
