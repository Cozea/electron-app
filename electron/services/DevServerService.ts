import net from 'node:net'

import { TerminalService } from './TerminalService'

export interface DevServerStartOptions {
  projectPath: string
  command: string
  preferredPort: number
  runId: string
  terminalId: string
  onOutput: (output: string, stream: 'stdout' | 'stderr') => void
  onExit: (code: number | null) => void
}

export interface DevServerStartResult {
  success: boolean
  port?: number
  runId?: string
  error?: string
}

interface ManagedDevServerRun {
  projectPath: string
  terminalId: string
  runId: string
  activePort: number | null
  candidatePorts: Set<number>
  command: string
  ready: boolean
  stopping: boolean
  disposed: boolean
  unsubscribeTerminal: (() => void) | null
  onOutput: (output: string, stream: 'stdout' | 'stderr') => void
  onExit: (code: number | null) => void
}

function extractCandidatePorts(output: string): number[] {
  const matches = output.matchAll(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[:\s]+(\d{2,5})/gi)
  const ports = new Set<number>()

  for (const match of matches) {
    const port = Number.parseInt(match[1] || '', 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) {
      ports.add(port)
    }
  }

  return Array.from(ports)
}

export class DevServerService {
  private static instance: DevServerService
  private readonly terminalService = TerminalService.getInstance()
  private processes = new Map<string, ManagedDevServerRun>()

  public static getInstance(): DevServerService {
    if (!DevServerService.instance) {
      DevServerService.instance = new DevServerService()
    }
    return DevServerService.instance
  }

  public async start(options: DevServerStartOptions): Promise<DevServerStartResult> {
    const { projectPath, command, preferredPort, runId, terminalId, onOutput, onExit } = options

    const stopResult = await this.stop(projectPath)
    if (!stopResult.success) {
      return {
        success: false,
        runId,
        error: stopResult.error || 'Failed to stop the previous dev server process.',
      }
    }

    if (!this.terminalService.hasTerminal(terminalId)) {
      return {
        success: false,
        runId,
        error: 'Dev server terminal is not available.',
      }
    }

    try {
      const actualPort = await this.findAvailablePort(preferredPort)
      const startupTimeoutMs = /\binstall\b/i.test(command) ? 120000 : 30000
      if (actualPort !== preferredPort) {
        onOutput(
          `[DevServer] Port ${preferredPort} is already in use. Using ${actualPort} instead.\n`,
          'stdout',
        )
      }

      const run: ManagedDevServerRun = {
        projectPath,
        terminalId,
        runId,
        activePort: null,
        candidatePorts: new Set<number>([actualPort]),
        command,
        ready: false,
        stopping: false,
        disposed: false,
        unsubscribeTerminal: null,
        onOutput,
        onExit,
      }

      run.unsubscribeTerminal = this.terminalService.subscribe(terminalId, {
        onOutput: ({ data }) => {
          for (const port of extractCandidatePorts(data)) {
            run.candidatePorts.add(port)
          }
          if (!run.disposed) {
            run.onOutput(data, 'stdout')
          }
        },
        onExit: ({ exitCode }) => {
          if (run.disposed) return
          this.disposeRun(projectPath, exitCode)
        },
        onActivity: ({ hasRunningSubprocess }) => {
          if (run.disposed || run.stopping || !run.ready || hasRunningSubprocess) {
            return
          }
          void this.handleUnexpectedStop(projectPath)
        },
      })

      this.processes.set(projectPath, run)

      const terminalInfo = this.terminalService.getInfo(terminalId)
      const launchCommand = buildTerminalLaunchCommand({
        command,
        port: actualPort,
        profileId: terminalInfo?.profileId ?? null,
      })

      onOutput(`[DevServer] Starting ${command} on port ${actualPort}\n`, 'stdout')
      const accepted = await this.terminalService.sendInput(terminalId, `${launchCommand}\r`)
      if (!accepted) {
        this.disposeRun(projectPath, null)
        return {
          success: false,
          runId,
          error: 'Failed to send the dev server command to the terminal.',
        }
      }

      const reachablePort = await this.waitForReadyPort(
        run.candidatePorts,
        startupTimeoutMs,
        () => this.processes.get(projectPath)?.runId === runId,
      )

      if (!reachablePort) {
        await this.stop(projectPath)
        return {
          success: false,
          runId,
          error: 'Dev server failed to expose a ready preview URL within timeout.',
        }
      }

      const active = this.processes.get(projectPath)
      if (active?.runId === runId) {
        active.activePort = reachablePort
        active.ready = true
      }

      onOutput(`[DevServer] Ready on port ${reachablePort}\n`, 'stdout')
      return { success: true, port: reachablePort, runId }
    } catch (error) {
      this.disposeRun(projectPath, null)
      return {
        success: false,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error starting dev server',
      }
    }
  }

