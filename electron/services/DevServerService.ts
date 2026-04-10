import execa, { type ExecaChildProcess } from 'execa'
import net from 'node:net'

export interface DevServerStartOptions {
  projectPath: string
  command: string
  preferredPort: number
  runId: string
  onOutput: (output: string, stream: 'stdout' | 'stderr') => void
  onExit: (code: number | null) => void
}

export interface DevServerStartResult {
  success: boolean
  port?: number
  runId?: string
  error?: string
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
  private processes = new Map<
    string,
    {
      process: ExecaChildProcess
      runId: string
      activePort: number | null
    }
  >()

  public static getInstance(): DevServerService {
    if (!DevServerService.instance) {
      DevServerService.instance = new DevServerService()
    }
    return DevServerService.instance
  }

  /**
   * Starts a dev server process, finds an open port, and waits for it to be ready.
   */
  public async start(options: DevServerStartOptions): Promise<DevServerStartResult> {
    const { projectPath, command, preferredPort, runId, onOutput, onExit } = options

    // 1. Ensure any existing server for this project is stopped
    const stopResult = await this.stop(projectPath)
    if (!stopResult.success) {
      return {
        success: false,
        runId,
        error: stopResult.error || 'Failed to stop the previous dev server process.',
      }
    }

    try {
      // 2. Explicitly scan for a free port starting from the preferred one.
      const actualPort = await this.findAvailablePort(preferredPort)
      const candidatePorts = new Set<number>([actualPort])
      const startupTimeoutMs = /\binstall\b/i.test(command) ? 120000 : 30000
      if (actualPort !== preferredPort) {
        onOutput(
          `[DevServer] Port ${preferredPort} is already in use. Using ${actualPort} instead.\n`,
          'stdout',
        )
      }
      console.log(`[DevServerService] Starting ${command} in ${projectPath} on port ${actualPort}`)

      // 3. Spawn robustly with cross-platform support
      // We pass PORT in the environment. Most frameworks (Vite, Next.js, CRA) respect this.
      // If the command itself specifies a port (e.g., `--port 3000`), we might need more complex parsing,
      // but for now, we rely on the PORT env var as the standard fallback.
      const subprocess = execa(command, {
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: actualPort.toString(),
          // Force some frameworks to not open browser
          BROWSER: 'none',
        },
        shell: true, // Needed to resolve `npm`, `yarn`, etc. in PATH
        detached: process.platform !== 'win32',
        all: true,   // Combine stdout and stderr if needed, though we listen separately
      })

      this.processes.set(projectPath, {
        process: subprocess,
        runId,
        activePort: actualPort,
      })

      // 4. Stream logs reliably
      if (subprocess.stdout) {
        subprocess.stdout.on('data', (data: Buffer) => {
          const output = data.toString('utf-8')
          for (const port of extractCandidatePorts(output)) {
            candidatePorts.add(port)
          }
          onOutput(output, 'stdout')
        })
      }
      
      if (subprocess.stderr) {
        subprocess.stderr.on('data', (data: Buffer) => {
          const output = data.toString('utf-8')
          for (const port of extractCandidatePorts(output)) {
            candidatePorts.add(port)
          }
          onOutput(output, 'stderr')
        })
      }

      // 5. Handle Exit
      subprocess.on('exit', (code: number | null) => {
        console.log(`[DevServerService] Process exited with code ${code}`)
        const active = this.processes.get(projectPath)
        if (active?.runId === runId) {
          this.processes.delete(projectPath)
        }
        onExit(code)
      })

      // 6. Deterministic Health Check
      // Wait until any candidate port is reachable so frameworks that ignore PORT still work.
      const reachablePort = await this.waitForReachablePort(
        candidatePorts,
        startupTimeoutMs,
        () => this.processes.get(projectPath)?.runId === runId
      )

      if (!reachablePort) {
        await this.stop(projectPath)
        return {
          success: false,
          runId,
          error: 'Dev server failed to bind to a reachable port within timeout.',
        }
      }

      const active = this.processes.get(projectPath)
      if (active?.runId === runId) {
        active.activePort = reachablePort
      }

      console.log(`[DevServerService] Ready on port ${reachablePort}`)
      return { success: true, port: reachablePort, runId }

    } catch (error) {
      console.error('[DevServerService] Failed to start:', error)
      return {
        success: false,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error starting dev server',
      }
    }
  }

  /**
   * Graceful shutdown that kills the whole process tree.
   */
  public async stop(projectPath: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.processes.get(projectPath)
    if (!entry) {
      return { success: true }
    }

    try {
      console.log(`[DevServerService] Stopping server for ${projectPath}`)

      this.terminateProcessTree(entry.process, 'SIGTERM')
      let exited = await this.waitForProcessExit(entry.process, 1500)

      if (!exited) {
        console.log(`[DevServerService] Force killing server for ${projectPath}`)
        this.terminateProcessTree(entry.process, 'SIGKILL')
        exited = await this.waitForProcessExit(entry.process, 1500)
      }

      if (!exited) {
        return {
          success: false,
          error: 'Dev server process did not exit cleanly.',
        }
      }

      if (typeof entry.activePort === 'number') {
        const released = await this.waitForPortState(entry.activePort, false, 3000)
        if (!released) {
          console.warn(
            `[DevServerService] Port ${entry.activePort} still appears in use after stopping ${projectPath}`,
          )
        }
      }

      this.processes.delete(projectPath)
      return { success: true }
    } catch (error) {
      console.error('[DevServerService] Error stopping process:', error)
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

  /**
   * Pings candidate ports continuously until one accepts a TCP socket connection.
   */
  private async waitForReachablePort(
    candidatePorts: Set<number>,
    timeoutMs: number,
    isRunActive: () => boolean
  ): Promise<number | null> {
    const startTime = Date.now()

    while (Date.now() - startTime <= timeoutMs) {
      if (!isRunActive()) return null

      for (const port of candidatePorts) {
        const reachable = await this.checkPort(port)
        if (reachable) {
          return port
        }
        if (!isRunActive()) return null
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return null
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

  private terminateProcessTree(child: ExecaChildProcess, signal: NodeJS.Signals): void {
    const childPid = child.pid
    if (typeof childPid === 'number' && process.platform !== 'win32') {
      try {
        process.kill(-childPid, signal)
        return
      } catch {
        // Fall through to direct child kill when the process group is already gone.
      }
    }

    try {
      child.kill(signal)
    } catch {
      // Ignore shutdown races.
    }
  }

  private async waitForProcessExit(child: ExecaChildProcess, timeoutMs: number): Promise<boolean> {
    const start = Date.now()

    while (Date.now() - start <= timeoutMs) {
      if (child.exitCode !== null || child.signalCode !== null) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    return child.exitCode !== null || child.signalCode !== null
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
