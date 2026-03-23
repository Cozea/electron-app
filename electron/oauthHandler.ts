/**
 * OAuth Handler for Integration Authentication
 *
 * Handles OAuth flows for integrations like GitHub, Vercel, etc.
 * Uses the system browser for authentication and handles callbacks
 * via the custom protocol (cozea://).
 */

import { shell } from 'electron'
import { randomUUID, randomBytes, createHash } from 'node:crypto'

// ============================================
// Types
// ============================================

interface OAuthConfig {
  authUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scopes: string[]
  pkce: boolean
  redirectUri: string
}

interface PendingOAuthFlow {
  provider: string
  orgId: string
  state: string
  codeVerifier?: string // For PKCE
  metadata?: Record<string, unknown>
  clientIdEnvVar?: string
  clientSecretEnvVar?: string
  scopes?: string[]
  createdAt: number
}

interface OAuthResult {
  success: boolean
  provider: string
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
  externalId?: string
  externalAccountName?: string
  scopes?: string[]
  metadata?: Record<string, unknown>
  error?: string
}

// ============================================
// State
// ============================================

// Pending OAuth flows (state -> flow info)
const pendingFlows = new Map<string, PendingOAuthFlow>()

// OAuth provider configurations
const OAUTH_CONFIGS: Record<string, Omit<OAuthConfig, 'clientId' | 'clientSecret' | 'redirectUri'>> = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user', 'user:email', 'read:org', 'workflow'],
    pkce: false,
  },
  gitlab: {
    authUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scopes: ['api', 'read_user', 'read_repository', 'write_repository'],
    pkce: false,
  },
  vercel: {
    authUrl: 'https://vercel.com/oauth/authorize',
    tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
    scopes: [],
    pkce: true,
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read'],
    pkce: false,
  },
}

// ============================================
// PKCE Helpers
// ============================================

/**
 * Generate a PKCE code verifier
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Generate a PKCE code challenge from a verifier
 */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// ============================================
// OAuth Flow Functions
// ============================================

/**
 * Start an OAuth flow for a provider
 */
export async function startOAuthFlow(
  provider: string,
  orgId: string,
  redirectUri: string = 'cozea://oauth/callback',
  metadata?: Record<string, unknown>,
  options?: {
    clientIdEnvVar?: string
    clientSecretEnvVar?: string
    scopes?: string[]
  }
): Promise<{ success: boolean; error?: string }> {
  const config = OAUTH_CONFIGS[provider]
  if (!config) {
    return { success: false, error: `Unknown OAuth provider: ${provider}` }
  }

  // Get client ID from environment
  const clientIdEnvVar = options?.clientIdEnvVar || `${provider.toUpperCase()}_CLIENT_ID`
  const clientId = process.env[clientIdEnvVar]
  if (!clientId) {
    return { success: false, error: `OAuth not configured: ${clientIdEnvVar} environment variable not set` }
  }

  // Generate state for CSRF protection
  const state = randomUUID()

  // Generate PKCE if required
  let codeVerifier: string | undefined
  let codeChallenge: string | undefined
  if (config.pkce) {
    codeVerifier = generateCodeVerifier()
    codeChallenge = generateCodeChallenge(codeVerifier)
  }

  const scopes = options?.scopes ?? config.scopes

  // Store pending flow
  pendingFlows.set(state, {
    provider,
    orgId,
    state,
    codeVerifier,
    metadata,
    clientIdEnvVar: options?.clientIdEnvVar,
    clientSecretEnvVar: options?.clientSecretEnvVar,
    scopes,
    createdAt: Date.now(),
  })

  // Build auth URL
  const authUrl = new URL(config.authUrl)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('response_type', 'code')

  if (scopes.length > 0) {
    authUrl.searchParams.set('scope', scopes.join(' '))
  }

  if (config.pkce && codeChallenge) {
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
  }

  // Open in system browser
  await shell.openExternal(authUrl.toString())

  // Clean up old pending flows (older than 10 minutes)
  const now = Date.now()
  for (const [flowState, flow] of pendingFlows.entries()) {
    if (now - flow.createdAt > 10 * 60 * 1000) {
      pendingFlows.delete(flowState)
    }
  }

  return { success: true }
}

/**
 * Handle OAuth callback
 */
