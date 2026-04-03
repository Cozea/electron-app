import type {
  RepositoryBranchDescriptor,
  RepositoryDescriptor,
  RepositoryLanguageDescriptor,
  RepositoryReadmeSnippetDescriptor,
  RepositoryOwnerDescriptor,
} from '../../shared/electronApiTypes'
import {
  type ProviderRepositoryBranch,
  type ProviderRepositoryLanguage,
  type ProviderRepositoryReadmeSnippet,
  type ProviderRepository,
  type ProviderRepositoryOwner,
  type ProviderSession,
  createProviderClient,
  ProviderClientError,
} from '../../server/src/lib/sourceControl/providerClient'

type RepositoryProvider = 'github' | 'gitlab'
type GitHubAuthStrategy = 'oauth' | 'github_app_installation'

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

interface ListRepositoryOwnersOptions {
  provider: RepositoryProvider
  accessToken?: string
  providerHost?: string
  authStrategy?: GitHubAuthStrategy
  bypassCache?: boolean
}

interface ListRepositoriesPageOptions extends ListRepositoryOwnersOptions {
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  search?: string
  page: number
  pageSize: number
}

interface ListRepositoryBranchesOptions extends ListRepositoryOwnersOptions {
  repositoryId?: string
  repositoryFullName: string
  defaultBranch?: string
  bypassCache?: boolean
}

interface ListRepositoryLanguagesOptions extends ListRepositoryOwnersOptions {
  repoUrl: string
  repositoryId?: string
  bypassCache?: boolean
}

interface GetRepositoryReadmeSnippetOptions extends ListRepositoryOwnersOptions {
  repoUrl: string
  repositoryId?: string
  branch?: string
  bypassCache?: boolean
}

interface CreateRepositoryOptions extends ListRepositoryOwnersOptions {
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  name: string
  private: boolean
}

interface SyncRepositoryAccessOptions extends ListRepositoryOwnersOptions {
  repoUrl: string
  action: 'grant' | 'revoke'
  role: 'project_manager' | 'developer' | 'designer' | 'viewer'
  inviteEmail?: string
  providerAccountHandle?: string
}

export interface RepositoryListPageResult {
  items: RepositoryDescriptor[]
  hasNextPage: boolean
  nextPage?: number
}

const OWNERS_TTL_MS = 60_000
const REPOSITORIES_TTL_MS = 60_000
const BRANCHES_TTL_MS = 30_000
const LANGUAGES_TTL_MS = 60_000

function cloneOwners(owners: RepositoryOwnerDescriptor[]): RepositoryOwnerDescriptor[] {
  return owners.map((owner) => ({ ...owner }))
}

function cloneRepositories(repositories: RepositoryDescriptor[]): RepositoryDescriptor[] {
  return repositories.map((repository) => ({ ...repository }))
}

function cloneBranches(branches: RepositoryBranchDescriptor[]): RepositoryBranchDescriptor[] {
  return branches.map((branch) => ({ ...branch }))
}

function cloneLanguages(languages: RepositoryLanguageDescriptor[]): RepositoryLanguageDescriptor[] {
  return languages.map((language) => ({ ...language }))
}

function cloneReadmeSnippet(
  snippet: RepositoryReadmeSnippetDescriptor
): RepositoryReadmeSnippetDescriptor {
  return { ...snippet }
}

function cloneRepositoryListPage(result: RepositoryListPageResult): RepositoryListPageResult {
  return {
    items: cloneRepositories(result.items),
    hasNextPage: result.hasNextPage,
    nextPage: result.nextPage,
  }
}

function toRepositoryOwnerDescriptor(owner: ProviderRepositoryOwner): RepositoryOwnerDescriptor {
  return {
    id: owner.id,
    login: owner.login,
    displayName: owner.displayName,
    kind: owner.kind,
  }
}

function toRepositoryDescriptor(repository: ProviderRepository): RepositoryDescriptor {
  return {
    id: repository.id,
    name: repository.name,
    fullName: repository.fullName,
    ownerLogin: repository.ownerLogin,
    ownerId: repository.ownerId,
    ownerAvatarUrl: repository.ownerAvatarUrl,
    lastActivityAt: repository.lastActivityAt,
    defaultBranch: repository.defaultBranch,
    private: repository.private,
    visibility: repository.visibility,
    url: repository.url,
    provider: repository.provider,
    canAdmin: repository.canAdmin,
    sizeBytes: repository.sizeBytes,
    starsCount: repository.starsCount,
  }
}

function toRepositoryBranchDescriptor(
  branch: ProviderRepositoryBranch
): RepositoryBranchDescriptor {
  return {
    name: branch.name,
    isDefault: branch.isDefault,
  }
}

