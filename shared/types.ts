import type {
  WorkspaceIconColorValue,
  WorkspaceIconKey,
} from './workspaceIdentity'

/**
 * Shared types used across the Cozea application
 * This file is the single source of truth for common interfaces
 */

// User from WorkOS
export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profileImageUrl: string | null
}

export type WorkspaceType = 'personal' | 'organization'

interface BaseWorkspaceMembership {
  id: string // WorkOS membership ID
  organizationId: string // WorkOS organization ID
  organizationName: string
  role: string // admin | member | viewer
  status: 'active' | 'inactive' | 'pending'
  convexOrgId?: string // Convex document ID (populated after sync)
  iconKey?: WorkspaceIconKey | null
  iconColor?: WorkspaceIconColorValue | null
  logoUrl?: string | null
}

export interface PersonalWorkspaceMembership extends BaseWorkspaceMembership {
  workspaceType: 'personal'
  role: 'admin'
  status: 'active'
}

export interface OrganizationWorkspaceMembership extends BaseWorkspaceMembership {
  workspaceType: 'organization'
}

export type WorkspaceMembership =
  | PersonalWorkspaceMembership
  | OrganizationWorkspaceMembership

// Backward-compatible alias while consumers are migrated.
export type OrganizationMembership = WorkspaceMembership

export function isOrganizationWorkspaceMembership(
  membership: WorkspaceMembership | null | undefined
): membership is OrganizationWorkspaceMembership {
  return membership?.workspaceType === 'organization'
}

export function isPersonalWorkspaceMembership(
  membership: WorkspaceMembership | null | undefined
): membership is PersonalWorkspaceMembership {
  return membership?.workspaceType === 'personal'
}

export function getWorkspaceSelectionId(
  membership: WorkspaceMembership | null | undefined
): string | null {
  return membership?.organizationId ?? membership?.id ?? null
}

export function combineWorkspaceMemberships(
  personalWorkspace: PersonalWorkspaceMembership | null | undefined,
  organizationWorkspaces: OrganizationWorkspaceMembership[]
): WorkspaceMembership[] {
  return personalWorkspace
    ? [personalWorkspace, ...organizationWorkspaces]
    : organizationWorkspaces
}

export function findWorkspaceBySelectionId(
  workspaces: WorkspaceMembership[],
  selectionId: string | null | undefined
): WorkspaceMembership | null {
  if (!selectionId) return null
  return workspaces.find((workspace) => workspaceMatchesSelectionId(workspace, selectionId)) ?? null
}

export function workspaceMatchesSelectionId(
  membership: WorkspaceMembership | null | undefined,
  selectionId: string | null | undefined
): boolean {
  if (!membership || !selectionId) return false
  return membership.organizationId === selectionId || membership.id === selectionId
}

// Session data stored after authentication
export interface Session {
  accessToken: string
  refreshToken: string
  user: User
  organizations: OrganizationWorkspaceMembership[]
}

// Role types for permission system
export type Role = 'admin' | 'member' | 'viewer'

// Organization from Convex/WorkOS
export interface Organization {
  id: string
  workosId: string
  name: string
  slug: string
  iconKey?: WorkspaceIconKey | null
  iconColor?: WorkspaceIconColorValue | null
  logoUrl?: string | null
}

// Member in an organization
export interface Member {
  id: string
  userId: string
  organizationId: string
  role: Role
  user: User
  joinedAt: number
}

// API response types
export interface ApiError {
  error: string
  code?: string
}

export interface ApiSuccess<T> {
  data: T
}

// Auth API types
export interface LoginResponse {
  success: boolean
}

export interface LogoutResponse {
  success: boolean
}

// Invitation types
export interface Invitation {
  id: string
  email: string
  role: Role
  status: 'pending' | 'accepted' | 'expired'
  expiresAt: number
  createdAt: number
}
