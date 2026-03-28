import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import type {
  VersionControlAuthStatus,
  VersionControlSetupMode,
} from '@shared/versionControl'
import { invalidateProviderRepositoryManagementCache } from '@/lib/git/providerRepositoryManagement'

type SourceControlProvider = 'github' | 'gitlab'
type SourceControlNamespaceType = 'user' | 'organization' | 'group'

interface WorkspaceSourceControlConnection {
  _id: Id<'workspaceSourceControlConnections'>
  organizationId: Id<'organizations'>
  provider: SourceControlProvider
  authType: 'oauth'
  authStatus: VersionControlAuthStatus
  setupMode: VersionControlSetupMode
  providerHost?: string
  externalAccountId?: string
  externalAccountName?: string
  externalAccountLogin?: string
  oauthScopes?: string[]
  tokenExpiresAt?: number
  namespaceId?: string
  namespaceName?: string
  namespaceLogin?: string
  namespaceType?: SourceControlNamespaceType
  installationId?: string
  installationTargetType?: 'user' | 'organization'
  installationTargetLogin?: string
  installationTargetName?: string
  lastVerifiedAt?: number
  lastError?: string
  connectedBy: Id<'users'>
  connectedAt: number
  updatedAt: number
}

interface StartSourceControlOAuthOptions {
  setupMode?: VersionControlSetupMode
  providerHost?: string
  metadata?: Record<string, unknown>
}

interface UseWorkspaceSourceControlOptions {
  route?: string
  enabled?: boolean
}

