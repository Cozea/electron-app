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
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization.ts'
import type { TerminalService } from '../services/TerminalService'

// registerOutputTarget is private on TerminalService; cast to any to access it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TerminalServiceAny = TerminalService & Record<string, any>



export function registerTerminalWorkspaceHandlers(
  ipcMain: IpcMain,
  terminalService: TerminalServiceAny,
): void {
  // Re-register terminal:create so that workspaceId is resolved to a real path
  // before being passed to the assistant runtime.
  ipcMain.removeHandler('terminal:create')
  ipcMain.handle('terminal:create', async (event, options: Record<string, unknown>) => {
    const workspaceId = options.workspaceId as string | undefined
    if (workspaceId) {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId,
          laneId: options.laneId as string | undefined,
          operation: 'terminal-create',
          cwd: options.cwd as any
        })
        options = {
          ...options,
          projectRootPath: access.projectRootPath,
          cwd: access.cwd ?? access.projectRootPath,
          gitCwd: access.gitRootPath ?? access.projectRootPath,
        }
      } catch (e) {
        return { success: false, error: String(e) }
      }
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
        try {
          const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'terminal-create' })
          key = access.projectRootPath
        } catch {
          return []
        }
      }
      return terminalService.listTerminalIds(key)
    },
  )
}
