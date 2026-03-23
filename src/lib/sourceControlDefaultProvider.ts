import type { SourceControlProviderPreference } from '@/lib/sourceControlPreferences'

export type DefaultSourceControlProvider = 'github' | 'gitlab'

interface ConnectionLike {
  authStatus?: string | null
}

interface ResolveDefaultSourceControlProviderArgs {
  userDefaultProvider?: string | null
  workspaceDefaultProvider?: string | null
  preferredProviders?: SourceControlProviderPreference[]
  githubConnection?: ConnectionLike | null
  gitlabConnection?: ConnectionLike | null
}

export interface ResolvedSourceControlProviderPreference {
  provider: DefaultSourceControlProvider | null
  explicitProvider: DefaultSourceControlProvider | null
  connectedProviders: DefaultSourceControlProvider[]
  shouldAskUser: boolean
}

function normalizeProvider(
  value: string | null | undefined
): DefaultSourceControlProvider | null {
  return value === 'github' || value === 'gitlab' ? value : null
}

function isUsableConnection(connection: ConnectionLike | null | undefined): boolean {
  return connection?.authStatus === 'active' || connection?.authStatus === 'missing_setup'
}

function uniqueProviders(
  providers: Array<DefaultSourceControlProvider | null | undefined>
): DefaultSourceControlProvider[] {
  return Array.from(
    new Set(
      providers.filter(
        (provider): provider is DefaultSourceControlProvider =>
          provider === 'github' || provider === 'gitlab'
      )
    )
  )
}

export function getSourceControlProviderLabel(
  provider: DefaultSourceControlProvider | null | undefined
): string {
  if (provider === 'gitlab') return 'GitLab'
  if (provider === 'github') return 'GitHub'
  return 'GitHub or GitLab'
}

export function resolveSourceControlProviderPreference(
  args: ResolveDefaultSourceControlProviderArgs
): ResolvedSourceControlProviderPreference {
  const explicitProvider =
    normalizeProvider(args.workspaceDefaultProvider) ??
    normalizeProvider(args.userDefaultProvider)

  const connectedProviders = uniqueProviders([
    isUsableConnection(args.githubConnection) ? 'github' : null,
    isUsableConnection(args.gitlabConnection) ? 'gitlab' : null,
  ])

  if (explicitProvider) {
    return {
      provider: explicitProvider,
      explicitProvider,
      connectedProviders,
      shouldAskUser: false,
    }
  }

  if (connectedProviders.length === 1) {
    return {
      provider: connectedProviders[0],
      explicitProvider: null,
      connectedProviders,
      shouldAskUser: false,
    }
  }

  if (connectedProviders.length > 1) {
    return {
      provider: null,
      explicitProvider: null,
      connectedProviders,
      shouldAskUser: true,
    }
  }

  const preferredProviders = uniqueProviders(
    (args.preferredProviders ?? []).map((provider) => normalizeProvider(provider))
  )

  if (preferredProviders.length === 1) {
    return {
      provider: preferredProviders[0],
      explicitProvider: null,
      connectedProviders,
      shouldAskUser: false,
    }
  }

  if (preferredProviders.length > 1) {
    return {
      provider: null,
      explicitProvider: null,
      connectedProviders,
      shouldAskUser: true,
    }
  }

  return {
    provider: null,
    explicitProvider: null,
    connectedProviders,
    shouldAskUser: false,
  }
}

export function resolveDefaultSourceControlProvider(
  args: ResolveDefaultSourceControlProviderArgs
): DefaultSourceControlProvider | null {
  return resolveSourceControlProviderPreference(args).provider
}