function toRepositoryLanguageDescriptor(
  language: ProviderRepositoryLanguage
): RepositoryLanguageDescriptor {
  return {
    name: language.name,
    percentage: language.percentage,
  }
}

function toRepositoryReadmeSnippetDescriptor(
  snippet: ProviderRepositoryReadmeSnippet
): RepositoryReadmeSnippetDescriptor {
  return {
    excerpt: snippet.excerpt,
  }
}

function buildSessionKey(options: {
  provider: RepositoryProvider
  accessToken: string
  providerHost?: string
  authStrategy?: GitHubAuthStrategy
}): string {
  return JSON.stringify({
    provider: options.provider,
    providerHost: options.providerHost ?? '',
    authStrategy: options.authStrategy ?? 'oauth',
    accessToken: options.accessToken,
  })
}

function assertAccessToken(options: {
  provider: RepositoryProvider
  accessToken?: string
}): string {
  const accessToken = options.accessToken?.trim()
  if (!accessToken) {
    throw new Error(
      `${options.provider === 'github' ? 'GitHub' : 'GitLab'} source control is not connected.`
    )
  }
  return accessToken
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ProviderClientError) {
    return error.message
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export class SourceControlProviderService {
  private static instance: SourceControlProviderService

  private ownerCache = new Map<string, CacheEntry<RepositoryOwnerDescriptor[]>>()
  private repositoryPageCache = new Map<string, CacheEntry<RepositoryListPageResult>>()
  private branchCache = new Map<string, CacheEntry<RepositoryBranchDescriptor[]>>()
  private languageCache = new Map<string, CacheEntry<RepositoryLanguageDescriptor[]>>()
  private readmeCache = new Map<string, CacheEntry<RepositoryReadmeSnippetDescriptor>>()

  static getInstance(): SourceControlProviderService {
    if (!SourceControlProviderService.instance) {
      SourceControlProviderService.instance = new SourceControlProviderService()
    }
    return SourceControlProviderService.instance
  }

  invalidateCache(options?: { provider?: RepositoryProvider }): void {
    if (!options?.provider) {
      this.ownerCache.clear()
      this.repositoryPageCache.clear()
      this.branchCache.clear()
      this.languageCache.clear()
      this.readmeCache.clear()
      return
    }

    const providerPrefix = `"provider":"${options.provider}"`
    for (const cache of [this.ownerCache, this.repositoryPageCache, this.branchCache, this.languageCache, this.readmeCache]) {
      for (const key of cache.keys()) {
        if (key.includes(providerPrefix)) {
          cache.delete(key)
        }
      }
    }
  }

  async listRepositoryOwners(
    options: ListRepositoryOwnersOptions
  ): Promise<RepositoryOwnerDescriptor[]> {
    const session = this.createSession(options)
    const cacheKey = JSON.stringify({
      session: buildSessionKey(session),
      type: 'owners',
    })

    if (!options.bypassCache) {
      const cached = this.ownerCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return cloneOwners(cached.value)
      }
    }

    try {
      const owners = (await createProviderClient(session).listOwners()).map(
        toRepositoryOwnerDescriptor
      )
      this.ownerCache.set(cacheKey, {
        expiresAt: Date.now() + OWNERS_TTL_MS,
        value: owners,
      })
      return cloneOwners(owners)
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to load repository owners.'))
    }
  }

  async listRepositoriesPage(
    options: ListRepositoriesPageOptions
  ): Promise<RepositoryListPageResult> {
    const session = this.createSession(options)
    const cacheKey = JSON.stringify({
      session: buildSessionKey(session),
      type: 'repositories',
      ownerId: options.ownerId ?? '',
      ownerLogin: options.ownerLogin ?? '',
      ownerKind: options.ownerKind ?? '',
      query: options.search?.trim().toLowerCase() ?? '',
      page: options.page,
      pageSize: options.pageSize,
    })

    if (!options.bypassCache) {
      const cached = this.repositoryPageCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return cloneRepositoryListPage(cached.value)
      }
    }

    try {
      const page = await createProviderClient(session).listRepositoriesPage({
        ownerId: options.ownerId,
        ownerLogin: options.ownerLogin,
        ownerKind: options.ownerKind,
        query: options.search,
        page: options.page,
        pageSize: options.pageSize,
      })

      const normalized: RepositoryListPageResult = {
        items: page.items.map(toRepositoryDescriptor),
        hasNextPage: page.hasNextPage,
        nextPage: page.nextPage,
      }

      this.repositoryPageCache.set(cacheKey, {
        expiresAt: Date.now() + REPOSITORIES_TTL_MS,
        value: normalized,
      })

      return cloneRepositoryListPage(normalized)
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to load repositories.'))
    }
  }

  async listRepositoryBranches(
    options: ListRepositoryBranchesOptions
  ): Promise<RepositoryBranchDescriptor[]> {
    const session = this.createSession(options)
    const cacheKey = JSON.stringify({
      session: buildSessionKey(session),
      type: 'branches',
      repositoryId: options.repositoryId ?? '',
      repositoryFullName: options.repositoryFullName,
      defaultBranch: options.defaultBranch ?? '',
    })

    if (!options.bypassCache) {
      const cached = this.branchCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return cloneBranches(cached.value)
      }
    }

    try {
      const branches = (await createProviderClient(session).listBranches({
        repositoryId: options.repositoryId,
        repositoryFullName: options.repositoryFullName,
        defaultBranch: options.defaultBranch,
      })).map(toRepositoryBranchDescriptor)

      this.branchCache.set(cacheKey, {
        expiresAt: Date.now() + BRANCHES_TTL_MS,
        value: branches,
      })

      return cloneBranches(branches)
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to load repository branches.'))
    }
  }

  async listRepositoryLanguages(
    options: ListRepositoryLanguagesOptions
  ): Promise<RepositoryLanguageDescriptor[]> {
    const session = this.createSession(options)
    const cacheKey = JSON.stringify({
      session: buildSessionKey(session),
      type: 'languages',
      repoUrl: options.repoUrl,
      repositoryId: options.repositoryId ?? '',
    })

    if (!options.bypassCache) {
      const cached = this.languageCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return cloneLanguages(cached.value)
      }
    }

    try {
      const languages = (await createProviderClient(session).listLanguages({
        repoUrl: options.repoUrl,
        repositoryId: options.repositoryId,
      })).map(toRepositoryLanguageDescriptor)

      this.languageCache.set(cacheKey, {
        expiresAt: Date.now() + LANGUAGES_TTL_MS,
        value: languages,
      })

      return cloneLanguages(languages)
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to load repository languages.'))
    }
  }

  async getRepositoryReadmeSnippet(
    options: GetRepositoryReadmeSnippetOptions
  ): Promise<RepositoryReadmeSnippetDescriptor> {
    const session = this.createSession(options)
    const cacheKey = JSON.stringify({
      session: buildSessionKey(session),
      type: 'readme',
      repoUrl: options.repoUrl,
      repositoryId: options.repositoryId ?? '',
      branch: options.branch ?? '',
    })

    if (!options.bypassCache) {
      const cached = this.readmeCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return cloneReadmeSnippet(cached.value)
      }
    }

    try {
      const snippet = toRepositoryReadmeSnippetDescriptor(
        await createProviderClient(session).getReadmeSnippet({
          repoUrl: options.repoUrl,
          repositoryId: options.repositoryId,
          branch: options.branch,
        })
      )

      this.readmeCache.set(cacheKey, {
        expiresAt: Date.now() + LANGUAGES_TTL_MS,
        value: snippet,
      })

      return cloneReadmeSnippet(snippet)
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to load repository README.'))
    }
  }

  async createRepository(options: CreateRepositoryOptions): Promise<RepositoryDescriptor> {
    const session = this.createSession(options)

    try {
      const repository = await createProviderClient(session).createRepository({
        ownerId: options.ownerId,
        ownerLogin: options.ownerLogin,
        ownerKind: options.ownerKind,
        name: options.name,
        private: options.private,
      })

      this.invalidateCache({ provider: options.provider })
      return toRepositoryDescriptor(repository)
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to create repository.'))
    }
  }

  async syncRepositoryAccess(
    options: SyncRepositoryAccessOptions
  ): Promise<Awaited<ReturnType<ReturnType<typeof createProviderClient>['syncRepositoryAccess']>>> {
    const session = this.createSession(options)
    try {
      return await createProviderClient(session).syncRepositoryAccess({
        repoUrl: options.repoUrl,
        action: options.action,
        role: options.role,
        inviteEmail: options.inviteEmail,
        providerAccountHandle: options.providerAccountHandle,
      })
    } catch (error) {
      return {
        success: false,
        accessState: 'error',
        providerAccountHandle: options.providerAccountHandle?.trim() || undefined,
        error: getErrorMessage(error, 'Failed to sync repository access.'),
      }
    }
  }

  private createSession(options: {
    provider: RepositoryProvider
    accessToken?: string
    providerHost?: string
    authStrategy?: GitHubAuthStrategy
  }): ProviderSession {
    return {
      provider: options.provider,
      accessToken: assertAccessToken(options),
      providerHost: options.providerHost,
      authStrategy: options.authStrategy,
    }
  }
}
