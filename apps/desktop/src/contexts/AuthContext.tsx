import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { Id } from '../../../../convex/_generated/dataModel'
import type {
  PersonalWorkspaceMembership,
  User,
} from '../types/electron'
import { convex } from '@/lib/convex'
import { clearDeviceSession, getDeviceSession } from '@/lib/deviceSession'

interface AuthContextType {
  user: User | null
  convexUserId: Id<"users"> | null
  accessToken: string | null
  personalWorkspace: PersonalWorkspaceMembership | null
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  needsOnboarding: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<RefreshTokenStatus>
}

export type RefreshTokenStatus = 'refreshed' | 'retryable' | 'expired'

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalWorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const bootstrapLocalDeviceSession = useCallback(async () => {
    const localProfile = await getDeviceSession()
    convex?.setAuth(async () => (await getDeviceSession()).accessToken)

    setAuthError(null)
    setAccessToken(localProfile.accessToken)
    setUser(localProfile.user)
    setConvexUserId(localProfile.convexUserId)
    setPersonalWorkspace(localProfile.personalWorkspace)
  }, [])

  useEffect(() => {
    let cancelled = false

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
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bootstrapLocalDeviceSession])

  const login = useCallback(async () => {
    setIsLoading(true)
    try {
      await bootstrapLocalDeviceSession()
      setAuthError(null)
    } catch (error) {
      console.error('[Auth] Failed to initialize local device profile:', error)
      setAuthError('Unable to initialize the local device profile.')
      throw error
    } finally {
      setIsLoading(false)
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
  }, [])

  const refreshToken = useCallback(async (): Promise<RefreshTokenStatus> => {
    try {
      const session = await getDeviceSession({ force: true })
      setAccessToken(session.accessToken)
      return 'refreshed'
    } catch {
      return 'retryable'
    }
  }, [])

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      convexUserId,
      accessToken,
      personalWorkspace,
      isAuthenticated: Boolean(user),
      isLoading,
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
