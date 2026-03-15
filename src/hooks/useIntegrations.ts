/**
 * useIntegrations Hook
 *
 * Manages integration state including connecting, disconnecting,
 * and fetching integrations for the current organization.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useCachedQuery } from '@/stores/useQueryCache'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import type { Id } from '../../convex/_generated/dataModel'
import type {
  IntegrationProvider,
  IntegrationCredentials,
  ConnectedIntegration,
} from '@/lib/integrations/types'
import { getIntegration } from '@/lib/integrations/registry'

interface UseIntegrationsReturn {
  // Data
  integrations: ConnectedIntegration[]
  isLoading: boolean
  error: string | null

  // Actions
  connect: (provider: IntegrationProvider, credentials: IntegrationCredentials) => Promise<void>
  disconnect: (integrationId: string) => Promise<void>
  startOAuth: (provider: IntegrationProvider) => Promise<void>

  // State
  connectingProvider: IntegrationProvider | null
  connectError: string | null
  clearConnectError: () => void
}

interface UseIntegrationsOptions {
  route?: string
  enabled?: boolean
}

export function useIntegrations(options: UseIntegrationsOptions = {}): UseIntegrationsReturn {
  const { convexUserId } = useAuth()
  const { convexOrg } = useScopedAppContext({ route: options.route })
  const convexOrgId = convexOrg?._id as Id<"organizations"> | undefined
  const isEnabled = options.enabled ?? true

  const [connectingProvider, setConnectingProvider] = useState<IntegrationProvider | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  // Query integrations from Convex (with caching to prevent loading flash)
  const freshIntegrations = useQuery(
    api.integrations.list,
    convexOrgId && isEnabled ? { organizationId: convexOrgId } : "skip"
  )
  const integrationsData = useCachedQuery(
    `integrations-list-${convexOrgId}`,
    freshIntegrations
  )

  // Mutations
  const connectMutation = useMutation(api.integrations.connect)
  const disconnectMutation = useMutation(api.integrations.disconnect)
  const storeKeyMetadataMutation = useMutation(api.integrations.storeKeyMetadata)

  // Get key metadata for the organization
  const keyMetadata = useQuery(
    api.integrations.getKeyMetadata,
    convexOrgId && isEnabled ? { organizationId: convexOrgId } : "skip"
  )

  /**
   * Connect an integration with API key credentials
   */
  const connect = useCallback(
    async (provider: IntegrationProvider, credentials: IntegrationCredentials) => {
      if (!convexOrgId) {
        setConnectError('No organization selected')
        return
      }

      if (!isEnabled) {
        setConnectError('No access to integrations')
        return
      }

      if (!convexUserId) {
        setConnectError('Not authenticated')
        return
      }

      const integration = getIntegration(provider)
      if (!integration) {
        setConnectError(`Unknown integration: ${provider}`)
        return
      }

      setConnectingProvider(provider)
      setConnectError(null)

      try {
        // Check if Electron API is available
        if (!window.electronAPI?.integrations) {
          throw new Error('Integrations API not available')
        }

        // 1. Determine the key ID for this org
        let keyId = keyMetadata?.keyId

        if (!keyId) {
          // Generate a new key ID
          const keyResult = await window.electronAPI.integrations.generateKey()
          if (!keyResult.success || !keyResult.keyData || !keyResult.keyId) {
            throw new Error(keyResult.error || 'Failed to generate encryption key')
          }

          keyId = keyResult.keyId

          // Store the key in keychain
          const storeResult = await window.electronAPI.integrations.storeKey({
            keyId,
            keyData: keyResult.keyData,
          })
          if (!storeResult.success) {
            throw new Error(storeResult.error || 'Failed to store encryption key')
          }

          // Store key metadata in Convex
          await storeKeyMetadataMutation({
            organizationId: convexOrgId,
            keyId,
            keyVersion: 1,
          })
        } else {
          // Check if key exists locally
          const keyExists = await window.electronAPI.integrations.keyExists({ keyId })
          if (!keyExists) {
            // Key metadata exists in Convex but not locally - regenerate
            const keyResult = await window.electronAPI.integrations.generateKey()
            if (!keyResult.success || !keyResult.keyData) {
              throw new Error(keyResult.error || 'Failed to generate encryption key')
            }

            // Store with existing key ID
            const storeResult = await window.electronAPI.integrations.storeKey({
              keyId,
              keyData: keyResult.keyData,
            })
            if (!storeResult.success) {
              throw new Error(storeResult.error || 'Failed to store encryption key')
            }

            // Update key version in Convex
            await storeKeyMetadataMutation({
              organizationId: convexOrgId,
              keyId,
              keyVersion: (keyMetadata?.keyVersion || 0) + 1,
            })
          }
        }

        // 2. Encrypt credentials
        const encryptResult = await window.electronAPI.integrations.encrypt({
          credentials,
          keyId,
        })
        if (!encryptResult.success || !encryptResult.encrypted) {
          throw new Error(encryptResult.error || 'Failed to encrypt credentials')
        }

        // 3. Store in Convex
        await connectMutation({
          organizationId: convexOrgId,
          provider,
          authType: integration.authType,
          encryptedCredentials: encryptResult.encrypted,
          enabledTools: integration.tools.map((t) => t.name),
          connectedBy: convexUserId,
        })

        setConnectingProvider(null)
      } catch (err) {
        console.error('Failed to connect integration:', err)
        setConnectError(err instanceof Error ? err.message : 'Failed to connect integration')
        setConnectingProvider(null)
        throw err // Re-throw so caller knows it failed
      }
    },
    [connectMutation, convexOrgId, convexUserId, isEnabled, keyMetadata, storeKeyMetadataMutation]
  )

  /**
   * Disconnect an integration
   */
  const disconnect = useCallback(
    async (integrationId: string) => {
      try {
        await disconnectMutation({
          integrationId: integrationId as Id<"integrations">,
        })
      } catch (err) {
        console.error('Failed to disconnect integration:', err)
        setConnectError(err instanceof Error ? err.message : 'Failed to disconnect integration')
      }
    },
    [disconnectMutation]
  )

  /**
   * Start OAuth flow for an integration
   */
  const startOAuth = useCallback(
    async (provider: IntegrationProvider) => {
      if (!convexOrgId) {
        setConnectError('No organization selected')
        return
      }

      if (!isEnabled) {
        setConnectError('No access to integrations')
        return
      }

      setConnectingProvider(provider)
      setConnectError(null)

      try {
        if (!window.electronAPI?.integrations) {
          throw new Error('Integrations API not available')
        }

        const result = await window.electronAPI.integrations.startOAuth({
          provider,
          orgId: convexOrgId,
        })

        if (!result.success) {
          throw new Error(result.error || 'Failed to start OAuth flow')
        }

        // OAuth flow is async - the result will come through the onOAuthSuccess callback
      } catch (err) {
        console.error('Failed to start OAuth:', err)
        setConnectError(err instanceof Error ? err.message : 'Failed to start OAuth')
        setConnectingProvider(null)
      }
    },
    [convexOrgId, isEnabled]
  )

  // Store refs to current values for use in OAuth callback
  const convexOrgIdRef = useRef(convexOrgId)
  const convexUserIdRef = useRef(convexUserId)
  const keyMetadataRef = useRef(keyMetadata)
  const connectingProviderRef = useRef(connectingProvider)

  useEffect(() => {
    convexOrgIdRef.current = convexOrgId
    convexUserIdRef.current = convexUserId
    keyMetadataRef.current = keyMetadata
    connectingProviderRef.current = connectingProvider
  }, [convexOrgId, convexUserId, keyMetadata, connectingProvider])

  /**
   * Handle OAuth success callback
   */
  const handleOAuthSuccess = useCallback(
    async (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
    }) => {
      const orgId = convexOrgIdRef.current
      const userId = convexUserIdRef.current
      const currentKeyMetadata = keyMetadataRef.current

      if (!orgId || !userId) {
        setConnectError('Not authenticated')
        setConnectingProvider(null)
        return
      }

      const integration = getIntegration(data.provider as IntegrationProvider)
      if (!integration) {
        setConnectError(`Unknown integration: ${data.provider}`)
        setConnectingProvider(null)
        return
      }

      try {
        if (!window.electronAPI?.integrations) {
          throw new Error('Integrations API not available')
        }

        // 1. Ensure we have an encryption key
        let keyId = currentKeyMetadata?.keyId

        if (!keyId) {
          const keyResult = await window.electronAPI.integrations.generateKey()
          if (!keyResult.success || !keyResult.keyData || !keyResult.keyId) {
            throw new Error(keyResult.error || 'Failed to generate encryption key')
          }

          keyId = keyResult.keyId

          const storeResult = await window.electronAPI.integrations.storeKey({
            keyId,
            keyData: keyResult.keyData,
          })
          if (!storeResult.success) {
            throw new Error(storeResult.error || 'Failed to store encryption key')
          }

          await storeKeyMetadataMutation({
            organizationId: orgId,
            keyId,
            keyVersion: 1,
          })
        }

        // 2. Encrypt OAuth tokens
        const credentials: IntegrationCredentials = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        }

        const encryptResult = await window.electronAPI.integrations.encrypt({
          credentials,
          keyId,
        })
        if (!encryptResult.success || !encryptResult.encrypted) {
          throw new Error(encryptResult.error || 'Failed to encrypt credentials')
        }

        // 3. Store in Convex
        await connectMutation({
          organizationId: orgId,
          provider: data.provider as IntegrationProvider,
          authType: 'oauth',
          encryptedCredentials: encryptResult.encrypted,
          enabledTools: integration.tools.map((t) => t.name),
          connectedBy: userId,
          oauthScopes: data.scopes,
          tokenExpiresAt: data.tokenExpiresAt,
          externalId: data.externalId,
          externalAccountName: data.externalAccountName,
        })

        setConnectingProvider(null)
      } catch (err) {
        console.error('Failed to complete OAuth:', err)
        setConnectError(err instanceof Error ? err.message : 'Failed to complete OAuth')
        setConnectingProvider(null)
      }
    },
    [connectMutation, storeKeyMetadataMutation]
  )

  /**
   * Handle OAuth error callback
   */
  const handleOAuthError = useCallback((data: { provider: string; error: string }) => {
    console.error('OAuth error:', data.error)
    setConnectError(data.error)
    setConnectingProvider(null)
  }, [])

  // Subscribe to OAuth events
  useEffect(() => {
    if (!window.electronAPI?.integrations) {
      return
    }

    const unsubscribeSuccess = window.electronAPI.integrations.onOAuthSuccess(handleOAuthSuccess)
    const unsubscribeError = window.electronAPI.integrations.onOAuthError(handleOAuthError)

    return () => {
      unsubscribeSuccess()
      unsubscribeError()
    }
  }, [handleOAuthSuccess, handleOAuthError])

  const clearConnectError = useCallback(() => {
    setConnectError(null)
  }, [])

  // Map Convex data to our type (with string IDs)
  const integrations: ConnectedIntegration[] = (integrationsData || []).map((i) => ({
    _id: i._id as string,
    organizationId: i.organizationId as string,
    provider: i.provider as IntegrationProvider,
    authType: i.authType as 'oauth' | 'api_key' | 'service_account',
    encryptedCredentials: '', // Not returned from query for security
    oauthScopes: i.oauthScopes,
    tokenExpiresAt: i.tokenExpiresAt,
    externalId: i.externalId,
    externalAccountName: i.externalAccountName,
    metadata: i.metadata as Record<string, unknown> | undefined,
    enabledTools: i.enabledTools,
    status: i.status as 'active' | 'expired' | 'revoked' | 'needs_reauth',
    lastVerifiedAt: i.lastVerifiedAt,
    connectedBy: i.connectedBy as string,
    connectedAt: i.connectedAt,
    updatedAt: i.updatedAt,
  }))

  return {
    integrations,
    isLoading: isEnabled && Boolean(convexOrgId) && integrationsData === undefined,
    error: null,
    connect,
    disconnect,
    startOAuth,
    connectingProvider,
    connectError,
    clearConnectError,
  }
}
