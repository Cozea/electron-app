import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex } from 'convex/react'
import { ArrowPathIcon as Loader2, ArrowPathIcon as RefreshCw, ArrowTopRightOnSquareIcon as ExternalLink, CheckCircleIcon as CheckCircle2, ExclamationCircleIcon as AlertCircle, FolderIcon as FolderGit2, NoSymbolIcon as Unplug } from "@heroicons/react/24/outline"

import type { Id } from '../../../convex/_generated/dataModel'
import type { RepositoryOwnerDescriptor } from '@shared/electronApiTypes'
import type { VersionControlSetupMode } from '@shared/versionControl'
import {
  getVersionControlSetupDescription,
} from '@shared/versionControl'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  SettingsGroup,
  SettingsGroupError,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/components/settings/SettingsChrome'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { useWorkspaceSourceControl } from '@/hooks/useWorkspaceSourceControl'
import { listConnectedRepositoryOwners } from '@/lib/git/providerRepositoryManagement'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'

type SourceControlProvider = 'github'

interface SourceControlProps {
  surface?: 'page' | 'drawer'
  route?: string
}

const GITHUB_SOURCE_CONTROL_APP_SLUG =
  (import.meta.env.VITE_GITHUB_SOURCE_CONTROL_APP_SLUG as string | undefined)?.trim() ||
  'cozea-source-control'
const OWNER_VERIFICATION_STALE_MS = 5 * 60_000

const PROVIDER_CARDS: Array<{
  provider: SourceControlProvider
  label: string
  host: string
}> = [
  { provider: 'github', label: 'GitHub', host: 'https://github.com' },
]

function getAuthStatusLabel(status?: string | null): string {
  switch (status) {
    case 'active':
      return 'Connected'
    case 'missing_setup':
      return 'Setup needed'
    case 'needs_reauth':
      return 'Reconnect required'
    case 'revoked':
      return 'Revoked'
    case 'error':
      return 'Error'
    default:
      return 'Not connected'
  }
}

function getAuthStatusTone(status?: string | null): 'default' | 'outline' | 'secondary' | 'destructive' {
  switch (status) {
    case 'active':
      return 'default'
    case 'missing_setup':
      return 'secondary'
    case 'needs_reauth':
    case 'revoked':
    case 'error':
      return 'destructive'
    default:
      return 'outline'
  }
}

function getPreferredOwner(
  owners: RepositoryOwnerDescriptor[],
  setupMode: VersionControlSetupMode
): RepositoryOwnerDescriptor | null {
  if (setupMode === 'organization') {
    return owners.find((owner) => owner.kind !== 'user') ?? owners[0] ?? null
  }

  return owners.find((owner) => owner.kind === 'user') ?? owners[0] ?? null
}

function buildGitHubAppInstallUrl(providerHost: string): string | null {
  const normalizedHost = providerHost.trim().replace(/\/+$/, '')
  if (!normalizedHost || !GITHUB_SOURCE_CONTROL_APP_SLUG) {
    return null
  }
  return `${normalizedHost}/apps/${GITHUB_SOURCE_CONTROL_APP_SLUG}/installations/new`
}

function buildSeedOwnerFromConnection(
  connection: ProviderCardProps['connection']
): RepositoryOwnerDescriptor | null {
  if (!connection?.namespaceId || !connection.namespaceLogin) {
    return null
  }

  return {
    id: connection.namespaceId,
    login: connection.namespaceLogin,
    displayName: connection.namespaceName || connection.namespaceLogin,
    kind:
      connection.namespaceType === 'group'
        ? 'group'
        : connection.namespaceType === 'organization'
          ? 'organization'
          : 'user',
    installationId: connection.installationId,
    installationTargetType: connection.installationTargetType,
    installationTargetLogin: connection.installationTargetLogin,
    installationTargetName: connection.installationTargetName,
  }
}

function mergeSeedOwner(
  owners: RepositoryOwnerDescriptor[],
  seedOwner: RepositoryOwnerDescriptor | null
): RepositoryOwnerDescriptor[] {
  if (!seedOwner) {
    return owners
  }

  const nextOwners = owners.filter((owner) => owner.id !== seedOwner.id)
  return [seedOwner, ...nextOwners]
}

function isOwnerVerificationStale(lastVerifiedAt?: number): boolean {
  if (!lastVerifiedAt) {
    return true
  }

  return Date.now() - lastVerifiedAt > OWNER_VERIFICATION_STALE_MS
}

