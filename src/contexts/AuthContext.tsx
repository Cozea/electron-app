import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { User, Session, OrganizationMembership } from '../types/electron'

// ============================================================================
// Token Management Utilities
// ============================================================================

interface TokenPayload {
  sub: string
  exp?: number
  iat?: number
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return atob(padded)
  } catch {
    return null
  }
}

function normalizeOrganizations(input: OrganizationMembership[]): OrganizationMembership[] {
  const byOrganizationId = new Map<string, OrganizationMembership>()

  const score = (org: OrganizationMembership): number => {
    let value = 0
    if (org.status === 'active') value += 4
    if (org.convexOrgId) value += 2
    if (org.role === 'admin') value += 2
    else if (org.role === 'member') value += 1
    return value
  }

  for (const org of input) {
    const key = org.organizationId || org.id
    if (!key) continue

    const normalizedOrg: OrganizationMembership = {
      ...org,
      organizationId: key,
    }

    const existing = byOrganizationId.get(key)
    if (!existing) {
      byOrganizationId.set(key, normalizedOrg)
      continue
    }

    const existingScore = score(existing)
    const incomingScore = score(normalizedOrg)

    if (incomingScore > existingScore) {
      byOrganizationId.set(key, { ...existing, ...normalizedOrg })
    } else if (incomingScore === existingScore) {
      byOrganizationId.set(key, { ...existing, ...normalizedOrg })
    }
  }

  return Array.from(byOrganizationId.values())
}

/**
 * Decode a JWT token without verification (client-side only)
 * Used to check expiry before making requests
 */
function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const rawPayload = decodeBase64Url(parts[1])
    if (!rawPayload) return null
    const payload = JSON.parse(rawPayload)
    return payload
  } catch {
    return null
  }
}

/**
 * Check if a token is expired or will expire within the buffer time
 * @param token JWT access token
 * @param bufferSeconds Seconds before actual expiry to consider as "expired" (default 30s)
 */
function isTokenExpired(token: string | null, bufferSeconds = 30): boolean {
  if (!token) return true
  const payload = decodeToken(token)
  // Opaque/non-JWT tokens can be valid but undecodable here.
  if (!payload?.exp) return false
  const expiresAt = payload.exp * 1000 // Convert to ms
  const bufferMs = bufferSeconds * 1000
  return Date.now() >= expiresAt - bufferMs
}

/**
 * Get time until token expires in milliseconds
 */
function getTokenTimeToExpiry(token: string | null): number | null {
  if (!token) return 0
  const payload = decodeToken(token)
  if (!payload?.exp) return null
  return Math.max(0, payload.exp * 1000 - Date.now())
}

interface AuthContextType {
  user: User | null
  convexUserId: Id<"users"> | null
  accessToken: string | null
  organizations: OrganizationMembership[]
  currentOrganization: OrganizationMembership | null
  workspaceSelectionRequired: boolean
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
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

const STORAGE_KEY_USER = 'auth_user'
const STORAGE_KEY_TOKEN = 'auth_token'
const STORAGE_KEY_ORGS = 'auth_orgs'
const STORAGE_KEY_CURRENT_ORG_ID = 'auth_current_org_id'
const LOGIN_FLOW_TIMEOUT_MS = 90_000
const MIN_TOKEN_REFRESH_INTERVAL_MS = 30_000
const UNKNOWN_EXPIRY_REFRESH_INTERVAL_MS = 10 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const loginTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const organizationsRef = useRef<OrganizationMembership[]>([])
  const currentOrganizationRef = useRef<OrganizationMembership | null>(null)

