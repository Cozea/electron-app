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
import { createDevServerRestartScheduler } from '@/hooks/devServerRestartScheduler'
import type { PreviewFailureReason } from '@shared/electronApiTypes'

export type DevServerStatus = 'idle' | 'starting' | 'ready' | 'unhealthy' | 'error' | 'stopped'

const RESTART_DELAY_MS = 500

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
    latestDomSnapshot: null,
  })

  const lifecycleRef = useRef(initialDevServerLifecycle())
  const activeRunIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const restartSchedulerRef = useRef(createDevServerRestartScheduler(RESTART_DELAY_MS))

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

    setState((prev) => ({
      ...prev,
      runId,
      url,
      port,
      reachable: false,
      failureReason: null,
      error: null,
    }))

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
  }, [appendTimeline, isStaleRunEvent, markUnhealthy, onReady, transitionLifecycle])

  // Start the dev server
  const start = useCallback(async () => {
    if (!projectPath) return
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
      output: [],
      lastOutputAt: null,
    }))

    try {
      // Get dev server config (command and port)
      const config = await getDevServerConfig(projectPath)
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
         void markReadyFromPort(resolvedRunId, result.port)
      } else if (result.existing && config.port) {
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
      onError?.(errorMessage)
    }
  }, [appendTimeline, markReadyFromPort, onError, projectPath, state.status, transitionLifecycle])

  // Stop the dev server
  const stop = useCallback(async () => {
    if (!projectPath) return

    const currentRunId = activeRunIdRef.current

    try {
      restartSchedulerRef.current.cancel()
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

      const result = await window.electronAPI.devServer.stop({ projectPath })
      if (!result.success && result.error) {
        console.warn('[DevServer] Stop reported an error:', result.error)
      }
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
      if (activeRunIdRef.current && projectPath) {
        console.log('[DevServer] Cleaning up on unmount')
        window.electronAPI.devServer.stop({ projectPath }).catch(console.error)
      }
    }
  }, [projectPath])

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
