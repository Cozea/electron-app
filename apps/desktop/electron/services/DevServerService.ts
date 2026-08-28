import net from 'node:net'

import { DevServerPortBroker } from './DevServerPortBroker'
import { TerminalService } from './TerminalService'
import {
  applyDevServerPortOverride,
  applyDevServerPortPlaceholder,
} from './devServerCommandPortOverride'

export interface DevServerStartOptions {
  workspaceId: string
  laneId?: string | null
  command: string
  bootstrapCommand?: string | null
  preferredPort: number
  sessionKey?: string | null
  framework?: string | null
  runId: string
  terminalId: string
  onOutput: (output: string, stream: 'stdout' | 'stderr') => void
  onExit: (code: number | null) => void
}

export interface DevServerStartResult {
  success: boolean
  port?: number
  runId?: string
  existing?: boolean
  error?: string
}

export interface DevServerProcessState {
  running: boolean
  ready: boolean
  port: number | null
  runId: string | null
  phase: 'bootstrapping' | 'launching' | 'running' | null
  headless: boolean
}

interface ManagedDevServerRun {
  workspaceId: string
  laneId: string
  runKey: string
  sessionKey: string
  terminalId: string
  runId: string
  bootstrapCommand: string | null
  activePort: number | null
  candidatePorts: Set<number>
  command: string
  effectiveCommand: string
  framework: string | null
  ready: boolean
  stopping: boolean
  disposed: boolean
  terminalDetached: boolean
  phase: 'bootstrapping' | 'launching' | 'running'
  bootstrapOutput: string
  unsubscribeTerminal: (() => void) | null
  onOutput: (output: string, stream: 'stdout' | 'stderr') => void
  onExit: (code: number | null) => void
}

const MAX_BOOTSTRAP_OUTPUT_LENGTH = 48_000
const BOOTSTRAP_TIMEOUT_MS = 15 * 60 * 1000
const BOOTSTRAP_SETTLE_DELAY_MS = 1200
const DEFAULT_LANE_ID = 'collab'

function normalizeLaneId(laneId?: string | null): string {
  const trimmed = laneId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_LANE_ID
}

function buildRunKey(workspaceId: string, laneId?: string | null): string {
  return `${workspaceId}::${normalizeLaneId(laneId)}`
}

function appendBootstrapOutput(current: string, chunk: string): string {
  const next = current + chunk
  if (next.length <= MAX_BOOTSTRAP_OUTPUT_LENGTH) {
    return next
  }
  return next.slice(-MAX_BOOTSTRAP_OUTPUT_LENGTH)
}