  public async stop(projectPath: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.processes.get(projectPath)
    if (!entry) {
      return { success: true }
    }

    entry.stopping = true

    try {
      await this.terminalService.sendInput(entry.terminalId, '\u0003')
      if (entry.activePort !== null) {
        const released = await this.waitForPortState(entry.activePort, false, 5000)
        if (!released) {
          await this.terminalService.sendInput(entry.terminalId, '\u0003')
          const releasedAfterRetry = await this.waitForPortState(entry.activePort, false, 2500)
          if (!releasedAfterRetry) {
            entry.stopping = false
            return {
              success: false,
              error: 'Dev server did not stop after sending Ctrl+C to the terminal.',
            }
          }
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      this.disposeRun(projectPath, 0)
      return { success: true }
    } catch (error) {
      entry.stopping = false
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  public isRunning(projectPath: string): boolean {
    return this.processes.has(projectPath)
  }

  public getState(projectPath: string): { running: boolean; port: number | null; runId: string | null } {
    const entry = this.processes.get(projectPath)
    return {
      running: Boolean(entry),
      port: entry?.activePort ?? null,
      runId: entry?.runId ?? null,
    }
  }

  public killAll() {
    for (const [projectPath] of this.processes) {
      this.stop(projectPath).catch(console.error)
    }
  }

  private async handleUnexpectedStop(projectPath: string): Promise<void> {
    const entry = this.processes.get(projectPath)
    if (!entry || entry.activePort === null) {
      return
    }

    const stillReachable = await this.waitForPortState(entry.activePort, true, 250)
    if (stillReachable) {
      return
    }

    this.disposeRun(projectPath, null)
  }

  private disposeRun(projectPath: string, exitCode: number | null): void {
    const entry = this.processes.get(projectPath)
    if (!entry) {
      return
    }

    entry.disposed = true
    entry.unsubscribeTerminal?.()
    entry.unsubscribeTerminal = null
    this.processes.delete(projectPath)
    entry.onExit(exitCode)
  }

  private async waitForReadyPort(
    candidatePorts: Set<number>,
    timeoutMs: number,
    isRunActive: () => boolean,
  ): Promise<number | null> {
    const startTime = Date.now()

    while (Date.now() - startTime <= timeoutMs) {
      if (!isRunActive()) return null

      for (const port of candidatePorts) {
        const ready = await this.checkReadyPort(port)
        if (ready) {
          return port
        }
        if (!isRunActive()) return null
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return null
  }

  private async checkReadyPort(port: number): Promise<boolean> {
    const url = `http://127.0.0.1:${port}/`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
      })
      return response.ok || response.status >= 100
    } catch {
      return this.checkPort(port)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async findAvailablePort(preferredPort: number, maxAttempts = 20): Promise<number> {
    let candidatePort = preferredPort

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const reachable = await this.checkPort(candidatePort)
      if (!reachable) {
        return candidatePort
      }
      candidatePort += 1
    }

    throw new Error(`No available port found starting from ${preferredPort}`)
  }

  private async waitForPortState(
    port: number,
    shouldBeReachable: boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    const start = Date.now()

    while (Date.now() - start <= timeoutMs) {
      const reachable = await this.checkPort(port)
      if (reachable === shouldBeReachable) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    const reachable = await this.checkPort(port)
    return reachable === shouldBeReachable
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false

      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(value)
      }

      socket.setTimeout(1000)
      socket.on('connect', () => finish(true))
      socket.on('timeout', () => finish(false))
      socket.on('error', () => finish(false))
      socket.connect(port, '127.0.0.1')
    })
  }
}

function buildTerminalLaunchCommand(input: {
  command: string
  port: number
  profileId: string | null
}): string {
  const { command, port, profileId } = input

  if (process.platform === 'win32') {
    if (profileId === 'powershell' || profileId === 'pwsh') {
      return `$env:PORT='${port}'; $env:BROWSER='none'; ${command}`
    }
    return `set PORT=${port}&& set BROWSER=none&& ${command}`
  }

  return `env PORT=${port} BROWSER=none ${command}`
}
