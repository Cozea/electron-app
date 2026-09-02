import { create, type StoreApi, type UseBoundStore } from 'zustand'

import {
  checkDependenciesInstalled,
  detectPackageManager,
  getDevServerConfig,
  getInstallCommand,
  hasPackageJson,
  type DevServerLaunchContext,
} from '@/utils/projectDetector'
import { buildLocalDevServerUrl } from './devServerTileCommands'
import {
  initialDevServerLifecycle,
  transitionDevServerLifecycle,
  type DevServerLifecycleEvent,
  type DevServerLifecycleSnapshot,
} from '@/features/projects/lib/devServerLifecycle'
import {
  createDevServerRestartScheduler,
  type DevServerRestartScheduler,
} from '@/hooks/devServerRestartScheduler'
import type {
  DevCommandSuggestion,
  DevServerProcessState,
  DevServerProcessStateEvent,
  PreviewFailureReason,
} from '@shared/electronApiTypes'

export type DevServerStatus = 'idle' | 'starting' | 'ready' | 'unhealthy' | 'error' | 'stopped'

export interface DevServerTimelineEvent {
  id: string
  at: number
  runId: string | null
  type:
    | 'start_requested'
    | 'start_succeeded'
    | 'output'
    | 'ready_detected'
    | 'probe_succeeded'
    | 'probe_failed'
    | 'error'
    | 'stopped'
    | 'exited'
  message: string
  details?: Record<string, unknown>
}

export interface DevServerRunState {
  status: DevServerStatus
  runId: string | null
  url: string | null
  port: number | null
  reachable: boolean
  failureReason: PreviewFailureReason | null
  lastOutputAt: number | null
  error: string | null
  requiresCommandSelection: boolean
  commandSuggestions: DevCommandSuggestion[]
  timeline: DevServerTimelineEvent[]
}

/**
 * Launch ingredients a mounted tile contributes for its run key: which
 * terminal hosts the process and how to detect the command. Sticky across
 * unmounts so stop/reconcile keep working after the tile goes away; when the
 * web tile and the simulator tile are both open for the same key, the last
 * registrant wins (they share one process in main anyway).
 */
export interface DevServerRunContext {
  workspaceId: string
  laneId: string | null
  sessionKey: string | null
  framework: string | null
  terminalId: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  storedCommandSource: DevServerLaunchContext['storedCommandSource']
  previewMode: DevServerLaunchContext['previewMode']
  nativePlatform: DevServerLaunchContext['nativePlatform']
}

export interface DevServerEnsureOptions {
  command?: string
  port?: number
}

interface DevServerRunStoreState {
  runs: Record<string, DevServerRunState>
  contexts: Record<string, DevServerRunContext>
}

export const DEFAULT_DEV_SERVER_RUN: DevServerRunState = Object.freeze({
  status: 'idle',
  runId: null,
  url: null,
  port: null,
  reachable: false,
  failureReason: null,
  lastOutputAt: null,
  error: null,
  requiresCommandSelection: false,
  commandSuggestions: [],
  timeline: [],
}) as DevServerRunState

const MAX_TIMELINE_EVENTS = 80
const OUTPUT_TIMELINE_INTERVAL_MS = 1500
const RESTART_DELAY_MS = 500
// Must match DevServerService's DEFAULT_LANE_ID — run keys are shared
// vocabulary between this mirror and the main-process registry.
const DEFAULT_LANE_ID = 'collab'

export function buildDevServerRunKey(workspaceId: string, laneId?: string | null): string {
  const trimmed = laneId?.trim()
  return `${workspaceId}::${trimmed && trimmed.length > 0 ? trimmed : DEFAULT_LANE_ID}`
}

export function clearDevServerRunsForWorkspace(workspaceId: string): void {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) return

  const prefix = `${normalizedWorkspaceId}::`
  const keys = new Set([
    ...Object.keys(runtime.store.getState().runs),
    ...Object.keys(runtime.store.getState().contexts),
  ].filter((key) => key.startsWith(prefix)))
  if (keys.size === 0) return

  runtime.store.setState((state) => ({
    runs: Object.fromEntries(
      Object.entries(state.runs).filter(([key]) => !keys.has(key)),
    ),
    contexts: Object.fromEntries(
      Object.entries(state.contexts).filter(([key]) => !keys.has(key)),
    ),
  }))

  for (const key of keys) {
    runtime.schedulers.get(key)?.cancel()
    runtime.schedulers.delete(key)
    runtime.lifecycles.delete(key)
    runtime.pendingStarts.delete(key)
    runtime.lastOutputTimelineAt.delete(key)
  }
}

