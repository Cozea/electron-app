import type { BrowserWindow, IpcMain } from 'electron'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { resolveCommandWithRuntime } from '../runtime/runtimeResolver'
import type { DevServerStartResult } from '../../shared/electronApiTypes'
import { DevServerService } from '../services/DevServerService'

interface RegisterDevServerHandlersDeps {
  getMainWindow: () => BrowserWindow | null
}

function createRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `devsrv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// Start, stop, and manage per-project dev servers.
export function registerDevServerHandlers(
  ipcMain: IpcMain,
  deps: RegisterDevServerHandlersDeps
): void {
  const service = DevServerService.getInstance()

  ipcMain.handle(
    'devServer:start',
    async (
      _event,
      {
        projectPath,
        command,
        port,
        runId,
      }: {
        projectPath: string
        command: string
        port: number
        cols?: number
        rows?: number
        runId?: string
      }
    ): Promise<DevServerStartResult> => {
      // 1. Resolve command with runtime wrapper if necessary (e.g., node versions)
      const resolved = resolveCommandWithRuntime(command)
      if (resolved.status === 'failed') {
        return { success: false, error: resolved.error || 'Command is not supported in this release.' }
      }
      if (resolved.status === 'needs_user_approval') {
        return {
          success: false,
          error: resolved.approvalPayload?.reason || resolved.error || 'Command requires user approval before execution.',
        }
      }
      if (resolved.runtime) {
        const ensured = await ensureRuntimeInstalled(resolved.runtime)
        if (!ensured.success) {
          return { success: false, error: ensured.error || 'Failed to install required runtime.' }
        }
      }

      const finalCommand = resolved.status === 'completed' && resolved.command 
        ? resolved.command 
        : command

      const resolvedRunId = typeof runId === 'string' && runId.trim().length > 0
        ? runId.trim()
        : createRunId()

      return await service.start({
        projectPath,
        command: finalCommand,
        preferredPort: port,
        runId: resolvedRunId,
        onOutput: (output, stream) => {
          deps.getMainWindow()?.webContents.send('devServer:output', {
            projectPath,
            output,
            stream,
            runId: resolvedRunId,
          })
        },
        onExit: (code) => {
          deps.getMainWindow()?.webContents.send('devServer:exit', {
            projectPath,
            code,
            runId: resolvedRunId,
          })
        },
      })
    }
  )

  ipcMain.handle(
    'devServer:stop',
    async (
      _event,
      { projectPath }: { projectPath: string }
    ): Promise<{ success: boolean; error?: string }> => {
      return await service.stop(projectPath)
    }
  )

  ipcMain.handle(
    'devServer:resize',
    (): { success: boolean } => {
      // No-op for process-based server
      return { success: true }
    }
  )

  ipcMain.handle(
    'devServer:isRunning',
    (_event, { projectPath }: { projectPath: string }): boolean => {
      return service.isRunning(projectPath)
    }
  )
}

