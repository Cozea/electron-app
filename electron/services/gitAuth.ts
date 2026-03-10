import * as integrationCrypto from '../integrationCrypto'
import * as integrationKeys from '../integrationKeys'

export function buildGitAuthorizationHeader(provider: string, accessToken?: string): string | null {
  if (!accessToken?.trim()) return null

  const username = provider === 'gitlab' ? 'oauth2' : 'x-access-token'
  const encoded = Buffer.from(`${username}:${accessToken.trim()}`, 'utf8').toString('base64')
  return `AUTHORIZATION: Basic ${encoded}`
}

function readIntegrationTokenValue(
  credentials: Record<string, unknown>,
  key: string
): string | undefined {
  const value = credentials[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function extractRepositoryAccessToken(
  provider: string,
  credentials: Record<string, unknown>
): string | undefined {
  if (provider === 'gitlab') {
    return (
      readIntegrationTokenValue(credentials, 'personalAccessToken') ||
      readIntegrationTokenValue(credentials, 'accessToken') ||
      readIntegrationTokenValue(credentials, 'apiToken') ||
      readIntegrationTokenValue(credentials, 'token')
    )
  }

  return (
    readIntegrationTokenValue(credentials, 'accessToken') ||
    readIntegrationTokenValue(credentials, 'personalAccessToken') ||
    readIntegrationTokenValue(credentials, 'apiToken') ||
    readIntegrationTokenValue(credentials, 'token')
  )
}

export function resolveRepositoryAccessToken(args: {
  provider: string
  accessToken?: string
  encryptedCredentials?: string
  keyId?: string
}): { accessToken?: string; error?: string } {
  if (typeof args.accessToken === 'string' && args.accessToken.trim().length > 0) {
    return { accessToken: args.accessToken.trim() }
  }

  if (!args.encryptedCredentials || !args.keyId) {
    return {}
  }

  const keyResult = integrationKeys.getEncryptionKey(args.keyId)
  if (!keyResult.success || !keyResult.keyData) {
    return {
      error: keyResult.error || 'Failed to retrieve integration encryption key.',
    }
  }

  const decryptResult = integrationCrypto.decryptCredentials(
    args.encryptedCredentials,
    keyResult.keyData
  )
  if (!decryptResult.success || !decryptResult.credentials) {
    return {
      error: decryptResult.error || 'Failed to decrypt integration credentials.',
    }
  }

  const accessToken = extractRepositoryAccessToken(args.provider, decryptResult.credentials)
  if (!accessToken) {
    return {
      error: 'No repository access token was found in the integration credentials.',
    }
  }

  return { accessToken }
}
