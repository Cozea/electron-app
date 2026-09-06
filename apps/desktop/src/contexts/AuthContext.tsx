import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { Id } from '../../../../convex/_generated/dataModel'
import type { PersonalWorkspaceMembership, User } from '../types/electron'
import { convex } from '@/lib/convex'
import { getDeviceSession, type DeviceSession } from '@/lib/deviceSession'
import { getInitialDesktopBootstrap } from '@/app/bootstrap/desktopBootstrap'
import { featureFlags } from '@/lib/featureFlags'

interface AuthContextType {
  user: User | null
  principalId: Id<"devicePrincipals"> | null
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

const AuthContext = createContext<AuthContextType | null>(null)
const UNCONFIGURED_DEVICE_NAME = 'This Device'

export function AuthProvider({ children }: { children: ReactNode }) {
  const bootstrapSession = featureFlags.shellFirstAuth
    ? getInitialDesktopBootstrap()?.session ?? null
    : null

  // Cached device presentation can paint the desktop shell immediately, but
  // cloud authority is re-established from a fresh proof-of-possession token.
  const [user, setUser] = useState<User | null>(() => bootstrapSession?.user ?? null)
  const [principalId, setPrincipalId] = useState<Id<"devicePrincipals"> | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalWorkspaceMembership | null>(
    () => bootstrapSession?.personalWorkspace ?? null,
  )
  const [isLoading, setIsLoading] = useState(() => !bootstrapSession)
  const [isRevalidating, setIsRevalidating] = useState(() => Boolean(bootstrapSession))
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

  const bootstrapLocalDeviceSession = useCallback(async (options: { force?: boolean } = {}) => {
    const session = await getDeviceSession(options)
    configureConvexAuth()
    applyDeviceSession(session)
  }, [applyDeviceSession, configureConvexAuth])

  useEffect(() => {
    let cancelled = false

    if (bootstrapSession) {
      convex?.clearAuth()
      setPrincipalId(null)
      setAccessToken(null)
      setIsLoading(false)
      setIsRevalidating(true)
      void bootstrapLocalDeviceSession({ force: true })
        .catch((error) => {
          if (cancelled) return
          convex?.clearAuth()
          setPrincipalId(null)
          setAccessToken(null)
          console.warn('[Auth] Background device-session revalidation failed:', error)
          setAuthError('Cloud authentication is temporarily unavailable. Local workspace state remains available.')
        })
        .finally(() => {
          if (!cancelled) setIsRevalidating(false)
        })
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        await bootstrapLocalDeviceSession()
      } catch (error) {
        if (cancelled) return
        convex?.clearAuth()
        setPrincipalId(null)
        setAccessToken(null)
        console.error('[Auth] Failed to initialize local device principal:', error)
        setAuthError('Unable to initialize the local device identity.')
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
    setIsLoading(true)
    setIsRevalidating(true)
    try {
      await bootstrapLocalDeviceSession({ force: true })
      setAuthError(null)
    } catch (error) {
      convex?.clearAuth()
      setPrincipalId(null)
      setAccessToken(null)
      console.error('[Auth] Failed to initialize local device principal:', error)
      setAuthError('Unable to initialize the local device identity.')
      throw error
    } finally {
      setIsLoading(false)
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

  const needsOnboarding = Boolean(
    user && (user.displayName.trim() || UNCONFIGURED_DEVICE_NAME) === UNCONFIGURED_DEVICE_NAME,
  )

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      principalId,
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
      user,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
