import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  Loader2,
  RefreshCw,
  Unplug,
} from 'lucide-react'

import type { Id } from '../../../convex/_generated/dataModel'
import type { RepositoryOwnerDescriptor } from '@shared/electronApiTypes'
import type { VersionControlSetupMode } from '@shared/versionControl'
import {
  getVersionControlSetupDescription,
  getVersionControlSetupLabel,
} from '@shared/versionControl'
import { SettingsRouteShell } from '@/components/settings/SettingsRouteShell'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { readSourceControlProviderPreferences } from '@/lib/sourceControlPreferences'
import {
  getSourceControlProviderLabel,
  resolveSourceControlProviderPreference,
  type DefaultSourceControlProvider,
} from '@/lib/sourceControlDefaultProvider'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { api } from '../../../convex/_generated/api'

type SourceControlProvider = 'github'

interface SourceControlProps {
  surface?: 'page' | 'drawer'
  route?: string
}

const GITHUB_SOURCE_CONTROL_APP_SLUG =
  (import.meta.env.VITE_GITHUB_SOURCE_CONTROL_APP_SLUG as string | undefined)?.trim() ||
  'cozea-source-control'

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

interface ProviderCardProps {
  provider: SourceControlProvider
  label: string
  providerHost: string
  organizationId?: Id<'organizations'>
  userId?: Id<'users'>
  setupMode: VersionControlSetupMode
  preferred?: boolean
  canManageSourceControl: boolean
  connection: ReturnType<
    ReturnType<typeof useWorkspaceSourceControl>['getConnection']
  >
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
  preferred = false,
  canManageSourceControl,
  connection,
  connectingProvider,
  clearConnectError,
  startOAuth,
  disconnect,
  updateSelection,
}: ProviderCardProps) {
  const convex = useConvex()
  const [owners, setOwners] = useState<RepositoryOwnerDescriptor[]>([])
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [ownerError, setOwnerError] = useState<string | null>(null)

  const loadOwners = useCallback(async (bypassCache = false) => {
    if (!organizationId || !userId || !connection || !canManageSourceControl) {
      setOwners([])
      setOwnerError(null)
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
      setOwners([])
      setOwnerError(
        error instanceof Error ? error.message : `Failed to load ${label} namespaces`
      )
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
    void loadOwners()
  }, [loadOwners])

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

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4" />
              {label}
              {preferred ? <Badge variant="secondary">Preferred</Badge> : null}
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

        <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
          <p className="text-sm font-medium">
            {getVersionControlSetupLabel({
              provider,
              setupMode,
            })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Agent CLI and MCP integrations are configured elsewhere. This surface only controls project repositories and git sync.
          </p>
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
                  void loadOwners(true)
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
                      void loadOwners(true)
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
              disabled={isConnecting}
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
                disabled={isConnecting}
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
    isLoading,
    getConnection,
    connectingProvider,
    connectError,
    clearConnectError,
    startOAuth,
    disconnect,
    updateSelection,
  } = useWorkspaceSourceControl({
    route: route ?? (workspaceScoped ? '/workspace/source-control' : '/settings/source-control'),
    enabled: Boolean(convexOrganizationId),
  })
  const profile = useQuery(
    api.users.getById,
    userId ? { userId } : 'skip'
  )
  const organization = useQuery(
    api.organizations.get,
    convexOrganizationId ? { id: convexOrganizationId } : 'skip'
  )
  const updatePreferences = useMutation(api.users.updatePreferences)
  const updateOrganizationSourceControlSettings = useMutation(
    api.organizations.updateSourceControlSettings
  )

  const setupMode: VersionControlSetupMode = personalScoped ? 'personal' : 'organization'
  const preferredProviders = useMemo(() => readSourceControlProviderPreferences(), [])
  const githubConnection = getConnection('github')
  const sourceControlPreference = useMemo(
    () =>
      resolveSourceControlProviderPreference({
        userDefaultProvider: profile?.preferences?.sourceControlDefaultProvider,
        workspaceDefaultProvider: organization?.sourceControlSettings?.defaultProvider,
        preferredProviders,
        githubConnection,
      }),
    [
      githubConnection,
      organization?.sourceControlSettings?.defaultProvider,
      preferredProviders,
      profile?.preferences?.sourceControlDefaultProvider,
    ]
  )
  const explicitDefaultProvider =
    organization?.sourceControlSettings?.defaultProvider ??
    profile?.preferences?.sourceControlDefaultProvider ??
    null
  const defaultProvider = sourceControlPreference.provider
  const orderedProviderCards = useMemo(() => {
    if (preferredProviders.length === 0) {
      return PROVIDER_CARDS
    }

    return [...PROVIDER_CARDS].sort((left, right) => {
      const leftPreferred = preferredProviders.includes(left.provider)
      const rightPreferred = preferredProviders.includes(right.provider)
      if (leftPreferred === rightPreferred) {
        return left.label.localeCompare(right.label)
      }
      return leftPreferred ? -1 : 1
    })
  }, [preferredProviders])

  const canManageSourceControl =
    personalScoped ||
    capabilities.canManageWorkspaceSettings ||
    capabilities.canManageWorkspaceIntegrations
  const handleDefaultProviderChange = useCallback(
    async (provider: DefaultSourceControlProvider | null) => {
      if (!userId || !convexOrganizationId) {
        return
      }

      if (workspaceScoped) {
        await updateOrganizationSourceControlSettings({
          orgId: convexOrganizationId,
          userId,
          sourceControlSettings: {
            defaultProvider: provider,
          },
        })
        return
      }

      await updatePreferences({
        userId,
        preferences: {
          sourceControlDefaultProvider: provider,
        },
      })
    },
    [
      convexOrganizationId,
      updateOrganizationSourceControlSettings,
      updatePreferences,
      userId,
      workspaceScoped,
    ]
  )
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
  ) : (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>
            <p className="text-sm text-muted-foreground">{pageDescription}</p>
            {preferredProviders.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Onboarding preferences:{' '}
                {preferredProviders.map(() => 'GitHub').join(', ')}
                .
              </p>
            ) : null}
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

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">
                {workspaceScoped
                  ? 'Default provider for new workspace projects'
                  : 'Default provider for your new non-org projects'}
              </CardTitle>
              <CardDescription>
                {workspaceScoped
                  ? 'The chat-based project wizard will prefer this provider when it generates plan cards for this workspace.'
                  : 'The chat-based project wizard will prefer this provider when it generates plan cards for projects in your personal project collection.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="default-source-control-provider">Default provider</Label>
                <Select
                  value={explicitDefaultProvider ?? 'none'}
                  onValueChange={(value) => {
                    void handleDefaultProviderChange(value === 'github' ? value : null)
                  }}
                  disabled={!canManageSourceControl}
                >
                  <SelectTrigger
                    id="default-source-control-provider"
                    className="max-w-sm rounded-xl bg-background"
                  >
                    <SelectValue placeholder="Choose a default provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ask when it matters</SelectItem>
                    <SelectItem value="github">GitHub</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {defaultProvider ? (
                  <>
                    New AI-generated plans will default to{' '}
                    <span className="font-medium text-foreground">
                      {getSourceControlProviderLabel(defaultProvider)}
                    </span>{' '}
                    unless the user explicitly asks for a different host or repository.
                  </>
                ) : sourceControlPreference.shouldAskUser ? (
                  <>
                    When no default is set, the planner will ask before using project source control.
                  </>
                ) : (
                  <>Set a default here if you want new plans to consistently prefer one provider.</>
                )}
              </p>
            </CardContent>
          </Card>

          {!canManageSourceControl ? (
            <div className="flex items-start gap-2 rounded-2xl border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                You can review connection status here. An admin will need to reconnect a provider or change the shared namespace for organization projects.
              </p>
            </div>
          ) : null}

          {isLoading ? (
            <Card className="border-border/60">
              <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading source control connections…
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            {orderedProviderCards.map((providerCard) => (
              <SourceControlProviderCard
                key={providerCard.provider}
                provider={providerCard.provider}
                label={providerCard.label}
                providerHost={providerCard.host}
                organizationId={convexOrganizationId}
                userId={userId}
                setupMode={setupMode}
                preferred={preferredProviders.includes(providerCard.provider)}
                canManageSourceControl={canManageSourceControl}
                connection={githubConnection}
                connectingProvider={connectingProvider}
                clearConnectError={clearConnectError}
                startOAuth={startOAuth}
                disconnect={disconnect}
                updateSelection={updateSelection}
              />
            ))}
          </div>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">
                {workspaceScoped ? 'When Cozea asks for setup' : 'How this applies to you'}
              </CardTitle>
              <CardDescription>
                {workspaceScoped
                  ? 'Organization workspaces keep a shared source-control connection. Cozea checks it when someone opens a project that uses that provider.'
                  : 'For non-org projects, Cozea uses your own GitHub connection when you open a project that needs provider access.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {workspaceScoped
                  ? 'If a project points at GitHub and this workspace has not configured that provider yet, opening the project will prompt the user to resolve it or ask an admin.'
                  : 'Your personal workspace is effectively your collection of non-org projects. Each user keeps their own source-control connection here, even when a project was created by someone else.'}
              </p>
              <p>
                Repository invitations and provider-side access are granted lazily on project open, so setup only becomes necessary when a project actually needs it.
              </p>
            </CardContent>
          </Card>
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

  return (
    <SettingsRouteShell surfaceId="sourceControl">
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Source control access required"
          description="You do not have permission to view project source control for this workspace."
        />
      ) : (
        content
      )}
    </SettingsRouteShell>
  )
}
