export type RepositoryProvider = 'github' | 'gitlab'
export type GitHubAuthStrategy = 'oauth' | 'github_app_installation'

export interface ProviderSession {
  provider: RepositoryProvider
  accessToken: string
  providerHost?: string
  authStrategy?: GitHubAuthStrategy
}

export interface ProviderRepositoryOwner {
  id: string
  login: string
  displayName?: string
  kind: 'user' | 'organization' | 'group'
}

export interface ProviderRepository {
  id: string
  name: string
  fullName: string
  ownerLogin?: string
  ownerId?: string
  ownerAvatarUrl?: string
  lastActivityAt?: string
  defaultBranch?: string
  private: boolean
  visibility?: string
  url: string
  provider: RepositoryProvider
  canAdmin?: boolean
  sizeBytes?: number
  starsCount?: number
}

export interface ProviderRepositoryBranch {
  name: string
  isDefault: boolean
}

export interface ProviderRepositoryLanguage {
  name: string
  percentage: number
}

export interface ProviderRepositoryReadmeSnippet {
  excerpt: string
}

export interface ProviderRepositoryListPage {
  items: ProviderRepository[]
  hasNextPage: boolean
  nextPage?: number
}

export interface ProviderRepositoryAccessSyncResult {
  success: boolean
  accessState: 'granted' | 'revoked' | 'noop' | 'error'
  providerAccountHandle?: string
  error?: string
}

export class ProviderClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderClientError'
  }
}

function unavailable(): never {
  throw new ProviderClientError('Source control provider integration is unavailable in this build.')
}

export function createProviderClient(_session: ProviderSession) {
  return {
    async listOwners(): Promise<ProviderRepositoryOwner[]> {
      unavailable()
    },
    async listRepositoriesPage(): Promise<ProviderRepositoryListPage> {
      unavailable()
    },
    async listBranches(): Promise<ProviderRepositoryBranch[]> {
      unavailable()
    },
    async listLanguages(): Promise<ProviderRepositoryLanguage[]> {
      unavailable()
    },
    async getReadmeSnippet(): Promise<ProviderRepositoryReadmeSnippet> {
      unavailable()
    },
    async createRepository(): Promise<ProviderRepository> {
      unavailable()
    },
    async syncRepositoryAccess(): Promise<ProviderRepositoryAccessSyncResult> {
      unavailable()
    },
  }
}
