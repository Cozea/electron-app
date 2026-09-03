import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { DevServerLaunchContext } from '@/utils/projectDetector'
import type { DevServerAuxiliaryProcessConfig } from '@shared/electronApiTypes'
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
} from '@/features/dev-server/devServerRunStore'

export type { DevServerStatus }

interface UseDevServerManagerOptions {
  workspaceId: string | null
  laneId?: string | null
  sessionKey?: string | null
  framework?: string | null
  terminalId?: string | null
  autoStart?: boolean
  /**
   * Persists the one-shot consumption of `autoStart`. Without it the guard
   * would live on this hook instance and a remount (e.g. project switch)
   * would restart a server the user had explicitly stopped.
   */
  onAutoStartConsumed?: () => void
  storedDevCommand?: string | null
  storedDevPort?: number | null
  storedCommandSource?: DevServerLaunchContext['storedCommandSource']
  previewMode?: DevServerLaunchContext['previewMode']
  nativePlatform?: DevServerLaunchContext['nativePlatform']
  auxiliaryProcesses?: DevServerAuxiliaryProcessConfig[]
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
  onAutoStartConsumed,
  storedDevCommand = null,
  storedDevPort = null,
  storedCommandSource = 'detected',
  previewMode = 'web',
  nativePlatform = null,
  auxiliaryProcesses = [],
}: UseDevServerManagerOptions) {
  const runKey = workspaceId ? buildDevServerRunKey(workspaceId, laneId) : null
  const autoStartAttemptedRunKeyRef = useRef<string | null>(null)
  const onAutoStartConsumedRef = useRef(onAutoStartConsumed)
  onAutoStartConsumedRef.current = onAutoStartConsumed

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
      storedCommandSource,
      previewMode,
      nativePlatform,
      auxiliaryProcesses,
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
    storedCommandSource,
    previewMode,
    nativePlatform,
    auxiliaryProcesses,
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
      autoStartAttemptedRunKeyRef.current = null
      return
    }
    if (!launchTerminalReady) return
    // Guards a second pass within this mount before the persisted flag lands.
    if (autoStartAttemptedRunKeyRef.current === runKey) return

    // Auto-start is one-shot per launch, recorded on the tile itself rather
    // than on this hook instance so a remount cannot resurrect a server the
    // user stopped. The owner clears the persisted flag in the callback.
    autoStartAttemptedRunKeyRef.current = runKey
    onAutoStartConsumedRef.current?.()
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
