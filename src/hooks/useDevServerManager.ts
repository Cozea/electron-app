import { useState, useEffect, useCallback, useRef } from 'react'
import {
  checkDependenciesInstalled,
  detectPackageManager,
  getDevServerConfig,
  getInstallCommand,
  hasPackageJson,
} from '@/utils/projectDetector'
import {
  initialDevServerLifecycle,
  transitionDevServerLifecycle,
} from '@/features/projects/lib/devServerLifecycle'
import { getPreviewFailurePresentation } from '@/features/projects/lib/previewFailurePresentation'
import type { PreviewFailureReason } from '@shared/electronApiTypes'

export type DevServerStatus = 'idle' | 'starting' | 'ready' | 'unhealthy' | 'error' | 'stopped'

const STARTUP_SOFT_TIMEOUT_MS = 20_000
const STARTUP_HARD_TIMEOUT_MS = 120_000

interface UseDevServerManagerOptions {
  projectPath: string | null
  autoStart?: boolean
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
  output: string[]
  timeline: DevServerTimelineEvent[]
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

interface ReadyPattern {
  regex: RegExp
}

// Only treat output as "ready" when it exposes a concrete local URL/port.
const READY_PATTERNS = [
  { regex: /Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i },
  { regex: /ready on.*(?:localhost|127\.0\.0\.1):(\d+)/i },
  { regex: /listening on.*(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i },
  { regex: /started.*(?:localhost|127\.0\.0\.1):(\d+)/i },
  { regex: /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i },
  { regex: /➜\s+Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i }, // Vite format
] satisfies ReadyPattern[]

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
}

export function useDevServerManager({
  projectPath,
  autoStart = false,
  onReady,
  onError,
  onOutput,
}: UseDevServerManagerOptions) {
  const [state, setState] = useState<DevServerState>({
    status: 'idle',
    runId: null,
    url: null,
    port: null,
    reachable: false,
    failureReason: null,
    lastOutputAt: null,
    error: null,
    output: [],
    timeline: [],
  })

  const lifecycleRef = useRef(initialDevServerLifecycle())
  const activeRunIdRef = useRef<string | null>(null)
  const expectedPortRef = useRef<number | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const startupSoftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startupHardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWatchdogs = useCallback(() => {
    if (startupSoftTimeoutRef.current) {
      clearTimeout(startupSoftTimeoutRef.current)
      startupSoftTimeoutRef.current = null
    }
    if (startupHardTimeoutRef.current) {
      clearTimeout(startupHardTimeoutRef.current)
      startupHardTimeoutRef.current = null
    }
  }, [])

  const transitionLifecycle = useCallback((event: Parameters<typeof transitionDevServerLifecycle>[1]) => {
    const result = transitionDevServerLifecycle(lifecycleRef.current, event)
    if (result.applied) {
      lifecycleRef.current = result.next
    }
    return result
  }, [])

  const isStaleRunEvent = useCallback((runId: string | null | undefined) => {
    if (!runId) return false
    if (!activeRunIdRef.current) return false
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

  const markUnhealthy = useCallback((reason: string, failureReason: PreviewFailureReason = 'server_unreachable') => {
    const runId = activeRunIdRef.current
    if (runId) {
      transitionLifecycle({ type: 'unhealthy', runId, reason })
    }
    setState((prev) => ({
      ...prev,
      status: 'unhealthy',
      error: reason,
      failureReason,
    }))
    appendTimeline({
      runId,
      type: 'probe_failed',
      message: reason,
      details: { failureReason },
    })
  }, [appendTimeline, transitionLifecycle])

  const markReadyFromPort = useCallback(async (runId: string, port: number) => {
    if (isStaleRunEvent(runId)) return
    const url = `http://localhost:${port}`

    let probeReachable = true
    let failureReason: PreviewFailureReason | null = null
    let failureMessage: string | null = null

    if (window.electronAPI?.preview?.probeUrl) {
      try {
        const probe = await window.electronAPI.preview.probeUrl({ url, timeoutMs: 2500 })
        if (isStaleRunEvent(runId)) return
        if (!probe.success || !probe.reachable) {
          const failure = getPreviewFailurePresentation(
            probe.reason ?? 'server_unreachable',
            probe.error ?? 'Dev server did not respond to probe',
            { context: 'server' },
          )
          probeReachable = false
          failureReason = failure.reason
          failureMessage = failure.message
        }
      } catch (error) {
        if (isStaleRunEvent(runId)) return
        const failure = getPreviewFailurePresentation(
          'server_unreachable',
          error instanceof Error ? error.message : 'Dev server probe failed',
          { context: 'server' },
        )
        probeReachable = false
        failureReason = failure.reason
        failureMessage = failure.message
      }
    }

    if (!probeReachable) {
      markUnhealthy(failureMessage ?? 'Dev server did not respond to probe', failureReason ?? 'server_unreachable')
      return
    }

    appendTimeline({
      runId,
      type: 'ready_detected',
      message: `Ready signal validated for port ${port}`,
    })
    transitionLifecycle({ type: 'ready', runId })
    clearWatchdogs()
    setState((prev) => ({
      ...prev,
      status: 'ready',
      runId,
      url,
      port,
      reachable: true,
      failureReason: null,
      error: null,
    }))
    appendTimeline({
      runId,
      type: 'probe_succeeded',
      message: `Reachability probe succeeded for ${url}`,
    })
    onReady?.(url)
  }, [appendTimeline, clearWatchdogs, isStaleRunEvent, markUnhealthy, onReady, transitionLifecycle])

  const scheduleStartupWatchdogs = useCallback((runId: string) => {
    clearWatchdogs()
    startupSoftTimeoutRef.current = setTimeout(() => {
      if (isStaleRunEvent(runId)) return
      const status = lifecycleRef.current.state
      if (status === 'starting') {
        markUnhealthy('Dev server startup is taking longer than expected. Waiting for output...', 'server_unreachable')
      }
    }, STARTUP_SOFT_TIMEOUT_MS)

    startupHardTimeoutRef.current = setTimeout(() => {
      if (isStaleRunEvent(runId)) return
      const status = lifecycleRef.current.state
      if (status === 'starting' || status === 'unhealthy') {
        transitionLifecycle({ type: 'error', runId, reason: 'Dev server startup timed out' })
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Dev server startup timed out',
          failureReason: 'server_unreachable',
        }))
        onError?.('Dev server startup timed out')
      }
    }, STARTUP_HARD_TIMEOUT_MS)
  }, [clearWatchdogs, isStaleRunEvent, markUnhealthy, onError, transitionLifecycle])

