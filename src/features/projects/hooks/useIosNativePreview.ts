import { useCallback, useEffect, useMemo, useRef } from 'react'

import type {
  NativePreviewIosSimulatorDevice,
  NativePreviewSessionLocator,
} from '@shared/nativePreviewTypes'

import type { ServerStatus } from '@/stores/useProjectPagesStore'
import { useNativePreviewStore } from '@/stores/useNativePreviewStore'

interface UseIosNativePreviewOptions {
  enabled: boolean
  projectPath: string | null
  serverStatus: ServerStatus
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
  enabled,
  projectPath,
  serverStatus,
}: UseIosNativePreviewOptions) {
  const iosSimulators = useNativePreviewStore((state) => state.iosSimulators)
  const selectedIosSimulatorId = useNativePreviewStore((state) => state.selectedIosSimulatorId)
  const sessionState = useNativePreviewStore((state) => state.sessionState)
  const simulatorsLoading = useNativePreviewStore((state) => state.simulatorsLoading)
  const simulatorsError = useNativePreviewStore((state) => state.simulatorsError)
  const sessionLoading = useNativePreviewStore((state) => state.sessionLoading)
  const sessionError = useNativePreviewStore((state) => state.sessionError)
  const actions = useNativePreviewStore((state) => state.actions)

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

  const refreshSimulators = useCallback(async () => {
    if (!enabled) {
      actions.setIosSimulators([])
      actions.setSimulatorsError(null)
      return
    }

    actions.setSimulatorsLoading(true)
    const result = await window.electronAPI.nativePreview.listIosSimulators()
    actions.setSimulatorsLoading(false)

    if (!result.success || !result.devices) {
      actions.setSimulatorsError(result.error ?? 'Failed to load iOS simulators.')
      actions.setIosSimulators([])
      return
    }

    actions.setSimulatorsError(null)
    actions.setIosSimulators(result.devices)
  }, [actions, enabled])

  useEffect(() => {
    void refreshSimulators()
  }, [refreshSimulators])

  useEffect(() => {
    if (!enabled) {
      actions.reset()
    }
  }, [actions, enabled])

  useEffect(() => {
    if (!enabled || !projectPath || !selectedSimulator) {
      actions.setSessionState(null)
      actions.setSessionError(null)
      return
    }

    let cancelled = false
    void (async () => {
      const state = await window.electronAPI.nativePreview.getSessionState(buildLocator(projectPath, selectedSimulator))
      if (cancelled) {
        return
      }
      actions.setSessionState(state)
    })()

    return () => {
      cancelled = true
    }
  }, [actions, enabled, projectPath, selectedSimulator])

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
        actions.setSessionState(event.state)
        if (event.state?.status === 'error') {
          actions.setSessionError(event.state.lastError ?? 'Native preview session failed.')
        } else if (event.state) {
          actions.setSessionError(null)
        }
        return
      }

      if (
        event.state === null &&
        activeLocator &&
        event.sessionKey === `${activeLocator.platform}:${activeLocator.deviceId}:${activeLocator.projectPath}`
      ) {
        actions.setSessionState(null)
      }
    })

    return unsubscribe
  }, [actions])

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
      actions.setSessionLoading(false)
      if (selectedSimulator && selectedSimulator.state !== 'Booted') {
        actions.setSessionError('Boot the selected iOS simulator to start native preview.')
      } else {
        actions.setSessionError(null)
      }
      return
    }

    if (previousKey === desiredKey) {
      return
    }

    actions.setSessionLoading(true)
    actions.setSessionError(null)
    void (async () => {
      const result = await window.electronAPI.nativePreview.startSession(desiredLocator)
      if (cancelled || activeLocatorRef.current !== desiredLocator) {
        return
      }
      actions.setSessionLoading(false)
      if (!result.success) {
        actions.setSessionState(result.state ?? null)
        actions.setSessionError(result.error ?? 'Failed to start native preview session.')
        return
      }
      actions.setSessionState(result.state ?? null)
      actions.setSessionError(null)
    })()

    return () => {
      cancelled = true
    }
  }, [actions, desiredLocator, selectedSimulator])

  useEffect(() => {
    return () => {
      const activeLocator = activeLocatorRef.current
      if (activeLocator) {
        void window.electronAPI.nativePreview.stopSession(activeLocator)
      }
    }
  }, [])

  return {
    iosSimulators,
    selectedIosSimulatorId,
    selectedSimulator,
    sessionState,
    simulatorsLoading,
    simulatorsError,
    sessionLoading,
    sessionError,
    setSelectedIosSimulatorId: actions.setSelectedIosSimulatorId,
    refreshSimulators,
  }
}
