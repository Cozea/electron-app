import type { IpcMain } from 'electron'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization.ts'
import type {
  DevCommandSuggestion,
  ProjectRuntimeProfile,
  RuntimeHealth,
  RuntimeKind,
} from '../runtime/runtimeTypes'
import { loadCapabilityCatalog } from '../runtime/capabilityCatalog'
import { resolveCommandIntent } from '../runtime/commandResolver'
import { buildDevCommandCandidates, buildDevCommandFingerprint } from '../runtime/devCommandCandidates'
import { LocalAutomationResolverService } from '../runtime/LocalAutomationResolverService'
import { collectProjectEvidence } from '../runtime/projectEvidence'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimeTarget, resolveCommandWithRuntime, resolveRuntimeHealth } from '../runtime/runtimeResolver'

const TRACKED_RUNTIMES: RuntimeKind[] = [
  'node',
  'npm',
  'corepack',
  'pnpm',
  'yarn',
  'bun',
  'python',
  'rust',
  'go',
]

async function buildSuggestions(
  workspaceId: string,
  projectPath: string,
): Promise<ProjectRuntimeProfile> {
  const evidence = collectProjectEvidence(projectPath)
  const catalog = loadCapabilityCatalog()
  const runtimes: RuntimeHealth[] = TRACKED_RUNTIMES.map((runtime) => resolveRuntimeHealth(runtime))
  const candidates = buildDevCommandCandidates({ evidence, catalog, runtimeHealth: runtimes })
  const resolution = await LocalAutomationResolverService.getInstance().rankDevCommands({
    workspaceId,
    fingerprint: buildDevCommandFingerprint(evidence, candidates),
    candidates,
  })
  const scoresById = new Map(resolution.scores.map((score) => [score.candidateId, score.score]))
  const suggestions: DevCommandSuggestion[] = candidates
    .map((candidate) => ({
      command: candidate.command,
      runtime: candidate.runtime,
      confidence: scoresById.get(candidate.id) ?? candidate.confidence,
      reason: candidate.reason,
    }))
    .sort((left, right) => right.confidence - left.confidence)

  return {
    runtimes,
    devServer: {
      suggestions,
      selectedCommand: resolution.selected?.command,
      requiresUserSelection: !resolution.selected,
    },
    evidence,
  }
}

export function registerRuntimeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('runtime:getProjectCapabilities', async (_event, options: { workspaceId: string }) => {
    try {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'runtime-detect' })
      return await buildSuggestions(options.workspaceId, access.projectRootPath)
    } catch {
      return {
        runtimes: [],
        devServer: { suggestions: [], requiresUserSelection: true },
        evidence: { files: [], scripts: [], lockfiles: [], packageScripts: {}, readmeCommands: [] },
      }
    }
  })

  ipcMain.handle('runtime:detectProjectRuntime', async (_event, options: { workspaceId: string }) => {
    try {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'runtime-detect' })
      return await buildSuggestions(options.workspaceId, access.projectRootPath)
    } catch {
      return {
        runtimes: [],
        devServer: { suggestions: [], requiresUserSelection: true },
        evidence: { files: [], scripts: [], lockfiles: [], packageScripts: {}, readmeCommands: [] },
      }
    }
  })

  ipcMain.handle('runtime:resolveCommand', async (_event, options: { workspaceId: string; command: string }) => {
    return resolveCommandWithRuntime(options.command)
  })

  ipcMain.handle('runtime:ensureCommandRuntime', async (_event, options: { workspaceId: string; command: string }) => {
    const intent = resolveCommandIntent(options.command)
    if (intent.classification !== 'supported' || intent.runtime === 'unknown') {
      return {
        success: false,
        command: options.command,
        error: intent.reason,
      }
    }
    return ensureRuntimeInstalled(intent.runtime)
  })

  ipcMain.handle('runtime:ensureForCommand', async (_event, options: { workspaceId: string; command: string }) => {
    const intent = resolveCommandIntent(options.command)
    if (intent.classification !== 'supported' || intent.runtime === 'unknown') {
      return {
        success: false,
        command: options.command,
        error: intent.reason,
      }
    }
    return ensureRuntimeInstalled(intent.runtime)
  })

  ipcMain.handle(
    'runtime:ensureRuntime',
    async (
      _event,
      options: {
        runtime: RuntimeKind
        target?: string
        cleanBrokenLocalFiles?: boolean
        forceReinstall?: boolean
      }
    ) => {
      return ensureRuntimeInstalled(options.runtime, options.target ?? getRuntimeTarget(), {
        cleanBrokenLocalFiles: options.cleanBrokenLocalFiles,
        forceReinstall: options.forceReinstall,
      })
    }
  )

  ipcMain.handle('runtime:getRuntimeStatus', async (_event, _options?: { workspaceId?: string }) => {
    return {
      target: getRuntimeTarget(),
      runtimes: TRACKED_RUNTIMES.map((runtime) => resolveRuntimeHealth(runtime)),
    }
  })
}