  // Start the dev server
  const start = useCallback(async () => {
    if (!projectPath) return
    if (state.status === 'starting' || state.status === 'ready') return

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
      output: [],
      lastOutputAt: null,
    }))

    try {
      // Get dev server config (command and port)
      const config = await getDevServerConfig(projectPath)
      if (config.requiresUserSelection) {
        throw new Error('Dev server command selection is required. Open Project Pages and choose a command first.')
      }
      expectedPortRef.current = config.port

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
        runId: requestedRunId,
      })

      const resolvedRunId = result.runId ?? requestedRunId
      activeRunIdRef.current = resolvedRunId

      if (!result.success) {
        throw new Error(result.error || 'Failed to start dev server')
      }

      scheduleStartupWatchdogs(resolvedRunId)
      setState((prev) => ({
        ...prev,
        runId: resolvedRunId,
      }))
      console.log('[DevServer] Started with PID:', result.pid, `runId=${resolvedRunId}`)
      appendTimeline({
        runId: resolvedRunId,
        type: 'start_succeeded',
        message: 'Dev server process started',
        details: {
          pid: result.pid,
          existing: Boolean(result.existing),
        },
      })

      if (result.existing && config.port) {
        void markReadyFromPort(resolvedRunId, config.port)
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
      clearWatchdogs()
      onError?.(errorMessage)
    }
  }, [appendTimeline, clearWatchdogs, markReadyFromPort, onError, projectPath, scheduleStartupWatchdogs, state.status, transitionLifecycle])

  // Stop the dev server
  const stop = useCallback(async () => {
    if (!projectPath) return

    const currentRunId = activeRunIdRef.current

    try {
      await window.electronAPI.devServer.stop({ projectPath })
      if (currentRunId) {
        transitionLifecycle({ type: 'stopped', runId: currentRunId })
      }
      activeRunIdRef.current = null
      clearWatchdogs()
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
  }, [appendTimeline, clearWatchdogs, projectPath, transitionLifecycle])

  // Restart the dev server
  const restart = useCallback(async () => {
    await stop()
    // Small delay before restarting
    setTimeout(() => {
      start()
    }, 500)
  }, [stop, start])

  // Check if a line indicates the server is ready and extract port
  const checkForReady = useCallback(
    (line: string): number | null => {
      const cleaned = stripAnsi(line)
      for (const pattern of READY_PATTERNS) {
        const match = cleaned.match(pattern.regex)
        if (match) {
          const port = Number.parseInt(match[1] || '', 10)
          return Number.isFinite(port) ? port : null
        }
      }
      return null
    },
    []
  )

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

      // Append to output log
      setState((prev) => ({
        ...prev,
        output: [...prev.output.slice(-100), output], // Keep last 100 lines
        lastOutputAt: outputAt,
      }))
      appendTimeline({
        runId: resolvedRunId ?? null,
        type: 'output',
        message: 'Received dev server output',
      })

      onOutput?.(output)

      // Check if server is ready (for starting or unhealthy recovery)
      if (state.status === 'starting' || state.status === 'unhealthy') {
        const port = checkForReady(output)
        if (port && resolvedRunId) {
          console.log('[DevServer] Candidate ready signal detected at port:', port)
          void markReadyFromPort(resolvedRunId, port)
        } else if (port) {
          setState((prev) => ({
            ...prev,
            port,
            url: `http://localhost:${port}`,
          }))
        }
      }
    })

    const unsubExit = window.electronAPI.devServer.onExit(({ projectPath: path, code, runId }) => {
      if (path !== projectPath) return
      if (isStaleRunEvent(runId)) return

      console.log('[DevServer] Exited with code:', code)
      const resolvedRunId = runId ?? activeRunIdRef.current
      if (resolvedRunId) {
        if (code === 0) {
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
      clearWatchdogs()

      setState((prev) => ({
        ...prev,
        status: code === 0 ? 'stopped' : 'error',
        runId: null,
        error: code !== 0 ? `Dev server exited with code ${code}` : null,
        failureReason: code !== 0 ? 'server_unreachable' : null,
        reachable: false,
      }))
      appendTimeline({
        runId: resolvedRunId ?? null,
        type: 'exited',
        message: code === 0 ? 'Dev server exited cleanly' : `Dev server exited with code ${code}`,
      })
    })

    const unsubError = window.electronAPI.devServer.onError(({ projectPath: path, error }) => {
      if (path !== projectPath) return

      console.error('[DevServer] Error:', error)
      const runId = activeRunIdRef.current
      if (runId) {
        transitionLifecycle({ type: 'error', runId, reason: error })
      }
      clearWatchdogs()
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
  }, [appendTimeline, clearWatchdogs, isStaleRunEvent, markReadyFromPort, onError, onOutput, projectPath, state.status, checkForReady, transitionLifecycle])

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && projectPath && state.status === 'idle') {
      start()
    }
  }, [autoStart, projectPath, state.status, start])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRunIdRef.current && projectPath) {
        console.log('[DevServer] Cleaning up on unmount')
        window.electronAPI.devServer.stop({ projectPath }).catch(console.error)
      }
      clearWatchdogs()
    }
  }, [clearWatchdogs, projectPath])

  return {
    ...state,
    start,
    stop,
    restart,
    isRunning: state.status === 'starting' || state.status === 'ready' || state.status === 'unhealthy',
  }
}
