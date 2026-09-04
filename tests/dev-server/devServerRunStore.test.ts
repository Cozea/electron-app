import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/projectDetector', () => ({
  getDevServerConfig: vi.fn(async () => ({
    command: 'npm run dev',
    port: 5173,
    label: 'npm run dev',
    suggestions: [],
    requiresUserSelection: false,
    packageDirectory: null,
    commandVerified: true,
  })),
  hasPackageJson: vi.fn(async () => false),
  detectPackageManager: vi.fn(async () => 'npm'),
  checkDependenciesInstalled: vi.fn(async () => true),
  getInstallCommand: vi.fn(() => 'npm install'),
}))

import { getDevServerConfig } from '@/utils/projectDetector'

import {
  DEFAULT_DEV_SERVER_RUN,
  buildDevServerRunKey,
  ensureDevServerEventBridge,
  ensureDevServerRun,
  reportDevServerPreviewHttpStatus,
  reconcileDevServerRun,
  registerDevServerRunContext,
  restartDevServerRun,
  startDevServerRun,
  updateDevServerRunAuxiliaryProcesses,
  useDevServerRunStore,
  type DevServerRunContext,
} from '@/features/dev-server/devServerRunStore'
import {
  buildLocalDevServerUrl,
  getDevServerPreviewRecoveryKey,
  isSameDevServerPreviewUrl,
} from '@/features/dev-server/devServerTileCommands'

describe('dev server preview URLs', () => {
  it('uses IPv4 loopback for the managed preview URL', () => {
    expect(buildLocalDevServerUrl(4173)).toBe('http://127.0.0.1:4173')
  })

  it('treats persisted localhost overrides as the managed loopback URL', () => {
    expect(
      isSameDevServerPreviewUrl('http://localhost:4173/', 'http://127.0.0.1:4173'),
    ).toBe(true)
    expect(
      isSameDevServerPreviewUrl('http://localhost:5173/', 'http://127.0.0.1:4173'),
    ).toBe(false)
    expect(
      isSameDevServerPreviewUrl('http://[::1]:4173/', 'http://127.0.0.1:4173'),
    ).toBe(true)
  })

  it('retries a visible failed preview once the matching run is ready', () => {
    const readyFailure = {
      status: 'ready',
      runId: 'run-1',
      url: 'http://127.0.0.1:4173',
      loadError: 'ERR_CONNECTION_REFUSED',
      visible: true,
    }

    expect(getDevServerPreviewRecoveryKey(readyFailure)).toBe(
      'run-1\0http://127.0.0.1:4173',
    )
    expect(
      getDevServerPreviewRecoveryKey({
        ...readyFailure,
        loadError: 'A later rendering of the same native error',
      }),
    ).toBe('run-1\0http://127.0.0.1:4173')
  })

  it('does not retry before readiness or without a visible transport failure', () => {
    const base = {
      status: 'ready',
      runId: 'run-1',
      url: 'http://127.0.0.1:4173',
      loadError: 'ERR_CONNECTION_REFUSED',
      visible: true,
    }

    expect(getDevServerPreviewRecoveryKey({ ...base, status: 'starting' })).toBeNull()
    expect(getDevServerPreviewRecoveryKey({ ...base, loadError: null })).toBeNull()
    expect(getDevServerPreviewRecoveryKey({ ...base, runId: null })).toBeNull()
    expect(getDevServerPreviewRecoveryKey({ ...base, url: '' })).toBeNull()
    expect(getDevServerPreviewRecoveryKey({ ...base, visible: false })).toBeNull()
  })

  it('permits a fresh recovery for a new run or preview URL', () => {
    const input = {
      status: 'ready',
      runId: 'run-1',
      url: 'http://127.0.0.1:4173',
      loadError: 'ERR_CONNECTION_REFUSED',
      visible: true,
    }

    expect(getDevServerPreviewRecoveryKey({ ...input, runId: 'run-2' })).not.toBe(
      getDevServerPreviewRecoveryKey(input),
    )
    expect(getDevServerPreviewRecoveryKey({ ...input, url: `${input.url}/settings` })).not.toBe(
      getDevServerPreviewRecoveryKey(input),
    )
  })
})

