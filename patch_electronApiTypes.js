const fs = require('fs');

let content = fs.readFileSync('shared/electronApiTypes.ts', 'utf8');

// I need to add sourceControl. What methods did it have?
// listRepositoryOwners, listRepositories, listRepositoriesPage, listBranches, listRepositoryLanguages, getRepositoryReadmeSnippet, createRepository, invalidateProviderCache, syncRepositoryAccess, onOAuthSuccess, onOAuthError, startOAuth

const sourceControlAPI = `  sourceControl: {
    startOAuth: (options: {
      provider: 'github' | 'gitlab'
      orgId: string
      metadata?: Record<string, unknown>
    }) => Promise<{ success: boolean; error?: string }>
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
      metadata?: Record<string, unknown>
    }) => void) => () => void
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => () => void
    listRepositoryOwners: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      bypassCache?: boolean
    }) => Promise<RepositoryOwnerDescriptor[]>
    listRepositories: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      ownerId?: string
      ownerLogin?: string
      ownerKind?: 'user' | 'organization' | 'group'
      search?: string
      bypassCache?: boolean
    }) => Promise<RepositoryDescriptor[]>
    listRepositoriesPage: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      ownerId?: string
      ownerLogin?: string
      ownerKind?: 'user' | 'organization' | 'group'
      search?: string
      page: number
      pageSize: number
      bypassCache?: boolean
    }) => Promise<RepositoryListPageResult>
    listBranches: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repositoryId?: string
      repositoryFullName: string
      defaultBranch?: string
      bypassCache?: boolean
    }) => Promise<RepositoryBranchDescriptor[]>
    listRepositoryLanguages: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repoUrl: string
      repositoryId?: string
      bypassCache?: boolean
    }) => Promise<RepositoryLanguageDescriptor[]>
    getRepositoryReadmeSnippet: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repoUrl: string
      branch?: string
      repositoryId?: string
      bypassCache?: boolean
    }) => Promise<RepositoryReadmeSnippetDescriptor>
    createRepository: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      name: string
      description?: string
      private?: boolean
      autoInit?: boolean
      ownerId?: string
    }) => Promise<RepositoryDescriptor>
    invalidateProviderCache: (options: {
      provider: 'github' | 'gitlab'
      ownerId?: string
      repositoryId?: string
    }) => Promise<{ success: boolean }>
    syncRepositoryAccess: (options: {
      projectId: string
      provider: 'github' | 'gitlab'
      accessToken?: string
    }) => Promise<{ success: boolean; error?: string }>
  }
`;

content = content.replace("  integrations: {", sourceControlAPI + "  integrations: {");

fs.writeFileSync('shared/electronApiTypes.ts', content);