export async function handleOAuthCallback(
  callbackUrl: string,
  redirectUri: string = 'cozea://oauth/callback'
): Promise<OAuthResult> {
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  // Check for error from provider
  if (error) {
    return {
      success: false,
      provider: 'unknown',
      error: errorDescription || error,
    }
  }

  // Validate state
  if (!state) {
    return { success: false, provider: 'unknown', error: 'Missing state parameter' }
  }

  const pendingFlow = pendingFlows.get(state)
  if (!pendingFlow) {
    return { success: false, provider: 'unknown', error: 'Invalid or expired state' }
  }

  // Remove from pending
  pendingFlows.delete(state)

  if (!code) {
    return { success: false, provider: pendingFlow.provider, error: 'Missing authorization code' }
  }

  const config = OAUTH_CONFIGS[pendingFlow.provider]
  if (!config) {
    return { success: false, provider: pendingFlow.provider, error: 'Unknown provider' }
  }

  // Get credentials from environment
  const clientId = process.env[
    pendingFlow.clientIdEnvVar || `${pendingFlow.provider.toUpperCase()}_CLIENT_ID`
  ]
  const clientSecret = process.env[
    pendingFlow.clientSecretEnvVar || `${pendingFlow.provider.toUpperCase()}_CLIENT_SECRET`
  ]

  if (!clientId) {
    return { success: false, provider: pendingFlow.provider, error: 'Client ID not configured' }
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens({
      provider: pendingFlow.provider,
      code,
      clientId,
      clientSecret,
      codeVerifier: pendingFlow.codeVerifier,
      redirectUri,
      tokenUrl: config.tokenUrl,
    })

    if (!tokenResponse.success) {
      return {
        success: false,
        provider: pendingFlow.provider,
        error: tokenResponse.error,
      }
    }

    // Fetch user info to get external account name
    const userInfo = await fetchUserInfo(pendingFlow.provider, tokenResponse.accessToken!)

    return {
      success: true,
      provider: pendingFlow.provider,
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      tokenExpiresAt: tokenResponse.expiresAt,
      externalId: userInfo?.id,
      externalAccountName: userInfo?.name || userInfo?.login || userInfo?.email,
      scopes: pendingFlow.scopes ?? config.scopes,
      metadata: pendingFlow.metadata,
    }
  } catch (err) {
    console.error('OAuth callback error:', err)
    return {
      success: false,
      provider: pendingFlow.provider,
      error: err instanceof Error ? err.message : 'Token exchange failed',
    }
  }
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(params: {
  provider: string
  code: string
  clientId: string
  clientSecret?: string
  codeVerifier?: string
  redirectUri: string
  tokenUrl: string
}): Promise<{
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  error?: string
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  })

  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret)
  }

  if (params.codeVerifier) {
    body.set('code_verifier', params.codeVerifier)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  // GitHub requires Accept header for JSON response
  if (params.provider === 'github') {
    headers['Accept'] = 'application/json'
  }

  const response = await fetch(params.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('Token exchange failed:', text)
    return { success: false, error: `Token exchange failed: ${response.status}` }
  }

  const data = await response.json()

  // Handle different response formats
  if (data.error) {
    return { success: false, error: data.error_description || data.error }
  }

  const accessToken = data.access_token
  const refreshToken = data.refresh_token
  const expiresIn = data.expires_in

  if (!accessToken) {
    return { success: false, error: 'No access token in response' }
  }

  return {
    success: true,
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  }
}

/**
 * Fetch user info from provider
 */
async function fetchUserInfo(
  provider: string,
  accessToken: string
): Promise<{ id?: string; name?: string; login?: string; email?: string } | null> {
  try {
    let url: string
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    }

    switch (provider) {
      case 'github':
        url = 'https://api.github.com/user'
        headers['Accept'] = 'application/vnd.github+json'
        break
      case 'gitlab':
        url = 'https://gitlab.com/api/v4/user'
        break
      case 'vercel':
        url = 'https://api.vercel.com/v2/user'
        break
      case 'slack':
        url = 'https://slack.com/api/auth.test'
        break
      default:
        return null
    }

    const response = await fetch(url, { headers })
    if (!response.ok) {
      console.error(`Failed to fetch user info: ${response.status}`)
      return null
    }

    const data = await response.json()

    // Handle Slack's different response format
    if (provider === 'slack') {
      return {
        id: data.user_id,
        name: data.user,
      }
    }

    return {
      id: data.id?.toString(),
      name: data.name || data.username,
      login: data.login || data.username,
      email: data.email,
    }
  } catch (err) {
    console.error('Failed to fetch user info:', err)
    return null
  }
}

/**
 * Get pending flow info by state
 */
export function getPendingFlow(state: string): PendingOAuthFlow | undefined {
  return pendingFlows.get(state)
}

/**
 * Cancel a pending OAuth flow
 */
export function cancelOAuthFlow(state: string): void {
  pendingFlows.delete(state)
}
