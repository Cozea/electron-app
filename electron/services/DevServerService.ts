import execa, { type ExecaChildProcess } from 'execa'
import getPort from 'get-port'
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
  error?: string
}

export class DevServerService {
  private static instance: DevServerService
  private processes = new Map<string, { process: ExecaChildProcess; runId: string }>()

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
    await this.stop(projectPath)

    try {
      // 2. Guarantee a free port
      const actualPort = await getPort({ port: preferredPort })
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
        all: true,   // Combine stdout and stderr if needed, though we listen separately
      })

      this.processes.set(projectPath, { process: subprocess, runId })

      // 4. Stream logs reliably
      if (subprocess.stdout) {
        subprocess.stdout.on('data', (data: Buffer) => {
          onOutput(data.toString('utf-8'), 'stdout')
        })
      }
      
      if (subprocess.stderr) {
        subprocess.stderr.on('data', (data: Buffer) => {
          onOutput(data.toString('utf-8'), 'stderr')
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
      // We wait until a TCP connection to the port succeeds.
      const isReady = await this.waitForPort(actualPort, 30000) // 30 second timeout

      if (!isReady) {
        await this.stop(projectPath)
        return { success: false, error: 'Dev server failed to bind to port within timeout.' }
      }

      console.log(`[DevServerService] Ready on port ${actualPort}`)
      return { success: true, port: actualPort }

    } catch (error) {
      console.error('[DevServerService] Failed to start:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error starting dev server' }
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
      
      // execa's cancel/kill handles child process trees nicely
      entry.process.kill('SIGTERM')
      
      // Wait a moment to see if it exits cleanly
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      if (!entry.process.killed) {
        console.log(`[DevServerService] Force killing server for ${projectPath}`)
        entry.process.kill('SIGKILL')
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

  public killAll() {
    for (const [projectPath] of this.processes) {
      this.stop(projectPath).catch(console.error)
    }
  }

  /**
   * Pings the port continuously until a TCP socket connects.
   */
  private waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now()
      let timer: NodeJS.Timeout

      const check = () => {
        if (Date.now() - startTime > timeoutMs) {
          resolve(false)
          return
        }

        const socket = new net.Socket()
        socket.setTimeout(1000)
        
        socket.on('connect', () => {
          socket.destroy()
          clearTimeout(timer)
          resolve(true)
        })

        socket.on('timeout', () => {
          socket.destroy()
          timer = setTimeout(check, 500)
        })

        socket.on('error', () => {
          socket.destroy()
          timer = setTimeout(check, 500)
        })

        socket.connect(port, '127.0.0.1')
      }

      check()
    })
  }
}
