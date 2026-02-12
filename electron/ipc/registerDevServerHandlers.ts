import type { BrowserWindow, IpcMain } from 'electron'
import * as pty from 'node-pty'
import { createRuntimeEnv } from '../runtime/runtimeEnv'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimePathPrefixes, resolveCommandWithRuntime } from '../runtime/runtimeResolver'

interface RegisterDevServerHandlersDeps {
  devServerProcesses: Map<string, pty.IPty>
  getMainWindow: () => BrowserWindow | null
}

// Start, stop, and manage per-project dev servers using PTY-backed terminals.
export function registerDevServerHandlers(
  ipcMain: IpcMain,
  deps: RegisterDevServerHandlersDeps
): void {
  ipcMain.handle(
    'devServer:start',
    async (
      _event,
      {
        projectPath,
        command,
        port,
        cols = 80,
        rows = 24,
      }: {
        projectPath: string
        command: string
        port: number
        cols?: number
        rows?: number
      }
    ): Promise<{ success: boolean; pid?: number; error?: string }> => {
      if (deps.devServerProcesses.has(projectPath)) {
        return { success: false, error: 'Dev server already running for this project' }
      }

      try {
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
            return { success: false, error: ensured.error || `Runtime ${resolved.runtime} is unavailable.` }
          }
        }

        console.log(`[DevServer] Starting PTY: ${command} in ${projectPath} (${cols}x${rows})`)
        const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
        const runtimeEnv = createRuntimeEnv(
          getRuntimePathPrefixes(),
          {
            ...process.env,
            PORT: String(port),
            FORCE_COLOR: '1',
            TERM: 'xterm-256color',
          }
        )

        const ptyProcess = pty.spawn(shell, ['-c', command], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: projectPath,
          env: runtimeEnv as Record<string, string>,
        })

        deps.devServerProcesses.set(projectPath, ptyProcess)

        ptyProcess.onData((data: string) => {
          deps.getMainWindow()?.webContents.send('devServer:output', { projectPath, output: data, stream: 'stdout' })
        })

        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[DevServer] PTY exited with code ${exitCode}`)
          deps.devServerProcesses.delete(projectPath)
          deps.getMainWindow()?.webContents.send('devServer:exit', { projectPath, code: exitCode })
        })

        return { success: true, pid: ptyProcess.pid }
      } catch (err) {
        console.error('[DevServer] Failed to start PTY:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to start dev server',
        }
      }
    }
  )

  ipcMain.handle(
    'devServer:stop',
    async (
      _event,
      { projectPath }: { projectPath: string }
    ): Promise<{ success: boolean; error?: string }> => {
      const ptyProcess = deps.devServerProcesses.get(projectPath)
      if (!ptyProcess) {
        return { success: true }
      }

      try {
        console.log(`[DevServer] Stopping PTY for ${projectPath}`)
        ptyProcess.kill()
        deps.devServerProcesses.delete(projectPath)
        return { success: true }
      } catch (err) {
        console.error('[DevServer] Failed to stop PTY:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to stop dev server',
        }
      }
    }
  )

  ipcMain.handle(
    'devServer:resize',
    (
      _event,
      { projectPath, cols, rows }: { projectPath: string; cols: number; rows: number }
    ): { success: boolean } => {
      const ptyProcess = deps.devServerProcesses.get(projectPath)
      if (!ptyProcess) {
        return { success: false }
      }

      try {
        ptyProcess.resize(cols, rows)
        return { success: true }
      } catch (err) {
        console.error('[DevServer] Failed to resize PTY:', err)
        return { success: false }
      }
    }
  )

  ipcMain.handle(
    'devServer:isRunning',
    (_event, { projectPath }: { projectPath: string }): boolean => {
      return deps.devServerProcesses.has(projectPath)
    }
  )
}