type OutputHandler = (event: {
  workspaceId: string
  laneId?: string | null
  output: string
  stream: 'stdout' | 'stderr'
  runId?: string
}) => void
type ExitHandler = (event: {
  workspaceId: string
  laneId?: string | null
  code: number | null
  runId?: string
}) => void
type StateHandler = (event: {
  workspaceId: string
  laneId?: string | null
  running: boolean
  ready: boolean
  port: number | null
  runId: string | null
  phase: 'bootstrapping' | 'launching' | 'running' | null
  headless: boolean
  processes?: Array<{
    id: string
    name: string
    terminalId: string
    kind: 'primary' | 'auxiliary'
    running: boolean
  }>
}) => void

let outputHandler: OutputHandler
let exitHandler: ExitHandler
let stateHandler: StateHandler
const startMock = vi.fn()
const ensureMock = vi.fn()
const stopMock = vi.fn(async () => ({ success: true }))
const getStateMock = vi.fn(async () => ({
  running: false,
  ready: false,
  port: null,
  runId: null,
  phase: null,
  headless: false,
  processes: [],
}))
const getDevServerConfigMock = vi.mocked(getDevServerConfig)

function makeContext(workspaceId: string, overrides: Partial<DevServerRunContext> = {}): DevServerRunContext {
  return {
    workspaceId,
    laneId: null,
    sessionKey: null,
    framework: null,
    terminalId: 'term-1',
    storedDevCommand: null,
    storedDevPort: null,
    storedCommandSource: 'detected',
    previewMode: 'web',
    nativePlatform: null,
    auxiliaryProcesses: [],
    ...overrides,
  }
}

beforeAll(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      devServer: {
        start: startMock,
        ensure: ensureMock,
        stop: stopMock,
        getState: getStateMock,
        onStateChange: (callback: StateHandler) => {
          stateHandler = callback
          return () => {}
        },
        onOutput: (callback: OutputHandler) => {
          outputHandler = callback
          return () => {}
        },
        onExit: (callback: ExitHandler) => {
          exitHandler = callback
          return () => {}
        },
      },
    },
  })
  ensureDevServerEventBridge()
})

beforeEach(() => {
  startMock.mockReset()
  ensureMock.mockReset()
  stopMock.mockClear()
  getStateMock.mockReset()
  getStateMock.mockResolvedValue({
    running: false,
    ready: false,
    port: null,
    runId: null,
    phase: null,
    headless: false,
    processes: [],
  })
  getDevServerConfigMock.mockResolvedValue({
    command: 'npm run dev',
    port: 5173,
    label: 'npm run dev',
    suggestions: [],
    requiresUserSelection: false,
    packageDirectory: null,
    commandVerified: true,
  })
})

let keyCounter = 0
function freshWorkspace(): string {
  keyCounter += 1
  return `ws-${keyCounter}`
}

describe('buildDevServerRunKey', () => {
  it('normalizes missing/blank lanes to the collab default used by main', () => {
    expect(buildDevServerRunKey('ws-a')).toBe('ws-a::collab')
    expect(buildDevServerRunKey('ws-a', null)).toBe('ws-a::collab')
    expect(buildDevServerRunKey('ws-a', '  ')).toBe('ws-a::collab')
    expect(buildDevServerRunKey('ws-a', 'lane-7')).toBe('ws-a::lane-7')
  })
})

