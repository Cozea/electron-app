import type { ConvexReactClient } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  RepositoryBranchDescriptor,
  RepositoryDescriptor,
  RepositoryLanguageDescriptor,
  RepositoryListPageResult,
  RepositoryOwnerDescriptor,
  RepositoryReadmeSnippetDescriptor,
} from '@shared/electronApiTypes'

type RepositoryProvider = 'github'

interface ResolvedProviderRepositoryAuth {
  accessToken?: string
  providerHost?: string
  authStrategy?: 'oauth' | 'github_app_installation'
}

interface GitHubOwnerInstallationResolution {
  ownerId: string
  ownerLogin: string
  installationId?: string
  installationTargetType?: 'user' | 'organization'
  installationTargetLogin?: string
  installationTargetName?: string
}

interface SessionCacheEntry {
  expiresAt: number
  value: ResolvedProviderRepositoryAuth
}

const SESSION_CACHE_TTL_MS = 30_000

const providerSessionCache = new Map<string, SessionCacheEntry>()

function buildSessionCacheKey(args: {
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  purpose: 'setup' | 'repository_management'
}): string {
  return JSON.stringify(args)
}

function clearExpiredSessionEntries(): void {
  const now = Date.now()
  for (const [key, entry] of providerSessionCache.entries()) {
    if (entry.expiresAt <= now) {
      providerSessionCache.delete(key)
    }
  }
}

async function resolveProviderRepositoryAuth(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  purpose: 'setup' | 'repository_management'
  bypassCache?: boolean
}): Promise<ResolvedProviderRepositoryAuth> {
  clearExpiredSessionEntries()

  const cacheKey = buildSessionCacheKey(args)
  if (!args.bypassCache) {
    const cached = providerSessionCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
  }

  const connection = await args.convex.query(api.sourceControl.getByProvider, {
    organizationId: args.organizationId,
    userId: args.userId,
    provider: args.provider,
  })

  if (!connection) {
    throw new Error(
      'GitHub source control is not connected for this workspace.'
    )
  }

  const session = await args.convex.action(
    api.sourceControl.issueWorkspaceProviderSession,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      provider: args.provider,
      purpose: args.purpose,
    }
  )

  const resolved = {
    accessToken: session?.accessToken,
    providerHost: session?.providerHost ?? connection.providerHost,
    authStrategy:
      session?.authStrategy === 'github_app_installation'
        ? 'github_app_installation'
        : 'oauth',
  } satisfies ResolvedProviderRepositoryAuth

  providerSessionCache.set(cacheKey, {
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    value: resolved,
  })

  return resolved
}

async function enrichGitHubOwnersWithInstallations(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  providerHost?: string
  owners: RepositoryOwnerDescriptor[]
}): Promise<RepositoryOwnerDescriptor[]> {
  const installationCandidates = args.owners.filter(
    (owner): owner is RepositoryOwnerDescriptor & { kind: 'user' | 'organization' } =>
      owner.kind === 'user' || owner.kind === 'organization'
  )

  if (installationCandidates.length === 0) {
    return args.owners
  }

  const resolvedInstallations = (await args.convex.action(
    api.sourceControl.resolveGitHubInstallationsForOwners,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      providerHost: args.providerHost,
      owners: installationCandidates.map((owner) => ({
        id: owner.id,
        login: owner.login,
        kind: owner.kind,
      })),
    }
  )) as GitHubOwnerInstallationResolution[]

  const installationsByOwnerId = new Map(
    resolvedInstallations.map((installation) => [installation.ownerId, installation])
  )

  return args.owners.map((owner) => {
    const installation = installationsByOwnerId.get(owner.id)
    if (!installation) {
      return owner
    }

    return {
      ...owner,
      installationId: installation.installationId,
      installationTargetType: installation.installationTargetType,
      installationTargetLogin: installation.installationTargetLogin,
      installationTargetName: installation.installationTargetName,
    }
  })
}

async function listProviderRepositoriesPage(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  page: number
  pageSize: number
  query?: string
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  bypassCache?: boolean
}): Promise<RepositoryListPageResult> {
  const auth = await resolveProviderRepositoryAuth({
    convex: args.convex,
    organizationId: args.organizationId,
    userId: args.userId,
    provider: args.provider,
    purpose: 'setup',
    bypassCache: args.bypassCache,
  })

  return await window.electronAPI.sourceControl.listRepositoriesPage({
    provider: args.provider,
    accessToken: auth.accessToken,
    providerHost: auth.providerHost,
    authStrategy: auth.authStrategy,
    ownerId: args.ownerId,
    ownerLogin: args.ownerLogin,
    ownerKind: args.ownerKind,
    search: args.query,
    page: args.page,
    pageSize: args.pageSize,
    bypassCache: args.bypassCache,
  })
}

export async function invalidateProviderRepositoryManagementCache(options?: {
  provider?: RepositoryProvider
}): Promise<void> {
  if (options?.provider) {
    for (const key of providerSessionCache.keys()) {
      if (key.includes(`"provider":"${options.provider}"`)) {
        providerSessionCache.delete(key)
      }
    }
  } else {
    providerSessionCache.clear()
  }

  await window.electronAPI.sourceControl.invalidateProviderCache(options)
}

