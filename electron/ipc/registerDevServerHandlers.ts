import type { BrowserWindow, IpcMain } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'node:fs'
import path from 'node:path'
import { createRuntimeEnv } from '../runtime/runtimeEnv'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimePathPrefixes, resolveCommandWithRuntime } from '../runtime/runtimeResolver'

interface RegisterDevServerHandlersDeps {
  devServerProcesses: Map<string, pty.IPty>
  getMainWindow: () => BrowserWindow | null
}

const SPAWN_HELPER_EXEC_MODE = 0o755
const spawnHelperFixCache = new Map<string, boolean>()

function getNodePtySpawnHelperCandidates(): string[] {
  const target = `${process.platform}-${process.arch}`
  const appRoot = process.env.APP_ROOT || process.cwd()
  return [
    path.join(appRoot, 'node_modules', 'node-pty', 'prebuilds', target, 'spawn-helper'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', target, 'spawn-helper'),
    path.join(process.resourcesPath, 'node_modules', 'node-pty', 'prebuilds', target, 'spawn-helper'),
  ]
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === 'win32') return
  const cacheKey = `${process.platform}-${process.arch}`
  if (spawnHelperFixCache.get(cacheKey)) return

  for (const candidate of getNodePtySpawnHelperCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue
      const stat = fs.statSync(candidate)
      const hasExecBit = (stat.mode & 0o111) !== 0
      if (!hasExecBit) {
        fs.chmodSync(candidate, SPAWN_HELPER_EXEC_MODE)
      }
      spawnHelperFixCache.set(cacheKey, true)
      return
    } catch {
      // Continue trying other candidate paths.
    }
  }
}

function resolvePtyShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'

  const envShell = process.env.SHELL?.trim()
  const candidates = [
    envShell,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate.startsWith('/')) {
      if (fs.existsSync(candidate)) return candidate
      continue
    }

    const normalized = candidate.replace(/^.*\//, '')
    const binCandidate = `/bin/${normalized}`
    if (fs.existsSync(binCandidate)) return binCandidate
  }

  return '/bin/sh'
}

function toPtyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      normalized[key] = value
    }
  }
  return normalized
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
        ensureNodePtySpawnHelperExecutable()
        const shell = resolvePtyShell()
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
          env: toPtyEnv(runtimeEnv),
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
