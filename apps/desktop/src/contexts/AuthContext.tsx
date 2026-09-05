import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { Id } from '../../../../convex/_generated/dataModel'
import type {
  PersonalWorkspaceMembership,
  User,
} from '../types/electron'
import { convex } from '@/lib/convex'
import { clearDeviceSession, getDeviceSession, seedDeviceSession, type DeviceSession } from '@/lib/deviceSession'
import { getInitialDesktopBootstrap } from '@/app/bootstrap/desktopBootstrap'
import { featureFlags } from '@/lib/featureFlags'

interface AuthContextType {
  user: User | null
  convexUserId: Id<"users"> | null
  accessToken: string | null
  personalWorkspace: PersonalWorkspaceMembership | null
  isAuthenticated: boolean
  isLoading: boolean
  isRevalidating: boolean
  authError: string | null
  needsOnboarding: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<RefreshTokenStatus>
}

export type RefreshTokenStatus = 'refreshed' | 'retryable' | 'expired'

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const bootstrapSession = featureFlags.shellFirstAuth
    ? getInitialDesktopBootstrap()?.session ?? null
    : null
  const [user, setUser] = useState<User | null>(() => bootstrapSession?.user ?? null)
  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(() =>
    bootstrapSession?.convexUserId
      ? bootstrapSession.convexUserId as Id<"users">
      : null,
  )
  const [accessToken, setAccessToken] = useState<string | null>(() => bootstrapSession?.accessToken ?? null)
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalWorkspaceMembership | null>(
    () => bootstrapSession?.personalWorkspace ?? null,
  )
  const [isLoading, setIsLoading] = useState(() => !bootstrapSession)
  const [isRevalidating, setIsRevalidating] = useState(() => Boolean(bootstrapSession))
  const [authError, setAuthError] = useState<string | null>(null)

  const applyDeviceSession = useCallback((localProfile: DeviceSession) => {
    setAuthError(null)
    setAccessToken(localProfile.accessToken)
    setUser(localProfile.user)
    setConvexUserId(localProfile.convexUserId)
    setPersonalWorkspace(localProfile.personalWorkspace)
  }, [])

  const configureConvexAuth = useCallback(() => {
    convex?.setAuth(async () => (await getDeviceSession()).accessToken)
  }, [])

  const bootstrapLocalDeviceSession = useCallback(async (options: { force?: boolean } = {}) => {
    const localProfile = await getDeviceSession(options)
    configureConvexAuth()
    applyDeviceSession(localProfile)
  }, [applyDeviceSession, configureConvexAuth])

  useEffect(() => {
    let cancelled = false

    if (bootstrapSession) {
      seedDeviceSession(bootstrapSession)
      configureConvexAuth()
      setIsLoading(false)
      setIsRevalidating(true)
      void bootstrapLocalDeviceSession({ force: true })
        .catch((error) => {
          if (cancelled) return
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
        console.error('[Auth] Failed to initialize local device profile:', error)
        setAuthError('Unable to initialize the local device profile.')
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
  }, [bootstrapLocalDeviceSession, bootstrapSession, configureConvexAuth])

  const login = useCallback(async () => {
    setIsLoading(true)
    setIsRevalidating(true)
    try {
      await bootstrapLocalDeviceSession({ force: true })
      setAuthError(null)
    } catch (error) {
      console.error('[Auth] Failed to initialize local device profile:', error)
      setAuthError('Unable to initialize the local device profile.')
      throw error
    } finally {
      setIsLoading(false)
      setIsRevalidating(false)
    }
  }, [bootstrapLocalDeviceSession])

  const logout = useCallback(async () => {
    convex?.clearAuth()
    clearDeviceSession()
    setUser(null)
    setConvexUserId(null)
    setPersonalWorkspace(null)
    setAccessToken(null)
    setAuthError(null)
    setIsLoading(false)
    setIsRevalidating(false)
  }, [])

  const refreshToken = useCallback(async (): Promise<RefreshTokenStatus> => {
    try {
      setIsRevalidating(true)
      const session = await getDeviceSession({ force: true })
      applyDeviceSession(session)
      return 'refreshed'
    } catch {
      return 'retryable'
    } finally {
      setIsRevalidating(false)
    }
  }, [applyDeviceSession])

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      convexUserId,
      accessToken,
      personalWorkspace,
      isAuthenticated: Boolean(user),
      isLoading,
      isRevalidating,
      authError,
      needsOnboarding: false,
      login,
      logout,
      refreshToken,
    }),
    [
      authError,
      accessToken,
      convexUserId,
      isLoading,
      isRevalidating,
      login,
      logout,
      personalWorkspace,
      refreshToken,
      user,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
