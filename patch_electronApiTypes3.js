const fs = require('fs');

let content = fs.readFileSync('shared/electronApiTypes.ts', 'utf8');

content = content.replace(
  `    syncRepositoryAccess: (options: {
      projectId: string
      provider: 'github' | 'gitlab'
      repoUrl: string
      accessToken?: string
    }) => Promise<{ success: boolean; error?: string; accessState?: string; externalInvitationId?: string; providerAccountHandle?: string }>`,
  `    syncRepositoryAccess: (options: {
      projectId: string
      provider: 'github' | 'gitlab'
      repoUrl: string
      providerHost?: string
      accessToken?: string
    }) => Promise<{ success: boolean; error?: string; accessState?: 'pending' | 'error' | 'revoked' | 'granted' | 'needs_identity' | 'manual_required'; externalInvitationId?: string; providerAccountHandle?: string }>`
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
      ownerLogin?: string
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
      ownerKind?: 'user' | 'organization' | 'group'
    }) => Promise<RepositoryDescriptor>`
);

fs.writeFileSync('shared/electronApiTypes.ts', content);