interface ProviderCardProps {
  provider: SourceControlProvider
  label: string
  providerHost: string
  organizationId?: Id<'organizations'>
  userId?: Id<'users'>
  setupMode: VersionControlSetupMode
  canManageSourceControl: boolean
  variant?: 'card' | 'rows'
  connection: ReturnType<
    ReturnType<typeof useWorkspaceSourceControl>['getConnection']
  >
  connectionsReady: boolean
  connectingProvider: ReturnType<
    typeof useWorkspaceSourceControl
  >['connectingProvider']
  clearConnectError: ReturnType<typeof useWorkspaceSourceControl>['clearConnectError']
  startOAuth: ReturnType<typeof useWorkspaceSourceControl>['startOAuth']
  disconnect: ReturnType<typeof useWorkspaceSourceControl>['disconnect']
  updateSelection: ReturnType<typeof useWorkspaceSourceControl>['updateSelection']
}

function SourceControlProviderCard({
  provider,
  label,
  providerHost,
  organizationId,
  userId,
  setupMode,
  canManageSourceControl,
  variant = 'card',
  connection,
  connectionsReady,
  connectingProvider,
  clearConnectError,
  startOAuth,
  disconnect,
  updateSelection,
}: ProviderCardProps) {
  const convex = useConvex()
  const [owners, setOwners] = useState<RepositoryOwnerDescriptor[]>(() =>
    mergeSeedOwner([], buildSeedOwnerFromConnection(connection))
  )
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [ownerError, setOwnerError] = useState<string | null>(null)
  const [hasLoadedOwners, setHasLoadedOwners] = useState(false)
  const seedOwner = useMemo(() => buildSeedOwnerFromConnection(connection), [connection])

  const loadOwners = useCallback(async (bypassCache = false) => {
    if (!organizationId || !userId || !connection || !canManageSourceControl) {
      setOwners([])
      setOwnerError(null)
      setHasLoadedOwners(false)
      return
    }

    setIsLoadingOwners(true)
    setOwnerError(null)
    try {
      const nextOwners = await listConnectedRepositoryOwners({
        convex,
        organizationId,
        userId,
        provider,
        bypassCache,
      })
      setOwners(nextOwners)
      setHasLoadedOwners(true)

      if (provider === 'github' && connection.namespaceId) {
        const resolvedOwner =
          nextOwners.find((owner) => owner.id === connection.namespaceId) ?? null

        if (
          resolvedOwner &&
          (resolvedOwner.installationId !== connection.installationId ||
            resolvedOwner.installationTargetType !== connection.installationTargetType ||
            resolvedOwner.installationTargetLogin !== connection.installationTargetLogin ||
            resolvedOwner.installationTargetName !== connection.installationTargetName ||
            (resolvedOwner.installationId ? 'active' : 'missing_setup') !==
              connection.authStatus)
        ) {
          await updateSelection(provider, {
            setupMode,
            providerHost: connection.providerHost || providerHost,
            namespaceId: resolvedOwner.id,
            namespaceName: resolvedOwner.displayName,
            namespaceLogin: resolvedOwner.login,
            namespaceType:
              resolvedOwner.kind === 'group'
                ? 'group'
                : resolvedOwner.kind === 'organization'
                  ? 'organization'
                  : 'user',
            installationId: resolvedOwner.installationId,
            installationTargetType: resolvedOwner.installationTargetType,
            installationTargetLogin: resolvedOwner.installationTargetLogin,
            installationTargetName: resolvedOwner.installationTargetName,
            authStatus: resolvedOwner.installationId ? 'active' : 'missing_setup',
            lastError: resolvedOwner.installationId
              ? undefined
              : 'This namespace does not have the GitHub App installed yet.',
          })
        }
      }
    } catch (error) {
      setOwners(mergeSeedOwner([], buildSeedOwnerFromConnection(connection)))
      setOwnerError(
        error instanceof Error ? error.message : `Failed to load ${label} namespaces`
      )
      setHasLoadedOwners(false)
    } finally {
      setIsLoadingOwners(false)
    }
  }, [
    canManageSourceControl,
    connection,
    convex,
    label,
    organizationId,
    provider,
    providerHost,
    setupMode,
    updateSelection,
    userId,
  ])

  useEffect(() => {
    if (!connection) {
      setOwners([])
      setOwnerError(null)
      setHasLoadedOwners(false)
      return
    }

    setOwners((current) => mergeSeedOwner(current, seedOwner))

    if (!connection.namespaceId && !hasLoadedOwners && !isLoadingOwners) {
      void loadOwners()
    }
  }, [connection, hasLoadedOwners, isLoadingOwners, loadOwners, seedOwner])

  const compatibleOwners = useMemo(
    () =>
      owners.filter((owner) =>
        setupMode === 'organization' ? owner.kind !== 'user' : owner.kind === 'user'
      ),
    [owners, setupMode]
  )
  const ownerOptions = compatibleOwners.length > 0 ? compatibleOwners : owners
  const selectedOwnerId =
    connection?.namespaceId ?? getPreferredOwner(ownerOptions, setupMode)?.id ?? ''
  const selectedOwner =
    ownerOptions.find((owner) => owner.id === selectedOwnerId) ?? null
  const isConnecting = connectingProvider === provider
  const effectiveProviderHost = connection?.providerHost || providerHost
  const installUrl =
    provider === 'github' ? buildGitHubAppInstallUrl(effectiveProviderHost) : null
  const needsInstallation = provider === 'github' && Boolean(selectedOwner && !selectedOwner.installationId)
  const ensureOwnersLoaded = useCallback(
    (force = false) => {
      if (!connection || !canManageSourceControl || isLoadingOwners) {
        return
      }

      if (force || !hasLoadedOwners) {
        void loadOwners(force || isOwnerVerificationStale(connection.lastVerifiedAt))
      }
    },
    [canManageSourceControl, connection, hasLoadedOwners, isLoadingOwners, loadOwners]
  )

  const handleConnect = useCallback(async () => {
    clearConnectError()
    await startOAuth(provider, {
      setupMode,
      providerHost: effectiveProviderHost,
      metadata: {
        setupMode,
        providerHost: effectiveProviderHost,
      },
    })
  }, [clearConnectError, effectiveProviderHost, provider, setupMode, startOAuth])

  const handleDisconnect = useCallback(async () => {
    clearConnectError()
    await disconnect(provider)
  }, [clearConnectError, disconnect, provider])

  const handleNamespaceChange = useCallback(
    async (ownerId: string) => {
      const owner = ownerOptions.find((entry) => entry.id === ownerId)
      if (!owner) {
        return
      }

      await updateSelection(provider, {
        setupMode,
        providerHost: effectiveProviderHost,
        namespaceId: owner.id,
        namespaceName: owner.displayName,
        namespaceLogin: owner.login,
        namespaceType:
          owner.kind === 'group'
            ? 'group'
            : owner.kind === 'organization'
              ? 'organization'
              : 'user',
        installationId: owner.installationId,
        installationTargetType: owner.installationTargetType,
        installationTargetLogin: owner.installationTargetLogin,
        installationTargetName: owner.installationTargetName,
        authStatus:
          provider === 'github' && !owner.installationId ? 'missing_setup' : 'active',
        lastError:
          provider === 'github' && !owner.installationId
            ? 'This namespace does not have the GitHub App installed yet.'
            : undefined,
      })
    },
    [effectiveProviderHost, ownerOptions, provider, setupMode, updateSelection]
  )

  if (variant === 'rows') {
    return (
      <section>
        <SettingsSectionTitle>GitHub</SettingsSectionTitle>
        <SettingsSectionDescription>
          Connect GitHub and choose the namespace Cozea should use for personal project repositories.
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title="Account"
              description="Connect or disconnect GitHub."
              descriptionClassName="truncate"
            />
            <SettingsRowControl>
              <Button
                type="button"
                variant={connection ? 'outline' : 'default'}
                size="sm"
                className="h-7 rounded-full text-[11px]"
                onClick={() => {
                  if (connection) {
                    void handleDisconnect()
                    return
                  }
                  void handleConnect()
                }}
                disabled={isConnecting || !canManageSourceControl || !connectionsReady}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Connecting…
                  </>
                ) : connection ? (
                  'Disconnect'
                ) : (
                  'Connect'
                )}
              </Button>
            </SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel
              title="Namespace"
              htmlFor="personal-source-control-namespace"
              descriptionClassName="truncate"
              description={
                connection
                  ? 'Choose the GitHub owner for personal projects.'
                  : 'Connect GitHub before choosing a namespace.'
              }
            />
            <SettingsRowControl className="gap-2">
              {connection ? (
                <select
                  id="personal-source-control-namespace"
                  value={selectedOwnerId}
                  onChange={(event) => {
                    void handleNamespaceChange(event.target.value)
                  }}
                  onFocus={() => {
                    ensureOwnersLoaded()
                  }}
                  onPointerDown={() => {
                    ensureOwnersLoaded()
                  }}
                  disabled={
                    !canManageSourceControl ||
                    !connectionsReady ||
                    isLoadingOwners ||
                    ownerOptions.length === 0
                  }
                  className="h-7 w-[220px] max-w-full rounded-md border border-border/50 bg-transparent px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring/50"
                >
                  {ownerOptions.length === 0 ? (
                    <option value="">
                      {isLoadingOwners ? 'Loading namespaces…' : `Choose ${label}`}
                    </option>
                  ) : null}
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.displayName} ({owner.login})
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
            </SettingsRowControl>
          </SettingsRow>
          {ownerError ? (
            <SettingsGroupError>{ownerError}</SettingsGroupError>
          ) : null}
          {connection?.lastError ? (
            <SettingsGroupError>{connection.lastError}</SettingsGroupError>
          ) : null}
          {needsInstallation && selectedOwner ? (
            <SettingsGroupError>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Install the GitHub App on <strong>{selectedOwner.login}</strong> before using provider-native repo automation.
                </span>
                <div className="flex flex-wrap gap-2">
                  {installUrl ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 rounded-full text-[11px]"
                      onClick={() => {
                        void window.electronAPI.shell.openExternal(installUrl)
                      }}
                    >
                      Install GitHub App
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full gap-1.5 text-[11px]"
                    onClick={() => {
                      ensureOwnersLoaded(true)
                    }}
                    disabled={isLoadingOwners || !canManageSourceControl}
                  >
                    {isLoadingOwners ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Refresh namespaces
                  </Button>
                </div>
              </div>
            </SettingsGroupError>
          ) : null}
        </SettingsGroup>
      </section>
    )
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4" />
              {label}
            </CardTitle>
            <CardDescription>
              {getVersionControlSetupDescription({
                provider,
                setupMode,
              })}
            </CardDescription>
          </div>
          <Badge variant={getAuthStatusTone(connection?.authStatus)}>
            {getAuthStatusLabel(connection?.authStatus)}
          </Badge>
        </div>

      </CardHeader>

      <CardContent className="space-y-4">
        {connection ? (
          <div className="space-y-2 rounded-xl border border-border/60 bg-card/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Connected account</span>
              <span className="font-medium">
                {connection.externalAccountName || connection.externalAccountLogin || 'Unknown'}
              </span>
            </div>
            {connection.namespaceLogin ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Selected namespace</span>
                <span className="font-medium">{connection.namespaceLogin}</span>
              </div>
            ) : null}
            {provider === 'github' ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">GitHub App installation</span>
                <span className="font-medium">
                  {connection.installationTargetLogin || connection.installationId || 'Not selected'}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">
            Connect {label} here to use it for project repository creation, provider-native access grants, and git sync.
          </div>
        )}

        {connection && canManageSourceControl ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Namespace</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={() => {
                  ensureOwnersLoaded(true)
                }}
                disabled={isLoadingOwners}
              >
                {isLoadingOwners ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
            </div>
            <Select
              value={selectedOwnerId}
              onOpenChange={(open) => {
                if (open) {
                  ensureOwnersLoaded()
                }
              }}
              onValueChange={(value) => {
                void handleNamespaceChange(value)
              }}
              disabled={isLoadingOwners || ownerOptions.length === 0}
            >
              <SelectTrigger className="rounded-xl bg-background">
                <SelectValue placeholder={`Select ${label} namespace`} />
              </SelectTrigger>
              <SelectContent>
                {ownerOptions.map((owner) => (
                  <SelectItem key={owner.id} value={owner.id}>
                    {owner.displayName} ({owner.login})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {setupMode === 'organization'
                ? 'Organization workspaces should point at an organization or group namespace.'
                : 'Your account should point at the personal user namespace you use for non-org projects.'}
            </p>
            {provider === 'github' && selectedOwner && !selectedOwner.installationId ? (
              <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    The GitHub App is not installed on <strong>{selectedOwner.login}</strong> yet.
                    Install it there before using provider-native repo automation from Cozea.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {installUrl ? (
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full"
                      onClick={() => {
                        void window.electronAPI.shell.openExternal(installUrl)
                      }}
                    >
                      Install GitHub App
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      ensureOwnersLoaded(true)
                    }}
                    disabled={isLoadingOwners}
                  >
                    Refresh installations
                  </Button>
                </div>
              </div>
            ) : null}
            {ownerError ? (
              <p className="text-xs text-destructive">{ownerError}</p>
            ) : null}
          </div>
        ) : connection ? (
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground">
            {canManageSourceControl
              ? 'Choose the repository namespace here once the provider is connected.'
              : 'An admin can reconnect this provider or change the namespace. You can use this page to track readiness.'}
          </div>
        ) : null}

        {connection?.lastError ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{connection.lastError}</p>
          </div>
        ) : connection?.authStatus === 'active' ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {setupMode === 'organization'
                ? `Projects in this workspace can now bind their repositories through ${label} without using the agent integrations surface.`
                : `Your account is ready to use ${label} for non-org project repositories without using the agent integrations surface.`}
            </p>
          </div>
        ) : null}

        {canManageSourceControl ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="rounded-full"
              onClick={() => {
                void handleConnect()
              }}
              disabled={isConnecting || !connectionsReady}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting…
                </>
              ) : connection ? (
                'Reconnect'
              ) : (
                `Connect ${label}`
              )}
            </Button>
            {connection ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  void handleDisconnect()
                }}
                disabled={isConnecting || !connectionsReady}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SourceControl({ surface = 'page', route }: SourceControlProps = {}) {
  const settingsPage = useScopedSettingsPage({
    route,
    surfaceId: 'sourceControl',
  })
  const {
    workspaceScoped,
    personalScoped,
    convexOrganizationId,
    capabilities,
  } = useScopedAppContext({ route })
  const {
    userId,
    hasResolved,
    isRefreshing,
    isLoading,
    getConnection,
    connectingProvider,
    connectError,
    clearConnectError,
    startOAuth,
    disconnect,
    updateSelection,
  } = useWorkspaceSourceControl({
    route: route ?? '/settings/source-control',
    enabled: Boolean(convexOrganizationId),
  })

  const setupMode: VersionControlSetupMode = personalScoped ? 'personal' : 'organization'
  const githubConnection = getConnection('github')
  const canManageSourceControl =
    personalScoped ||
    capabilities.canManageWorkspaceSettings ||
    capabilities.canManageWorkspaceIntegrations
  const pageTitle = workspaceScoped
    ? 'Workspace Source Control'
    : 'Your Source Control'
  const pageDescription = workspaceScoped
    ? 'Choose the shared provider identity and namespace that own repositories for projects in this organization workspace.'
    : 'Connect the provider accounts Cozea can use when you open or collaborate on non-organization projects.'

  const content = !convexOrganizationId || !userId ? (
    <div className="p-6">
      <WorkspaceAccessNotice
        title="Source control is unavailable"
        description="You do not have access to configure project source control for this workspace."
      />
    </div>
  ) : !workspaceScoped ? (
    <SettingsPageBody surface={surface}>
      {connectError ? (
        <div className="flex items-start gap-2 rounded-[14px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-2">
            <p>{connectError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full text-[11px]"
              onClick={clearConnectError}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <SourceControlProviderCard
        provider="github"
        label="GitHub"
        providerHost="https://github.com"
        organizationId={convexOrganizationId}
        userId={userId}
        setupMode={setupMode}
        canManageSourceControl={canManageSourceControl}
        connection={githubConnection}
        connectionsReady={hasResolved}
        connectingProvider={connectingProvider}
        clearConnectError={clearConnectError}
        startOAuth={startOAuth}
        disconnect={disconnect}
        updateSelection={updateSelection}
        variant="rows"
      />
      {isRefreshing ? (
        <p className="px-1 text-[11px] text-muted-foreground">Refreshing source control state in the background.</p>
      ) : null}
    </SettingsPageBody>
  ) : (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>
            <p className="text-sm text-muted-foreground">{pageDescription}</p>
          </div>

          {connectError ? (
            <div className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-2">
                <p>{connectError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={clearConnectError}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          {!canManageSourceControl ? (
            <div className="flex items-start gap-2 rounded-2xl border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                You can review connection status here. An admin will need to reconnect a provider or change the shared namespace for organization projects.
              </p>
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            {PROVIDER_CARDS.map((providerCard) => (
              <SourceControlProviderCard
                key={providerCard.provider}
                provider={providerCard.provider}
                label={providerCard.label}
                providerHost={providerCard.host}
                organizationId={convexOrganizationId}
                userId={userId}
                setupMode={setupMode}
                canManageSourceControl={canManageSourceControl}
                connection={githubConnection}
                connectionsReady={hasResolved}
                connectingProvider={connectingProvider}
                clearConnectError={clearConnectError}
                startOAuth={startOAuth}
                disconnect={disconnect}
                updateSelection={updateSelection}
              />
            ))}
          </div>

          {isRefreshing || isLoading ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              Refreshing source control state in the background.
            </p>
          ) : null}

        </div>
  )

  if (surface === 'drawer') {
    return settingsPage.isWorkspaceAccessDenied ? (
      <WorkspaceAccessNotice
        title="Source control access required"
        description="You do not have permission to view project source control for this workspace."
      />
    ) : (
      content
    )
  }

  return settingsPage.isWorkspaceAccessDenied ? (
    <WorkspaceAccessNotice
      title="Source control access required"
      description="You do not have permission to view project source control for this workspace."
    />
  ) : (
    content
  )
}
