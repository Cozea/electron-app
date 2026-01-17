import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { OrganizationMembership } from '../types/electron'

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'

interface Organization {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

interface Member {
  membershipId: string
  userId: string
  email: string | null
  firstName: string | null
  lastName: string | null
  profileImageUrl: string | null
  role: string
  status: string
  createdAt: string
}

interface Invitation {
  id: string
  email: string
  state: string
  expiresAt: string
  createdAt: string
}

interface OrganizationContextType {
  // Current organization
  currentOrganization: OrganizationMembership | null
  organizations: OrganizationMembership[]
  setOrganizations: (orgs: OrganizationMembership[]) => void
  switchOrganization: (orgId: string) => void

  // Organization CRUD
  createOrganization: (name: string) => Promise<{ organization: Organization; membership: OrganizationMembership } | null>
  updateOrganization: (orgId: string, name: string) => Promise<Organization | null>
  deleteOrganization: (orgId: string) => Promise<boolean>

  // Members
  getMembers: (orgId: string) => Promise<Member[]>
  inviteMember: (orgId: string, email: string, roleSlug?: string) => Promise<{ invitationId: string; error?: string } | null>
  removeMember: (orgId: string, membershipId: string) => Promise<boolean>
  updateMemberRole: (orgId: string, membershipId: string, roleSlug: string) => Promise<boolean>

  // Invitations
  getPendingInvitations: (orgId: string) => Promise<Invitation[]>
  revokeInvitation: (invitationId: string) => Promise<boolean>

