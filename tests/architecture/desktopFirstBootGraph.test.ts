import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('desktop-first boot graph', () => {
  it('keeps common route chunk waits invisible while preserving token-bound invite loading', () => {
    const routeLoading = read('apps/desktop/src/router/RouteLoading.tsx')

    expect(routeLoading).toContain('VISIBLE_BLOCKING_ROUTE_LOADERS')
    expect(routeLoading).toContain('"routeLoading.projectInvite"')
    expect(routeLoading).toContain('return null')
    expect(routeLoading).not.toContain('"routeLoading.workbench",')
    expect(routeLoading).not.toContain('"routeLoading.tasks",')
    expect(routeLoading).not.toContain('"routeLoading.account",')
    expect(routeLoading).not.toContain('"routeLoading.appearance",')
  })

  it('aliases cold main-process services to startup-safe facades', () => {
    const config = read('apps/desktop/electron.vite.config.ts')

    expect(config).toContain("find: './services/IntegrationService'")
    expect(config).toContain('IntegrationServiceFacade.ts')
    expect(config).toContain("find: './services/AgentToolService'")
    expect(config).toContain('AgentToolServiceFacade.ts')
    expect(config).toContain("find: './services/AgentSkillService'")
    expect(config).toContain('AgentSkillServiceFacade.ts')
    expect(config).toContain('alias: [...mainBootAliases, ...sharedAliases]')
  })

  it('registers cold IPC names eagerly but imports implementations on demand', () => {
    const integrations = read('apps/desktop/electron/ipc/registerLazyIntegrationHandlers.ts')
    const agentTools = read('apps/desktop/electron/ipc/registerLazyAgentToolHandlers.ts')
    const agentSkills = read('apps/desktop/electron/ipc/registerLazyAgentSkillHandlers.ts')
    const integrationFacade = read('apps/desktop/electron/services/boot/IntegrationServiceFacade.ts')
    const agentSkillFacade = read('apps/desktop/electron/services/boot/AgentSkillServiceFacade.ts')

    expect(integrations).toContain("ipcMain.handle('integrations:isEncryptionAvailable'")
    expect(integrations).toContain("await import('../integrationKeys')")
    expect(integrations).toContain("await import('../services/repositoryManagementService')")

    expect(agentTools).toContain("ipcMain.handle('agentTools:getStatus'")
    expect(agentTools).toContain("import('../services/AgentToolService')")

    expect(agentSkills).toContain("ipcMain.handle('agentSkills:list'")
    expect(agentSkills).toContain("import('../services/AgentSkillService')")

    expect(integrationFacade).toContain("await import('../../oauthHandler')")
    expect(agentSkillFacade).toContain("import('../AgentSkillService')")
  })
})
