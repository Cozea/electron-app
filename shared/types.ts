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

// Organization membership from WorkOS
export interface OrganizationMembership {
  id: string // WorkOS membership ID
  organizationId: string // WorkOS organization ID
  organizationName: string
  role: string // admin | member | viewer
  status: 'active' | 'inactive' | 'pending'
  convexOrgId?: string // Convex document ID (populated after sync)
}

// Session data stored after authentication
export interface Session {
  accessToken: string
  refreshToken: string
  user: User
  organizations: OrganizationMembership[]
}

// Role types for permission system
export type Role = 'admin' | 'member' | 'viewer'

// Organization from Convex/WorkOS
export interface Organization {
  id: string
  workosId: string
  name: string
  slug: string
  logoUrl?: string
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
