import type { BrowserWindow, IpcMain } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'node:fs'

interface RegisterDevServerHandlersDeps {
  devServerProcesses: Map<string, pty.IPty>
  getMainWindow: () => BrowserWindow | null
}

function shellBasename(shellPath: string): string {
  const name = shellPath.split('/').pop()
  return (name && name.length > 0 ? name : shellPath).toLowerCase()
}

function getCommandShellArgs(shellPath: string, command: string): string[] {
  if (process.platform === 'win32') {
    return ['-Command', command]
  }

  const shell = shellBasename(shellPath)
  // Interactive + login shells load common Node manager setup (nvm/fnm/asdf).
  if (shell === 'zsh' || shell === 'bash' || shell === 'fish') {
    return ['-ilc', command]
  }

  return ['-lc', command]
}

function withPathFallback(env: NodeJS.ProcessEnv): Record<string, string> {
  const fallbackPathSegments = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const currentSegments = (env.PATH ?? '').split(':').filter((segment) => segment.length > 0)
  const seen = new Set<string>()
  const mergedSegments = [...currentSegments, ...fallbackPathSegments].filter((segment) => {
    if (seen.has(segment)) return false
    seen.add(segment)
    return true
  })

  return {
    ...env,
    PATH: mergedSegments.join(':'),
  } as Record<string, string>
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
        console.log(`[DevServer] Starting PTY: ${command} in ${projectPath} (${cols}x${rows})`)
        const shell = process.platform === 'win32'
          ? 'powershell.exe'
          : process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')
        const shellArgs = getCommandShellArgs(shell, command)

        const ptyProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: projectPath,
          env: withPathFallback({
            ...process.env,
            PORT: String(port),
            FORCE_COLOR: '1',
            TERM: 'xterm-256color',
          }),
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
