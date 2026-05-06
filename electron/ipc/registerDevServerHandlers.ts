import type { BrowserWindow, IpcMain } from 'electron'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization.ts'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { resolveCommandWithRuntime } from '../runtime/runtimeResolver'
import type { DevServerStartOptions as SharedDevServerStartOptions, DevServerStartResult } from '../../shared/electronApiTypes'
import { DevServerService } from '../services/DevServerService'
import { createIpcOutputBatcher } from '../lib/ipcOutputBatcher'



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
  const outputBatcher = createIpcOutputBatcher<{
    workspaceId: string
    laneId?: string | null
    output: string
    stream: 'stdout' | 'stderr'
    runId?: string
  }>({
    channel: 'devServer:output',
    keyOf: (payload) => `${payload.workspaceId}:${payload.laneId ?? 'collab'}:${payload.stream}:${payload.runId ?? ''}`,
    merge: (current, next) => ({
      ...current,
      output: current.output + next.output,
      runId: next.runId ?? current.runId,
    }),
  })

  ipcMain.handle(
    'devServer:start',
    async (
      _event,
      {
        workspaceId,
        laneId,
        command,
        bootstrapCommand,
        port,
        sessionKey,
        framework,
        terminalId,
        runId,
      }: SharedDevServerStartOptions
    ): Promise<DevServerStartResult> => {
      // 1. Resolve bootstrap/install command first when present.
      const trimmedBootstrapCommand =
        typeof bootstrapCommand === 'string' && bootstrapCommand.trim().length > 0
          ? bootstrapCommand.trim()
          : null
      let finalBootstrapCommand: string | null = null

      if (trimmedBootstrapCommand) {
        const resolvedBootstrap = resolveCommandWithRuntime(trimmedBootstrapCommand)
        if (resolvedBootstrap.status === 'failed') {
          return {
            success: false,
            error: resolvedBootstrap.error || 'Bootstrap command is not supported in this release.',
          }
        }
        if (resolvedBootstrap.status === 'needs_user_approval') {
          return {
            success: false,
            error:
              resolvedBootstrap.approvalPayload?.reason ||
              resolvedBootstrap.error ||
              'Bootstrap command requires user approval before execution.',
          }
        }
        if (resolvedBootstrap.runtime) {
          const ensuredBootstrapRuntime = await ensureRuntimeInstalled(resolvedBootstrap.runtime)
          if (!ensuredBootstrapRuntime.success) {
            return {
              success: false,
              error: ensuredBootstrapRuntime.error || 'Failed to install required bootstrap runtime.',
            }
          }
        }
        finalBootstrapCommand =
          resolvedBootstrap.status === 'completed' && resolvedBootstrap.command
            ? resolvedBootstrap.command
            : trimmedBootstrapCommand
      }

      // 2. Resolve dev server command with runtime wrapper if necessary (e.g., node versions)
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

      try {
        await resolveAuthorizedWorkspaceAccess({
          workspaceId,
          laneId,
          operation: 'dev-server-start',
        })
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }

      const resolvedRunId = typeof runId === 'string' && runId.trim().length > 0
        ? runId.trim()
        : createRunId()

      return await service.start({
        workspaceId,
        laneId,
        command: finalCommand,
        bootstrapCommand: finalBootstrapCommand,
        preferredPort: port,
        sessionKey,
        framework,
        terminalId,
        runId: resolvedRunId,
        onOutput: (output, stream) => {
          const mainWindow = deps.getMainWindow()
          if (!mainWindow || mainWindow.isDestroyed()) {
            return
          }

          outputBatcher.enqueue(mainWindow.webContents, {
            workspaceId,
            laneId: laneId ?? null,
            output,
            stream,
            runId: resolvedRunId,
          })
        },
        onExit: (code) => {
          const mainWindow = deps.getMainWindow()
          if (!mainWindow || mainWindow.isDestroyed()) {
            return
          }

          outputBatcher.flush(mainWindow.webContents)
          mainWindow.webContents.send('devServer:exit', {
            workspaceId,
            laneId: laneId ?? null,
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
      { workspaceId, laneId }: { workspaceId: string; laneId?: string | null }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        await resolveAuthorizedWorkspaceAccess({ workspaceId, laneId, operation: 'dev-server-start' })
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      return await service.stop(workspaceId, laneId)
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
    async (_event, { workspaceId, laneId }: { workspaceId: string; laneId?: string | null }): Promise<boolean> => {
      try {
        await resolveAuthorizedWorkspaceAccess({ workspaceId, laneId, operation: 'dev-server-start' })
        return service.isRunning(workspaceId, laneId)
      } catch {
        return false
      }
    }
  )
}