interface DevServerRunRuntime {
  store: UseBoundStore<StoreApi<DevServerRunStoreState>>
  lifecycles: Map<string, DevServerLifecycleSnapshot>
  schedulers: Map<string, DevServerRestartScheduler>
  pendingStarts: Set<string>
  lastOutputTimelineAt: Map<string, number>
  bridgeInstalled: boolean
}

// Anchored on globalThis, not module scope: this module sits on the exact
// seam that broke the header-controls registry — the dock header and the
// panel content import it through different chains, and Vite's dev server
// can serve two live instances (`?t=` re-transforms after HMR). Two store
// instances would put the header and the tile back in split-brain.
const RUNTIME_KEY = Symbol.for('cozea.devServerRunRuntime')
const runtimeHost = globalThis as { [RUNTIME_KEY]?: DevServerRunRuntime }
const runtime: DevServerRunRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  store: create<DevServerRunStoreState>(() => ({ runs: {}, contexts: {} })),
  lifecycles: new Map(),
  schedulers: new Map(),
  pendingStarts: new Set(),
  lastOutputTimelineAt: new Map(),
  bridgeInstalled: false,
})

export const useDevServerRunStore = runtime.store

function getRun(key: string): DevServerRunState {
  return runtime.store.getState().runs[key] ?? DEFAULT_DEV_SERVER_RUN
}

function setRun(key: string, update: (prev: DevServerRunState) => DevServerRunState): void {
  runtime.store.setState((state) => {
    const prev = state.runs[key] ?? DEFAULT_DEV_SERVER_RUN
    const next = update(prev)
    if (next === prev) return state
    return { runs: { ...state.runs, [key]: next } }
  })
}

function transitionLifecycle(key: string, event: DevServerLifecycleEvent): void {
  const current = runtime.lifecycles.get(key) ?? initialDevServerLifecycle()
  const result = transitionDevServerLifecycle(current, event)
  if (result.applied) {
    runtime.lifecycles.set(key, result.next)
  }
}

function getScheduler(key: string): DevServerRestartScheduler {
  let scheduler = runtime.schedulers.get(key)
  if (!scheduler) {
    scheduler = createDevServerRestartScheduler(RESTART_DELAY_MS)
    runtime.schedulers.set(key, scheduler)
  }
  return scheduler
}

function appendTimeline(
  key: string,
  event: Omit<DevServerTimelineEvent, 'id' | 'at'> & { at?: number },
): void {
  setRun(key, (prev) => {
    const nextEvent: DevServerTimelineEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: event.at ?? Date.now(),
      runId: event.runId,
      type: event.type,
      message: event.message,
      ...(event.details ? { details: event.details } : {}),
    }
    const merged = [...prev.timeline, nextEvent]
    return {
      ...prev,
      timeline: merged.length > MAX_TIMELINE_EVENTS
        ? merged.slice(merged.length - MAX_TIMELINE_EVENTS)
        : merged,
    }
  })
}

export function reportDevServerPreviewHttpStatus(
  key: string,
  statusCode: number | null | undefined,
  statusText?: string | null,
): void {
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) return

  const current = getRun(key)
  if (current.status !== 'ready' && current.status !== 'unhealthy') return

  if (statusCode >= 500) {
    const normalizedStatusText = statusText?.trim() ?? ''
    const message = `Preview returned HTTP ${statusCode}${normalizedStatusText ? ` ${normalizedStatusText}` : ''}`
    if (
      current.status === 'unhealthy' &&
      current.failureReason === 'http_error_response' &&
      current.error === message
    ) {
      return
    }
    setRun(key, (prev) => ({
      ...prev,
      status: 'unhealthy',
      reachable: true,
      failureReason: 'http_error_response',
      error: message,
    }))
    appendTimeline(key, {
      runId: current.runId,
      type: 'probe_failed',
      message,
      details: { statusCode },
    })
    return
  }

  if (current.status !== 'unhealthy' || current.failureReason !== 'http_error_response') {
    return
  }
  setRun(key, (prev) => ({
    ...prev,
    status: 'ready',
    reachable: true,
    failureReason: null,
    error: null,
  }))
  appendTimeline(key, {
    runId: current.runId,
    type: 'probe_succeeded',
    message: `Preview recovered with HTTP ${statusCode}`,
    details: { statusCode },
  })
}

function isStaleRunEvent(key: string, runId: string | null | undefined): boolean {
  if (!runId) return false
  return runId !== getRun(key).runId
}

