import type { BrowserWindow, IpcMain } from 'electron'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization.ts'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { resolveCommandWithRuntime } from '../runtime/runtimeResolver'
import type { DevServerStartOptions as SharedDevServerStartOptions, DevServerStartResult } from '../../../../shared/electronApiTypes'
import { DevServerService } from '../services/DevServerService'
import { createIpcOutputBatcher } from '../lib/ipcOutputBatcher'
import { LocalAutomationResolverService } from '../runtime/LocalAutomationResolverService'



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

  const emitState = (workspaceId: string, laneId?: string | null): void => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('devServer:state', {
      workspaceId,
      laneId: laneId ?? null,
      ...service.getState(workspaceId, laneId),
    })
  }

  const launchDevServer = async (
    options: SharedDevServerStartOptions,
    mode: 'start' | 'ensure',
  ): Promise<DevServerStartResult> => {
    const {
      workspaceId,
      laneId,
      command,
      bootstrapCommand,
      port,
      sessionKey,
      framework,
      terminalId,
      runId,
    } = options

    // Authorize before command resolution or runtime work (authorize-then-act).
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
    const callbacks = {
      workspaceId,
      laneId,
      command: finalCommand,
      bootstrapCommand: finalBootstrapCommand,
      preferredPort: port,
      sessionKey,
      framework,
      terminalId,
      runId: resolvedRunId,
      onOutput: (output: string, stream: 'stdout' | 'stderr') => {
        const mainWindow = deps.getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) return
        outputBatcher.enqueue(mainWindow.webContents, {
          workspaceId,
          laneId: laneId ?? null,
          output,
          stream,
          runId: resolvedRunId,
        })
      },
      onExit: (code: number | null) => {
        const mainWindow = deps.getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) return
        outputBatcher.flush(mainWindow.webContents)
        mainWindow.webContents.send('devServer:exit', {
          workspaceId,
          laneId: laneId ?? null,
          code,
          runId: resolvedRunId,
        })
        emitState(workspaceId, laneId)
      },
    }

    const result = mode === 'ensure'
      ? await service.ensure(callbacks)
      : await service.start(callbacks)
    if (result.success) {
      LocalAutomationResolverService.getInstance().recordSuccessfulCommand(workspaceId, finalCommand)
    }
    emitState(workspaceId, laneId)
    return result
  }

  ipcMain.handle(
    'devServer:start',
    async (_event, options: SharedDevServerStartOptions): Promise<DevServerStartResult> =>
      await launchDevServer(options, 'start'),
  )

  ipcMain.handle(
    'devServer:ensure',
    async (_event, options: SharedDevServerStartOptions): Promise<DevServerStartResult> =>
      await launchDevServer(options, 'ensure'),
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
      const result = await service.stop(workspaceId, laneId)
      emitState(workspaceId, laneId)
      return result
    }
  )

  ipcMain.handle(
    'devServer:detachSurface',
    async (
      _event,
      {
        workspaceId,
        laneId,
        terminalId,
      }: { workspaceId: string; laneId?: string | null; terminalId: string },
    ): Promise<{ success: boolean; ownsRuntime: boolean; error?: string }> => {
      try {
        await resolveAuthorizedWorkspaceAccess({ workspaceId, laneId, operation: 'dev-server-start' })
      } catch (error) {
        return {
          success: false,
          ownsRuntime: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      const result = service.detachSurface(workspaceId, laneId, terminalId)
      emitState(workspaceId, laneId)
      return result
    },
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

  // Source-of-truth snapshot for renderer reconciliation: the renderer mirror
  // (devServerRunStore) re-syncs from this on mount/focus instead of trusting
  // whatever events it happened to be mounted for.
  ipcMain.handle(
    'devServer:getState',
    async (
      _event,
      { workspaceId, laneId }: { workspaceId: string; laneId?: string | null }
    ): Promise<ReturnType<DevServerService['getState']>> => {
      try {
        await resolveAuthorizedWorkspaceAccess({ workspaceId, laneId, operation: 'dev-server-start' })
        return service.getState(workspaceId, laneId)
      } catch {
        return { running: false, ready: false, port: null, runId: null, phase: null, headless: false }
      }
    }
  )
}
