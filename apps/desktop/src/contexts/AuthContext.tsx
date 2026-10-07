import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSafeConvexQuery } from '@/hooks/useSafeConvexQuery'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { PersonalWorkspaceMembership, User } from '../types/electron'
import type { LocalDevicePresentation, LocalDevicePresentationUpdate } from '@cozea/app-contract/desktopBootstrap'
import { convex } from '@/lib/convex'
import { getDeviceSession, type DeviceSession } from '@/lib/deviceSession'
import { getInitialDesktopBootstrap } from '@/app/bootstrap/desktopBootstrap'

export interface DevicePreferences {
  theme?: "light" | "dark" | "system"
  defaultModel?: string
  pushNotifications?: boolean
}

export interface AuthContextType {
  user: User | null
  localDevice: LocalDevicePresentation | null
  isLocalDeviceReady: boolean
  localDeviceError: string | null
  retryLocalDevice: () => Promise<void>
  updateLocalDevice: (update: Omit<LocalDevicePresentationUpdate, 'identityKey'>) => Promise<void>
  principalId: Id<"devicePrincipals"> | null
  preferences: DevicePreferences | null
  accessToken: string | null
  personalWorkspace: PersonalWorkspaceMembership | null
  isAuthenticated: boolean
  isConvexAuthReady: boolean
  isLoading: boolean
  isRevalidating: boolean
  authError: string | null
  needsOnboarding: boolean
  retryDeviceSession: () => Promise<void>
  refreshToken: () => Promise<RefreshTokenStatus>
}

export type RefreshTokenStatus = 'refreshed' | 'retryable' | 'expired'

