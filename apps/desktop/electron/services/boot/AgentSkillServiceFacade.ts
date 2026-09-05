import { ipcMain } from 'electron'

import { registerLazyAgentSkillHandlers } from '../../ipc/registerLazyAgentSkillHandlers'

interface RealAgentSkillLifecycle {
  ensureBuiltInSkills(): Promise<void>
  migrateManagedBindingsToPrimaryRoot(): Promise<void>
}

let realServicePromise: Promise<RealAgentSkillLifecycle> | null = null

function getRealAgentSkillService(): Promise<RealAgentSkillLifecycle> {
  realServicePromise ??= import('../AgentSkillService').then(
    ({ AgentSkillService }) =>
      AgentSkillService.getInstance() as unknown as RealAgentSkillLifecycle,
  )
  return realServicePromise
}

/**
 * Startup facade for the agent-skill library. IPC registration is tiny; the
 * provider/filesystem implementation and its one-time seed migration load
 * asynchronously after Electron is ready rather than inflating module boot.
 */
export class AgentSkillService {
  private static instance: AgentSkillService | null = null

  static getInstance(): AgentSkillService {
    AgentSkillService.instance ??= new AgentSkillService()
    return AgentSkillService.instance
  }

  registerIpcHandlers(): void {
    registerLazyAgentSkillHandlers(ipcMain)
  }

  async ensureBuiltInSkills(): Promise<void> {
    await (await getRealAgentSkillService()).ensureBuiltInSkills()
  }

  async migrateManagedBindingsToPrimaryRoot(): Promise<void> {
    await (await getRealAgentSkillService()).migrateManagedBindingsToPrimaryRoot()
  }
}