export async function listConnectedRepositoryOwners(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  bypassCache?: boolean
}): Promise<RepositoryOwnerDescriptor[]> {
  const auth = await resolveProviderRepositoryAuth({
    ...args,
    purpose: 'setup',
  })
  const owners = await window.electronAPI.sourceControl.listRepositoryOwners({
    provider: args.provider,
    accessToken: auth.accessToken,
    providerHost: auth.providerHost,
    authStrategy: auth.authStrategy,
    bypassCache: args.bypassCache,
  })

  if (args.provider !== 'github') {
    return owners
  }

  return await enrichGitHubOwnersWithInstallations({
    convex: args.convex,
    organizationId: args.organizationId,
    userId: args.userId,
    providerHost: auth.providerHost,
    owners,
  })
}

export async function listConnectedRepositories(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  search?: string
  bypassCache?: boolean
}): Promise<RepositoryDescriptor[]> {
  const repositories: RepositoryDescriptor[] = []
  let nextPage = 1
  let pagesFetched = 0

  while (nextPage && pagesFetched < 20) {
    const page = await listProviderRepositoriesPage({
      convex: args.convex,
      organizationId: args.organizationId,
      userId: args.userId,
      provider: args.provider,
      ownerId: args.ownerId,
      ownerLogin: args.ownerLogin,
      ownerKind: args.ownerKind,
      query: args.search,
      page: nextPage,
      pageSize: 100,
      bypassCache: args.bypassCache,
    })

    repositories.push(...page.items)
    nextPage = page.hasNextPage ? page.nextPage ?? nextPage + 1 : 0
    pagesFetched += 1
  }

  return repositories
}

export async function listConnectedRepositoriesPage(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  search?: string
  page: number
  pageSize: number
  bypassCache?: boolean
}): Promise<RepositoryListPageResult> {
  return listProviderRepositoriesPage({
    convex: args.convex,
    organizationId: args.organizationId,
    userId: args.userId,
    provider: args.provider,
    ownerId: args.ownerId,
    ownerLogin: args.ownerLogin,
    ownerKind: args.ownerKind,
    query: args.search,
    page: args.page,
    pageSize: args.pageSize,
    bypassCache: args.bypassCache,
  })
}

export async function createConnectedRepository(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  name: string
  private: boolean
}): Promise<RepositoryDescriptor> {
  const auth = await resolveProviderRepositoryAuth({
    ...args,
    purpose:
      'setup',
  })
  const repository = await window.electronAPI.sourceControl.createRepository({
    provider: args.provider,
    accessToken: auth.accessToken,
    providerHost: auth.providerHost,
    authStrategy: auth.authStrategy,
    ownerId: args.ownerId,
    ownerLogin: args.ownerLogin,
    ownerKind: args.ownerKind,
    name: args.name,
    private: args.private,
  })

  await invalidateProviderRepositoryManagementCache({ provider: args.provider })
  return repository
}

export async function listConnectedRepositoryBranches(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  repositoryId?: string
  repositoryFullName: string
  defaultBranch?: string
  bypassCache?: boolean
}): Promise<RepositoryBranchDescriptor[]> {
  const auth = await resolveProviderRepositoryAuth({
    ...args,
    purpose: 'setup',
  })

  return window.electronAPI.sourceControl.listBranches({
    provider: args.provider,
    accessToken: auth.accessToken,
    providerHost: auth.providerHost,
    authStrategy: auth.authStrategy,
    repositoryId: args.repositoryId,
    repositoryFullName: args.repositoryFullName,
    defaultBranch: args.defaultBranch,
    bypassCache: args.bypassCache,
  })
}

export async function listConnectedRepositoryLanguages(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  repoUrl: string
  repositoryId?: string
  bypassCache?: boolean
}): Promise<RepositoryLanguageDescriptor[]> {
  const auth = await resolveProviderRepositoryAuth({
    ...args,
    purpose: 'setup',
  })

  return window.electronAPI.sourceControl.listRepositoryLanguages({
    provider: args.provider,
    accessToken: auth.accessToken,
    providerHost: auth.providerHost,
    authStrategy: auth.authStrategy,
    repoUrl: args.repoUrl,
    repositoryId: args.repositoryId,
    bypassCache: args.bypassCache,
  })
}

export async function getConnectedRepositoryReadmeSnippet(args: {
  convex: ConvexReactClient
  organizationId: Id<'organizations'>
  userId: Id<'users'>
  provider: RepositoryProvider
  repoUrl: string
  repositoryId?: string
  branch?: string
  bypassCache?: boolean
}): Promise<RepositoryReadmeSnippetDescriptor> {
  const auth = await resolveProviderRepositoryAuth({
    ...args,
    purpose: 'setup',
  })

  return window.electronAPI.sourceControl.getRepositoryReadmeSnippet({
    provider: args.provider,
    accessToken: auth.accessToken,
    providerHost: auth.providerHost,
    authStrategy: auth.authStrategy,
    repoUrl: args.repoUrl,
    repositoryId: args.repositoryId,
    branch: args.branch,
    bypassCache: args.bypassCache,
  })
}
