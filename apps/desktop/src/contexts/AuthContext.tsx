import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type {
  PersonalWorkspaceMembership,
  User,
} from '../types/electron'

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
  const ensureLocalDeviceProfile = useMutation(api.users.ensureLocalDeviceProfile)

  const [user, setUser] = useState<User | null>(null)
  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalWorkspaceMembership | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const bootstrapLocalDeviceSession = useCallback(async () => {
    const deviceIdentity = await window.electronAPI.collab.ensureDeviceIdentity()
    const localProfile = await ensureLocalDeviceProfile({
      deviceId: deviceIdentity.deviceId,
      deviceLabel: deviceIdentity.deviceLabel,
      platform: deviceIdentity.platform,
      fingerprint: deviceIdentity.fingerprint,
    })

    setAuthError(null)
    setUser(localProfile.user)
    setConvexUserId(localProfile.userId)
    setPersonalWorkspace(localProfile.personalWorkspace)
  }, [ensureLocalDeviceProfile])

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
    setAuthError(null)
    setIsLoading(false)
  }, [])

  const refreshToken = useCallback(async (): Promise<RefreshTokenStatus> => {
    return 'expired'
  }, [])

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      convexUserId,
      accessToken: null,
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
