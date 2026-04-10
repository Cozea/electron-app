import { startTransition, useState, useEffect, useCallback, useRef } from 'react'
import {
  checkDependenciesInstalled,
  detectPackageManager,
  getDevServerConfig,
  getInstallCommand,
  hasPackageJson,
  type DevServerLaunchContext,
} from '@/utils/projectDetector'
import {
  initialDevServerLifecycle,
  transitionDevServerLifecycle,
} from '@/features/projects/lib/devServerLifecycle'
import { createDevServerRestartScheduler } from '@/hooks/devServerRestartScheduler'
import type { PreviewFailureReason } from '@shared/electronApiTypes'

export type DevServerStatus = 'idle' | 'starting' | 'ready' | 'unhealthy' | 'error' | 'stopped'

const RESTART_DELAY_MS = 500
const MAX_DEV_SERVER_OUTPUT_LENGTH = 80_000
const DEV_SERVER_OUTPUT_TRUNCATION_MESSAGE = '\n...dev server output truncated...\n'
const OUTPUT_TIMELINE_INTERVAL_MS = 1500

function appendDevServerOutput(current: string, chunk: string): string {
  const next = current + chunk
  if (next.length <= MAX_DEV_SERVER_OUTPUT_LENGTH) {
    return next
  }

  const tailLength = Math.max(0, MAX_DEV_SERVER_OUTPUT_LENGTH - DEV_SERVER_OUTPUT_TRUNCATION_MESSAGE.length)
  return `${DEV_SERVER_OUTPUT_TRUNCATION_MESSAGE}${next.slice(-tailLength)}`
}

interface UseDevServerManagerOptions {
  projectPath: string | null
  terminalId?: string | null
  autoStart?: boolean
  storedDevCommand?: string | null
  storedDevPort?: number | null
  previewMode?: DevServerLaunchContext['previewMode']
  nativePlatform?: DevServerLaunchContext['nativePlatform']
  keepAliveOnUnmount?: boolean
  initialSnapshot?: {
    running: boolean
    port: number | null
    runId: string | null
  } | null
  onReady?: (url: string) => void
  onError?: (error: string) => void
  onOutput?: (output: string) => void
}

interface DevServerState {
  status: DevServerStatus
  runId: string | null
  url: string | null
  port: number | null
  reachable: boolean
  failureReason: PreviewFailureReason | null
  lastOutputAt: number | null
  error: string | null
  output: string
  timeline: DevServerTimelineEvent[]
  latestDomSnapshot: string | null
}

