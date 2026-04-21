import { useCallback, useEffect, useMemo, useRef } from 'react'

import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewSessionLocator,
} from '@shared/nativePreviewTypes'

import type { ServerStatus } from '@/features/projects/lib/previewRuntimeTypes'
import {
  DEFAULT_NATIVE_PREVIEW_SCOPE_STATE,
  useNativePreviewStore,
} from '@/stores/useNativePreviewStore'

interface UseIosNativePreviewOptions {
  scopeKey: string
  enabled: boolean
  projectPath: string | null
  serverStatus: ServerStatus
  keepAliveOnUnmount?: boolean
}

function isPreviewSessionWanted(serverStatus: ServerStatus): boolean {
  return serverStatus === 'starting' || serverStatus === 'running' || serverStatus === 'unhealthy'
}

function buildLocator(
  projectPath: string,
  device: NativePreviewIosSimulatorDevice
): NativePreviewSessionLocator {
  return {
    projectPath,
    deviceId: device.udid,
    platform: 'ios',
  }
}

export function useIosNativePreview({
  scopeKey,
  enabled,
  projectPath,
  serverStatus,
  keepAliveOnUnmount = false,
}: UseIosNativePreviewOptions) {
  const scopeState = useNativePreviewStore((state) => state.scopes[scopeKey] ?? DEFAULT_NATIVE_PREVIEW_SCOPE_STATE)
  const actions = useNativePreviewStore((state) => state.actions)

  const {
    iosSimulators,
    selectedIosSimulatorId,
    sessionState,
    simulatorsLoading,
    simulatorsError,
    sessionLoading,
    sessionError,
  } = scopeState

  const selectedSimulator = useMemo(() => {
    return iosSimulators.find((device) => device.udid === selectedIosSimulatorId) ?? null
  }, [iosSimulators, selectedIosSimulatorId])

  const desiredLocator = useMemo(() => {
    if (!enabled || !projectPath || !selectedSimulator || selectedSimulator.state !== 'Booted') {
      return null
    }

    if (!isPreviewSessionWanted(serverStatus)) {
      return null
    }

    return buildLocator(projectPath, selectedSimulator)
  }, [enabled, projectPath, selectedSimulator, serverStatus])

  const activeLocatorRef = useRef<NativePreviewSessionLocator | null>(null)

  useEffect(() => {
    actions.ensureScope(scopeKey)
  }, [actions, scopeKey])

  const refreshSimulators = useCallback(async () => {
    if (!enabled) {
      actions.setIosSimulators(scopeKey, [])
      actions.setSimulatorsError(scopeKey, null)
      return
    }

    actions.setSimulatorsLoading(scopeKey, true)
    const result = await window.electronAPI.nativePreview.listIosSimulators()
    actions.setSimulatorsLoading(scopeKey, false)

    if (!result.success || !result.devices) {
      actions.setSimulatorsError(scopeKey, result.error ?? 'Failed to load iOS simulators.')
      actions.setIosSimulators(scopeKey, [])
      return
    }

    actions.setSimulatorsError(scopeKey, null)
    actions.setIosSimulators(scopeKey, result.devices)
  }, [actions, enabled, scopeKey])

  useEffect(() => {
    void refreshSimulators()
  }, [refreshSimulators])

  useEffect(() => {
    if (!enabled && !keepAliveOnUnmount) {
      actions.reset(scopeKey)
    }
  }, [actions, enabled, keepAliveOnUnmount, scopeKey])

  useEffect(() => {
    if (!enabled || !projectPath || !selectedSimulator) {
      actions.setSessionState(scopeKey, null)
      actions.setSessionError(scopeKey, null)
      return
    }

    let cancelled = false
    void (async () => {
      const state = await window.electronAPI.nativePreview.getSessionState(buildLocator(projectPath, selectedSimulator))
      if (cancelled) {
        return
      }
      actions.setSessionState(scopeKey, state)
    })()

    return () => {
      cancelled = true
    }
  }, [actions, enabled, projectPath, scopeKey, selectedSimulator])

  useEffect(() => {
    const unsubscribe = window.electronAPI.nativePreview.onStateChanged((event) => {
      const activeLocator = activeLocatorRef.current
      if (!activeLocator) {
        return
      }

      if (
        event.state?.projectPath === activeLocator.projectPath &&
        event.state?.deviceId === activeLocator.deviceId &&
        event.state?.platform === activeLocator.platform
      ) {
        actions.setSessionState(scopeKey, event.state)
        if (event.state?.status === 'error') {
          actions.setSessionError(scopeKey, event.state.lastError ?? 'Native preview session failed.')
        } else if (event.state) {
          actions.setSessionError(scopeKey, null)
        }
        return
      }

      if (
        event.state === null &&
        activeLocator &&
        event.sessionKey === `${activeLocator.platform}:${activeLocator.deviceId}:${activeLocator.projectPath}`
      ) {
        actions.setSessionState(scopeKey, null)
      }
    })

    return unsubscribe
  }, [actions, scopeKey])

  useEffect(() => {
    let cancelled = false

    const previousLocator = activeLocatorRef.current
    const previousKey = previousLocator
      ? `${previousLocator.platform}:${previousLocator.deviceId}:${previousLocator.projectPath}`
      : null
    const desiredKey = desiredLocator
      ? `${desiredLocator.platform}:${desiredLocator.deviceId}:${desiredLocator.projectPath}`
      : null

    if (previousLocator && previousKey !== desiredKey) {
      void window.electronAPI.nativePreview.stopSession(previousLocator)
    }

    activeLocatorRef.current = desiredLocator

    if (!desiredLocator) {
      actions.setSessionLoading(scopeKey, false)
      if (selectedSimulator && selectedSimulator.state !== 'Booted') {
        actions.setSessionError(scopeKey, 'Boot the selected iOS simulator to start native preview.')
      } else {
        actions.setSessionError(scopeKey, null)
      }
      return
    }

    if (previousKey === desiredKey) {
      return
    }

    actions.setSessionLoading(scopeKey, true)
    actions.setSessionError(scopeKey, null)
    void (async () => {
      const result = await window.electronAPI.nativePreview.startSession(desiredLocator)
      if (cancelled || activeLocatorRef.current !== desiredLocator) {
        return
      }
      actions.setSessionLoading(scopeKey, false)
      if (!result.success) {
        actions.setSessionState(scopeKey, result.state ?? null)
        actions.setSessionError(scopeKey, result.error ?? 'Failed to start native preview session.')
        return
      }
      actions.setSessionState(scopeKey, result.state ?? null)
      actions.setSessionError(scopeKey, null)
    })()

    return () => {
      cancelled = true
    }
  }, [actions, desiredLocator, scopeKey, selectedSimulator])

  useEffect(() => {
    return () => {
      const activeLocator = activeLocatorRef.current
      if (activeLocator && !keepAliveOnUnmount) {
        void window.electronAPI.nativePreview.stopSession(activeLocator)
      }
    }
  }, [keepAliveOnUnmount])

  return {
    iosSimulators,
    selectedIosSimulatorId,
    selectedSimulator,
    sessionState,
    simulatorsLoading,
    simulatorsError,
    sessionLoading,
    sessionError,
    setSelectedIosSimulatorId: (deviceId: string | null) => {
      actions.setSelectedIosSimulatorId(scopeKey, deviceId)
    },
    refreshSimulators,
  }
}
