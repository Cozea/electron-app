import { ipcMain } from 'electron'

import { registerLazyIntegrationHandlers } from '../../ipc/registerLazyIntegrationHandlers'

interface IntegrationOAuthResult {
  success: boolean
  provider: string
  error?: string
}

/**
 * Startup-safe facade for the API that main.ts already consumes. The Vite main
 * build aliases the legacy IntegrationService import to this file, preserving
 * the call sites while keeping repository/OAuth/tool implementations outside
 * the boot chunk.
 */
export class IntegrationService {
  private static instance: IntegrationService | null = null

  static getInstance(): IntegrationService {
    IntegrationService.instance ??= new IntegrationService()
    return IntegrationService.instance
  }

  registerIpcHandlers(): void {
    registerLazyIntegrationHandlers(ipcMain)
  }

  async handleOAuthCallback(url: string): Promise<IntegrationOAuthResult> {
    const { handleOAuthCallback } = await import('../../oauthHandler')
    return handleOAuthCallback(url)
  }
}