describe('startDevServerRun', () => {
  it('reaches ready with url/port and a coherent timeline on success', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      port: 5174,
      runId: options.runId,
    }))

    await startDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.status).toBe('ready')
    expect(run.url).toBe('http://127.0.0.1:5174')
    expect(run.port).toBe(5174)
    expect(run.reachable).toBe(true)
    expect(run.runId).toBeTruthy()
    expect(run.timeline.map((event) => event.type)).toEqual([
      'start_requested',
      'start_succeeded',
      'ready_detected',
      'probe_succeeded',
    ])
  })

  it('errors without a terminal in context and never calls IPC', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId, { terminalId: null }))

    await startDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.status).toBe('error')
    expect(run.error).toContain('terminal is still preparing')
    expect(startMock).not.toHaveBeenCalled()
  })

  it('ignores a second start while one is in flight', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    let resolveStart: (value: { success: boolean; port: number; runId?: string }) => void
    startMock.mockImplementation(
      (options: { runId?: string }) =>
        new Promise((resolve) => {
          resolveStart = (value) => resolve({ ...value, runId: options.runId })
        }),
    )

    const first = startDevServerRun(key)
    const second = startDevServerRun(key)
    await vi.waitFor(() => expect(startMock).toHaveBeenCalled())
    resolveStart!({ success: true, port: 5175 })
    await Promise.all([first, second])

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(useDevServerRunStore.getState().runs[key].status).toBe('ready')
  })

  it('surfaces IPC failure as error status', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockResolvedValue({ success: false, error: 'port busy' })

    await startDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.status).toBe('error')
    expect(run.error).toBe('port busy')
    expect(run.failureReason).toBe('server_unreachable')
  })

  it('errors instead of stranding starting when success carries no port', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      runId: options.runId,
    }))

    await startDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.status).toBe('error')
    expect(run.error).toContain('no reachable port')
    expect(run.failureReason).toBe('server_unreachable')
  })

  it('surfaces ranked command suggestions when discovery needs a user choice', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    getDevServerConfigMock.mockResolvedValue({
      command: 'npm run dev',
      port: 5173,
      label: 'Choose a command',
      suggestions: [
        {
          command: 'npm run dev',
          runtime: 'node',
          confidence: 0.8,
          reason: 'Found a dev script.',
        },
        {
          command: 'npm run web',
          runtime: 'node',
          confidence: 0.79,
          reason: 'Found a web script.',
        },
      ],
      requiresUserSelection: true,
      packageDirectory: null,
      commandVerified: false,
    })

    await startDevServerRun(key)

    expect(startMock).not.toHaveBeenCalled()
    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'error',
      error: 'Choose which command Cozea should use for this Dev Server.',
      requiresCommandSelection: true,
      commandSuggestions: [
        expect.objectContaining({ command: 'npm run dev' }),
        expect.objectContaining({ command: 'npm run web' }),
      ],
    })
  })

  it('starts the exact command selected in the tile chooser', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockResolvedValue({ success: true, port: 5190, runId: 'run-selected' })

    await startDevServerRun(key, { command: 'npm run web', port: 5190 })

    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm run web', port: 5190 }),
    )
    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'ready',
      port: 5190,
      requiresCommandSelection: false,
      commandSuggestions: [],
    })
  })

  it('passes project-local additional processes to the managed run', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    const auxiliaryProcesses = [
      {
        id: 'backend',
        name: 'Backend',
        command: 'bun run dev',
      },
    ]
    registerDevServerRunContext(key, makeContext(workspaceId, { auxiliaryProcesses }))
    startMock.mockResolvedValue({ success: true, port: 5191, runId: 'run-stack' })

    await startDevServerRun(key)

    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({ auxiliaryProcesses }),
    )
  })
})

describe('reportDevServerPreviewHttpStatus', () => {
  it('marks a live server unhealthy on HTTP 5xx and restores it after recovery', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      port: 5174,
      runId: options.runId,
    }))
    await startDevServerRun(key)

    reportDevServerPreviewHttpStatus(key, 500, 'Internal Server Error')
    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'unhealthy',
      reachable: true,
      failureReason: 'http_error_response',
      error: 'Preview returned HTTP 500 Internal Server Error',
    })

    reportDevServerPreviewHttpStatus(key, 200, 'OK')
    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'ready',
      reachable: true,
      failureReason: null,
      error: null,
    })
  })

  it('does not classify a route-level 404 as an unhealthy dev server', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      port: 5174,
      runId: options.runId,
    }))
    await startDevServerRun(key)

    reportDevServerPreviewHttpStatus(key, 404, 'Not Found')
    expect(useDevServerRunStore.getState().runs[key].status).toBe('ready')
  })
})

describe('ensureDevServerRun', () => {
  it('uses the idempotent ensure IPC path and projects an existing run as ready', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    ensureMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      existing: true,
      port: 5310,
      runId: options.runId,
    }))

    await ensureDevServerRun(key)

    expect(ensureMock).toHaveBeenCalledTimes(1)
    expect(startMock).not.toHaveBeenCalled()
    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'ready',
      port: 5310,
      url: 'http://127.0.0.1:5310',
    })
  })

  it('uses an explicit agent command and preferred port when detection is ambiguous', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    ensureMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      port: 4173,
      runId: options.runId,
    }))

    await ensureDevServerRun(key, {
      command: 'python3 -m http.server {port}',
      port: 4173,
    })

    expect(ensureMock).toHaveBeenCalledWith(expect.objectContaining({
      command: 'python3 -m http.server {port}',
      port: 4173,
    }))
    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'ready',
      port: 4173,
    })
  })
})