function detectBootstrapFailure(output: string): boolean {
  return /(npm error|npm ERR!|ERR_PNPM_|error Command failed|command not found|No such file or directory)/i.test(output)
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
  private readonly portBroker = DevServerPortBroker.getInstance()
  private processes = new Map<string, ManagedDevServerRun>()
  private ensureRequests = new Map<string, Promise<DevServerStartResult>>()

  public static getInstance(): DevServerService {
    if (!DevServerService.instance) {
      DevServerService.instance = new DevServerService()
    }
    return DevServerService.instance
  }

  /**
   * Idempotently make a workspace/lane dev server available. Unlike start(),
   * this never replaces an existing run: callers either join the launch in
   * progress or receive the already-running process.
   */
  public async ensure(options: DevServerStartOptions): Promise<DevServerStartResult> {
    const runKey = buildRunKey(options.workspaceId, options.laneId)
    const existing = this.processes.get(runKey)
    if (existing) {
      return await this.waitForExistingRun(existing)
    }

    const pending = this.ensureRequests.get(runKey)
    if (pending) {
      const result = await pending
      return result.success ? { ...result, existing: true } : result
    }

    let request: Promise<DevServerStartResult>
    request = this.start(options)
      .then((result) => ({ ...result, existing: false }))
      .finally(() => {
        if (this.ensureRequests.get(runKey) === request) {
          this.ensureRequests.delete(runKey)
        }
      })
    this.ensureRequests.set(runKey, request)
    return await request
  }

  public async start(options: DevServerStartOptions): Promise<DevServerStartResult> {
    const {
      workspaceId,
      laneId,
      command,
      bootstrapCommand,
      preferredPort,
      sessionKey,
      framework,
      runId,
      terminalId,
      onOutput,
      onExit,
    } = options
    const normalizedLaneId = normalizeLaneId(laneId)
    const runKey = buildRunKey(workspaceId, normalizedLaneId)

    const stopResult = await this.stop(workspaceId, normalizedLaneId)
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
      this.terminalService.setActivityTracking(terminalId, 'subprocess')

      const normalizedSessionKey = sessionKey?.trim() || runKey
      const portLease = await this.portBroker.acquirePort({
        sessionKey: normalizedSessionKey,
        workspaceId,
        preferredPort,
        isPortReachable: (port) => this.checkPort(port),
      })
      const actualPort = portLease.port

      if (actualPort !== portLease.requestedPort) {
        onOutput(
          `[DevServer] Port ${portLease.requestedPort} is already in use. Using ${actualPort} instead.\n`,
          'stdout',
        )
      }

      const effectiveCommand = applyDevServerPortOverride({
        command: applyDevServerPortPlaceholder(command, actualPort),
        framework,
        port: actualPort,
      })

      const run: ManagedDevServerRun = {
        workspaceId,
        laneId: normalizedLaneId,
        runKey,
        sessionKey: normalizedSessionKey,
        terminalId,
        runId,
        bootstrapCommand: bootstrapCommand?.trim() || null,
        activePort: null,
        candidatePorts: new Set<number>([actualPort]),
        command,
        effectiveCommand,
        framework: framework?.trim() || null,
        ready: false,
        stopping: false,
        disposed: false,
        terminalDetached: false,
        phase: bootstrapCommand?.trim() ? 'bootstrapping' : 'launching',
        bootstrapOutput: '',
        unsubscribeTerminal: null,
        onOutput,
        onExit,
      }

      run.unsubscribeTerminal = this.terminalService.subscribe(terminalId, {
        onOutput: ({ data }) => {
          for (const port of extractCandidatePorts(data)) {
            run.candidatePorts.add(port)
          }
          if (run.phase === 'bootstrapping') {
            run.bootstrapOutput = appendBootstrapOutput(run.bootstrapOutput, data)
          }
          if (!run.disposed) {
            run.onOutput(data, 'stdout')
          }
        },
        onExit: ({ exitCode }) => {
          if (run.disposed) return
          this.disposeRun(runKey, exitCode)
        },
        onActivity: ({ hasRunningSubprocess }) => {
          if (run.disposed || run.stopping || !run.ready || hasRunningSubprocess) {
            return
          }
          void this.handleUnexpectedStop(runKey)
        },
      })

      this.processes.set(runKey, run)

      const terminalInfo = this.terminalService.getInfo(terminalId)
      const profileId = terminalInfo?.profileId ?? null

      if (run.bootstrapCommand) {
        run.onOutput(
          `[DevServer] Installing dependencies with ${run.bootstrapCommand}\n`,
          'stdout',
        )
        const bootstrapAccepted = await this.terminalService.sendInput(
          terminalId,
          `${run.bootstrapCommand}\r`,
        )
        if (!bootstrapAccepted) {
          this.discardRun(runKey)
          return {
            success: false,
            runId,
            error: 'Failed to send the dependency installation command to the terminal.',
          }
        }

        const bootstrapCompleted = await this.waitForTerminalCommandToSettle(
          terminalId,
          BOOTSTRAP_TIMEOUT_MS,
          () => this.processes.get(runKey)?.runId === runId,
        )

        if (!bootstrapCompleted) {
          await this.stop(workspaceId, normalizedLaneId)
          return {
            success: false,
            runId,
            error: 'Dependency installation did not finish before the bootstrap timeout.',
          }
        }

        const activeAfterBootstrap = this.processes.get(runKey)
        if (!activeAfterBootstrap || activeAfterBootstrap.runId !== runId) {
          return {
            success: false,
            runId,
            error: 'Dev server bootstrap was interrupted before launch.',
          }
        }

        if (detectBootstrapFailure(activeAfterBootstrap.bootstrapOutput)) {
          this.discardRun(runKey)
          return {
            success: false,
            runId,
            error: 'Dependency installation failed. Check the terminal output for details.',
          }
        }

        activeAfterBootstrap.phase = 'launching'
        activeAfterBootstrap.bootstrapOutput = ''
        onOutput('[DevServer] Dependency bootstrap finished. Launching dev server.\n', 'stdout')
      }

      const launchCommand = buildTerminalLaunchCommand({
        command: effectiveCommand,
        port: actualPort,
        profileId,
      })

      onOutput(`[DevServer] Starting ${effectiveCommand} on port ${actualPort}\n`, 'stdout')
      const accepted = await this.terminalService.sendInput(terminalId, `${launchCommand}\r`)
      if (!accepted) {
        this.discardRun(runKey)
        return {
          success: false,
          runId,
          error: 'Failed to send the dev server command to the terminal.',
        }
      }

      const reachablePort = await this.waitForReadyPort(
        run.candidatePorts,
        30000,
        () => this.processes.get(runKey)?.runId === runId,
      )

      if (!reachablePort) {
        await this.stop(workspaceId, normalizedLaneId)
        return {
          success: false,
          runId,
          error: 'Dev server failed to expose a ready preview URL within timeout.',
        }
      }

      const active = this.processes.get(runKey)
      if (active?.runId === runId) {
        active.activePort = reachablePort
        active.ready = true
        active.phase = 'running'
      }

      onOutput(`[DevServer] Ready on port ${reachablePort}\n`, 'stdout')
      return { success: true, port: reachablePort, runId }
    } catch (error) {
      if (!this.processes.has(runKey)) {
        this.terminalService.setActivityTracking(terminalId, 'off')
      }
      this.disposeRun(runKey, null)
      return {
        success: false,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error starting dev server',
      }
    }
  }

  public async stop(workspaceId: string, laneId?: string | null): Promise<{ success: boolean; error?: string }> {
    const runKey = buildRunKey(workspaceId, laneId)
    const entry = this.processes.get(runKey)
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
            this.terminalService.killTerminal(entry.terminalId)
            const releasedAfterKill = await this.waitForPortState(entry.activePort, false, 2500)
            if (!releasedAfterKill) {
              entry.stopping = false
              return {
                success: false,
                error: 'Dev server did not stop after sending Ctrl+C and killing the terminal.',
              }
            }
          }
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      this.disposeRun(runKey, 0)
      return { success: true }
    } catch (error) {
      entry.stopping = false
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  public isRunning(workspaceId: string, laneId?: string | null): boolean {
    return this.processes.has(buildRunKey(workspaceId, laneId))
  }

  /**
   * Detach a closing surface from the PTY that owns the singleton run. The
   * process keeps running; once it stops, its now-headless terminal is reaped.
   */
  public detachSurface(
    workspaceId: string,
    laneId: string | null | undefined,
    terminalId: string,
  ): { success: boolean; ownsRuntime: boolean } {
    const entry = this.processes.get(buildRunKey(workspaceId, laneId))
    if (!entry || entry.terminalId !== terminalId) {
      return { success: true, ownsRuntime: false }
    }
    entry.terminalDetached = true
    return { success: true, ownsRuntime: true }
  }

  public getState(workspaceId: string, laneId?: string | null): DevServerProcessState {
    const entry = this.processes.get(buildRunKey(workspaceId, laneId))
    return {
      running: Boolean(entry),
      ready: Boolean(entry?.ready),
      port: entry?.activePort ?? null,
      runId: entry?.runId ?? null,
      phase: entry?.phase ?? null,
      headless: Boolean(entry?.terminalDetached),
    }
  }

  public killAll() {
    for (const [, entry] of this.processes) {
      this.stop(entry.workspaceId, entry.laneId).catch(console.error)
    }
  }

  private async handleUnexpectedStop(runKey: string): Promise<void> {
    const entry = this.processes.get(runKey)
    if (!entry || entry.activePort === null) {
      return
    }

    const stillReachable = await this.waitForPortState(entry.activePort, true, 250)
    if (stillReachable) {
      return
    }

    this.disposeRun(runKey, null)
  }

  private async waitForExistingRun(entry: ManagedDevServerRun): Promise<DevServerStartResult> {
    if (entry.ready && entry.activePort !== null) {
      return {
        success: true,
        port: entry.activePort,
        runId: entry.runId,
        existing: true,
      }
    }

    const deadline = Date.now() + BOOTSTRAP_TIMEOUT_MS + 30_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const active = this.processes.get(entry.runKey)
      if (!active || active.runId !== entry.runId) {
        return {
          success: false,
          runId: entry.runId,
          existing: true,
          error: 'The existing dev server stopped before it became ready.',
        }
      }
      if (active.ready && active.activePort !== null) {
        return {
          success: true,
          port: active.activePort,
          runId: active.runId,
          existing: true,
        }
      }
    }

    return {
      success: false,
      runId: entry.runId,
      existing: true,
      error: 'The existing dev server did not become ready before the launch timeout.',
    }
  }

  private discardRun(runKey: string): void {
    const entry = this.processes.get(runKey)
    if (!entry) {
      return
    }

    entry.disposed = true
    entry.unsubscribeTerminal?.()
    entry.unsubscribeTerminal = null
    this.terminalService.setActivityTracking(entry.terminalId, 'off')
    this.processes.delete(runKey)
    this.portBroker.releasePort(entry.sessionKey, entry.workspaceId)
    if (entry.terminalDetached) {
      this.terminalService.killTerminal(entry.terminalId)
    }
  }

  private disposeRun(runKey: string, exitCode: number | null): void {
    const entry = this.processes.get(runKey)
    if (!entry) {
      return
    }

    entry.disposed = true
    entry.unsubscribeTerminal?.()
    entry.unsubscribeTerminal = null
    this.terminalService.setActivityTracking(entry.terminalId, 'off')
    this.processes.delete(runKey)
    this.portBroker.releasePort(entry.sessionKey, entry.workspaceId)
    entry.onExit(exitCode)
    if (entry.terminalDetached) {
      this.terminalService.killTerminal(entry.terminalId)
    }
  }

  private waitForTerminalCommandToSettle(
    terminalId: string,
    timeoutMs: number,
    isRunActive: () => boolean,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      let sawBusy = false
      let sawOutput = false
      let idleTimer: NodeJS.Timeout | null = null
      let activePoll: NodeJS.Timeout | null = null
      let timeoutHandle: NodeJS.Timeout | null = null

      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        if (idleTimer) clearTimeout(idleTimer)
        if (activePoll) clearInterval(activePoll)
        if (timeoutHandle) clearTimeout(timeoutHandle)
        unsubscribe()
        resolve(result)
      }

      const scheduleIdleCompletion = () => {
        if (!sawBusy && !sawOutput) {
          return
        }
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => finish(true), BOOTSTRAP_SETTLE_DELAY_MS)
      }

      const unsubscribe = this.terminalService.subscribe(terminalId, {
        onOutput: () => {
          sawOutput = true
          if (!sawBusy) {
            scheduleIdleCompletion()
          }
        },
        onActivity: ({ hasRunningSubprocess }) => {
          if (!isRunActive()) {
            finish(false)
            return
          }

          if (hasRunningSubprocess) {
            sawBusy = true
            if (idleTimer) {
              clearTimeout(idleTimer)
              idleTimer = null
            }
            return
          }

          scheduleIdleCompletion()
        },
        onExit: () => {
          finish(false)
        },
      })

      activePoll = setInterval(() => {
        if (!isRunActive()) {
          finish(false)
        }
      }, 250)

      timeoutHandle = setTimeout(() => {
        finish(false)
      }, timeoutMs)
    })
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