export const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const bootstrapSession = getInitialDesktopBootstrap()?.session ?? null

  // Cached cloud presentation supplies no authority. Local readiness is checked
  // against the installation key independently of any cloud token.
  const [user, setUser] = useState<User | null>(() => bootstrapSession?.user ?? null)
  const [principalId, setPrincipalId] = useState<Id<"devicePrincipals"> | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalWorkspaceMembership | null>(
    () => bootstrapSession?.personalWorkspace ?? null,
  )
  const [localDevice, setLocalDevice] = useState<LocalDevicePresentation | null>(null)
  const [localDeviceError, setLocalDeviceError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRevalidating, setIsRevalidating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const applyDeviceSession = useCallback((session: DeviceSession) => {
    setAuthError(null)
    setAccessToken(session.accessToken)
    setUser(session.user)
    setPrincipalId(session.principalId)
    setPersonalWorkspace(session.personalWorkspace)
  }, [])

  const configureConvexAuth = useCallback(() => {
    convex?.setAuth(async () => (await getDeviceSession()).accessToken)
  }, [])

  const bootstrapLocalDeviceSession = useCallback(async (options: { force?: boolean; isCurrent?: () => boolean } = {}) => {
    if (!convex) throw new Error('Cloud features are not configured. Local projects remain available.')
    const physicalDevice = await window.cozeaBootstrap!.getLocalDevice()
    const session = await getDeviceSession({ force: options.force })
    if (session.user.identityKey !== physicalDevice.identityKey) throw new Error('Cloud session differs from this physical device.')
    if (options.isCurrent && !options.isCurrent()) return
    configureConvexAuth()
    applyDeviceSession(session)
  }, [applyDeviceSession, configureConvexAuth])

  const retryLocalDevice = useCallback(async () => {
    setIsLoading(true)
    try {
      if (!window.cozeaBootstrap) throw new Error('The desktop identity service is unavailable.')
      const device = await window.cozeaBootstrap.getLocalDevice()
      setLocalDevice(device)
      setLocalDeviceError(null)
    } catch (error) {
      setLocalDevice(null)
      setLocalDeviceError(error instanceof Error ? error.message : 'Unable to initialize the local device identity.')
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateLocalDevice = useCallback(async (update: Omit<LocalDevicePresentationUpdate, 'identityKey'>) => {
    if (!localDevice || !window.cozeaBootstrap) throw new Error('The local device identity is unavailable.')
    const result = await window.cozeaBootstrap.updateLocalDevice({ ...update, identityKey: localDevice.identityKey })
    setLocalDevice(result)
  }, [localDevice])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        if (!window.cozeaBootstrap) throw new Error('The desktop identity service is unavailable.')
        const device = await window.cozeaBootstrap.getLocalDevice()
        if (cancelled) return
        setLocalDevice(device)
        setLocalDeviceError(null)
        setIsLoading(false)
        // Only a previously enrolled device resumes cloud authentication at launch.
        // A fresh local installation never enrolls merely to open the shell.
        if (!bootstrapSession || bootstrapSession.user.identityKey !== device.identityKey) {
          setUser(null)
          setPersonalWorkspace(null)
          if (bootstrapSession) await window.cozeaBootstrap.clearSession().catch(() => {
            setAuthError('The previous cloud session could not be cleared from secure storage.')
          })
          return
        }
        if (!convex) return
        setIsRevalidating(true)
        try {
          await bootstrapLocalDeviceSession({ force: true, isCurrent: () => !cancelled })
        } catch (error) {
          if (cancelled) return
          convex.clearAuth()
          setPrincipalId(null)
          setAccessToken(null)
          console.warn('[Auth] Background device-session revalidation failed:', error)
          setAuthError('Cloud authentication is temporarily unavailable. Local workspace state remains available.')
        }
      } catch (error) {
        if (cancelled) return
        setLocalDeviceError(error instanceof Error ? error.message : 'Unable to initialize the local device identity.')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setIsRevalidating(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bootstrapLocalDeviceSession, bootstrapSession])

  const retryDeviceSession = useCallback(async () => {
    setIsRevalidating(true)
    try {
      await bootstrapLocalDeviceSession({ force: true })
      setAuthError(null)
    } catch (error) {
      convex?.clearAuth()
      setPrincipalId(null)
      setAccessToken(null)
      console.error('[Auth] Failed to initialize local device principal:', error)
      setAuthError('Cloud authentication is temporarily unavailable. Local workspace state remains available.')
      throw error
    } finally {
      setIsRevalidating(false)
    }
  }, [bootstrapLocalDeviceSession])


  const refreshToken = useCallback(async (): Promise<RefreshTokenStatus> => {
    try {
      setIsRevalidating(true)
      await bootstrapLocalDeviceSession({ force: true })
      return 'refreshed'
    } catch {
      convex?.clearAuth()
      setPrincipalId(null)
      setAccessToken(null)
      return 'retryable'
    } finally {
      setIsRevalidating(false)
    }
  }, [bootstrapLocalDeviceSession])

  const isConvexAuthReady = Boolean(accessToken)
  const profileQuery = useSafeConvexQuery(
    api.devicePrincipals.getCurrent,
    isConvexAuthReady && principalId ? {} : 'skip',
  )
  const liveProfile = profileQuery.data

  useEffect(() => {
    if (profileQuery.status !== 'error') return
    convex?.clearAuth()
    setPrincipalId(null)
    setAccessToken(null)
    setAuthError('Cloud access could not be verified. Reconnect to use cloud features.')
  }, [profileQuery.status])

  const reactiveUser = useMemo(() => {
    if (!user) return null
    if (!liveProfile) return user
    return {
      ...user,
      displayName: liveProfile.displayName,
      avatarUrl: liveProfile.avatarUrl ?? null,
      presentationConfigured: liveProfile.presentationConfigured,
      platform: liveProfile.platform,
    }
  }, [user, liveProfile])

  const needsOnboarding = Boolean(localDevice && !localDevice.presentationConfigured)

  const value = useMemo<AuthContextType>(
    () => ({
      user: reactiveUser,
      localDevice,
      isLocalDeviceReady: Boolean(localDevice),
      localDeviceError,
      retryLocalDevice,
      updateLocalDevice,
      principalId,
      preferences: liveProfile?.preferences ?? null,
      accessToken,
      personalWorkspace,
      isAuthenticated: Boolean(user),
      isConvexAuthReady: Boolean(accessToken),
      isLoading,
      isRevalidating,
      authError,
      needsOnboarding,
      retryDeviceSession,
      refreshToken,
    }),
    [
      authError,
      accessToken,
      principalId,
      isLoading,
      isRevalidating,
      retryDeviceSession,
      needsOnboarding,
      personalWorkspace,
      refreshToken,
      reactiveUser,
      localDevice,
      localDeviceError,
      retryLocalDevice,
      updateLocalDevice,
      liveProfile?.preferences,
      isConvexAuthReady,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
