const fs = require('fs');

let content = fs.readFileSync('shared/electronApiTypes.ts', 'utf8');

content = content.replace(
  "startOAuth: (options: { provider: string; orgId: string }) => Promise<{ success: boolean; error?: string }>",
  "startOAuth: (options: { provider: string; orgId: string; metadata?: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>"
);

content = content.replace(
  `    invalidateProviderCache: (options: {
      provider: 'github' | 'gitlab'
      ownerId?: string
      repositoryId?: string
    }) => Promise<{ success: boolean }>`,
  `    invalidateProviderCache: (options?: {
      provider?: 'github' | 'gitlab'
      ownerId?: string
      repositoryId?: string
    }) => Promise<{ success: boolean }>`
);

content = content.replace(
  `    createRepository: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      name: string
      description?: string
      private?: boolean
      autoInit?: boolean
      ownerId?: string
    }) => Promise<RepositoryDescriptor>`,
  `    createRepository: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      name: string
      description?: string
      private?: boolean
      autoInit?: boolean
      ownerId?: string
      ownerLogin?: string
    }) => Promise<RepositoryDescriptor>`
);

content = content.replace(
  `    syncRepositoryAccess: (options: {
      projectId: string
      provider: 'github' | 'gitlab'
      accessToken?: string
    }) => Promise<{ success: boolean; error?: string }>`,
  `    syncRepositoryAccess: (options: {
      projectId: string
      provider: 'github' | 'gitlab'
      repoUrl: string
      accessToken?: string
    }) => Promise<{ success: boolean; error?: string; accessState?: string; externalInvitationId?: string; providerAccountHandle?: string }>`
);

fs.writeFileSync('shared/electronApiTypes.ts', content);