  // State
  isLoading: boolean
}

const OrganizationContext = createContext<OrganizationContextType | null>(null)

interface OrganizationProviderProps {
  children: ReactNode
  accessToken: string | null
  initialOrganizations?: OrganizationMembership[]
  onTokenExpired?: () => Promise<boolean>
}

export function OrganizationProvider({ children, accessToken, initialOrganizations = [], onTokenExpired }: OrganizationProviderProps) {
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>(initialOrganizations)
  const [currentOrganization, setCurrentOrganization] = useState<OrganizationMembership | null>(
    initialOrganizations[0] || null
  )
  const [isLoading, setIsLoading] = useState(false)

  // Update organizations when initialOrganizations changes
  useEffect(() => {
    setOrganizations(initialOrganizations)
    if (initialOrganizations.length > 0 && !currentOrganization) {
      setCurrentOrganization(initialOrganizations[0])
    }
  }, [initialOrganizations, currentOrganization])

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
  }, [accessToken])

  // Helper to make authenticated requests with automatic token refresh on 401
  // TODO: Integrate this into the fetch calls below for automatic token refresh
  const _fetchWithRefresh = useCallback(async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...getAuthHeaders(),
      },
    })

    // If 401 and we have a refresh callback, try refreshing and retry once
    if (response.status === 401 && onTokenExpired) {
      console.log('Token expired, attempting refresh...')
      const refreshed = await onTokenExpired()
      if (refreshed) {
        // Retry with new token (need to get fresh headers after refresh)
        // The accessToken prop will be updated by parent, but we need to wait
        // For now, just return the failed response - the auto-refresh will fix it
        console.log('Token refreshed, please retry the operation')
      }
    }

    return response
  }, [getAuthHeaders, onTokenExpired])
  void _fetchWithRefresh; // Available for future integration

  const switchOrganization = useCallback((orgId: string) => {
    const org = organizations.find((o) => o.organizationId === orgId)
    if (org) {
      setCurrentOrganization(org)
    }
  }, [organizations])

  const createOrganization = useCallback(async (name: string) => {
    if (!accessToken) return null
    setIsLoading(true)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        throw new Error('Failed to create organization')
      }

      const data = await response.json()
      const newMembership: OrganizationMembership = {
        id: data.membership.id,
        organizationId: data.organization.id,
        organizationName: data.organization.name,
        role: data.membership.role,
        status: data.membership.status,
      }

      setOrganizations((prev) => [...prev, newMembership])
      setCurrentOrganization(newMembership)

      return { organization: data.organization, membership: newMembership }
    } catch (err) {
      console.error('Failed to create organization:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, getAuthHeaders])

  const updateOrganization = useCallback(async (orgId: string, name: string) => {
    if (!accessToken) return null
    setIsLoading(true)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        throw new Error('Failed to update organization')
      }

      const data = await response.json()

      // Update local state
      setOrganizations((prev) =>
        prev.map((org) =>
          org.organizationId === orgId ? { ...org, organizationName: name } : org
        )
      )

      if (currentOrganization?.organizationId === orgId) {
        setCurrentOrganization((prev) => prev ? { ...prev, organizationName: name } : null)
      }

      return data.organization
    } catch (err) {
      console.error('Failed to update organization:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, getAuthHeaders, currentOrganization])

  const deleteOrganization = useCallback(async (orgId: string) => {
    if (!accessToken) return false
    setIsLoading(true)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Failed to delete organization')
      }

      // Update local state
      setOrganizations((prev) => prev.filter((org) => org.organizationId !== orgId))

      if (currentOrganization?.organizationId === orgId) {
        setCurrentOrganization(organizations.find((o) => o.organizationId !== orgId) || null)
      }

      return true
    } catch (err) {
      console.error('Failed to delete organization:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, getAuthHeaders, currentOrganization, organizations])

  const getMembers = useCallback(async (orgId: string): Promise<Member[]> => {
    if (!accessToken) return []

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}/members`, {
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Failed to get members')
      }

      const data = await response.json()
      return data.members
    } catch (err) {
      console.error('Failed to get members:', err)
      return []
    }
  }, [accessToken, getAuthHeaders])

  const inviteMember = useCallback(async (orgId: string, email: string, roleSlug?: string): Promise<{ invitationId: string; error?: string } | null> => {
    if (!accessToken) return null
    setIsLoading(true)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ email, roleSlug }),
      })

      if (!response.ok) {
        // Try to parse error message from response
        try {
          const errorData = await response.json()
          const errorMessage = errorData.error || errorData.message || 'Failed to invite member'
          return { invitationId: '', error: errorMessage }
        } catch {
          return { invitationId: '', error: 'Failed to invite member' }
        }
      }

      const data = await response.json()
      // Handle different response formats from auth gateway
      const invitationId = data.invitation?.id || data.invitationId || data.id || ''
      if (!invitationId) {
        console.warn('Invitation created but no ID returned:', data)
      }
      return { invitationId }
    } catch (err) {
      console.error('Failed to invite member:', err)
      return { invitationId: '', error: err instanceof Error ? err.message : 'Failed to invite member' }
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, getAuthHeaders])

  const removeMember = useCallback(async (orgId: string, membershipId: string) => {
    if (!accessToken) return false
    setIsLoading(true)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}/members/${membershipId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Failed to remove member')
      }

      return true
    } catch (err) {
      console.error('Failed to remove member:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, getAuthHeaders])

  const updateMemberRole = useCallback(async (orgId: string, membershipId: string, roleSlug: string) => {
    if (!accessToken) return false
    setIsLoading(true)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}/members/${membershipId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ roleSlug }),
      })

      if (!response.ok) {
        throw new Error('Failed to update member role')
      }

      return true
    } catch (err) {
      console.error('Failed to update member role:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, getAuthHeaders])

  const getPendingInvitations = useCallback(async (orgId: string): Promise<Invitation[]> => {
    if (!accessToken) return []

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations/${orgId}/invitations`, {
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Failed to get invitations')
      }

      const data = await response.json()
      return data.invitations || []
    } catch (err) {
      console.error('Failed to get invitations:', err)
      return []
    }
  }, [accessToken, getAuthHeaders])

  const revokeInvitation = useCallback(async (invitationId: string) => {
    if (!accessToken) return false

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/invitations/${invitationId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Failed to revoke invitation')
      }

      return true
    } catch (err) {
      console.error('Failed to revoke invitation:', err)
      return false
    }
  }, [accessToken, getAuthHeaders])

  return (
    <OrganizationContext.Provider
      value={{
        currentOrganization,
        organizations,
        setOrganizations,
        switchOrganization,
        createOrganization,
        updateOrganization,
        deleteOrganization,
        getMembers,
        inviteMember,
        removeMember,
        updateMemberRole,
        getPendingInvitations,
        revokeInvitation,
        isLoading,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  )
}

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider')
  }
  return context
}