describe('restartDevServerRun', () => {
  it('does not schedule a start when the preceding stop failed', async () => {
    vi.useFakeTimers()
    try {
      const workspaceId = freshWorkspace()
      const key = buildDevServerRunKey(workspaceId)
      registerDevServerRunContext(key, makeContext(workspaceId))
      startMock.mockImplementation(async (options: { runId?: string }) => ({
        success: true,
        port: 5200,
        runId: options.runId,
      }))
      await startDevServerRun(key)
      expect(useDevServerRunStore.getState().runs[key].status).toBe('ready')

      stopMock.mockResolvedValueOnce({ success: false, error: 'port still held' })
      startMock.mockClear()

      await restartDevServerRun(key)

      // The scheduled start (if any) fires after RESTART_DELAY_MS.
      vi.advanceTimersByTime(2000)
      await Promise.resolve()

      const run = useDevServerRunStore.getState().runs[key]
      expect(run.status).toBe('error')
      expect(run.error).toBe('port still held')
      expect(startMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('schedules a start after a clean stop', async () => {
    vi.useFakeTimers()
    try {
      const workspaceId = freshWorkspace()
      const key = buildDevServerRunKey(workspaceId)
      registerDevServerRunContext(key, makeContext(workspaceId))
      startMock.mockImplementation(async (options: { runId?: string }) => ({
        success: true,
        port: 5201,
        runId: options.runId,
      }))
      await startDevServerRun(key)
      stopMock.mockResolvedValueOnce({ success: true })
      startMock.mockClear()

      await restartDevServerRun(key)
      await vi.advanceTimersByTimeAsync(2000)

      expect(startMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('restarts with a newly saved auxiliary-process configuration', async () => {
    vi.useFakeTimers()
    try {
      const workspaceId = freshWorkspace()
      const key = buildDevServerRunKey(workspaceId)
      registerDevServerRunContext(key, makeContext(workspaceId))
      startMock.mockImplementation(async (options: { runId?: string }) => ({
        success: true,
        port: 5202,
        runId: options.runId,
      }))
      await startDevServerRun(key)
      startMock.mockClear()

      const auxiliaryProcesses = [
        {
          id: 'api',
          name: 'API',
          command: 'bun run dev',
        },
      ]
      updateDevServerRunAuxiliaryProcesses(key, auxiliaryProcesses)

      await restartDevServerRun(key)
      await vi.advanceTimersByTimeAsync(2000)

      expect(startMock).toHaveBeenCalledWith(
        expect.objectContaining({ auxiliaryProcesses }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('event bridge', () => {
  async function readyRun(workspaceId: string): Promise<string> {
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      port: 5180,
      runId: options.runId,
    }))
    await startDevServerRun(key)
    return key
  }

  it('updates liveness from output events without accumulating output', async () => {
    const workspaceId = freshWorkspace()
    const key = await readyRun(workspaceId)
    const runId = useDevServerRunStore.getState().runs[key].runId!

    outputHandler({ workspaceId, laneId: null, output: 'compiled', stream: 'stdout', runId })

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.lastOutputAt).toBeTypeOf('number')
    expect('output' in run).toBe(false)
    expect(run.status).toBe('ready')
  })

  it('adopts a ready main-process state while a renderer start promise is pending', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    let resolveStart: (value: { success: boolean; port: number; runId: string }) => void
    startMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    )

    const start = startDevServerRun(key)
    await vi.waitFor(() => expect(startMock).toHaveBeenCalled())
    const requestedRunId = useDevServerRunStore.getState().runs[key].runId!

    stateHandler({
      workspaceId,
      laneId: null,
      running: true,
      ready: true,
      port: 4173,
      runId: requestedRunId,
      phase: 'running',
      headless: false,
    })

    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'ready',
      runId: requestedRunId,
      port: 4173,
      url: 'http://127.0.0.1:4173',
      reachable: true,
    })

    resolveStart!({ success: true, port: 4173, runId: requestedRunId })
    await start
  })

  it('clears a ready mirror when main reports the singleton stopped', async () => {
    const workspaceId = freshWorkspace()
    const key = await readyRun(workspaceId)

    stateHandler({
      workspaceId,
      laneId: null,
      running: false,
      ready: false,
      port: null,
      runId: null,
      phase: null,
      headless: false,
    })

    expect(useDevServerRunStore.getState().runs[key]).toMatchObject({
      status: 'stopped',
      runId: null,
      url: null,
      port: null,
      reachable: false,
    })
  })

  it('drops events from stale runs', async () => {
    const workspaceId = freshWorkspace()
    const key = await readyRun(workspaceId)

    exitHandler({ workspaceId, laneId: null, code: 1, runId: 'someone-elses-run' })

    expect(useDevServerRunStore.getState().runs[key].status).toBe('ready')
  })

  it('marks clean exits stopped and dirty exits error', async () => {
    const cleanWorkspace = freshWorkspace()
    const cleanKey = await readyRun(cleanWorkspace)
    const cleanRunId = useDevServerRunStore.getState().runs[cleanKey].runId!
    exitHandler({ workspaceId: cleanWorkspace, laneId: null, code: 0, runId: cleanRunId })
    const cleanRun = useDevServerRunStore.getState().runs[cleanKey]
    expect(cleanRun.status).toBe('stopped')
    expect(cleanRun.url).toBeNull()
    expect(cleanRun.runId).toBeNull()

    const dirtyWorkspace = freshWorkspace()
    const dirtyKey = await readyRun(dirtyWorkspace)
    const dirtyRunId = useDevServerRunStore.getState().runs[dirtyKey].runId!
    exitHandler({ workspaceId: dirtyWorkspace, laneId: null, code: 137, runId: dirtyRunId })
    const dirtyRun = useDevServerRunStore.getState().runs[dirtyKey]
    expect(dirtyRun.status).toBe('error')
    expect(dirtyRun.error).toContain('137')
  })

  it('keeps the timeline bounded', async () => {
    const workspaceId = freshWorkspace()
    const key = await readyRun(workspaceId)
    const runId = useDevServerRunStore.getState().runs[key].runId!

    // The per-key throttle only admits one 'output' timeline entry per
    // interval; this asserts the cap logic rather than flooding it.
    for (let index = 0; index < 200; index += 1) {
      outputHandler({ workspaceId, laneId: null, output: 'x', stream: 'stdout', runId })
    }

    expect(useDevServerRunStore.getState().runs[key].timeline.length).toBeLessThanOrEqual(80)
  })
})

describe('reconcileDevServerRun', () => {
  it('adopts a ready run reported by main on a cold mirror', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    getStateMock.mockResolvedValue({
      running: true,
      ready: true,
      port: 4321,
      runId: 'main-run',
      phase: 'running',
      headless: false,
    })

    await reconcileDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.status).toBe('ready')
    expect(run.url).toBe('http://127.0.0.1:4321')
    expect(run.runId).toBe('main-run')
  })

  it('downgrades a stale ready belief when main reports nothing running', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    startMock.mockImplementation(async (options: { runId?: string }) => ({
      success: true,
      port: 5190,
      runId: options.runId,
    }))
    await startDevServerRun(key)
    expect(useDevServerRunStore.getState().runs[key].status).toBe('ready')

    getStateMock.mockResolvedValue({
      running: false,
      ready: false,
      port: null,
      runId: null,
      phase: null,
      headless: false,
    })
    await reconcileDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key]
    expect(run.status).toBe('stopped')
    expect(run.url).toBeNull()
  })

  it('leaves an idle mirror alone when main reports nothing running', async () => {
    const workspaceId = freshWorkspace()
    const key = buildDevServerRunKey(workspaceId)
    registerDevServerRunContext(key, makeContext(workspaceId))
    getStateMock.mockResolvedValue({
      running: false,
      ready: false,
      port: null,
      runId: null,
      phase: null,
      headless: false,
    })

    await reconcileDevServerRun(key)

    const run = useDevServerRunStore.getState().runs[key] ?? DEFAULT_DEV_SERVER_RUN
    expect(run.status).toBe('idle')
  })
})
