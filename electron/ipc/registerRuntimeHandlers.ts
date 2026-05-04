import type { IpcMain } from 'electron'
import * as Effect from 'effect/Effect'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization.ts'
import type { DevCommandSuggestion, ProjectRuntimeProfile, RuntimeHealth, RuntimeKind } from '../runtime/runtimeTypes'
import { loadCapabilityCatalog } from '../runtime/capabilityCatalog'
import { resolveCommandIntent } from '../runtime/commandResolver'
import { collectProjectEvidence } from '../runtime/projectEvidence'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimeTarget, resolveCommandWithRuntime, resolveRuntimeHealth } from '../runtime/runtimeResolver'


}

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

function buildSuggestions(projectPath: string): ProjectRuntimeProfile {
  const evidence = collectProjectEvidence(projectPath)
  const catalog = loadCapabilityCatalog()
  const suggestions: DevCommandSuggestion[] = []

  for (const rule of catalog.rules) {
    const fileMatch = (rule.matchAnyFile ?? []).some((candidate) => evidence.files.includes(candidate))
    const scriptMatch = (rule.matchAnyScript ?? []).some((script) => evidence.scripts.includes(script))
    if (!fileMatch && !scriptMatch) continue

    for (const suggestion of rule.suggestedCommands) {
      suggestions.push({
        command: suggestion.command,
        runtime: suggestion.runtime,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
      })
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence)

  const selected = suggestions.find((suggestion) => suggestion.confidence >= 0.8)?.command
  const runtimes: RuntimeHealth[] = TRACKED_RUNTIMES.map((runtime) => resolveRuntimeHealth(runtime))

  return {
    runtimes,
    devServer: {
      suggestions,
      selectedCommand: selected,
      requiresUserSelection: !selected,
    },
    evidence,
  }
}

export function registerRuntimeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('runtime:getProjectCapabilities', async (_event, options: { workspaceId: string }) => {
    try {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'runtime-detect' })
      return buildSuggestions(access.projectRootPath)
    } catch (e) {
      return {
        runtimes: [],
        devServer: { suggestions: [], requiresUserSelection: true },
        evidence: { files: [], scripts: [], lockfiles: [] }
      }
    }
  })

  ipcMain.handle('runtime:detectProjectRuntime', async (_event, options: { workspaceId: string }) => {
    try {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'runtime-detect' })
      return buildSuggestions(access.projectRootPath)
    } catch (e) {
      return {
        runtimes: [],
        devServer: { suggestions: [], requiresUserSelection: true },
        evidence: { files: [], scripts: [], lockfiles: [] }
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

  ipcMain.handle('runtime:getRuntimeStatus', async (_event, _options?: { projectPath?: string }) => {
    return {
      target: getRuntimeTarget(),
      runtimes: TRACKED_RUNTIMES.map((runtime) => resolveRuntimeHealth(runtime)),
    }
  })
}
