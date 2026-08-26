import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { DevServerLaunchContext } from '@/utils/projectDetector'
import {
  DEFAULT_DEV_SERVER_RUN,
  buildDevServerRunKey,
  ensureDevServerEventBridge,
  isDevServerRunActive,
  reconcileDevServerRun,
  registerDevServerRunContext,
  restartDevServerRun,
  startDevServerRun,
  stopDevServerRun,
  useDevServerRunStore,
  type DevServerStatus,
} from '@/features/projects/devserver/devServerRunStore'

export type { DevServerStatus }

interface UseDevServerManagerOptions {
  workspaceId: string | null
  laneId?: string | null
  sessionKey?: string | null
  framework?: string | null
  terminalId?: string | null
  autoStart?: boolean
  storedDevCommand?: string | null
  storedDevPort?: number | null
  previewMode?: DevServerLaunchContext['previewMode']
  nativePlatform?: DevServerLaunchContext['nativePlatform']
}

/**
 * Thin facade over devServerRunStore. The run state lives in the keyed store
 * (fed by the app-level event bridge and reconciled against the main
 * process), so any component — tile body, dock header, status indicators —
 * reads the same truth; this hook just scopes it to one workspace::lane key
 * and contributes the mounted tile's launch context.
 */
export function useDevServerManager({
  workspaceId,
  laneId = null,
  sessionKey = null,
  framework = null,
  terminalId = null,
  autoStart = false,
  storedDevCommand = null,
  storedDevPort = null,
  previewMode = 'web',
  nativePlatform = null,
}: UseDevServerManagerOptions) {
  const runKey = workspaceId ? buildDevServerRunKey(workspaceId, laneId) : null
  const autoStartedRunKeyRef = useRef<string | null>(null)

  useEffect(() => {
    ensureDevServerEventBridge()
  }, [])

  useEffect(() => {
    if (!runKey || !workspaceId) return
    registerDevServerRunContext(runKey, {
      workspaceId,
      laneId,
      sessionKey,
      framework,
      terminalId,
      storedDevCommand,
      storedDevPort,
      previewMode,
      nativePlatform,
    })
  }, [
    runKey,
    workspaceId,
    laneId,
    sessionKey,
    framework,
    terminalId,
    storedDevCommand,
    storedDevPort,
    previewMode,
    nativePlatform,
  ])

  // The context registration above must land before the first reconcile —
  // both effects key on runKey and run in declaration order.
  useEffect(() => {
    if (!runKey) return
    void reconcileDevServerRun(runKey)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void reconcileDevServerRun(runKey)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [runKey])

  const run = useDevServerRunStore((state) => (runKey ? state.runs[runKey] : undefined))
  const registeredTerminalId = useDevServerRunStore((storeState) =>
    runKey ? storeState.contexts[runKey]?.terminalId ?? null : null,
  )
  // Contexts are sticky across tile unmounts, so an older terminal cannot
  // satisfy auto-start for a newly mounted tile. Wait until this tile's
  // terminal is the one registered for the run key.
  const launchTerminalReady = Boolean(terminalId && registeredTerminalId === terminalId)
  const state = run ?? DEFAULT_DEV_SERVER_RUN

  useEffect(() => {
    if (!autoStart || !runKey) {
      autoStartedRunKeyRef.current = null
      return
    }
    if (!launchTerminalReady) return
    if (autoStartedRunKeyRef.current === runKey) return

    // Auto-start is one-shot per mounted run context. This covers a DevApp
    // replacing a previously stopped built-in Dev Server without immediately
    // undoing a later explicit Stop action from the user.
    autoStartedRunKeyRef.current = runKey
    if (state.status === 'idle' || state.status === 'stopped' || state.status === 'error') {
      void startDevServerRun(runKey)
    }
  }, [autoStart, launchTerminalReady, runKey, state.status])

  const start = useCallback(async () => {
    if (!runKey) return
    await startDevServerRun(runKey)
  }, [runKey])

  const stop = useCallback(async () => {
    if (!runKey) return
    await stopDevServerRun(runKey)
  }, [runKey])

  const restart = useCallback(async () => {
    if (!runKey) return
    await restartDevServerRun(runKey)
  }, [runKey])

  return useMemo(
    () => ({
      ...state,
      start,
      stop,
      restart,
      isRunning: isDevServerRunActive(state.status),
    }),
    [state, start, stop, restart],
  )
}
