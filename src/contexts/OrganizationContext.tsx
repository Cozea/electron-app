import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { OrganizationMembership } from '../types/electron'

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'
const STORAGE_KEY_TOKEN = 'auth_token'

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

  // Keep local organization state in sync with AuthContext without creating
  // a self-triggering effect cycle on currentOrganization updates.
  useEffect(() => {
    setOrganizations(initialOrganizations)

    if (initialOrganizations.length === 0) {
      setCurrentOrganization(null)
      return
    }

    setCurrentOrganization((prev) => prev ?? initialOrganizations[0])
  }, [initialOrganizations])

  // Make authenticated requests and retry once after token refresh on 401.
  const fetchWithRefresh = useCallback(async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const performRequest = (token: string | null) => {
      const headers = new Headers(options.headers)
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      return fetch(url, {
        ...options,
        headers,
      })
    }

    const response = await performRequest(accessToken)

    // If 401 and we have a refresh callback, try refreshing and retry once
    if (response.status === 401 && onTokenExpired) {
      console.log('Token expired, attempting refresh...')
      const refreshed = await onTokenExpired()
      if (refreshed) {
        const refreshedToken = localStorage.getItem(STORAGE_KEY_TOKEN)
        return performRequest(refreshedToken)
      }
    }

    return response
  }, [accessToken, onTokenExpired])

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
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
  }, [accessToken, fetchWithRefresh])

  const updateOrganization = useCallback(async (orgId: string, name: string) => {
    if (!accessToken) return null
    setIsLoading(true)

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
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
  }, [accessToken, fetchWithRefresh, currentOrganization])

  const deleteOrganization = useCallback(async (orgId: string) => {
    if (!accessToken) return false
    setIsLoading(true)

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}`, {
        method: 'DELETE',
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
  }, [accessToken, fetchWithRefresh, currentOrganization, organizations])

  const getMembers = useCallback(async (orgId: string): Promise<Member[]> => {
    if (!accessToken) return []

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}/members`)

      if (!response.ok) {
        throw new Error('Failed to get members')
      }

      const data = await response.json()
      return data.members
    } catch (err) {
      console.error('Failed to get members:', err)
      return []
    }
  }, [accessToken, fetchWithRefresh])

  const inviteMember = useCallback(async (orgId: string, email: string, roleSlug?: string): Promise<{ invitationId: string; error?: string } | null> => {
    if (!accessToken) return null
    setIsLoading(true)

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
  }, [accessToken, fetchWithRefresh])

  const removeMember = useCallback(async (orgId: string, membershipId: string) => {
    if (!accessToken) return false
    setIsLoading(true)

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}/members/${membershipId}`, {
        method: 'DELETE',
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
  }, [accessToken, fetchWithRefresh])

  const updateMemberRole = useCallback(async (orgId: string, membershipId: string, roleSlug: string) => {
    if (!accessToken) return false
    setIsLoading(true)

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}/members/${membershipId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
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
  }, [accessToken, fetchWithRefresh])

  const getPendingInvitations = useCallback(async (orgId: string): Promise<Invitation[]> => {
    if (!accessToken) return []

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/organizations/${orgId}/invitations`)

      if (!response.ok) {
        throw new Error('Failed to get invitations')
      }

      const data = await response.json()
      return data.invitations || []
    } catch (err) {
      console.error('Failed to get invitations:', err)
      return []
    }
  }, [accessToken, fetchWithRefresh])

  const revokeInvitation = useCallback(async (invitationId: string) => {
    if (!accessToken) return false

    try {
      const response = await fetchWithRefresh(`${AUTH_SERVER_URL}/invitations/${invitationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to revoke invitation')
      }

      return true
    } catch (err) {
      console.error('Failed to revoke invitation:', err)
      return false
    }
  }, [accessToken, fetchWithRefresh])

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