  // Initialize state from localStorage for instant load
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_USER)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)

  const [accessToken, setAccessToken] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_TOKEN)
  })

  const [organizations, setOrganizationsState] = useState<OrganizationMembership[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ORGS)
      const parsed = stored ? (JSON.parse(stored) as OrganizationMembership[]) : []
      return normalizeOrganizations(parsed)
    } catch { return [] }
  })

  const [currentOrganization, setCurrentOrganization] = useState<OrganizationMembership | null>(() => {
    try {
      const storedOrgs = localStorage.getItem(STORAGE_KEY_ORGS)
      const storedCurrentId = localStorage.getItem(STORAGE_KEY_CURRENT_ORG_ID)
      if (storedOrgs && storedCurrentId) {
        const orgs = normalizeOrganizations(JSON.parse(storedOrgs) as OrganizationMembership[])
        return orgs.find(o => o.id === storedCurrentId || o.organizationId === storedCurrentId) || null
      }
      return null
    } catch { return null }
  })

  // specific isLoading logic: only true if we don't have a user (cold start) or explicitly loading
  const [isLoading, setIsLoading] = useState(() => {
    return !localStorage.getItem(STORAGE_KEY_USER)
  })
  const [authError, setAuthError] = useState<string | null>(null)
  const [convexLoading, setConvexLoading] = useState(false)
  const [workspaceSelectionRequired, setWorkspaceSelectionRequired] = useState(false)

  useEffect(() => {
    organizationsRef.current = organizations
    currentOrganizationRef.current = currentOrganization
  }, [organizations, currentOrganization])

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
      const convexOrgs = normalizeOrganizations(
        orgs
          .filter((org): org is ConvexOrganizationShape => org !== null)
          .map((org) => ({
            id: org.workosId || org._id, // Keep WorkOS ID for consistency
            organizationId: org.workosId || org._id, // WorkOS organization ID
            organizationName: org.name,
            role: org.role || 'member',
            status: 'active' as const,
            convexOrgId: org._id, // Store Convex document ID separately
          }))
      )

      // Update with Convex data if convexOrgId is missing (to fix race condition)
      const currentOrg = currentOrganizationRef.current
      const existingOrganizations = organizationsRef.current
      const needsConvexOrgId = !currentOrg?.convexOrgId || existingOrganizations.some(org => !org.convexOrgId)
      if (convexOrgs.length > 0 && needsConvexOrgId) {
        setOrganizationsState(convexOrgs)
        if (!workspaceSelectionRequired) {
          // Update current org with the one that has convexOrgId
          const currentOrgId = currentOrg?.organizationId
          const updatedCurrentOrg = currentOrgId
            ? convexOrgs.find(org => org.organizationId === currentOrgId)
            : convexOrgs[0]
          if (updatedCurrentOrg) {
            setCurrentOrganization(updatedCurrentOrg)
          }
        }
        // Persist to local session
        window.electronAPI.auth.updateOrganizations(convexOrgs)
      }
      setConvexLoading(false)
    } else if (convexUserWithOrgs !== undefined) {
      // Query completed but no orgs
      setConvexLoading(false)
    }
  }, [convexUserWithOrgs, workspaceSelectionRequired])

  // Derived state: user needs onboarding if authenticated, Convex loaded, and has no orgs
  const needsOnboarding = !!user && !convexLoading && convexUserWithOrgs !== undefined &&
    organizations.length === 0 && (!convexUserWithOrgs?.organizations || convexUserWithOrgs.organizations.length === 0)

  // Wrapper to update organizations and set current org
  const setOrganizations = useCallback((orgs: OrganizationMembership[]) => {
    const normalized = normalizeOrganizations(orgs)
    setOrganizationsState(normalized)
    // Set current org to first active one if not already set
    if (normalized.length > 0 && !currentOrganization) {
      const activeOrg = normalized.find(o => o.status === 'active') || normalized[0]
      setCurrentOrganization(activeOrg)
    }
  }, [currentOrganization])

  // Convex mutations for syncing
  const syncUserToConvex = useMutation(api.users.syncFromWorkOS)
  const syncOrgToConvex = useMutation(api.organizations.syncFromWorkOS)
  const reconcileMembershipsToConvex = useMutation(api.organizations.reconcileMembershipSetFromWorkOS)

  const handleSession = useCallback(async (session: Session | null, source: 'startup' | 'callback' = 'startup') => {
    if (session) {
      setAuthError(null)
      setUser(session.user)
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(session.user))

      setAccessToken(session.accessToken)
      localStorage.setItem(STORAGE_KEY_TOKEN, session.accessToken)

      const orgs = normalizeOrganizations(session.organizations || [])
      setOrganizationsState(orgs)
      localStorage.setItem(STORAGE_KEY_ORGS, JSON.stringify(orgs))
      const shouldPromptWorkspaceSelection = source === 'callback' && orgs.length > 1
      setWorkspaceSelectionRequired(shouldPromptWorkspaceSelection)

      // Set current org to first active one
      if (orgs.length > 0) {
        if (shouldPromptWorkspaceSelection) {
          setCurrentOrganization(null)
          localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
        } else {
          // use existing choice if available
          const storedCurrentId = localStorage.getItem(STORAGE_KEY_CURRENT_ORG_ID)
          let activeOrg: OrganizationMembership | undefined

          if (storedCurrentId) {
            activeOrg = orgs.find(o => o.id === storedCurrentId || o.organizationId === storedCurrentId)
          }

          if (!activeOrg) {
            activeOrg = orgs.find(o => o.status === 'active') || orgs[0]
          }

          if (activeOrg) {
            setCurrentOrganization(activeOrg)
            localStorage.setItem(STORAGE_KEY_CURRENT_ORG_ID, activeOrg.organizationId)
          }
        }
      } else {
        setCurrentOrganization(null)
        localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
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

        // Sync organizations and memberships to Convex - must succeed for billing
        for (const org of session.organizations || []) {
          // Sync org
          await syncOrgToConvex({
            workosId: org.organizationId,
            name: org.organizationName,
          })
        }

        await reconcileMembershipsToConvex({
          workosUserId: session.user.id,
          memberships: (session.organizations || []).map((org) => ({
            workosId: org.id,
            workosOrgId: org.organizationId,
            role: org.role,
            status: org.status,
          })),
        })
      } catch (err) {
        console.error('Failed to sync to Convex - billing will not work:', err)
        // Re-throw so the error is visible - sync must succeed for billing
        throw err
      }
    } else {
      setUser(null)
      setConvexUserId(null)
      setAccessToken(null)
      setOrganizationsState([])
      setCurrentOrganization(null)
      setConvexLoading(false)
      setWorkspaceSelectionRequired(false)

      // Clear local storage
      localStorage.removeItem(STORAGE_KEY_USER)
      localStorage.removeItem(STORAGE_KEY_TOKEN)
      localStorage.removeItem(STORAGE_KEY_ORGS)
      localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
    }
    setIsLoading(false)
  }, [syncUserToConvex, syncOrgToConvex, reconcileMembershipsToConvex])

  const clearLoginTimeout = useCallback(() => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current)
      loginTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    // Load initial session with smart token refresh
    const loadSession = async () => {
      try {
        const session = await window.electronAPI.auth.getSession()

        if (!session) {
          // No stored session
          handleSession(null, 'startup')
          return
        }

        // Check if token is expired or about to expire (within 60 seconds)
        if (isTokenExpired(session.accessToken, 60)) {
          console.log('[Auth] Token expired or expiring soon, refreshing on startup...')
          const refreshedSession = await window.electronAPI.auth.refresh()
          if (refreshedSession) {
            console.log('[Auth] Token refreshed successfully on startup')
            handleSession(refreshedSession, 'startup')
          } else {
            // Refresh failed - session fully expired, need to re-login
            console.log('[Auth] Token refresh failed, session expired')
            handleSession(null, 'startup')
          }
        } else {
          // Token is still valid
          const ttl = getTokenTimeToExpiry(session.accessToken)
          if (ttl === null) {
            console.log('[Auth] Token valid, expiry unknown')
          } else {
            console.log(`[Auth] Token valid, expires in ${Math.round(ttl / 1000)}s`)
          }
          handleSession(session, 'startup')
        }
      } catch (error) {
        console.error('[Auth] Failed to load session:', error)
        setIsLoading(false)
      }
    }

    // Add timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      console.warn('[Auth] Session loading timed out, assuming no session')
      setIsLoading(false)
    }, 10000) // Increased to 10s to allow for refresh

    loadSession().finally(() => clearTimeout(timeoutId))

    // Listen for auth callbacks
    const cleanupSuccess = window.electronAPI.auth.onSuccess((session) => {
      clearLoginTimeout()
      handleSession(session, 'callback')
    })

    const cleanupError = window.electronAPI.auth.onError((error) => {
      console.error('Auth error:', error)
      clearLoginTimeout()
      setAuthError(typeof error === 'string' && error.length > 0 ? error : 'Authentication failed. Please try again.')
      setIsLoading(false)
    })

    // Cleanup listeners on unmount
    return () => {
      clearTimeout(timeoutId)
      clearLoginTimeout()
      cleanupSuccess()
      cleanupError()
    }
  }, [clearLoginTimeout, handleSession])

  const login = useCallback(async () => {
    setAuthError(null)
    setIsLoading(true)
    clearLoginTimeout()
    loginTimeoutRef.current = setTimeout(() => {
      console.warn('[Auth] Login flow timed out or was interrupted')
      setAuthError('Login timed out. Please try again.')
      setIsLoading(false)
      loginTimeoutRef.current = null
    }, LOGIN_FLOW_TIMEOUT_MS)

    try {
      await window.electronAPI.auth.login()
      // Session will be set via onSuccess callback
    } catch (error) {
      clearLoginTimeout()
      setAuthError('Unable to start login. Please try again.')
      setIsLoading(false)
      throw error
    }
  }, [clearLoginTimeout])

  const logout = useCallback(async () => {
    clearLoginTimeout()
    setAuthError(null)
    setIsLoading(true)
    await window.electronAPI.auth.logout()
    setUser(null)
    setConvexUserId(null)
    setAccessToken(null)
    setOrganizationsState([])
    setCurrentOrganization(null)
    setConvexLoading(false)
    setWorkspaceSelectionRequired(false)
    setIsLoading(false)

    // Clear local storage
    localStorage.removeItem(STORAGE_KEY_USER)
    localStorage.removeItem(STORAGE_KEY_TOKEN)
    localStorage.removeItem(STORAGE_KEY_ORGS)
    localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
  }, [clearLoginTimeout])

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null)
  const lastRefreshAttemptAtRef = useRef<number>(0)

  // Refresh the access token using the refresh token
  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current
    }

    const pendingRefresh = (async (): Promise<boolean> => {
      try {
        const newSession = await window.electronAPI.auth.refresh()
        if (newSession) {
          setAccessToken(newSession.accessToken)
          localStorage.setItem(STORAGE_KEY_TOKEN, newSession.accessToken)
          return true
        }
        // Refresh failed - session expired, need to re-login
        setUser(null)
        setConvexUserId(null)
        setAccessToken(null)
        localStorage.removeItem(STORAGE_KEY_TOKEN)
        setOrganizationsState([])
        setCurrentOrganization(null)
        setWorkspaceSelectionRequired(false)
        return false
      } catch (err) {
        console.error('Token refresh failed:', err)
        return false
      } finally {
        refreshInFlightRef.current = null
      }
    })()

    refreshInFlightRef.current = pendingRefresh
    return pendingRefresh
  }, [])

  useEffect(() => {
    if (accessToken && user) {
      // Clear any existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }

      const scheduleRefresh = (delayMs: number) => {
        refreshTimeoutRef.current = setTimeout(async () => {
          const elapsed = Date.now() - lastRefreshAttemptAtRef.current
          if (elapsed < MIN_TOKEN_REFRESH_INTERVAL_MS) {
            scheduleRefresh(MIN_TOKEN_REFRESH_INTERVAL_MS - elapsed)
            return
          }
          lastRefreshAttemptAtRef.current = Date.now()
          console.log('[Auth] Auto-refreshing token...')
          const success = await refreshToken()
          if (!success) {
            console.log('[Auth] Auto-refresh failed')
          }
        }, delayMs)
      }

      const timeToExpiry = getTokenTimeToExpiry(accessToken)
      let refreshIn: number
      if (timeToExpiry === null) {
        console.log('[Auth] Token expiry unknown, scheduling conservative refresh cadence')
        refreshIn = UNKNOWN_EXPIRY_REFRESH_INTERVAL_MS
      } else {
        // Refresh around 80% of lifetime, but no later than 30 seconds pre-expiry.
        refreshIn = Math.min(timeToExpiry * 0.8, timeToExpiry - 30000)
      }

      if (refreshIn > 0) {
        console.log(`[Auth] Scheduling token refresh in ${Math.round(refreshIn / 1000)}s`)
        scheduleRefresh(refreshIn)
      } else if (timeToExpiry !== null) {
        // Token is already expired or about to expire, refresh immediately
        console.log('[Auth] Token expiring, refreshing immediately...')
        scheduleRefresh(0)
      }

      return () => {
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current)
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
        workspaceSelectionRequired,
        isAuthenticated: !!user,
        isLoading: isLoading, // Only block on initial hydration, not background sync
        authError,
        needsOnboarding,
        login,
        logout,
        refreshToken,
        setOrganizations,
        setCurrentOrganization: (org) => {
          setCurrentOrganization(org)
          if (org) {
            setWorkspaceSelectionRequired(false)
            localStorage.setItem(STORAGE_KEY_CURRENT_ORG_ID, org.organizationId)
          } else {
            localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
          }
        },
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
