import type { IpcMain, WebContents } from 'electron'

import type {
  AgentSkillDraft,
  AgentSkillProvider,
  AgentSkillSetupPack,
} from '../../../../shared/electronApiTypes'

interface LazyAgentSkillService {
  list(): unknown
  save(draft: AgentSkillDraft): Promise<unknown>
  setProviderEnabled(options: {
    skillId: string
    provider: AgentSkillProvider
    enabled: boolean
  }): Promise<unknown>
  setEnabled(options: { skillId: string; enabled: boolean }): Promise<unknown>
  update(skillId: string): Promise<unknown>
  install(skillId: string): Promise<unknown>
  saveBuild(options: { buildId?: string; name: string; skillIds: string[] }): Promise<unknown>
  deleteBuild(buildId: string): Promise<unknown>
  applyBuild(buildId: string): Promise<unknown>
  copyToLibrary(skillId: string): Promise<unknown>
  remove(skillId: string): Promise<unknown>
  importDirectory(sender: WebContents): Promise<unknown>
  openSetupPack(sender: WebContents): Promise<unknown>
  copyFromSetupPack(pack: AgentSkillSetupPack, packSkillId: string): Promise<unknown>
  exportSetupPack(
    sender: WebContents,
    options: { setupName: string; authorName: string },
  ): Promise<unknown>
}

let servicePromise: Promise<LazyAgentSkillService> | null = null

function getAgentSkillService(): Promise<LazyAgentSkillService> {
  servicePromise ??= import('../services/AgentSkillService').then(
    ({ AgentSkillService }) =>
      AgentSkillService.getInstance() as unknown as LazyAgentSkillService,
  )
  return servicePromise
}

export function registerLazyAgentSkillHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('agentSkills:list', async () => (await getAgentSkillService()).list())
  ipcMain.handle('agentSkills:save', async (_event, draft: AgentSkillDraft) =>
    (await getAgentSkillService()).save(draft),
  )
  ipcMain.handle(
    'agentSkills:setProviderEnabled',
    async (
      _event,
      options: { skillId: string; provider: AgentSkillProvider; enabled: boolean },
    ) => (await getAgentSkillService()).setProviderEnabled(options),
  )
  ipcMain.handle(
    'agentSkills:setEnabled',
    async (_event, options: { skillId: string; enabled: boolean }) =>
      (await getAgentSkillService()).setEnabled(options),
  )
  ipcMain.handle('agentSkills:update', async (_event, options: { skillId: string }) =>
    (await getAgentSkillService()).update(options.skillId),
  )
  ipcMain.handle('agentSkills:install', async (_event, options: { skillId: string }) =>
    (await getAgentSkillService()).install(options.skillId),
  )
  ipcMain.handle(
    'agentSkills:saveBuild',
    async (_event, options: { buildId?: string; name: string; skillIds: string[] }) =>
      (await getAgentSkillService()).saveBuild(options),
  )
  ipcMain.handle('agentSkills:deleteBuild', async (_event, options: { buildId: string }) =>
    (await getAgentSkillService()).deleteBuild(options.buildId),
  )
  ipcMain.handle('agentSkills:applyBuild', async (_event, options: { buildId: string }) =>
    (await getAgentSkillService()).applyBuild(options.buildId),
  )
  ipcMain.handle('agentSkills:copyToLibrary', async (_event, options: { skillId: string }) =>
    (await getAgentSkillService()).copyToLibrary(options.skillId),
  )
  ipcMain.handle('agentSkills:remove', async (_event, options: { skillId: string }) =>
    (await getAgentSkillService()).remove(options.skillId),
  )
  ipcMain.handle('agentSkills:importDirectory', async (event) =>
    (await getAgentSkillService()).importDirectory(event.sender),
  )
  ipcMain.handle('agentSkills:openSetupPack', async (event) =>
    (await getAgentSkillService()).openSetupPack(event.sender),
  )
  ipcMain.handle(
    'agentSkills:copyFromSetupPack',
    async (_event, options: { pack: AgentSkillSetupPack; packSkillId: string }) =>
      (await getAgentSkillService()).copyFromSetupPack(options.pack, options.packSkillId),
  )
  ipcMain.handle(
    'agentSkills:exportSetupPack',
    async (event, options: { setupName: string; authorName: string }) =>
      (await getAgentSkillService()).exportSetupPack(event.sender, options),
  )
}
