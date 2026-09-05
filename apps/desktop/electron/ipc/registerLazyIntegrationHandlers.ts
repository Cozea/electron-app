import type { IpcMain } from 'electron'

interface RepositoryAccessOptions {
  provider: 'github' | 'gitlab'
  repoUrl: string
  encryptedCredentials?: string
  keyId?: string
  action: 'grant' | 'revoke'
  role: 'project_manager' | 'developer' | 'designer' | 'viewer'
  inviteEmail?: string
  providerAccountHandle?: string
}

interface RepositoryListOptions {
  provider: 'github' | 'gitlab'
  encryptedCredentials?: string
  keyId?: string
  providerHost?: string
  ownerId?: string
  ownerLogin?: string
  ownerKind?: 'user' | 'organization' | 'group'
  search?: string
}

interface RepositoryCreateOptions extends Omit<RepositoryListOptions, 'search'> {
  name: string
  private: boolean
}

interface IntegrationToolRunOptions {
  toolName: string
  args: string[]
  workspaceId: string
  laneId: string
  cwd?: { kind: 'projectRoot' } | { kind: 'relative'; path: string }
  encryptedCredentials: string
  keyId: string
  timeout?: number
}

/**
 * Keep cold integration/repository tooling out of Electron's startup graph.
 * The IPC surface is registered synchronously, but implementation modules are
 * imported only when a renderer actually invokes that capability.
 */
export function registerLazyIntegrationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('integrations:isEncryptionAvailable', async () => {
    const keys = await import('../integrationKeys')
    return keys.isEncryptionAvailable()
  })

  ipcMain.handle('integrations:generateKey', async () => {
    try {
      const keys = await import('../integrationKeys')
      const { keyId, keyData } = keys.generateEncryptionKey()
      return { success: true, keyId, keyData }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate key',
      }
    }
  })

  ipcMain.handle('integrations:storeKey', async (_event, options: { keyId: string; keyData: string }) => {
    const keys = await import('../integrationKeys')
    return keys.storeEncryptionKey(options.keyId, options.keyData)
  })

  ipcMain.handle('integrations:deleteKey', async (_event, options: { keyId: string }) => {
    const keys = await import('../integrationKeys')
    return keys.deleteEncryptionKey(options.keyId)
  })

  ipcMain.handle('integrations:keyExists', async (_event, options: { keyId: string }) => {
    const keys = await import('../integrationKeys')
    return keys.keyExists(options.keyId)
  })

  ipcMain.handle(
    'integrations:encrypt',
    async (_event, options: { credentials: Record<string, unknown>; keyId: string }) => {
      const [keys, crypto] = await Promise.all([
        import('../integrationKeys'),
        import('../integrationCrypto'),
      ])
      const keyResult = keys.getEncryptionKey(options.keyId)
      if (!keyResult.success || !keyResult.keyData) {
        return {
          success: false,
          error: keyResult.error || 'Failed to retrieve encryption key',
        }
      }
      return crypto.encryptCredentials(options.credentials, keyResult.keyData)
    },
  )

  ipcMain.handle(
    'integrations:startOAuth',
    async (
      _event,
      options: { provider: string; orgId: string; metadata?: Record<string, unknown> },
    ) => {
      const { startOAuthFlow } = await import('../oauthHandler')
      return startOAuthFlow(
        options.provider,
        options.orgId,
        'cozea://oauth/callback',
        options.metadata,
      )
    },
  )

  ipcMain.handle(
    'integrations:syncRepositoryAccess',
    async (_event, options: RepositoryAccessOptions) => {
      const { syncRepositoryAccess } = await import('../services/repositoryAccessService')
      return syncRepositoryAccess(options)
    },
  )

  ipcMain.handle(
    'integrations:listRepositoryOwners',
    async (_event, options: Omit<RepositoryListOptions, 'ownerId' | 'ownerLogin' | 'ownerKind' | 'search'>) => {
      const { listRepositoryOwners } = await import('../services/repositoryManagementService')
      return listRepositoryOwners(options)
    },
  )

  ipcMain.handle('integrations:listRepositories', async (_event, options: RepositoryListOptions) => {
    const { listRepositories } = await import('../services/repositoryManagementService')
    return listRepositories(options)
  })

  ipcMain.handle('integrations:createRepository', async (_event, options: RepositoryCreateOptions) => {
    const { createRepository } = await import('../services/repositoryManagementService')
    return createRepository(options)
  })

  ipcMain.handle('integrations:runTool', async (_event, options: IntegrationToolRunOptions) => {
    const { runIntegrationTool } = await import('../integrationToolExecutor')
    return runIntegrationTool(options)
  })

  ipcMain.handle('integrations:isToolAvailable', async (_event, options: { toolName: string }) => {
    const { isIntegrationTool } = await import('../integrationToolExecutor')
    return isIntegrationTool(options.toolName)
  })

  ipcMain.handle('integrations:getToolDefinition', async (_event, options: { toolName: string }) => {
    const { getIntegrationToolDefinition } = await import('../integrationToolExecutor')
    const definition = getIntegrationToolDefinition(options.toolName)
    if (!definition) return null
    return {
      provider: definition.provider,
      name: definition.name,
      displayName: definition.displayName,
      command: definition.command,
      description: definition.description,
    }
  })

  ipcMain.handle('integrations:listTools', async () => {
    const { INTEGRATION_TOOLS } = await import('../integrationToolExecutor')
    return INTEGRATION_TOOLS.map((tool) => ({
      provider: tool.provider,
      name: tool.name,
      displayName: tool.displayName,
      command: tool.command,
      description: tool.description,
    }))
  })
}
