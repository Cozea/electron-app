export type VersionControlProvider = 'github' | 'gitlab' | 'bitbucket' | 'local'
export type VersionControlSetupMode = 'personal' | 'organization'
export type VersionControlOwnerType = 'user' | 'organization' | 'group'
export type VersionControlAuthStatus =
  | 'active'
  | 'needs_reauth'
  | 'revoked'
  | 'missing_setup'
  | 'error'
export type VersionControlNamespaceType = 'user' | 'organization' | 'group'

export interface WorkspaceSourceControlConnectionSummary {
  provider: 'github' | 'gitlab'
  organizationId: string
  setupMode: VersionControlSetupMode
  authStatus: VersionControlAuthStatus
  providerHost?: string
  externalAccountId?: string
  externalAccountName?: string
  externalAccountLogin?: string
  namespaceId?: string
  namespaceName?: string
  namespaceLogin?: string
  namespaceType?: VersionControlNamespaceType
  installationId?: string
  installationTargetType?: 'user' | 'organization'
  installationTargetLogin?: string
  installationTargetName?: string
  tokenExpiresAt?: number
  connectedAt: number
  updatedAt: number
}

export interface ProjectRepositoryBindingSummary {
  projectId: string
  organizationId: string
  provider: VersionControlProvider
  setupMode: VersionControlSetupMode
  syncPolicy: 'auto' | 'manual'
  workingCopyMode: 'managed' | 'attached'
  repoUrl?: string
  defaultBranch: string
  ownerId?: string
  ownerLogin?: string
  ownerName?: string
  ownerType?: VersionControlNamespaceType
  repoId?: string
  repoName?: string
  repoFullName?: string
  visibility?: string
  providerHost?: string
  repoAccessPolicy?: 'on_first_open'
}

export interface VersionControlIntegrationMetadata extends Record<string, unknown> {
  setupMode?: VersionControlSetupMode
  ownerType?: VersionControlOwnerType
  providerHost?: string
  usesGitHubApp?: boolean
}

export function normalizeVersionControlProvider(
  value: string | null | undefined
): VersionControlProvider | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
    case 'local':
      return value.trim().toLowerCase() as VersionControlProvider
    default:
      return undefined
  }
}

export function getDefaultVersionControlSetupMode(
  isPersonalWorkspace: boolean
): VersionControlSetupMode {
  return isPersonalWorkspace ? 'personal' : 'organization'
}

export function getVersionControlOwnerType(
  provider: string | null | undefined,
  setupMode: VersionControlSetupMode
): VersionControlOwnerType | undefined {
  const normalizedProvider = normalizeVersionControlProvider(provider)
  if (!normalizedProvider || normalizedProvider === 'bitbucket' || normalizedProvider === 'local') {
    return undefined
  }

  if (setupMode === 'personal') {
    return 'user'
  }

  return normalizedProvider === 'gitlab' ? 'group' : 'organization'
}

export function supportsVersionControlAutomation(
  provider: string | null | undefined
): provider is 'github' | 'gitlab' {
  const normalizedProvider = normalizeVersionControlProvider(provider)
  return normalizedProvider === 'github' || normalizedProvider === 'gitlab'
}

export function buildVersionControlIntegrationMetadata(args: {
  provider: string | null | undefined
  setupMode: VersionControlSetupMode
  providerHost?: string
}): VersionControlIntegrationMetadata {
  const normalizedProvider = normalizeVersionControlProvider(args.provider)

  return {
    setupMode: args.setupMode,
    ownerType: getVersionControlOwnerType(normalizedProvider, args.setupMode),
    providerHost: args.providerHost,
    usesGitHubApp: normalizedProvider === 'github',
  }
}

export function parseVersionControlIntegrationMetadata(
  value: unknown
): VersionControlIntegrationMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const setupMode =
    candidate.setupMode === 'personal' || candidate.setupMode === 'organization'
      ? candidate.setupMode
      : undefined
  const ownerType =
    candidate.ownerType === 'user' ||
    candidate.ownerType === 'organization' ||
    candidate.ownerType === 'group'
      ? candidate.ownerType
      : undefined

  return {
    setupMode,
    ownerType,
    providerHost: typeof candidate.providerHost === 'string' ? candidate.providerHost : undefined,
    usesGitHubApp: candidate.usesGitHubApp === true,
  }
}

export function versionControlIntegrationMatchesSetupMode(args: {
  provider: string | null | undefined
  requiredSetupMode: VersionControlSetupMode
  metadata: unknown
}): boolean {
  const normalizedProvider = normalizeVersionControlProvider(args.provider)
  if (!supportsVersionControlAutomation(normalizedProvider)) {
    return false
  }

  const metadata = parseVersionControlIntegrationMetadata(args.metadata)
  if (!metadata?.setupMode) {
    return false
  }

  return metadata.setupMode === args.requiredSetupMode
}

export function getVersionControlSetupLabel(args: {
  provider: string | null | undefined
  setupMode: VersionControlSetupMode
}): string {
  const normalizedProvider = normalizeVersionControlProvider(args.provider)

  if (normalizedProvider === 'github') {
    return args.setupMode === 'organization'
      ? 'GitHub App + OAuth organization setup'
      : 'GitHub App + OAuth personal setup'
  }

  if (normalizedProvider === 'gitlab') {
    return args.setupMode === 'organization'
      ? 'GitLab OAuth organization setup'
      : 'GitLab OAuth personal setup'
  }

  return args.setupMode === 'organization'
    ? 'Organization-managed repository'
    : 'Personal repository'
}

export function getVersionControlSetupDescription(args: {
  provider: string | null | undefined
  setupMode: VersionControlSetupMode
}): string {
  const normalizedProvider = normalizeVersionControlProvider(args.provider)

  if (normalizedProvider === 'github') {
    return args.setupMode === 'organization'
      ? 'Use OAuth for the operator account and a non-personal GitHub App installation for the target organization.'
      : 'Use OAuth for the account and the GitHub App user installation for repo automation.'
  }

  if (normalizedProvider === 'gitlab') {
    return args.setupMode === 'organization'
      ? 'Use GitLab OAuth with a non-personal group or organization-managed namespace.'
      : 'Use GitLab OAuth against the user account that owns the repository.'
  }

  return args.setupMode === 'organization'
    ? 'This project expects an organization-managed repository.'
    : 'This project expects a personal repository.'
}
