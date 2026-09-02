import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cozea-dev-server-service-test' },
  ipcMain: {},
}))

import {
  DevServerService,
  type DevServerStartOptions,
  type DevServerStartResult,
} from '../../apps/desktop/electron/services/DevServerService'

function options(workspaceId: string): DevServerStartOptions {
  return {
    workspaceId,
    laneId: 'collab',
    command: 'bun run dev',
    preferredPort: 5173,
    runId: `run-${workspaceId}`,
    terminalId: `terminal-${workspaceId}`,
    onOutput: () => {},
    onExit: () => {},
  }
}

describe('DevServerService.ensure', () => {
  it('starts and stops the frontend and additional processes as one run', async () => {
    const service = new DevServerService()
    const sendInput = vi.fn(async () => true)
    const createResolvedTerminal = vi.fn(async () => ({
      success: true,
      terminalId: 'terminal-api',
    }))
    const killTerminal = vi.fn(() => true)
    const setActivityTracking = vi.fn(() => true)
    const releasePort = vi.fn()
    const onStateChange = vi.fn()
    const onExit = vi.fn()

    Object.defineProperty(service, 'terminalService', {
      value: {
        hasTerminal: vi.fn(() => true),
        setActivityTracking,
        getInfo: vi.fn(() => ({ profileId: 'zsh' })),
        getTerminalSnapshot: vi.fn(() => ({ stdout: 'user@host project % ' })),
        subscribe: vi.fn(() => () => {}),
        createResolvedTerminal,
        sendInput,
        killTerminal,
      },
    })
    Object.defineProperty(service, 'portBroker', {
      value: {
        acquirePort: vi.fn(async () => ({ port: 5173, requestedPort: 5173 })),
        releasePort,
      },
    })
    Object.defineProperty(service, 'waitForReadyPort', {
      value: vi.fn(async () => 5173),
    })
    Object.defineProperty(service, 'waitForPortState', {
      value: vi.fn(async () => true),
    })

    const workspaceId = `workspace-${crypto.randomUUID()}`
    const result = await service.start({
      ...options(workspaceId),
      onExit,
      onStateChange,
      auxiliaryProcesses: [
        {
          id: 'api',
          name: 'API',
          command: 'bun run api',
          cwd: '/tmp/project/apps/api',
          projectRootPath: '/tmp/project',
          gitCwd: '/tmp/project',
        },
      ],
    })

    expect(result).toEqual({ success: true, port: 5173, runId: `run-${workspaceId}` })
    expect(createResolvedTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        cwd: '/tmp/project/apps/api',
        terminalKind: 'dev-server',
        env: { BROWSER: 'none' },
      }),
    )
    const frontendLaunchCommand =
      process.platform === 'win32'
        ? 'set PORT=5173&& set BROWSER=none&& bun run dev\r'
        : 'env PORT=5173 BROWSER=none bun run dev\r'
    expect(sendInput).toHaveBeenCalledWith('terminal-api', 'bun run api\r')
    expect(sendInput).toHaveBeenCalledWith(
      `terminal-${workspaceId}`,
      frontendLaunchCommand,
    )
    expect(service.getState(workspaceId, 'collab').processes).toEqual([
      expect.objectContaining({ id: 'primary', kind: 'primary', running: true }),
      expect.objectContaining({ id: 'api', kind: 'auxiliary', running: true }),
    ])

    await expect(service.stop(workspaceId, 'collab')).resolves.toEqual({ success: true })
    expect(sendInput).toHaveBeenCalledWith(`terminal-${workspaceId}`, '\u0003')
    expect(sendInput).toHaveBeenCalledWith('terminal-api', '\u0003')
    expect(killTerminal).toHaveBeenCalledWith('terminal-api')
    expect(setActivityTracking).toHaveBeenCalledWith('terminal-api', 'off')
    expect(releasePort).toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledWith(0)
    expect(service.getState(workspaceId, 'collab').running).toBe(false)
  })

  it('keeps the frontend running when an additional process stops, and runs shell syntax verbatim', async () => {
    const service = new DevServerService()
    const sendInput = vi.fn(async () => true)
    const observers = new Map<string, { onExit?: (event: { exitCode: number | null }) => void }>()
    const createResolvedTerminal = vi.fn(async () => ({
      success: true,
      terminalId: 'terminal-api',
    }))
    const killTerminal = vi.fn(() => true)
    const onStateChange = vi.fn()
    const onExit = vi.fn()
    const outputs: string[] = []

    Object.defineProperty(service, 'terminalService', {
      value: {
        hasTerminal: vi.fn(() => true),
        setActivityTracking: vi.fn(() => true),
        getInfo: vi.fn(() => ({ profileId: 'zsh' })),
        getTerminalSnapshot: vi.fn(() => ({ stdout: 'user@host project % ' })),
        subscribe: vi.fn((terminalId: string, observer: Record<string, unknown>) => {
          observers.set(terminalId, observer)
          return () => observers.delete(terminalId)
        }),
        createResolvedTerminal,
        sendInput,
        killTerminal,
      },
    })
    Object.defineProperty(service, 'portBroker', {
      value: {
        acquirePort: vi.fn(async () => ({ port: 5173, requestedPort: 5173 })),
        releasePort: vi.fn(),
      },
    })
    Object.defineProperty(service, 'waitForReadyPort', { value: vi.fn(async () => 5173) })
    Object.defineProperty(service, 'waitForPortState', { value: vi.fn(async () => true) })

    const workspaceId = `workspace-${crypto.randomUUID()}`
    const result = await service.start({
      ...options(workspaceId),
      onOutput: (output: string) => outputs.push(output),
      onExit,
      onStateChange,
      auxiliaryProcesses: [
        {
          id: 'api',
          name: 'API',
          command: 'cd apps/api && uvicorn main:app --reload',
          cwd: '/tmp/project',
          projectRootPath: '/tmp/project',
          gitCwd: '/tmp/project',
        },
      ],
    })

    expect(result.success).toBe(true)
    // No exec-style prefix: the command reaches the shell exactly as typed.
    expect(sendInput).toHaveBeenCalledWith(
      'terminal-api',
      'cd apps/api && uvicorn main:app --reload\r',
    )

    observers.get('terminal-api')?.onExit?.({ exitCode: 1 })

    expect(onExit).not.toHaveBeenCalled()
    expect(sendInput).not.toHaveBeenCalledWith(`terminal-${workspaceId}`, '\u0003')
    expect(service.getState(workspaceId, 'collab')).toMatchObject({
      running: true,
      ready: true,
      port: 5173,
      processes: [
        expect.objectContaining({ id: 'primary', running: true }),
        expect.objectContaining({ id: 'api', kind: 'auxiliary', running: false }),
      ],
    })
    expect(outputs.some((entry) => entry.includes('API stopped with code 1'))).toBe(true)
  })

  it('waits for the shell prompt before typing an additional process command', async () => {
    const service = new DevServerService()
    const sendInput = vi.fn(async () => true)
    const observers = new Map<string, { onOutput?: (event: { data: string }) => void }>()

    Object.defineProperty(service, 'terminalService', {
      value: {
        hasTerminal: vi.fn(() => true),
        setActivityTracking: vi.fn(() => true),
        getInfo: vi.fn(() => ({ profileId: 'zsh' })),
        // A PTY that has drawn nothing yet: the login shell is still sourcing
        // rc files, so anything typed now would be discarded as typeahead.
        getTerminalSnapshot: vi.fn(() => ({ stdout: '' })),
        subscribe: vi.fn((terminalId: string, observer: Record<string, unknown>) => {
          observers.set(terminalId, observer)
          return () => observers.delete(terminalId)
        }),
        createResolvedTerminal: vi.fn(async () => ({
          success: true,
          terminalId: 'terminal-api',
        })),
        sendInput,
        killTerminal: vi.fn(() => true),
      },
    })
    Object.defineProperty(service, 'portBroker', {
      value: {
        acquirePort: vi.fn(async () => ({ port: 5173, requestedPort: 5173 })),
        releasePort: vi.fn(),
      },
    })
    Object.defineProperty(service, 'waitForReadyPort', { value: vi.fn(async () => 5173) })
    Object.defineProperty(service, 'waitForPortState', { value: vi.fn(async () => true) })

    const workspaceId = `workspace-${crypto.randomUUID()}`
    const started = service.start({
      ...options(workspaceId),
      auxiliaryProcesses: [
        {
          id: 'api',
          name: 'API',
          command: 'npm run api',
          cwd: '/tmp/project',
          projectRootPath: '/tmp/project',
          gitCwd: '/tmp/project',
        },
      ],
    })

    while (!observers.has('terminal-api')) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(sendInput).not.toHaveBeenCalledWith('terminal-api', 'npm run api\r')

    // The shell finishes booting and draws its prompt.
    observers.get('terminal-api')?.onOutput?.({ data: 'user@host project % ' })

    await expect(started).resolves.toMatchObject({ success: true })
    expect(sendInput).toHaveBeenCalledWith('terminal-api', 'npm run api\r')
  })

  it('returns a ready existing singleton without calling start', async () => {
    const service = new DevServerService()
    const start = vi.spyOn(service, 'start')
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const runKey = `${workspaceId}::collab`
    const processRegistry = (service as unknown as {
      processes: Map<string, Record<string, unknown>>
    }).processes
    processRegistry.set(runKey, {
      workspaceId,
      laneId: 'collab',
      runKey,
      runId: 'existing-run',
      activePort: 5173,
      ready: true,
    })

    const result = await service.ensure(options(workspaceId))

    expect(result).toEqual({
      success: true,
      port: 5173,
      runId: 'existing-run',
      existing: true,
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('coalesces concurrent ensure requests for the same workspace and lane', async () => {
    const service = new DevServerService()
    const workspaceId = `workspace-${crypto.randomUUID()}`
    let resolveStart!: (result: DevServerStartResult) => void
    const startResult = new Promise<DevServerStartResult>((resolve) => {
      resolveStart = resolve
    })
    const start = vi.spyOn(service, 'start').mockReturnValue(startResult)

    const first = service.ensure(options(workspaceId))
    const second = service.ensure(options(workspaceId))
    resolveStart({ success: true, port: 5199, runId: 'shared-run' })

    await expect(first).resolves.toMatchObject({ success: true, existing: false })
    await expect(second).resolves.toMatchObject({ success: true, existing: true })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('joins a launch already registered by another caller', async () => {
    const service = new DevServerService()
    const start = vi.spyOn(service, 'start')
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const runKey = `${workspaceId}::collab`
    const processRegistry = (service as unknown as {
      processes: Map<string, Record<string, unknown>>
    }).processes
    const launching = {
      workspaceId,
      laneId: 'collab',
      runKey,
      runId: 'launching-run',
      activePort: null,
      ready: false,
    }
    processRegistry.set(runKey, launching)
    setTimeout(() => {
      launching.activePort = 5277
      launching.ready = true
    }, 5)

    await expect(service.ensure(options(workspaceId))).resolves.toEqual({
      success: true,
      port: 5277,
      runId: 'launching-run',
      existing: true,
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('marks only the owning terminal detached while keeping the process running', () => {
    const service = new DevServerService()
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const runKey = `${workspaceId}::collab`
    const processRegistry = (service as unknown as {
      processes: Map<string, Record<string, unknown>>
    }).processes
    processRegistry.set(runKey, {
      workspaceId,
      laneId: 'collab',
      runKey,
      runId: 'headless-run',
      terminalId: 'owner-terminal',
      activePort: 5173,
      ready: true,
      phase: 'running',
      terminalDetached: false,
      auxiliaryProcesses: [
        {
          id: 'backend',
          name: 'Backend',
          terminalId: 'backend-terminal',
          running: true,
        },
      ],
    })

    expect(service.detachSurface(workspaceId, 'collab', 'other-terminal')).toEqual({
      success: true,
      ownsRuntime: false,
    })
    expect(service.getState(workspaceId, 'collab').headless).toBe(false)

    expect(service.detachSurface(workspaceId, 'collab', 'owner-terminal')).toEqual({
      success: true,
      ownsRuntime: true,
    })
    expect(service.getState(workspaceId, 'collab')).toMatchObject({
      running: true,
      ready: true,
      runId: 'headless-run',
      headless: true,
      terminalId: 'owner-terminal',
      processes: [
        expect.objectContaining({ id: 'primary', kind: 'primary' }),
        expect.objectContaining({ id: 'backend', kind: 'auxiliary', running: true }),
      ],
    })

    expect(service.attachSurface(workspaceId, 'collab', 'other-terminal')).toEqual({
      success: true,
      ownsRuntime: false,
    })
    expect(service.getState(workspaceId, 'collab').headless).toBe(true)

    expect(service.attachSurface(workspaceId, 'collab', 'owner-terminal')).toEqual({
      success: true,
      ownsRuntime: true,
    })
    expect(service.getState(workspaceId, 'collab').headless).toBe(false)
  })
})
