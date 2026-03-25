import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useTerminalStore } from '@/stores/useTerminalStore'
import type {
  NativePreviewDeviceDescriptor,
  NativePreviewLauncher,
  NativePreviewPlatform,
  NativePreviewSession,
  NativePreviewSessionState,
} from '@shared/electronApiTypes'

type NativePreviewTarget = 'ios' | 'android' | 'both'
type ServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unhealthy'

interface UseNativePreviewSessionOptions {
  projectPath: string | null
  enabled: boolean
  target: NativePreviewTarget
  launcher: NativePreviewLauncher
  serverPort: number | null
  serverStatus: ServerStatus
}

type SessionMap = Partial<Record<string, NativePreviewSession>>

function buildStartKey(platform: NativePreviewPlatform, deviceId?: string | null): string {
  return `${platform}:${deviceId ?? 'auto'}`
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

function buildSelectedDeviceStorageKey(projectPath: string, platform: NativePreviewPlatform): string {
  return `cozea:radon:selected-device:${encodeURIComponent(projectPath)}:${platform}`
}

function readStoredSelectedDevice(projectPath: string | null, platform: NativePreviewPlatform): string | null {
  if (!projectPath) return null
  try {
    return window.localStorage.getItem(buildSelectedDeviceStorageKey(projectPath, platform))
  } catch {
    return null
  }
}

function writeStoredSelectedDevice(projectPath: string | null, platform: NativePreviewPlatform, deviceId: string | null): void {
  if (!projectPath) return
  try {
    const key = buildSelectedDeviceStorageKey(projectPath, platform)
    if (deviceId) {
      window.localStorage.setItem(key, deviceId)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore local persistence failures.
  }
}

function pickPreferredDevice(
  devices: NativePreviewDeviceDescriptor[],
  platform: NativePreviewPlatform,
  preferredId?: string | null,
): NativePreviewDeviceDescriptor | null {
  const matching = devices.filter((device) => device.platform === platform)
  if (preferredId) {
    const preferred = matching.find((device) => device.id === preferredId)
    if (preferred) return preferred
  }

  return matching.find((device) => device.state === 'booted')
    ?? matching.find((device) => device.kind === 'emulator' || device.kind === 'simulator')
    ?? matching[0]
    ?? null
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
  const [sessionsById, setSessionsById] = useState<SessionMap>({})
  const sessionsRef = useRef<SessionMap>({})
  const pendingStartsRef = useRef(new Set<string>())
  const blockedAutoStartsRef = useRef(new Set<string>())
  const [isInitialized, setIsInitialized] = useState(false)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Partial<Record<NativePreviewPlatform, string>>>({})

  const { convexUserId } = useAuth()
  const profile = useQuery(api.users.getById, convexUserId ? { userId: convexUserId } : 'skip')

  const [showTokenDialog, setShowTokenDialogState] = useState(false)
  const [hasDismissedTokenDialog, setHasDismissedTokenDialog] = useState(false)

  const desiredPlatforms = useMemo(() => getDesiredPlatforms(target), [target])

  const setShowTokenDialog = useCallback((next: boolean) => {
    if (!next) {
      setHasDismissedTokenDialog(true)
    }
    setShowTokenDialogState(next)
  }, [])

  const selectDeviceForPlatform = useCallback((platform: NativePreviewPlatform, deviceId: string | null) => {
    setSelectedDeviceIds((current) => ({
      ...current,
      [platform]: deviceId ?? undefined,
    }))
    writeStoredSelectedDevice(projectPath, platform, deviceId)
  }, [projectPath])

  const refreshDevices = useCallback(async () => {
    if (!enabled) {
      setDevices([])
      return
    }

    setDevicesLoading(true)
    try {
      const result = await window.electronAPI.radon.listDevices()
      if (!result.success) {
        return
      }

      const nextDevices = result.devices ?? []
      setDevices(nextDevices)
      setSelectedDeviceIds((current) => {
        const next = { ...current }
        for (const platform of ['ios', 'android'] as const) {
          const preferred = pickPreferredDevice(
            nextDevices,
            platform,
            current[platform] ?? readStoredSelectedDevice(projectPath, platform),
          )
          if (preferred?.id && current[platform] !== preferred.id) {
            next[platform] = preferred.id
            writeStoredSelectedDevice(projectPath, platform, preferred.id)
          }
        }
        return next
      })
    } finally {
      setDevicesLoading(false)
    }
  }, [enabled, projectPath])

  const mergeSession = useCallback((session: NativePreviewSession) => {
    if (!projectPath || session.projectPath !== projectPath) return

    const startKey = buildStartKey(session.platform, session.device?.id)
    if (session.state === 'error') {
      blockedAutoStartsRef.current.add(startKey)
    } else {
      blockedAutoStartsRef.current.delete(startKey)
    }

    sessionsRef.current = {
      ...sessionsRef.current,
      [session.id]: session,
    }
    setSessionsById((current) => ({
      ...current,
      [session.id]: session,
    }))

    if (session.device?.id && session.platform) {
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

      if (session.focused || !selectedDeviceIds[session.platform]) {
        selectDeviceForPlatform(session.platform, session.device.id)
      }
    }
  }, [projectPath, selectDeviceForPlatform, selectedDeviceIds])

  const refreshSessions = useCallback(async () => {
    if (!projectPath) {
      blockedAutoStartsRef.current.clear()
      sessionsRef.current = {}
      setSessionsById({})
      setIsInitialized(true)
      return
    }

    const result = await window.electronAPI.radon.listSessions()
    if (!result.success) {
      setIsInitialized(true)
      return
    }

    const relevantEntries = (result.sessions ?? []).filter((session) => session.projectPath === projectPath)
    const next: SessionMap = {}
    for (const session of relevantEntries) {
      next[session.id] = session
    }
    sessionsRef.current = next
    setSessionsById(next)
    setIsInitialized(true)
  }, [projectPath])

  const stopSessions = useCallback(async () => {
    blockedAutoStartsRef.current.clear()
    const sessions = Object.values(sessionsRef.current)
      .filter((session): session is NativePreviewSession => session != null)
    await Promise.all(
      sessions.map((session) =>
        window.electronAPI.radon.stopSession({ sessionId: session.id }).catch(() => null)),
    )
  }, [])

  const openDevice = useCallback(async (platform: NativePreviewPlatform, deviceId?: string) => {
    const result = await window.electronAPI.radon.openDevice({ platform, deviceId })
    if (result.success && (result.device?.id || deviceId)) {
      selectDeviceForPlatform(platform, result.device?.id ?? deviceId ?? null)
      await refreshDevices()
    }
    return result
  }, [refreshDevices, selectDeviceForPlatform])

  const startSessionForDevice = useCallback(async (
    platform: NativePreviewPlatform,
    preferredDeviceId?: string | null,
    options?: { force?: boolean },
  ) => {
    if (!projectPath || !terminalId) return

    const token = profile?.preferences?.radonToken?.trim()
    if (!token) return

    const startKey = buildStartKey(platform, preferredDeviceId)
    if (!options?.force && blockedAutoStartsRef.current.has(startKey)) {
      return
    }
    if (pendingStartsRef.current.has(startKey)) {
      return
    }

    const platformSessions = Object.values(sessionsRef.current)
      .filter((session): session is NativePreviewSession =>
        session != null
        && session.projectPath === projectPath
        && session.platform === platform,
      )

    const matchingActiveSession = platformSessions.find((session) =>
      isSessionActive(session.state)
      && (preferredDeviceId ? session.device?.id === preferredDeviceId : true),
    )

    if (matchingActiveSession && !options?.force) {
      await window.electronAPI.radon.focusSession({ sessionId: matchingActiveSession.id }).catch(() => null)
      if (matchingActiveSession.device?.id) {
        selectDeviceForPlatform(platform, matchingActiveSession.device.id)
      }
      return
    }

    const sessionsToStop = platformSessions.filter((session) => {
      if (options?.force) {
        return !['stopped'].includes(session.state)
      }

      return Boolean(preferredDeviceId)
        && session.device?.id !== preferredDeviceId
        && isSessionActive(session.state)
    })

    pendingStartsRef.current.add(startKey)
    blockedAutoStartsRef.current.delete(startKey)

    try {
      await Promise.all(
        sessionsToStop.map((session) =>
          window.electronAPI.radon.stopSession({ sessionId: session.id }).catch(() => null)),
      )

      const result = await window.electronAPI.radon.startSession({
        projectPath,
        platform,
        launcher,
        buildMode: 'debug',
        terminalId,
        devServerPort: serverPort ?? undefined,
        radonToken: token,
        deviceId: preferredDeviceId ?? undefined,
        entryMode: 'app',
      })

      if (result.success && result.session) {
        mergeSession(result.session)
      }
    } finally {
      pendingStartsRef.current.delete(startKey)
    }
  }, [launcher, mergeSession, profile, projectPath, selectDeviceForPlatform, serverPort, terminalId])

  useEffect(() => {
    void refreshDevices()
    void refreshSessions()
  }, [refreshDevices, refreshSessions])

  useEffect(() => {
    return window.electronAPI.radon.onSessionUpdated((session) => {
      mergeSession(session)
    })
  }, [mergeSession])

  useEffect(() => {
    if (!projectPath) return
    blockedAutoStartsRef.current.clear()
    setSelectedDeviceIds({
      ios: readStoredSelectedDevice(projectPath, 'ios') ?? undefined,
      android: readStoredSelectedDevice(projectPath, 'android') ?? undefined,
    })
  }, [projectPath])

  const orderedSessions = useMemo(() => {
    const sessions = Object.values(sessionsById).filter((session): session is NativePreviewSession => session != null)
    return desiredPlatforms
      .map((platform) => {
        const selectedDeviceId = selectedDeviceIds[platform]
        const candidates = sessions
          .filter((session) => session.platform === platform)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        return candidates.find((session) => session.device?.id === selectedDeviceId)
          ?? candidates.find((session) => session.focused)
          ?? candidates.find((session) => session.state === 'stream_ready')
          ?? candidates[0]
          ?? null
      })
      .filter((session): session is NativePreviewSession => session != null)
  }, [desiredPlatforms, selectedDeviceIds, sessionsById])

  const primarySession = useMemo(() => {
    return orderedSessions.find((session) => session.state === 'app_ready')
      ?? orderedSessions.find((session) => session.state === 'stream_ready')
      ?? orderedSessions.find((session) => isSessionActive(session.state))
      ?? orderedSessions[0]
      ?? null
  }, [orderedSessions])

  const retryPreview = useCallback(async (session?: NativePreviewSession | null) => {
    const targetSession = session ?? primarySession
    if (!targetSession?.platform) return

    const startKey = buildStartKey(targetSession.platform, targetSession.device?.id)
    blockedAutoStartsRef.current.delete(startKey)

    if (targetSession.id) {
      await window.electronAPI.radon.stopSession({ sessionId: targetSession.id }).catch(() => null)
    }

    await startSessionForDevice(targetSession.platform, targetSession.device?.id, { force: true })
  }, [primarySession, startSessionForDevice])

  useEffect(() => {
    if (!isInitialized) return
    if (!enabled || !projectPath || launcher === 'web') return
    if (!terminalId) return
    if (serverStatus !== 'running') {
      setHasDismissedTokenDialog(false)
      return
    }

    const token = profile?.preferences?.radonToken?.trim()
    if (profile !== undefined && !token) {
      if (!showTokenDialog && !hasDismissedTokenDialog && orderedSessions.every((session) => !isSessionActive(session.state))) {
        setShowTokenDialogState(true)
      }
      return
    }

    for (const platform of desiredPlatforms) {
      const selectedDeviceId = selectedDeviceIds[platform]
        ?? pickPreferredDevice(devices, platform)?.id
        ?? null

      void startSessionForDevice(platform, selectedDeviceId)
    }
  }, [
    desiredPlatforms,
    devices,
    enabled,
    hasDismissedTokenDialog,
    isInitialized,
    launcher,
    mergeSession,
    orderedSessions,
    profile,
    projectPath,
    selectedDeviceIds,
    serverPort,
    serverStatus,
    showTokenDialog,
    startSessionForDevice,
    terminalId,
  ])

  useEffect(() => {
    const activeSessions = Object.values(sessionsById).filter(
      (session): session is NativePreviewSession => session != null && isSessionActive(session.state),
    )
    if (activeSessions.length === 0) return

    const sessionsToStop = activeSessions.filter((session) => {
      if (!enabled || !projectPath) return true
      if (launcher === 'web') return true
      if (serverStatus === 'stopped' || serverStatus === 'error') return true
      if (!desiredPlatforms.includes(session.platform)) return true

      const selectedDeviceId = selectedDeviceIds[session.platform]
      return Boolean(selectedDeviceId && session.device?.id && session.device.id !== selectedDeviceId)
    })

    if (sessionsToStop.length === 0) return

    void Promise.all(
      sessionsToStop.map((session) =>
        window.electronAPI.radon.stopSession({ sessionId: session.id }).catch(() => null)),
    )
  }, [desiredPlatforms, enabled, launcher, projectPath, selectedDeviceIds, serverStatus, sessionsById])

  const selectedDevicesByPlatform = useMemo(() => {
    return {
      ios: pickPreferredDevice(devices, 'ios', selectedDeviceIds.ios),
      android: pickPreferredDevice(devices, 'android', selectedDeviceIds.android),
    }
  }, [devices, selectedDeviceIds.android, selectedDeviceIds.ios])

  return {
    devices,
    devicesLoading,
    orderedSessions,
    primarySession,
    selectedDevicesByPlatform,
    selectedDeviceIds,
    showTokenDialog,
    setShowTokenDialog,
    terminalId,
    refreshDevices,
    refreshSessions,
    stopSessions,
    openDevice,
    retryPreview,
    selectDeviceForPlatform,
  }
}