function applyAuthoritativeProcessState(
  key: string,
  processState: DevServerProcessState,
  options: { preserveIdle: boolean },
): void {
  if (processState.running && processState.ready && processState.port) {
    const url = buildLocalDevServerUrl(processState.port)
    runtime.lifecycles.set(key, {
      ...initialDevServerLifecycle(),
      runId: processState.runId,
      state: 'ready',
      readyAt: Date.now(),
    })
    setRun(key, (prev) => {
      if (
        prev.status === 'ready' &&
        prev.port === processState.port &&
        prev.runId === (processState.runId ?? prev.runId)
      ) {
        return prev
      }
      return {
        ...prev,
        status: 'ready',
        runId: processState.runId ?? prev.runId,
        url,
        port: processState.port,
        reachable: true,
        failureReason: null,
        error: null,
        requiresCommandSelection: false,
        commandSuggestions: [],
      }
    })
    return
  }

  if (processState.running) {
    setRun(key, (prev) =>
      prev.status === 'starting' && prev.runId === (processState.runId ?? prev.runId)
        ? prev
        : {
            ...prev,
            status: 'starting',
            runId: processState.runId ?? prev.runId,
            url: null,
            port: processState.port,
            reachable: false,
            failureReason: null,
            error: null,
            requiresCommandSelection: false,
            commandSuggestions: [],
          },
    )
    return
  }

  setRun(key, (prev) => {
    if (options.preserveIdle && prev.status === 'idle') return prev
    if (runtime.pendingStarts.has(key)) return prev
    const preserveError = prev.status === 'error'
    return {
      ...prev,
      status: preserveError ? 'error' : 'stopped',
      runId: null,
      url: null,
      port: null,
      reachable: false,
      failureReason: preserveError ? prev.failureReason : null,
      error: preserveError ? prev.error : null,
    }
  })
}

export function registerDevServerRunContext(key: string, context: DevServerRunContext): void {
  runtime.store.setState((state) => {
    const prev = state.contexts[key]
    if (
      prev &&
      prev.workspaceId === context.workspaceId &&
      prev.laneId === context.laneId &&
      prev.sessionKey === context.sessionKey &&
      prev.framework === context.framework &&
      prev.terminalId === context.terminalId &&
      prev.storedDevCommand === context.storedDevCommand &&
      prev.storedDevPort === context.storedDevPort &&
      prev.storedCommandSource === context.storedCommandSource &&
      prev.previewMode === context.previewMode &&
      prev.nativePlatform === context.nativePlatform
    ) {
      return state
    }
    return { contexts: { ...state.contexts, [key]: context } }
  })
}

/**
 * One renderer-wide subscription to the dev-server event channels. Events
 * update the keyed mirror regardless of which tiles are mounted, so a project
 * switch can no longer eat an exit event and leave a tile believing in a dead
 * server. Output is NOT accumulated — the bound PTY terminal is the log
 * surface; here it only feeds liveness (lastOutputAt) and a bounded timeline.
 */
export function ensureDevServerEventBridge(): void {
  if (runtime.bridgeInstalled) return
  if (typeof window === 'undefined' || !window.electronAPI?.devServer) return
  runtime.bridgeInstalled = true

  window.electronAPI.devServer.onStateChange((processState: DevServerProcessStateEvent) => {
    const key = buildDevServerRunKey(processState.workspaceId, processState.laneId)
    applyAuthoritativeProcessState(key, processState, { preserveIdle: true })
  })

  window.electronAPI.devServer.onOutput(({ workspaceId, laneId, output, runId }) => {
    const key = buildDevServerRunKey(workspaceId, laneId)
    if (isStaleRunEvent(key, runId)) return

    const resolvedRunId = runId ?? getRun(key).runId
    if (resolvedRunId) {
      transitionLifecycle(key, { type: 'output', runId: resolvedRunId })
    }
    const outputAt = Date.now()
    setRun(key, (prev) => ({ ...prev, lastOutputAt: outputAt }))

    if (outputAt - (runtime.lastOutputTimelineAt.get(key) ?? 0) >= OUTPUT_TIMELINE_INTERVAL_MS) {
      runtime.lastOutputTimelineAt.set(key, outputAt)
      appendTimeline(key, {
        runId: resolvedRunId ?? null,
        type: 'output',
        message: 'Received dev server output',
        details: { bytes: output.length },
      })
    }
  })

  window.electronAPI.devServer.onExit(({ workspaceId, laneId, code, runId }) => {
    const key = buildDevServerRunKey(workspaceId, laneId)
    if (isStaleRunEvent(key, runId)) return

    const resolvedRunId = runId ?? getRun(key).runId
    const clean = code === 0 || code === null
    if (resolvedRunId) {
      transitionLifecycle(
        key,
        clean
          ? { type: 'stopped', runId: resolvedRunId }
          : { type: 'error', runId: resolvedRunId, reason: `Dev server exited with code ${code}` },
      )
    }
    setRun(key, (prev) => ({
      ...prev,
      status: clean ? 'stopped' : 'error',
      runId: null,
      url: null,
      port: null,
      reachable: false,
      error: clean ? null : `Dev server exited with code ${code}`,
      failureReason: clean ? null : 'server_unreachable',
    }))
    appendTimeline(key, {
      runId: resolvedRunId ?? null,
      type: 'exited',
      message: clean ? 'Dev server exited cleanly' : `Dev server exited with code ${code}`,
    })
  })
}

