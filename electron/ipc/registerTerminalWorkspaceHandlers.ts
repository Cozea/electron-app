/**
 * Override the `terminal:create` and `terminal:list` IPC handlers that
 * TerminalService.registerIpcHandlers() registers to support the new
 * workspaceId-based API.
 *
 * TerminalService registers these handlers internally using `projectPath`.
 * After the workspace catalog was introduced, callers pass `workspaceId` (a
 * UUID) instead of a raw filesystem path.  This file removes the original
 * handlers and re-registers them with workspaceId → projectPath resolution.
 */

import type { IpcMain } from 'electron'
import * as Effect from 'effect/Effect'
import { WorkspaceCatalog } from '../workspaces/WorkspaceCatalog.ts'
import { waitForWorkspaceCatalogRuntime } from '../workspaces/WorkspaceCatalogRuntime.ts'
import type { TerminalService } from '../services/TerminalService'

// registerOutputTarget is private on TerminalService; cast to any to access it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TerminalServiceAny = TerminalService & Record<string, any>

async function resolveProjectPath(workspaceId: string): Promise<string | null> {
  try {
    const rt = await waitForWorkspaceCatalogRuntime()
    const workspace = await rt.runPromise(
      Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.getById(workspaceId))
    )
    return workspace?.projectRootPath ?? null
  } catch {
    return null
  }
}

export function registerTerminalWorkspaceHandlers(
  ipcMain: IpcMain,
  terminalService: TerminalServiceAny,
): void {
  // Re-register terminal:create so that workspaceId is resolved to a real path
  // before being passed to the assistant runtime.
  ipcMain.removeHandler('terminal:create')
  ipcMain.handle('terminal:create', async (event, options: Record<string, unknown>) => {
    const workspaceId = options.workspaceId as string | undefined
    if (workspaceId && !options.projectPath) {
      const projectPath = await resolveProjectPath(workspaceId)
      options = { ...options, projectPath: projectPath ?? workspaceId }
    }
    terminalService.registerOutputTarget(event.sender)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await terminalService.createTerminal(options as any)
    return { success: result.success, terminalId: result.terminalId, error: result.error }
  })

  // Re-register terminal:list so workspaceId maps to the real path key.
  ipcMain.removeHandler('terminal:list')
  ipcMain.handle(
    'terminal:list',
    async (event, options: { workspaceId?: string; projectPath?: string }) => {
      terminalService.registerOutputTarget(event.sender)
      let key = options.projectPath ?? ''
      if (!key && options.workspaceId) {
        key = (await resolveProjectPath(options.workspaceId)) ?? options.workspaceId
      }
      return terminalService.listTerminalIds(key)
    },
  )
}