export function useWorkspaceSourceControl(
  options: UseWorkspaceSourceControlOptions = {}
) {
  const { convexUserId } = useAuth()
  const { convexOrg } = useScopedAppContext({ route: options.route })
  const organizationId = convexOrg?._id as Id<'organizations'> | undefined
  const enabled = options.enabled ?? true
  const [connectingProvider, setConnectingProvider] =
    useState<SourceControlProvider | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const listQuery = useQuery(
    api.sourceControl.listConnections,
    organizationId && convexUserId && enabled
      ? {
          organizationId,
          userId: convexUserId,
        }
      : 'skip'
  ) as WorkspaceSourceControlConnection[] | undefined

  const connectMutation = useMutation(api.sourceControl.connectOAuth)
  const disconnectMutation = useMutation(api.sourceControl.disconnect)
  const updateSelectionMutation = useMutation(api.sourceControl.updateConnectionSelection)

  const organizationIdRef = useRef(organizationId)
  const convexUserIdRef = useRef(convexUserId)

  useEffect(() => {
    organizationIdRef.current = organizationId
  }, [organizationId])

  useEffect(() => {
    convexUserIdRef.current = convexUserId
  }, [convexUserId])

  const connections = useMemo(() => listQuery ?? [], [listQuery])
  const isLoading = enabled && Boolean(organizationId && convexUserId) && listQuery === undefined

  const getConnection = useCallback(
    (provider: SourceControlProvider) =>
      connections.find((connection) => connection.provider === provider) ?? null,
    [connections]
  )

  const clearConnectError = useCallback(() => {
    setConnectError(null)
  }, [])

  const startOAuth = useCallback(
    async (
      provider: SourceControlProvider,
      options: StartSourceControlOAuthOptions = {}
    ) => {
      if (!organizationId || !convexUserId) {
        setConnectError('No workspace selected')
        return
      }

      setConnectingProvider(provider)
      setConnectError(null)

      const metadata = {
        ...(options.metadata ? options.metadata : {}),
        setupMode: options.setupMode,
        providerHost: options.providerHost,
      }

      const result = await window.electronAPI.sourceControl.startOAuth({
        provider,
        orgId: organizationId,
        metadata,
      })

      if (!result.success) {
        setConnectingProvider(null)
        setConnectError(result.error || 'Failed to start source control OAuth')
      }
    },
    [convexUserId, organizationId]
  )

  const disconnect = useCallback(
    async (provider: SourceControlProvider) => {
      if (!organizationId || !convexUserId) {
        return
      }

      await disconnectMutation({
        organizationId,
        userId: convexUserId,
        provider,
      })
      await invalidateProviderRepositoryManagementCache({ provider })
    },
    [convexUserId, disconnectMutation, organizationId]
  )

  const updateSelection = useCallback(
    async (
      provider: SourceControlProvider,
      selection: {
        setupMode?: VersionControlSetupMode
        providerHost?: string
        namespaceId?: string
        namespaceName?: string
        namespaceLogin?: string
        namespaceType?: SourceControlNamespaceType
        installationId?: string
        installationTargetType?: 'user' | 'organization'
        installationTargetLogin?: string
        installationTargetName?: string
        authStatus?: VersionControlAuthStatus
        lastError?: string
      }
    ) => {
      if (!organizationId || !convexUserId) {
        return
      }

      await updateSelectionMutation({
        organizationId,
        userId: convexUserId,
        provider,
        ...selection,
      })
      await invalidateProviderRepositoryManagementCache({ provider })
    },
    [convexUserId, organizationId, updateSelectionMutation]
  )

  useEffect(() => {
    const cleanupSuccess = window.electronAPI.sourceControl.onOAuthSuccess(
      (result) => {
        const nextOrganizationId = organizationIdRef.current
        const nextUserId = convexUserIdRef.current
        const provider =
          result.provider === 'github' || result.provider === 'gitlab'
            ? result.provider
            : null

        if (!nextOrganizationId || !nextUserId || !provider || !result.accessToken) {
          setConnectingProvider(null)
          return
        }

        void connectMutation({
          organizationId: nextOrganizationId,
          userId: nextUserId,
          provider,
          setupMode:
            result.metadata?.setupMode === 'organization' ||
            result.metadata?.setupMode === 'personal'
              ? result.metadata.setupMode
              : undefined,
          providerHost:
            typeof result.metadata?.providerHost === 'string'
              ? result.metadata.providerHost
              : undefined,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenExpiresAt: result.tokenExpiresAt,
          oauthScopes: result.scopes,
          externalAccountId:
            typeof result.externalId === 'string' ? result.externalId : undefined,
          externalAccountName:
            typeof result.externalAccountName === 'string'
              ? result.externalAccountName
              : undefined,
          externalAccountLogin:
            typeof result.metadata?.externalAccountLogin === 'string'
              ? result.metadata.externalAccountLogin
              : undefined,
          namespaceId:
            typeof result.metadata?.namespaceId === 'string'
              ? result.metadata.namespaceId
              : undefined,
          namespaceName:
            typeof result.metadata?.namespaceName === 'string'
              ? result.metadata.namespaceName
              : undefined,
          namespaceLogin:
            typeof result.metadata?.namespaceLogin === 'string'
              ? result.metadata.namespaceLogin
              : undefined,
          namespaceType:
            result.metadata?.namespaceType === 'user' ||
            result.metadata?.namespaceType === 'organization' ||
            result.metadata?.namespaceType === 'group'
              ? result.metadata.namespaceType
              : undefined,
          installationId:
            typeof result.metadata?.installationId === 'string'
              ? result.metadata.installationId
              : undefined,
          installationTargetType:
            result.metadata?.installationTargetType === 'organization' ||
            result.metadata?.installationTargetType === 'user'
              ? result.metadata.installationTargetType
              : undefined,
          installationTargetLogin:
            typeof result.metadata?.installationTargetLogin === 'string'
              ? result.metadata.installationTargetLogin
              : undefined,
          installationTargetName:
            typeof result.metadata?.installationTargetName === 'string'
              ? result.metadata.installationTargetName
              : undefined,
        })
          .then(async () => {
            await invalidateProviderRepositoryManagementCache({ provider })
          })
          .catch((error) => {
            setConnectError(
              error instanceof Error
                ? error.message
                : 'Failed to connect source control'
            )
          })
          .finally(() => {
            setConnectingProvider(null)
          })
      }
    )

    const cleanupError = window.electronAPI.sourceControl.onOAuthError((result) => {
      setConnectingProvider(null)
      setConnectError(result.error)
    })

    return () => {
      cleanupSuccess()
      cleanupError()
    }
  }, [connectMutation])

  return {
    organizationId,
    userId: convexUserId,
    connections,
    isLoading,
    getConnection,
    connectingProvider,
    connectError,
    clearConnectError,
    startOAuth,
    disconnect,
    updateSelection,
  }
}
