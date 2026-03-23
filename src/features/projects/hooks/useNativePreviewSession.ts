import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTerminalStore } from '@/stores/useTerminalStore'
import type {
  NativePreviewDeviceDescriptor,
  NativePreviewPlatform,
  NativePreviewSession,
  NativePreviewSessionState,
} from '@shared/electronApiTypes'

type NativePreviewTarget = 'ios' | 'android' | 'both'
type NativePreviewLauncher = 'expo-go' | 'dev-build' | 'web'
type ServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unhealthy'

interface UseNativePreviewSessionOptions {
  projectPath: string | null
  enabled: boolean
  target: NativePreviewTarget
  launcher: NativePreviewLauncher
  serverPort: number | null
  serverStatus: ServerStatus
}

function getDesiredPlatforms(target: NativePreviewTarget): NativePreviewPlatform[] {
  if (target === 'both') return ['ios', 'android']
  return [target]
}

function isSessionActive(state: NativePreviewSessionState): boolean {
  return state !== 'stopped' && state !== 'error'
}

function findDevServerTerminalId(
  terminals: ReturnType<typeof useTerminalStore.getState>['terminals'],
  projectPath: string | null,
): string | null {
  if (!projectPath) return null

  const terminal = Object.values(terminals)
    .filter((entry) => entry.projectPath === projectPath && entry.kind === 'dev-server' && entry.status !== 'exited')
    .sort((a, b) => {
      const aHeartbeat = a.lastHeartbeatAt ?? 0
      const bHeartbeat = b.lastHeartbeatAt ?? 0
      return bHeartbeat - aHeartbeat
    })[0]

  return terminal?.id ?? null
}

export function useNativePreviewSession({
  projectPath,
  enabled,
  target,
  launcher,
  serverPort,
  serverStatus,
}: UseNativePreviewSessionOptions) {
  const terminals = useTerminalStore((state) => state.terminals)
  const terminalId = useMemo(() => findDevServerTerminalId(terminals, projectPath), [projectPath, terminals])
  const [devices, setDevices] = useState<NativePreviewDeviceDescriptor[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [sessionsByPlatform, setSessionsByPlatform] = useState<Partial<Record<NativePreviewPlatform, NativePreviewSession>>>({})
  const pendingStartsRef = useRef(new Set<NativePreviewPlatform>())

  const desiredPlatforms = useMemo(() => getDesiredPlatforms(target), [target])

  const refreshDevices = useCallback(async () => {
    if (!enabled) {
      setDevices([])
      return
    }

    setDevicesLoading(true)
    try {
      const result = await window.electronAPI.nativePreview.listDevices()
      if (result.success) {
        setDevices(result.devices ?? [])
      }
    } finally {
      setDevicesLoading(false)
    }
  }, [enabled])

  const mergeSession = useCallback((session: NativePreviewSession) => {
    if (!projectPath || session.projectPath !== projectPath) return
    if (session.device) {
      setDevices((current) => {
        const next = [
          session.device!,
          ...current.filter((device) => !(device.platform === session.device!.platform && device.id === session.device!.id)),
        ]
        return next.sort((a, b) => {
          if (a.state === 'booted' && b.state !== 'booted') return -1
          if (b.state === 'booted' && a.state !== 'booted') return 1
          return a.name.localeCompare(b.name)
        })
      })
    }
    setSessionsByPlatform((current) => ({
      ...current,
      [session.platform]: session,
    }))
  }, [projectPath])

  const stopSessions = useCallback(async () => {
    const sessions = Object.values(sessionsByPlatform).filter(
      (session): session is NativePreviewSession => Boolean(session),
    )
    await Promise.all(
      sessions.map((session) =>
        window.electronAPI.nativePreview.stopSession({ sessionId: session.id }).catch(() => null))
    )
  }, [sessionsByPlatform])

  const refreshSessions = useCallback(async () => {
    if (!projectPath) {
      setSessionsByPlatform({})
      return
    }

    const result = await window.electronAPI.nativePreview.listSessions()
    if (!result.success) return

    const relevantSessions = (result.sessions ?? []).filter((session) => session.projectPath === projectPath)
    const next: Partial<Record<NativePreviewPlatform, NativePreviewSession>> = {}
    for (const session of relevantSessions) {
      next[session.platform] = session
    }
    setSessionsByPlatform(next)
  }, [projectPath])

  const openDevice = useCallback(async (platform: NativePreviewPlatform, deviceId?: string) => {
    const result = await window.electronAPI.nativePreview.openDevice({ platform, deviceId })
    if (result.success) {
      await refreshDevices()
    }
    return result
  }, [refreshDevices])

  useEffect(() => {
    void refreshDevices()
    void refreshSessions()
  }, [refreshDevices, refreshSessions])

  useEffect(() => {
    return window.electronAPI.nativePreview.onSessionUpdated((session) => {
      mergeSession(session)
    })
  }, [mergeSession])

  useEffect(() => {
    if (!enabled || !projectPath || launcher === 'web') return
    if (!terminalId) return
    if (serverStatus !== 'running') return

    for (const platform of desiredPlatforms) {
      const session = sessionsByPlatform[platform]
      if (session && isSessionActive(session.state)) continue
      if (pendingStartsRef.current.has(platform)) continue

      pendingStartsRef.current.add(platform)
      void window.electronAPI.nativePreview.startSession({
        projectPath,
        platform,
        launcher,
        buildMode: 'debug',
        devServerPort: serverPort ?? undefined,
        terminalId,
      }).finally(() => {
        pendingStartsRef.current.delete(platform)
      })
    }
  }, [desiredPlatforms, enabled, launcher, projectPath, serverPort, serverStatus, sessionsByPlatform, terminalId])

  useEffect(() => {
    const activeSessions = Object.values(sessionsByPlatform).filter(
      (session): session is NativePreviewSession => Boolean(session) && isSessionActive(session.state),
    )
    if (activeSessions.length === 0) return

    const sessionsToStop = activeSessions.filter((session) => {
      if (!enabled || !projectPath) return true
      if (launcher === 'web') return true
      if (serverStatus === 'stopped' || serverStatus === 'error') return true
      return !desiredPlatforms.includes(session.platform)
    })

    if (sessionsToStop.length === 0) return

    void Promise.all(
      sessionsToStop.map((session) =>
        window.electronAPI.nativePreview.stopSession({ sessionId: session.id }).catch(() => null))
    )
  }, [desiredPlatforms, enabled, launcher, projectPath, serverStatus, sessionsByPlatform])

  const orderedSessions = useMemo(() => desiredPlatforms
    .map((platform) => sessionsByPlatform[platform])
    .filter((session): session is NativePreviewSession => Boolean(session)), [desiredPlatforms, sessionsByPlatform])

  const primarySession = useMemo(() => {
    return orderedSessions.find((session) => session.state === 'stream_ready')
      ?? orderedSessions[0]
      ?? null
  }, [orderedSessions])

  return {
    devices,
    devicesLoading,
    sessionsByPlatform,
    orderedSessions,
    primarySession,
    terminalId,
    refreshDevices,
    refreshSessions,
    openDevice,
    stopSessions,
  }
}
