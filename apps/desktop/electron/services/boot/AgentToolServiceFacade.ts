import { ipcMain } from 'electron'

import { registerLazyAgentToolHandlers } from '../../ipc/registerLazyAgentToolHandlers'

/**
 * Startup-safe facade for main.ts. Agent CLI discovery and login tooling stays
 * out of the Electron boot chunk until a renderer actually asks for it.
 */
export class AgentToolService {
  private static instance: AgentToolService | null = null

  static getInstance(): AgentToolService {
    AgentToolService.instance ??= new AgentToolService()
    return AgentToolService.instance
  }

  registerIpcHandlers(): void {
    registerLazyAgentToolHandlers(ipcMain)
  }
}