interface DevServerTimelineEvent {
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

const MAX_TIMELINE_EVENTS = 80

export function useDevServerManager({
  projectPath,
  terminalId = null,
  autoStart = false,
  storedDevCommand = null,
  storedDevPort = null,
  previewMode = 'web',
  nativePlatform = null,
  keepAliveOnUnmount = false,
  initialSnapshot = null,
  onReady,
  onError,
  onOutput,
}: UseDevServerManagerOptions) {
  const [state, setState] = useState<DevServerState>({
    status: initialSnapshot?.running ? 'ready' : 'idle',
    runId: initialSnapshot?.runId ?? null,
    url: initialSnapshot?.port ? `http://localhost:${initialSnapshot.port}` : null,
    port: initialSnapshot?.port ?? null,
    reachable: Boolean(initialSnapshot?.running && initialSnapshot?.port),
    failureReason: null,
    lastOutputAt: null,
    error: null,
    output: '',
    timeline: [],
    latestDomSnapshot: null,
  })

  const lifecycleRef = useRef(initialDevServerLifecycle())
  const activeRunIdRef = useRef<string | null>(initialSnapshot?.runId ?? null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const restartSchedulerRef = useRef(createDevServerRestartScheduler(RESTART_DELAY_MS))
  const lastOutputTimelineAtRef = useRef(0)

  const transitionLifecycle = useCallback((event: Parameters<typeof transitionDevServerLifecycle>[1]) => {
    const result = transitionDevServerLifecycle(lifecycleRef.current, event)
    if (result.applied) {
      lifecycleRef.current = result.next
    }
    return result
  }, [])

  const isStaleRunEvent = useCallback((runId: string | null | undefined) => {
    if (!runId) return false
    return runId !== activeRunIdRef.current
  }, [])

  const appendTimeline = useCallback((event: Omit<DevServerTimelineEvent, 'id' | 'at'> & { at?: number }) => {
    setState((prev) => {
      const nextEvent: DevServerTimelineEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: event.at ?? Date.now(),
        ...event,
      }
      const merged = [...prev.timeline, nextEvent]
      const timeline = merged.length > MAX_TIMELINE_EVENTS
        ? merged.slice(merged.length - MAX_TIMELINE_EVENTS)
        : merged
      return {
        ...prev,
        timeline,
      }
    })
  }, [])

  useEffect(() => {
    if (!initialSnapshot?.running || !initialSnapshot.port) {
      return
    }

    activeRunIdRef.current = initialSnapshot.runId ?? activeRunIdRef.current
    setState((prev) => {
      const nextUrl = `http://localhost:${initialSnapshot.port}`
      if (
        prev.status === 'ready' &&
        prev.port === initialSnapshot.port &&
        prev.runId === (initialSnapshot.runId ?? prev.runId)
      ) {
        return prev
      }

      return {
        ...prev,
        status: 'ready',
        runId: initialSnapshot.runId ?? prev.runId,
        url: nextUrl,
        port: initialSnapshot.port,
        reachable: true,
        failureReason: null,
        error: null,
      }
    })
  }, [initialSnapshot?.port, initialSnapshot?.runId, initialSnapshot?.running])

  // Start the dev server
  const start = useCallback(async () => {
    if (!projectPath) return
    if (!terminalId) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: 'Dev server terminal is still preparing. Try again in a moment.',
        failureReason: 'server_unreachable',
      }))
      return
    }
    if (state.status === 'starting' || state.status === 'ready') return

    restartSchedulerRef.current.cancel()
    const requestedRunId = crypto?.randomUUID ? crypto.randomUUID() : `devsrv_${Date.now()}`
    activeRunIdRef.current = requestedRunId
    transitionLifecycle({ type: 'start_requested', runId: requestedRunId })
    appendTimeline({
      runId: requestedRunId,
      type: 'start_requested',
      message: 'Dev server start requested',
    })

    setState((prev) => ({
      ...prev,
      status: 'starting',
      runId: requestedRunId,
      reachable: false,
      failureReason: null,
      error: null,
      output: '',
      lastOutputAt: null,
    }))

    try {
      // Get dev server config (command and port)
      const config = await getDevServerConfig(projectPath, storedDevCommand, storedDevPort, {
        previewMode,
        nativePlatform,
      })
      if (config.requiresUserSelection) {
        throw new Error('Dev server command selection is required. Open the Workbench dev-server tile and choose a command first.')
      }

      let command = config.command
      const packageJsonExists = await hasPackageJson(projectPath)
      if (packageJsonExists) {
        const packageManager = await detectPackageManager(projectPath)
        const dependenciesInstalled = await checkDependenciesInstalled(projectPath, packageManager)
        if (!dependenciesInstalled) {
          command = `${getInstallCommand(packageManager)} && ${config.command}`
        }
      }

      console.log('[DevServer] Starting with config:', {
        ...config,
        command,
      })

      // Start the dev server
      const result = await window.electronAPI.devServer.start({
        projectPath,
        command,
        port: config.port,
        terminalId,
        runId: requestedRunId,
      })

      const resolvedRunId = result.runId ?? requestedRunId
      activeRunIdRef.current = resolvedRunId

      if (!result.success) {
        throw new Error(result.error || 'Failed to start dev server')
      }

      setState((prev) => ({
        ...prev,
        runId: resolvedRunId,
      }))
      console.log('[DevServer] Started successfully:', `runId=${resolvedRunId}`)
      appendTimeline({
        runId: resolvedRunId,
        type: 'start_succeeded',
        message: 'Dev server process started',
        details: {
          existing: Boolean(result.existing),
        },
      })

      if (result.port) {
        const url = `http://localhost:${result.port}`
        appendTimeline({
          runId: resolvedRunId,
          type: 'ready_detected',
          message: `Ready on ${url}`,
        })
        appendTimeline({
          runId: resolvedRunId,
          type: 'probe_succeeded',
          message: `Preview validated by the main process for ${url}`,
        })
        transitionLifecycle({ type: 'ready', runId: resolvedRunId })
        setState((prev) => ({
          ...prev,
          status: 'ready',
          runId: resolvedRunId,
          url,
          port: result.port ?? null,
          reachable: true,
          failureReason: null,
          error: null,
        }))
        onReady?.(url)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      const runId = activeRunIdRef.current
      if (runId) {
        transitionLifecycle({ type: 'error', runId, reason: errorMessage })
      }
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: errorMessage,
        failureReason: 'server_unreachable',
      }))
      appendTimeline({
        runId,
        type: 'error',
        message: errorMessage,
      })
      onError?.(errorMessage)
    }
  }, [
    appendTimeline,
    nativePlatform,
    onError,
    onReady,
    previewMode,
    projectPath,
    state.status,
    storedDevCommand,
    storedDevPort,
    terminalId,
    transitionLifecycle,
  ])

  // Stop the dev server
  const stop = useCallback(async () => {
    if (!projectPath) return

    const currentRunId = activeRunIdRef.current

    try {
      restartSchedulerRef.current.cancel()
      const result = await window.electronAPI.devServer.stop({ projectPath })
      if (!result.success) {
        if (result.error) {
          console.warn('[DevServer] Stop reported an error:', result.error)
        }
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: result.error ?? 'Failed to stop dev server',
          failureReason: 'server_unreachable',
        }))
        appendTimeline({
          runId: currentRunId,
          type: 'error',
          message: result.error ?? 'Failed to stop dev server',
        })
        return
      }

      if (currentRunId) {
        transitionLifecycle({ type: 'stopped', runId: currentRunId })
      }
      activeRunIdRef.current = null
      setState((prev) => ({
        ...prev,
        status: 'stopped',
        runId: null,
        url: null,
        port: null,
        reachable: false,
        failureReason: null,
      }))
      appendTimeline({
        runId: currentRunId,
        type: 'stopped',
        message: 'Dev server stopped',
      })
    } catch (err) {
      console.error('[DevServer] Failed to stop:', err)
    }
  }, [appendTimeline, projectPath, transitionLifecycle])

  // Restart the dev server
  const restart = useCallback(async () => {
    await stop()
    restartSchedulerRef.current.schedule(() => {
      void start()
    })
  }, [stop, start])

  // Listen for dev server output
  useEffect(() => {
    if (!projectPath) return

    const unsubOutput = window.electronAPI.devServer.onOutput(({ projectPath: path, output, runId }) => {
      if (path !== projectPath) return
      if (isStaleRunEvent(runId)) return

      const resolvedRunId = runId ?? activeRunIdRef.current
      if (resolvedRunId) {
        transitionLifecycle({ type: 'output', runId: resolvedRunId })
      }
      const outputAt = Date.now()

      startTransition(() => {
        setState((prev) => ({
          ...prev,
          output: appendDevServerOutput(prev.output, output),
          lastOutputAt: outputAt,
        }))
      })

      if (outputAt - lastOutputTimelineAtRef.current >= OUTPUT_TIMELINE_INTERVAL_MS) {
        lastOutputTimelineAtRef.current = outputAt
        appendTimeline({
          runId: resolvedRunId ?? null,
          type: 'output',
          message: 'Received dev server output',
          details: { bytes: output.length },
        })
      }

      onOutput?.(output)
    })

    const unsubExit = window.electronAPI.devServer.onExit(({ projectPath: path, code, runId }) => {
      if (path !== projectPath) return
      if (isStaleRunEvent(runId)) return

      console.log('[DevServer] Exited with code:', code)
      const resolvedRunId = runId ?? activeRunIdRef.current
      if (resolvedRunId) {
        if (code === 0 || code === null) {
          transitionLifecycle({ type: 'stopped', runId: resolvedRunId })
        } else {
          transitionLifecycle({
            type: 'error',
            runId: resolvedRunId,
            reason: `Dev server exited with code ${code}`,
          })
        }
      }
      activeRunIdRef.current = null

      setState((prev) => ({
        ...prev,
        status: (code === 0 || code === null) ? 'stopped' : 'error',
        runId: null,
        error: (code !== 0 && code !== null) ? `Dev server exited with code ${code}` : null,
        failureReason: (code !== 0 && code !== null) ? 'server_unreachable' : null,
        reachable: false,
      }))
      appendTimeline({
        runId: resolvedRunId ?? null,
        type: 'exited',
        message: (code === 0 || code === null) ? 'Dev server exited cleanly' : `Dev server exited with code ${code}`,
      })
    })

    const unsubError = window.electronAPI.devServer.onError(({ projectPath: path, error }) => {
      if (path !== projectPath) return

      console.error('[DevServer] Error:', error)
      const runId = activeRunIdRef.current
      if (runId) {
        transitionLifecycle({ type: 'error', runId, reason: error })
      }
      setState((prev) => ({
        ...prev,
        status: 'error',
        error,
        failureReason: 'server_unreachable',
      }))
      appendTimeline({
        runId,
        type: 'error',
        message: error,
      })
      onError?.(error)
    })

    cleanupRef.current = () => {
      unsubOutput()
      unsubExit()
      unsubError()
    }

    return () => {
      cleanupRef.current?.()
    }
  }, [appendTimeline, isStaleRunEvent, onError, onOutput, projectPath, transitionLifecycle])

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && projectPath && state.status === 'idle') {
      start()
    }
  }, [autoStart, projectPath, state.status, start])

  // Cleanup on unmount
  useEffect(() => {
    const scheduler = restartSchedulerRef.current
    return () => {
      scheduler.cancel()
      if (!keepAliveOnUnmount && activeRunIdRef.current && projectPath) {
        console.log('[DevServer] Cleaning up on unmount')
        window.electronAPI.devServer.stop({ projectPath }).catch(console.error)
      }
    }
  }, [keepAliveOnUnmount, projectPath])

  const setLatestDomSnapshot = useCallback((snapshot: string | null) => {
    setState((prev) => ({ ...prev, latestDomSnapshot: snapshot }))
  }, [])

  return {
    ...state,
    start,
    stop,
    restart,
    setLatestDomSnapshot,
    isRunning: state.status === 'starting' || state.status === 'ready' || state.status === 'unhealthy',
  }
}
