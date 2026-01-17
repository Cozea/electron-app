import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { User, Session, OrganizationMembership } from '../types/electron'

interface AuthContextType {
  user: User | null
  convexUserId: Id<"users"> | null
  accessToken: string | null
  organizations: OrganizationMembership[]
  currentOrganization: OrganizationMembership | null
  isAuthenticated: boolean
  isLoading: boolean
  needsOnboarding: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<boolean>
  setOrganizations: (orgs: OrganizationMembership[]) => void
  setCurrentOrganization: (org: OrganizationMembership | null) => void
}

type ConvexOrganizationShape = {
  _id: Id<"organizations">
  workosId?: string
  name: string
  role?: string
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [organizations, setOrganizationsState] = useState<OrganizationMembership[]>([])
  const [currentOrganization, setCurrentOrganization] = useState<OrganizationMembership | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [convexLoading, setConvexLoading] = useState(false)

  // Query Convex for user's organizations (source of truth)
  const convexUserWithOrgs = useQuery(
    api.users.getWithOrganizations,
    convexUserId ? { userId: convexUserId } : "skip"
  )

  // Update organizations from Convex when available
  useEffect(() => {
    if (convexUserWithOrgs?.organizations && convexUserWithOrgs.organizations.length > 0) {
      // Convert Convex orgs to OrganizationMembership format (filter out nulls)
      const orgs = convexUserWithOrgs.organizations as Array<ConvexOrganizationShape | null>
      const convexOrgs: OrganizationMembership[] = orgs
        .filter((org): org is ConvexOrganizationShape => org !== null)
        .map((org) => ({
          id: org._id, // Use Convex ID as membership ID
          organizationId: org.workosId || org._id,
          organizationName: org.name,
          role: org.role || 'member',
          status: 'active' as const,
        }))

      // Update state if different from current
      if (convexOrgs.length > 0 && organizations.length === 0) {
        setOrganizationsState(convexOrgs)
        if (!currentOrganization) {
          setCurrentOrganization(convexOrgs[0])
        }
        // Persist to local session
        window.electronAPI.auth.updateOrganizations(convexOrgs)
      }
      setConvexLoading(false)
    } else if (convexUserWithOrgs !== undefined) {
      // Query completed but no orgs
      setConvexLoading(false)
    }
  }, [convexUserWithOrgs, organizations.length, currentOrganization])

  // Derived state: user needs onboarding if authenticated, Convex loaded, and has no orgs
  const needsOnboarding = !!user && !convexLoading && convexUserWithOrgs !== undefined &&
    organizations.length === 0 && (!convexUserWithOrgs?.organizations || convexUserWithOrgs.organizations.length === 0)

  // Wrapper to update organizations and set current org
  const setOrganizations = useCallback((orgs: OrganizationMembership[]) => {
    setOrganizationsState(orgs)
    // Set current org to first active one if not already set
    if (orgs.length > 0 && !currentOrganization) {
      const activeOrg = orgs.find(o => o.status === 'active') || orgs[0]
      setCurrentOrganization(activeOrg)
    }
  }, [currentOrganization])

  // Convex mutations for syncing
  const syncUserToConvex = useMutation(api.users.syncFromWorkOS)
  const syncOrgToConvex = useMutation(api.organizations.syncFromWorkOS)
  const syncMembershipToConvex = useMutation(api.organizations.syncMembershipFromWorkOS)

  const handleSession = useCallback(async (session: Session | null) => {
    if (session) {
      setUser(session.user)
      setAccessToken(session.accessToken)
      const orgs = session.organizations || []
      setOrganizationsState(orgs)
      // Set current org to first active one
      if (orgs.length > 0) {
        const activeOrg = orgs.find(o => o.status === 'active') || orgs[0]
        setCurrentOrganization(activeOrg)
      } else {
        setCurrentOrganization(null)
      }

      // Sync user to Convex and get their ID
      try {
        setConvexLoading(true)
        const userId = await syncUserToConvex({
          workosId: session.user.id,
          email: session.user.email,
          firstName: session.user.firstName || undefined,
          lastName: session.user.lastName || undefined,
          profileImageUrl: session.user.profileImageUrl || undefined,
        })
        setConvexUserId(userId)

        // Sync organizations and memberships to Convex
        for (const org of session.organizations || []) {
          try {
            // Sync org
            await syncOrgToConvex({
              workosId: org.organizationId,
              name: org.organizationName,
            })

            // Sync membership
            await syncMembershipToConvex({
              workosId: org.id,
              workosOrgId: org.organizationId,
              workosUserId: session.user.id,
              role: org.role,
              status: org.status,
            })
          } catch (err) {
            console.warn('Failed to sync org to Convex:', err)
          }
        }
      } catch (err) {
        console.warn('Failed to sync user to Convex:', err)
      }
    } else {
      setUser(null)
      setConvexUserId(null)
      setAccessToken(null)
      setOrganizationsState([])
      setCurrentOrganization(null)
      setConvexLoading(false)
    }
    setIsLoading(false)
  }, [syncUserToConvex, syncOrgToConvex, syncMembershipToConvex])

  useEffect(() => {
    // Load initial session
    const sessionPromise = window.electronAPI.auth.getSession()

    // Add timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      console.warn('Session loading timed out, assuming no session')
      setIsLoading(false)
    }, 5000)

    sessionPromise
      .then((session) => {
        clearTimeout(timeoutId)
        handleSession(session)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        console.error('Failed to get session:', error)
        setIsLoading(false)
      })

    // Listen for auth callbacks
    const cleanupSuccess = window.electronAPI.auth.onSuccess((session) => {
      handleSession(session)
    })

    const cleanupError = window.electronAPI.auth.onError((error) => {
      console.error('Auth error:', error)
      setIsLoading(false)
    })

    // Cleanup listeners on unmount
    return () => {
      clearTimeout(timeoutId)
      cleanupSuccess()
      cleanupError()
    }
  }, [handleSession])

  const login = useCallback(async () => {
    setIsLoading(true)
    await window.electronAPI.auth.login()
    // Session will be set via onSuccess callback
  }, [])

  const logout = useCallback(async () => {
    setIsLoading(true)
    await window.electronAPI.auth.logout()
    setUser(null)
    setConvexUserId(null)
    setAccessToken(null)
    setOrganizationsState([])
    setCurrentOrganization(null)
    setConvexLoading(false)
    setIsLoading(false)
  }, [])

  // Refresh the access token using the refresh token
  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      const newSession = await window.electronAPI.auth.refresh()
      if (newSession) {
        setAccessToken(newSession.accessToken)
        return true
      }
      // Refresh failed - session expired, need to re-login
      setUser(null)
      setConvexUserId(null)
      setAccessToken(null)
      setOrganizationsState([])
      setCurrentOrganization(null)
      return false
    } catch (err) {
      console.error('Token refresh failed:', err)
      return false
    }
  }, [])

  // Auto-refresh token every 4 minutes (tokens expire after 5 min)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (accessToken && user) {
      // Clear any existing interval
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }

      // Set up periodic refresh (every 4 minutes)
      refreshIntervalRef.current = setInterval(() => {
        console.log('Auto-refreshing token...')
        refreshToken()
      }, 4 * 60 * 1000) // 4 minutes

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
        }
      }
    }
  }, [accessToken, user, refreshToken])

  return (
    <AuthContext.Provider
      value={{
        user,
        convexUserId,
        accessToken,
        organizations,
        currentOrganization,
        isAuthenticated: !!user,
        isLoading: isLoading || convexLoading,
        needsOnboarding,
        login,
        logout,
        refreshToken,
        setOrganizations,
        setCurrentOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
