import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { AuthRefreshResult } from '@shared/electronApiTypes'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type {
  User,
  Session,
  OrganizationMembership,
  WorkspaceMembership,
  PersonalWorkspaceMembership,
  OrganizationWorkspaceMembership,
} from '../types/electron'
import {
  sanitizeWorkspaceIdentityInput,
  type WorkspaceIdentityInput,
} from '@shared/workspaceIdentity.ts'
import {
  combineWorkspaceMemberships,
  findWorkspaceBySelectionId,
  getWorkspaceSelectionId,
  isOrganizationWorkspaceMembership,
  isPersonalWorkspaceMembership,
} from '@shared/types'

// ============================================================================
// Token Management Utilities
// ============================================================================

interface TokenPayload {
  sub: string
  exp?: number
  iat?: number
}

interface CreateOrganizationResponse {
  organization: {
    id: string
    name: string
    iconKey?: OrganizationWorkspaceMembership['iconKey']
    iconColor?: OrganizationWorkspaceMembership['iconColor']
  }
  membership: {
    id: string
    organizationId?: string
    organizationName?: string
    role?: string
    status?: string
    iconKey?: OrganizationWorkspaceMembership['iconKey']
    iconColor?: OrganizationWorkspaceMembership['iconColor']
  }
}

function normalizeWorkspaceNameForComparison(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

interface ListOrganizationsResponse {
  organizations?: OrganizationWorkspaceMembership[]
}

interface WorkspaceNameAvailabilityResult {
  available: boolean
  reason?: string
}

const PERSONAL_WORKSPACE_PREFIX = 'personal:'
const PERSONAL_MEMBERSHIP_PREFIX = 'personal-membership:'
const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://api.cozea.app'

function isPersonalWorkspaceOrganizationId(organizationId: string): boolean {
  return organizationId.startsWith(PERSONAL_WORKSPACE_PREFIX)
}

function getPersonalWorkspaceName(user: User): string {
  if (user.firstName && user.firstName.trim().length > 0) {
    return `${user.firstName.trim()}'s Workspace`
  }
  const emailPrefix = user.email.split('@')[0]?.trim()
  if (emailPrefix) {
    return `${emailPrefix}'s Workspace`
  }
  return 'My Workspace'
}

function createPersonalWorkspaceMembership(
  user: User,
  options?: {
    convexOrgId?: string
    organizationName?: string
    iconKey?: PersonalWorkspaceMembership['iconKey']
    iconColor?: PersonalWorkspaceMembership['iconColor']
    logoUrl?: PersonalWorkspaceMembership['logoUrl']
  }
): PersonalWorkspaceMembership {
  const organizationId = `${PERSONAL_WORKSPACE_PREFIX}${user.id}`
  return {
    id: `${PERSONAL_MEMBERSHIP_PREFIX}${user.id}`,
    organizationId,
    organizationName: options?.organizationName || getPersonalWorkspaceName(user),
    role: 'admin',
    status: 'active',
    workspaceType: 'personal',
    convexOrgId: options?.convexOrgId,
    iconKey: options?.iconKey,
    iconColor: options?.iconColor,
    logoUrl: options?.logoUrl,
  }
}

function normalizeMembershipStatus(status: string | undefined): OrganizationMembership['status'] {
  if (status === 'inactive' || status === 'pending') {
    return status
  }
  return 'active'
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

function normalizeOrganizations(input: WorkspaceMembership[]): WorkspaceMembership[] {
  const byOrganizationId = new Map<string, WorkspaceMembership>()

  const score = (org: WorkspaceMembership): number => {
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

    const normalizedOrg: WorkspaceMembership = {
      ...org,
      organizationId: key,
      workspaceType: org.workspaceType ?? (isPersonalWorkspaceOrganizationId(key) ? 'personal' : 'organization'),
    } as WorkspaceMembership

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

function normalizeOrganizationWorkspaces(
  input: WorkspaceMembership[] | OrganizationWorkspaceMembership[]
): OrganizationWorkspaceMembership[] {
  return normalizeOrganizations(input as WorkspaceMembership[]).filter(
    (workspace): workspace is OrganizationWorkspaceMembership => workspace.workspaceType === 'organization'
  )
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
  organizationWorkspaces: OrganizationWorkspaceMembership[]
  personalWorkspace: PersonalWorkspaceMembership | null
  currentPersonalWorkspace: PersonalWorkspaceMembership | null
  currentOrganizationWorkspace: OrganizationWorkspaceMembership | null
  workspaceSelectionRequired: boolean
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  needsOnboarding: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<RefreshTokenStatus>
  checkOrganizationWorkspaceNameAvailability: (
    name: string
  ) => Promise<WorkspaceNameAvailabilityResult>
  createOrganizationWorkspace: (
    name: string,
    identity?: WorkspaceIdentityInput
  ) => Promise<OrganizationWorkspaceMembership>
  setCurrentWorkspace: (workspace: WorkspaceMembership | null) => void
}

export type RefreshTokenStatus = 'refreshed' | 'retryable' | 'expired'

type ConvexOrganizationShape = {
  _id: Id<"organizations">
  workosId?: string
  name: string
  role?: string
  iconKey?: OrganizationWorkspaceMembership['iconKey']
  iconColor?: OrganizationWorkspaceMembership['iconColor']
  logoUrl?: OrganizationWorkspaceMembership['logoUrl']
}

const AuthContext = createContext<AuthContextType | null>(null)

const STORAGE_KEY_USER = 'auth_user'
const STORAGE_KEY_TOKEN = 'auth_token'
const STORAGE_KEY_ORGS = 'auth_orgs'
const STORAGE_KEY_CURRENT_ORG_ID = 'auth_current_org_id'
const LOGIN_FLOW_TIMEOUT_MS = 90_000
const MIN_TOKEN_REFRESH_INTERVAL_MS = 30_000
const FOREGROUND_TOKEN_REFRESH_INTERVAL_MS = 5_000
const UNKNOWN_EXPIRY_REFRESH_INTERVAL_MS = 10 * 60 * 1000
const TOKEN_REFRESH_RETRY_DELAY_MS = 30_000

function clearLegacyAuthBootstrapStorage(): void {
  localStorage.removeItem(STORAGE_KEY_USER)
  localStorage.removeItem(STORAGE_KEY_TOKEN)
  localStorage.removeItem(STORAGE_KEY_ORGS)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const loginTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [user, setUser] = useState<User | null>(null)

  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)

  const [accessToken, setAccessToken] = useState<string | null>(null)

  const [organizationWorkspaces, setOrganizationWorkspacesState] = useState<OrganizationWorkspaceMembership[]>([])

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_CURRENT_ORG_ID)
  })

  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [convexLoading, setConvexLoading] = useState(false)
  const [workspaceSelectionRequired, setWorkspaceSelectionRequired] = useState(false)

  // Query Convex for user's organizations (source of truth)
  const convexUserWithOrgs = useQuery(
    api.users.getWithOrganizations,
    convexUserId ? { userId: convexUserId } : "skip"
  )

  const personalConvexWorkspace = useMemo(() => {
    if (!user || !convexUserWithOrgs?.organizations?.length) return null

    const personalOrganizationId = `${PERSONAL_WORKSPACE_PREFIX}${user.id}`
    const organizations = convexUserWithOrgs.organizations as Array<ConvexOrganizationShape | null>

    return (
      organizations.find((organization): organization is ConvexOrganizationShape => {
        if (!organization) return false
        return (
          organization.workosId === personalOrganizationId ||
          String(organization._id) === personalOrganizationId
        )
      }) ?? null
    )
  }, [convexUserWithOrgs?.organizations, user])

  const personalWorkspace = useMemo(
    () =>
      user
        ? createPersonalWorkspaceMembership(user, {
            convexOrgId: personalConvexWorkspace?._id,
            organizationName: personalConvexWorkspace?.name,
            iconKey: personalConvexWorkspace?.iconKey,
            iconColor: personalConvexWorkspace?.iconColor,
            logoUrl: personalConvexWorkspace?.logoUrl,
          })
        : null,
    [personalConvexWorkspace, user],
  )

  const availableWorkspaces = useMemo<WorkspaceMembership[]>(
    () => combineWorkspaceMemberships(personalWorkspace, organizationWorkspaces),
    [organizationWorkspaces, personalWorkspace],
  )

  const selectedWorkspace = useMemo(
    () => findWorkspaceBySelectionId(availableWorkspaces, currentWorkspaceId),
    [availableWorkspaces, currentWorkspaceId],
  )

  const currentOrganizationWorkspace = useMemo(
    () => (isOrganizationWorkspaceMembership(selectedWorkspace) ? selectedWorkspace : null),
    [selectedWorkspace],
  )

  const currentPersonalWorkspace = useMemo(
    () => (isPersonalWorkspaceMembership(selectedWorkspace) ? selectedWorkspace : null),
    [selectedWorkspace],
  )

  useEffect(() => {
    if (currentWorkspaceId) {
      localStorage.setItem(STORAGE_KEY_CURRENT_ORG_ID, currentWorkspaceId)
      return
    }
    localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
  }, [currentWorkspaceId])

  useEffect(() => {
    if (workspaceSelectionRequired) {
      return
    }

    if (availableWorkspaces.length === 0) {
      if (currentWorkspaceId !== null) {
        setCurrentWorkspaceId(null)
      }
      return
    }

    if (!selectedWorkspace) {
      const activeWorkspace =
        availableWorkspaces.find((workspace) => workspace.status === 'active') || availableWorkspaces[0]
      setCurrentWorkspaceId(getWorkspaceSelectionId(activeWorkspace))
    }
  }, [availableWorkspaces, currentWorkspaceId, selectedWorkspace, workspaceSelectionRequired])

  // Update organizations from Convex when available
  useEffect(() => {
    if (convexUserWithOrgs?.organizations && convexUserWithOrgs.organizations.length > 0) {
      // Convert Convex orgs to OrganizationMembership format (filter out nulls)
      const orgs = convexUserWithOrgs.organizations as Array<ConvexOrganizationShape | null>
      const convexOrgs = normalizeOrganizationWorkspaces(
        orgs
          .filter((org): org is ConvexOrganizationShape => org !== null)
          .map((org) => ({
            id: org.workosId || org._id, // Keep WorkOS ID for consistency
            organizationId: org.workosId || org._id, // WorkOS organization ID
            organizationName: org.name,
            role: org.role || 'member',
            status: 'active' as const,
            convexOrgId: org._id, // Store Convex document ID separately
            iconKey: org.iconKey,
            iconColor: org.iconColor,
            logoUrl: org.logoUrl,
            workspaceType: isPersonalWorkspaceOrganizationId(org.workosId || org._id)
              ? ('personal' as const)
              : ('organization' as const),
          })) as OrganizationWorkspaceMembership[]
      )

      // Update with Convex data if convexOrgId is missing (to fix race condition)
      const needsConvexOrgId = organizationWorkspaces.some((org) => !org.convexOrgId)
      if (convexOrgs.length > 0 && needsConvexOrgId) {
        setOrganizationWorkspacesState(convexOrgs)
        if (!workspaceSelectionRequired) {
          const nextAvailableWorkspaces = combineWorkspaceMemberships(personalWorkspace, convexOrgs)
          const updatedCurrentWorkspace =
            findWorkspaceBySelectionId(nextAvailableWorkspaces, currentWorkspaceId) ?? nextAvailableWorkspaces[0] ?? null
          if (updatedCurrentWorkspace) {
            setCurrentWorkspaceId(getWorkspaceSelectionId(updatedCurrentWorkspace))
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
  }, [convexUserWithOrgs, currentWorkspaceId, organizationWorkspaces, personalWorkspace, workspaceSelectionRequired])

  // Derived state: user needs onboarding if authenticated, Convex loaded, and has no orgs
  const needsOnboarding = !!user && !convexLoading && convexUserWithOrgs !== undefined &&
    organizationWorkspaces.length === 0 && (!convexUserWithOrgs?.organizations || convexUserWithOrgs.organizations.length === 0)

  // Convex mutations for syncing
  const syncUserToConvex = useMutation(api.users.syncFromWorkOS)
  const syncOrgToConvex = useMutation(api.organizations.syncFromWorkOS)
  const syncMembershipToConvex = useMutation(api.organizations.syncMembershipFromWorkOS)
  const reconcileMembershipsToConvex = useMutation(api.organizations.reconcileMembershipSetFromWorkOS)

  const createOrganizationWorkspace = useCallback(async (
    name: string,
    identity?: WorkspaceIdentityInput
  ): Promise<OrganizationWorkspaceMembership> => {
    if (!user || !accessToken) {
      throw new Error('You must be signed in to create a workspace')
    }

    const trimmedName = name.trim()
    const normalizedIdentity = sanitizeWorkspaceIdentityInput(identity)
    if (!trimmedName) {
      throw new Error('Workspace name is required')
    }

    const normalizedRequestedName = normalizeWorkspaceNameForComparison(trimmedName)
    const hasDuplicateName = availableWorkspaces.some(
      (organization) =>
        normalizeWorkspaceNameForComparison(organization.organizationName) === normalizedRequestedName,
    )

    if (hasDuplicateName) {
      throw new Error('You already have a workspace with that name. Choose a different name.')
    }

    const createResponse = await fetch(`${AUTH_SERVER_URL}/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: trimmedName,
        iconKey: normalizedIdentity.iconKey,
        iconColor: normalizedIdentity.iconColor,
      }),
    })

    if (!createResponse.ok) {
      let errorMessage = 'Failed to create workspace'
      try {
        const errorData = (await createResponse.json()) as { error?: string }
        if (errorData.error) {
          errorMessage = errorData.error
        }
      } catch {
        // noop
      }
      throw new Error(errorMessage)
    }

    const created = (await createResponse.json()) as CreateOrganizationResponse

    const createdConvexOrgId = await syncOrgToConvex({
      workosId: created.organization.id,
      name: created.organization.name,
      iconKey: normalizedIdentity.iconKey,
      iconColor: normalizedIdentity.iconColor,
    })

    const createdMembership: OrganizationWorkspaceMembership = {
      id: created.membership.id,
      organizationId: created.organization.id,
      organizationName: created.organization.name,
      role: created.membership.role || 'admin',
      status: normalizeMembershipStatus(created.membership.status),
      workspaceType: 'organization',
      convexOrgId: createdConvexOrgId,
      iconKey: created.organization.iconKey ?? normalizedIdentity.iconKey ?? null,
      iconColor: created.organization.iconColor ?? normalizedIdentity.iconColor ?? null,
    }

    await syncMembershipToConvex({
      workosId: createdMembership.id,
      workosOrgId: createdMembership.organizationId,
      workosUserId: user.id,
      role: createdMembership.role,
      status: createdMembership.status,
    })

    let nextOrganizationWorkspaces: OrganizationWorkspaceMembership[]
    try {
      const listResponse = await fetch(`${AUTH_SERVER_URL}/organizations`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!listResponse.ok) {
        throw new Error('Failed to list organizations after creation')
      }

      const listed = (await listResponse.json()) as ListOrganizationsResponse
      const convexOrgIdsByWorkosId = new Map<string, string>(
        organizationWorkspaces
          .filter((organization) => !!organization.convexOrgId)
          .map((organization) => [organization.organizationId, organization.convexOrgId as string])
      )
      convexOrgIdsByWorkosId.set(createdMembership.organizationId, createdConvexOrgId)

      const listedOrganizations = ((listed.organizations || []) as OrganizationWorkspaceMembership[]).map((organization) => {
        const organizationId = organization.organizationId || organization.id
        return {
          ...organization,
          organizationId,
          workspaceType: 'organization' as const,
          convexOrgId: convexOrgIdsByWorkosId.get(organizationId),
          iconKey: organization.iconKey ?? null,
          iconColor: organization.iconColor ?? null,
          logoUrl: organization.logoUrl ?? null,
        } satisfies OrganizationWorkspaceMembership
      })

      nextOrganizationWorkspaces = normalizeOrganizationWorkspaces(listedOrganizations)
    } catch {
      nextOrganizationWorkspaces = normalizeOrganizationWorkspaces([
        ...organizationWorkspaces,
        createdMembership,
      ])
    }

    setOrganizationWorkspacesState(nextOrganizationWorkspaces)
    await window.electronAPI.auth.updateOrganizations(nextOrganizationWorkspaces)

    const selectedOrganization =
      nextOrganizationWorkspaces.find(
        (organization): organization is OrganizationWorkspaceMembership =>
          organization.workspaceType === 'organization' &&
          organization.organizationId === createdMembership.organizationId
      ) || createdMembership

    const selectedWorkspaceId = getWorkspaceSelectionId(selectedOrganization)
    setCurrentWorkspaceId(selectedWorkspaceId)
    setWorkspaceSelectionRequired(false)
    if (selectedWorkspaceId) {
      localStorage.setItem(STORAGE_KEY_CURRENT_ORG_ID, selectedWorkspaceId)
    }

    return selectedOrganization
  }, [accessToken, availableWorkspaces, organizationWorkspaces, syncMembershipToConvex, syncOrgToConvex, user])

  const checkOrganizationWorkspaceNameAvailability = useCallback(
    async (name: string): Promise<WorkspaceNameAvailabilityResult> => {
      if (!user || !accessToken) {
        return {
          available: false,
          reason: 'You must be signed in to create a workspace',
        }
      }

      const trimmedName = name.trim()
      if (!trimmedName) {
        return {
          available: false,
          reason: 'Workspace name is required',
        }
      }

      const normalizedRequestedName = normalizeWorkspaceNameForComparison(trimmedName)
      const hasDuplicateName = availableWorkspaces.some(
        (organization) =>
          normalizeWorkspaceNameForComparison(organization.organizationName) === normalizedRequestedName,
      )

      if (hasDuplicateName) {
        return {
          available: false,
          reason: 'You already have a workspace with that name. Choose a different name.',
        }
      }

      const response = await fetch(
        `${AUTH_SERVER_URL}/organizations/check-name?name=${encodeURIComponent(trimmedName)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (!response.ok) {
        let errorMessage = 'Failed to check workspace name availability'
        try {
          const errorData = (await response.json()) as { error?: string }
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          // noop
        }

        return {
          available: false,
          reason: errorMessage,
        }
      }

      return (await response.json()) as WorkspaceNameAvailabilityResult
    },
    [accessToken, availableWorkspaces, user]
  )

  const handleSession = useCallback(async (session: Session | null, source: 'startup' | 'callback' = 'startup') => {
    if (session) {
      setAuthError(null)
      setUser(session.user)
      setAccessToken(session.accessToken)
      clearLegacyAuthBootstrapStorage()

      const orgs = normalizeOrganizationWorkspaces(session.organizations || [])
      const nextAvailableWorkspaces = combineWorkspaceMemberships(
        createPersonalWorkspaceMembership(session.user),
        orgs,
      )
      setOrganizationWorkspacesState(orgs)
      const shouldPromptWorkspaceSelection = source === 'callback' && nextAvailableWorkspaces.length > 1
      setWorkspaceSelectionRequired(shouldPromptWorkspaceSelection)

      if (nextAvailableWorkspaces.length > 0) {
        if (shouldPromptWorkspaceSelection) {
          setCurrentWorkspaceId(null)
          localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
        } else {
          const storedCurrentId = localStorage.getItem(STORAGE_KEY_CURRENT_ORG_ID)
          let activeWorkspace = findWorkspaceBySelectionId(nextAvailableWorkspaces, storedCurrentId) ?? undefined

          if (!activeWorkspace) {
            activeWorkspace =
              nextAvailableWorkspaces.find((workspace) => workspace.status === 'active') || nextAvailableWorkspaces[0]
          }

          if (activeWorkspace) {
            const selectionId = getWorkspaceSelectionId(activeWorkspace)
            setCurrentWorkspaceId(selectionId)
            if (selectionId) {
              localStorage.setItem(STORAGE_KEY_CURRENT_ORG_ID, selectionId)
            }
          }
        }
      } else {
        setCurrentWorkspaceId(null)
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
        for (const org of orgs) {
          // Sync org
          await syncOrgToConvex({
            workosId: org.organizationId,
            name: org.organizationName,
            iconKey: org.iconKey,
            iconColor: org.iconColor,
          })
        }

        const syncedPersonalWorkspace = createPersonalWorkspaceMembership(session.user)
        await syncOrgToConvex({
          workosId: syncedPersonalWorkspace.organizationId,
          name: syncedPersonalWorkspace.organizationName,
        })
        await syncMembershipToConvex({
          workosId: syncedPersonalWorkspace.id,
          workosOrgId: syncedPersonalWorkspace.organizationId,
          workosUserId: session.user.id,
          role: 'admin',
          status: 'active',
        })

        await reconcileMembershipsToConvex({
          workosUserId: session.user.id,
          memberships: orgs.map((org) => ({
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
      setOrganizationWorkspacesState([])
      setCurrentWorkspaceId(null)
      setConvexLoading(false)
      setWorkspaceSelectionRequired(false)

      // Clear local storage
      clearLegacyAuthBootstrapStorage()
      localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
    }
    setIsLoading(false)
  }, [syncUserToConvex, syncOrgToConvex, syncMembershipToConvex, reconcileMembershipsToConvex])

  const applySession = useCallback(
    async (session: Session | null, source: 'startup' | 'callback') => {
      try {
        await handleSession(session, source)
      } catch (error) {
        console.error('[Auth] Failed to apply session:', error)
        await handleSession(null, 'startup')
        setAuthError(
          source === 'callback'
            ? 'Failed to finish sign in. Please try again.'
            : 'Failed to restore your session. Please sign in again.',
        )
      }
    },
    [handleSession],
  )

  const clearLoginTimeout = useCallback(() => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current)
      loginTimeoutRef.current = null
    }
  }, [])

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshInFlightRef = useRef<Promise<RefreshTokenStatus> | null>(null)
  const lastRefreshAttemptAtRef = useRef<number>(0)
  const nextRefreshDelayOverrideRef = useRef<number | null>(null)
  const [refreshScheduleNonce, setRefreshScheduleNonce] = useState(0)

  const queueRefreshRetry = useCallback((delayMs = TOKEN_REFRESH_RETRY_DELAY_MS) => {
    nextRefreshDelayOverrideRef.current = delayMs
    setRefreshScheduleNonce((value) => value + 1)
  }, [])

  const commitRefreshSchedule = useCallback((overrideDelayMs: number | null = null) => {
    nextRefreshDelayOverrideRef.current = overrideDelayMs
    setRefreshScheduleNonce((value) => value + 1)
  }, [])

  const resolveRefreshResult = useCallback(async (result: AuthRefreshResult): Promise<RefreshTokenStatus> => {
    if (result.ok) {
      setAuthError(null)
      setAccessToken(result.session.accessToken)
      commitRefreshSchedule(null)
      return 'refreshed'
    }

    if (result.reason === 'retryable') {
      console.warn('[Auth] Token refresh failed temporarily; keeping local session active')
      commitRefreshSchedule(TOKEN_REFRESH_RETRY_DELAY_MS)
      return 'retryable'
    }

    await handleSession(null, 'startup')
    return 'expired'
  }, [commitRefreshSchedule, handleSession])

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
          const refreshResult = await window.electronAPI.auth.refresh()
          if (refreshResult.ok) {
            console.log('[Auth] Token refreshed successfully on startup')
            await applySession(refreshResult.session, 'startup')
          } else if (refreshResult.reason === 'retryable') {
            console.log('[Auth] Token refresh failed temporarily on startup; preserving session')
            queueRefreshRetry(TOKEN_REFRESH_RETRY_DELAY_MS)
            await applySession(session, 'startup')
          } else {
            // Refresh failed - session fully expired, need to re-login
            console.log('[Auth] Token refresh failed, session expired')
            await applySession(null, 'startup')
          }
        } else {
          // Token is still valid
          const ttl = getTokenTimeToExpiry(session.accessToken)
          if (ttl === null) {
            console.log('[Auth] Token valid, expiry unknown')
          } else {
            console.log(`[Auth] Token valid, expires in ${Math.round(ttl / 1000)}s`)
          }
          await applySession(session, 'startup')
        }
      } catch (error) {
        console.error('[Auth] Failed to load session:', error)
        await applySession(null, 'startup')
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
      void applySession(session, 'callback')
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
  }, [applySession, clearLoginTimeout, handleSession, queueRefreshRetry])

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
    await window.electronAPI.auth.logout({ accessToken })
    setUser(null)
    setConvexUserId(null)
    setAccessToken(null)
    setOrganizationWorkspacesState([])
    setCurrentWorkspaceId(null)
    setConvexLoading(false)
    setWorkspaceSelectionRequired(false)
    setIsLoading(false)

    // Clear local storage
    clearLegacyAuthBootstrapStorage()
    localStorage.removeItem(STORAGE_KEY_CURRENT_ORG_ID)
  }, [accessToken, clearLoginTimeout])

  // Refresh the access token using the refresh token
  const refreshToken = useCallback(async (): Promise<RefreshTokenStatus> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current
    }

    const pendingRefresh = (async (): Promise<RefreshTokenStatus> => {
      try {
        const refreshResult = await window.electronAPI.auth.refresh()
        return await resolveRefreshResult(refreshResult)
      } catch (err) {
        console.error('Token refresh failed:', err)
        commitRefreshSchedule(TOKEN_REFRESH_RETRY_DELAY_MS)
        return 'retryable'
      } finally {
        refreshInFlightRef.current = null
      }
    })()

    refreshInFlightRef.current = pendingRefresh
    return pendingRefresh
  }, [commitRefreshSchedule, resolveRefreshResult])

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
          const status = await refreshToken()
          if (status === 'retryable') {
            console.warn('[Auth] Auto-refresh failed temporarily; will retry')
          } else if (status === 'expired') {
            console.warn('[Auth] Auto-refresh failed; session expired')
          }
        }, delayMs)
      }

      const timeToExpiry = getTokenTimeToExpiry(accessToken)
      let refreshIn: number
      const overrideDelayMs = nextRefreshDelayOverrideRef.current
      nextRefreshDelayOverrideRef.current = null

      if (overrideDelayMs !== null) {
        refreshIn = overrideDelayMs
      } else if (timeToExpiry === null) {
        refreshIn = UNKNOWN_EXPIRY_REFRESH_INTERVAL_MS
      } else {
        // Refresh around 80% of lifetime, but no later than 30 seconds pre-expiry.
        refreshIn = Math.min(timeToExpiry * 0.8, timeToExpiry - 30000)
      }

      if (refreshIn > 0) {
        scheduleRefresh(refreshIn)
      } else if (timeToExpiry !== null) {
        // Token is already expired or about to expire, refresh immediately
        scheduleRefresh(0)
      }

      return () => {
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current)
        }
      }
    }
  }, [accessToken, refreshScheduleNonce, user, refreshToken])

  useEffect(() => {
    if (!user || !accessToken) {
      return
    }

    const attemptForegroundRefresh = async (reason: 'focus' | 'visible' | 'online') => {
      const ttl = getTokenTimeToExpiry(accessToken)
      const shouldRefresh =
        nextRefreshDelayOverrideRef.current !== null ||
        (ttl !== null && ttl <= 2 * 60 * 1000)

      if (!shouldRefresh) {
        return
      }

      const elapsed = Date.now() - lastRefreshAttemptAtRef.current
      if (elapsed < FOREGROUND_TOKEN_REFRESH_INTERVAL_MS) {
        return
      }

      lastRefreshAttemptAtRef.current = Date.now()
      const status = await refreshToken()
      if (status === 'retryable') {
        console.warn(`[Auth] Foreground refresh still retryable after ${reason}`)
      }
    }

    const handleFocus = () => {
      void attemptForegroundRefresh('focus')
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void attemptForegroundRefresh('visible')
      }
    }

    const handleOnline = () => {
      void attemptForegroundRefresh('online')
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [accessToken, refreshToken, user])

  return (
    <AuthContext.Provider
      value={{
        user,
        convexUserId,
        accessToken,
        organizationWorkspaces,
        personalWorkspace,
        currentPersonalWorkspace,
        currentOrganizationWorkspace,
        workspaceSelectionRequired,
        isAuthenticated: !!user,
        isLoading: isLoading, // Only block on initial hydration, not background sync
        authError,
        needsOnboarding,
        login,
        logout,
        refreshToken,
        checkOrganizationWorkspaceNameAvailability,
        createOrganizationWorkspace,
        setCurrentWorkspace: (workspace) => {
          setCurrentWorkspaceId(getWorkspaceSelectionId(workspace))
          if (workspace) {
            setWorkspaceSelectionRequired(false)
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
