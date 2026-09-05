import type { IpcMain, WebContents } from 'electron'

import type {
  AgentToolId,
  AgentToolLoginStartResult,
  AgentToolPrepareResult,
  AgentToolStatus,
} from '../../../../shared/electronApiTypes'

interface LazyAgentToolService {
  getStatus(toolId: AgentToolId): Promise<AgentToolStatus>
  prepare(toolId: AgentToolId): Promise<AgentToolPrepareResult>
  startLogin(toolId: AgentToolId, sender: WebContents): Promise<AgentToolLoginStartResult>
  loginInput(sessionId: string, value: string): boolean
  cancelLogin(sessionId: string): boolean
}

let servicePromise: Promise<LazyAgentToolService> | null = null

function getAgentToolService(): Promise<LazyAgentToolService> {
  servicePromise ??= import('../services/AgentToolService').then(
    ({ AgentToolService }) =>
      AgentToolService.getInstance() as unknown as LazyAgentToolService,
  )
  return servicePromise
}

/**
 * Agent CLI discovery shells out to login shells and touches provider state.
 * Register its IPC names eagerly while keeping the implementation cold until
 * the Tooling UI or a remediation action actually needs it.
 */
export function registerLazyAgentToolHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('agentTools:getStatus', async (_event, options: { toolId: AgentToolId }) => {
    return (await getAgentToolService()).getStatus(options.toolId)
  })

  ipcMain.handle('agentTools:prepare', async (_event, options: { toolId: AgentToolId }) => {
    return (await getAgentToolService()).prepare(options.toolId)
  })

  ipcMain.handle('agentTools:loginStart', async (event, options: { toolId: AgentToolId }) => {
    return (await getAgentToolService()).startLogin(options.toolId, event.sender)
  })

  ipcMain.handle(
    'agentTools:loginInput',
    async (_event, options: { sessionId: string; value: string }) => ({
      success: (await getAgentToolService()).loginInput(options.sessionId, options.value),
    }),
  )

  ipcMain.handle('agentTools:loginCancel', async (_event, options: { sessionId: string }) => ({
    success: (await getAgentToolService()).cancelLogin(options.sessionId),
  }))
}
