import { ipcMain } from 'electron'
import * as integrationKeys from '../integrationKeys'
import * as integrationCrypto from '../integrationCrypto'
import { startOAuthFlow, handleOAuthCallback } from '../oauthHandler'
import { runIntegrationTool, isIntegrationTool, getIntegrationToolDefinition, INTEGRATION_TOOLS } from '../integrationToolExecutor'
import { syncRepositoryAccess } from './repositoryAccessService'
import {
    listRepositoryOwners,
    listRepositories,
    createRepository,
} from './repositoryManagementService'

export class IntegrationService {
    private static instance: IntegrationService

    private constructor() { }

    static getInstance(): IntegrationService {
        if (!IntegrationService.instance) {
            IntegrationService.instance = new IntegrationService()
        }
        return IntegrationService.instance
    }

    // Exposed for Main to call when protocol URL is received
    async handleOAuthCallback(url: string) {
        return handleOAuthCallback(url)
    }

    registerIpcHandlers(): void {
        // Key Management
        ipcMain.handle('integrations:isEncryptionAvailable', () => {
            return integrationKeys.isEncryptionAvailable()
        })

        ipcMain.handle('integrations:generateKey', () => {
            try {
                const { keyId, keyData } = integrationKeys.generateEncryptionKey()
                return { success: true, keyId, keyData }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : 'Failed to generate key' }
            }
        })

        ipcMain.handle('integrations:storeKey', (_event, options: { keyId: string; keyData: string }) => {
            return integrationKeys.storeEncryptionKey(options.keyId, options.keyData)
        })

        ipcMain.handle('integrations:deleteKey', (_event, options: { keyId: string }) => {
            return integrationKeys.deleteEncryptionKey(options.keyId)
        })

        ipcMain.handle('integrations:keyExists', (_event, options: { keyId: string }) => {
            return integrationKeys.keyExists(options.keyId)
        })

        // Encryption/Decryption
        ipcMain.handle('integrations:encrypt', async (_event, options: { credentials: Record<string, unknown>; keyId: string }) => {
            const keyResult = integrationKeys.getEncryptionKey(options.keyId)
            if (!keyResult.success || !keyResult.keyData) {
                return { success: false, error: keyResult.error || 'Failed to retrieve encryption key' }
            }
            return integrationCrypto.encryptCredentials(options.credentials, keyResult.keyData)
        })

        // OAuth
        ipcMain.handle('integrations:startOAuth', async (
            _event,
            options: { provider: string; orgId: string; metadata?: Record<string, unknown> }
        ) => {
            return startOAuthFlow(options.provider, options.orgId, 'cozea://oauth/callback', options.metadata)
        })

        ipcMain.handle('integrations:syncRepositoryAccess', async (
            _event,
            options: {
                provider: 'github' | 'gitlab'
                repoUrl: string
                encryptedCredentials?: string
                keyId?: string
                action: 'grant' | 'revoke'
                role: 'project_manager' | 'developer' | 'designer' | 'viewer'
                inviteEmail?: string
                providerAccountHandle?: string
            }
        ) => {
            return syncRepositoryAccess(options)
        })

        ipcMain.handle('integrations:listRepositoryOwners', async (
            _event,
            options: {
                provider: 'github' | 'gitlab'
                encryptedCredentials?: string
                keyId?: string
                providerHost?: string
            }
        ) => {
            return listRepositoryOwners(options)
        })

        ipcMain.handle('integrations:listRepositories', async (
            _event,
            options: {
                provider: 'github' | 'gitlab'
                encryptedCredentials?: string
                keyId?: string
                providerHost?: string
                ownerId?: string
                ownerLogin?: string
                ownerKind?: 'user' | 'organization' | 'group'
                search?: string
            }
        ) => {
            return listRepositories(options)
        })

        ipcMain.handle('integrations:createRepository', async (
            _event,
            options: {
                provider: 'github' | 'gitlab'
                encryptedCredentials?: string
                keyId?: string
                providerHost?: string
                ownerId?: string
                ownerLogin?: string
                ownerKind?: 'user' | 'organization' | 'group'
                name: string
                private: boolean
            }
        ) => {
            return createRepository(options)
        })

        // Tool Execution
        ipcMain.handle('integrations:runTool', async (_event, options: {
            toolName: string
            args: string[]
            workspaceId: string
            laneId: string
            cwd?: { kind: 'projectRoot' } | { kind: 'relative'; path: string }
            encryptedCredentials: string
            keyId: string
            timeout?: number
        }) => {
            return runIntegrationTool(options)
        })

        ipcMain.handle('integrations:isToolAvailable', (_event, options: { toolName: string }) => {
            return isIntegrationTool(options.toolName)
        })

        ipcMain.handle('integrations:getToolDefinition', (_event, options: { toolName: string }) => {
            const def = getIntegrationToolDefinition(options.toolName)
            if (!def) return null
            return {
                provider: def.provider,
                name: def.name,
                displayName: def.displayName,
                command: def.command,
                description: def.description,
            }
        })

        ipcMain.handle('integrations:listTools', () => {
            return INTEGRATION_TOOLS.map((t) => ({
                provider: t.provider,
                name: t.name,
                displayName: t.displayName,
                command: t.command,
                description: t.description,
            }))
        })
    }
}