/**
 * Re-sync one run from the main process (the source of truth). Useful on
 * tile mount and window re-focus: the mirror may have missed events while no
 * renderer code was listening (reload) or main may have outlived a renderer
 * belief. Never downgrades a run with a start() in flight.
 */
export async function reconcileDevServerRun(key: string): Promise<void> {
  const context = runtime.store.getState().contexts[key]
  if (!context) return

  let processState
  try {
    processState = await window.electronAPI.devServer.getState({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    })
  } catch {
    return
  }

  if (runtime.pendingStarts.has(key)) return

  applyAuthoritativeProcessState(key, processState, { preserveIdle: true })
}

async function launchDevServerRun(
  key: string,
  mode: 'start' | 'ensure',
  ensureOptions?: DevServerEnsureOptions,
): Promise<void> {
  const context = runtime.store.getState().contexts[key]
  if (!context?.workspaceId) return
  if (!context.terminalId) {
    setRun(key, (prev) => ({
      ...prev,
      status: 'error',
      error: 'Dev server terminal is still preparing. Try again in a moment.',
      failureReason: 'server_unreachable',
    }))
    return
  }

  const current = getRun(key)
  if (current.status === 'starting' || current.status === 'ready') return
  if (runtime.pendingStarts.has(key)) return

  getScheduler(key).cancel()
  const requestedRunId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `devsrv_${Date.now()}`
  transitionLifecycle(key, { type: 'start_requested', runId: requestedRunId })
  appendTimeline(key, {
    runId: requestedRunId,
    type: 'start_requested',
    message: 'Dev server start requested',
  })
  setRun(key, (prev) => ({
    ...prev,
    status: 'starting',
    runId: requestedRunId,
    reachable: false,
    failureReason: null,
    error: null,
    requiresCommandSelection: false,
    commandSuggestions: [],
    lastOutputAt: null,
  }))

  runtime.pendingStarts.add(key)
  try {
    const explicitCommand = ensureOptions?.command?.trim() || null
    const config = explicitCommand
      ? {
          command: explicitCommand,
          port:
            typeof ensureOptions?.port === 'number' &&
            Number.isInteger(ensureOptions.port) &&
            ensureOptions.port > 0 &&
            ensureOptions.port <= 65_535
              ? ensureOptions.port
              : (context.storedDevPort ?? 5173),
          label: 'Agent Dev Server',
          suggestions: [],
          requiresUserSelection: false,
          packageDirectory: null,
          commandVerified: false,
        }
      : await getDevServerConfig(
          context.workspaceId,
          context.storedDevCommand,
          context.storedDevPort,
          {
            previewMode: context.previewMode,
            nativePlatform: context.nativePlatform,
            storedCommandSource: context.storedCommandSource,
          },
        )
    if (config.requiresUserSelection) {
      const message =
        config.suggestions.length > 0
          ? 'Choose which command Cozea should use for this Dev Server.'
          : 'No supported Dev Server command was found. Add a dev, web, start, develop, or serve script, or build a static site into dist, build, out, or public.'
      setRun(key, (prev) => ({
        ...prev,
        requiresCommandSelection: true,
        commandSuggestions: config.suggestions,
      }))
      throw new Error(
        message,
      )
    }

    const packageDirectory = config.packageDirectory
    let bootstrapCommand: string | null = null
    if (await hasPackageJson(context.workspaceId, packageDirectory)) {
      const packageManager = await detectPackageManager(context.workspaceId, packageDirectory)
      const dependenciesInstalled = await checkDependenciesInstalled(
        context.workspaceId,
        packageManager,
        packageDirectory,
      )
      if (!dependenciesInstalled) {
        bootstrapCommand = getInstallCommand(packageManager, packageDirectory)
      }
    }

    console.log('[DevServer] Starting with config:', { ...config, bootstrapCommand })

    const launch = mode === 'ensure'
      ? window.electronAPI.devServer.ensure
      : window.electronAPI.devServer.start
    const result = await launch({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
      command: config.command,
      bootstrapCommand,
      port: config.port,
      sessionKey: context.sessionKey,
      framework: context.framework,
      terminalId: context.terminalId,
      runId: requestedRunId,
    })

    const resolvedRunId = result.runId ?? requestedRunId
    if (resolvedRunId !== requestedRunId) {
      setRun(key, (prev) => ({ ...prev, runId: resolvedRunId }))
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to start dev server')
    }

    appendTimeline(key, {
      runId: resolvedRunId,
      type: 'start_succeeded',
      message: 'Dev server process started',
      details: { existing: Boolean(result.existing) },
    })

    if (result.port) {
      const url = buildLocalDevServerUrl(result.port)
      appendTimeline(key, { runId: resolvedRunId, type: 'ready_detected', message: `Ready on ${url}` })
      appendTimeline(key, {
        runId: resolvedRunId,
        type: 'probe_succeeded',
        message: `Preview validated by the main process for ${url}`,
      })
      transitionLifecycle(key, { type: 'ready', runId: resolvedRunId })
      setRun(key, (prev) => ({
        ...prev,
        status: 'ready',
        runId: resolvedRunId,
        url,
        port: result.port ?? null,
        reachable: true,
        failureReason: null,
        error: null,
        requiresCommandSelection: false,
        commandSuggestions: [],
      }))
    } else {
      // A success without a reachable port can't surface a preview, and there
      // is no renderer-side probe or timeout to rescue it — leaving the run in
      // 'starting' would strand the tile on a permanent spinner. Treat it as an
      // error so the user gets a recoverable Stop/Retry state instead.
      throw new Error('Dev server started but reported no reachable port')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const failedRunId = getRun(key).runId
    if (failedRunId) {
      transitionLifecycle(key, { type: 'error', runId: failedRunId, reason: message })
    }
    setRun(key, (prev) => ({
      ...prev,
      status: 'error',
      error: message,
      failureReason: 'server_unreachable',
    }))
    appendTimeline(key, { runId: failedRunId, type: 'error', message })
  } finally {
    runtime.pendingStarts.delete(key)
  }
}

export async function startDevServerRun(
  key: string,
  options?: DevServerEnsureOptions,
): Promise<void> {
  await launchDevServerRun(key, 'start', options)
}

/** Agent/headless-safe launch: reuse the workspace/lane singleton if present. */
export async function ensureDevServerRun(
  key: string,
  options?: DevServerEnsureOptions,
): Promise<void> {
  await reconcileDevServerRun(key)
  await launchDevServerRun(key, 'ensure', options)
}

/**
 * Returns true when the stop succeeded (run is now 'stopped'); false when main
 * reported a failed stop or the IPC threw, in which case the run was left in
 * 'error' and the underlying process may still be alive. Callers that chain a
 * start (restart) must honor a false result.
 */
export async function stopDevServerRun(key: string): Promise<boolean> {
  const context = runtime.store.getState().contexts[key]
  if (!context?.workspaceId) return false

  const currentRunId = getRun(key).runId

  try {
    getScheduler(key).cancel()
    const result = await window.electronAPI.devServer.stop({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    })
    if (!result.success) {
      if (result.error) {
        console.warn('[DevServer] Stop reported an error:', result.error)
      }
      setRun(key, (prev) => ({
        ...prev,
        status: 'error',
        error: result.error ?? 'Failed to stop dev server',
        failureReason: 'server_unreachable',
      }))
      appendTimeline(key, {
        runId: currentRunId,
        type: 'error',
        message: result.error ?? 'Failed to stop dev server',
      })
      return false
    }

    if (currentRunId) {
      transitionLifecycle(key, { type: 'stopped', runId: currentRunId })
    }
    setRun(key, (prev) => ({
      ...prev,
      status: 'stopped',
      runId: null,
      url: null,
      port: null,
      reachable: false,
      failureReason: null,
    }))
    appendTimeline(key, { runId: currentRunId, type: 'stopped', message: 'Dev server stopped' })
    return true
  } catch (error) {
    console.error('[DevServer] Failed to stop:', error)
    return false
  }
}

export async function restartDevServerRun(key: string): Promise<void> {
  // If the stop failed, main left the run in 'error' with the process possibly
  // still holding its port. Scheduling a start over that would flip the UI to a
  // misleading 'starting' and provoke a second failed stop in main — bail and
  // surface the stop error instead.
  const stopped = await stopDevServerRun(key)
  if (!stopped) return

  getScheduler(key).schedule(() => {
    void startDevServerRun(key)
  })
}

export function isDevServerRunActive(status: DevServerStatus): boolean {
  return status === 'starting' || status === 'ready' || status === 'unhealthy'
}
