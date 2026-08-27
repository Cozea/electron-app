/**
 * Integration System Types
 *
 * Types for the integration registry, credentials, and tools.
 */

import type { VersionControlIntegrationMetadata } from '@shared/versionControl'

// ============================================
// Integration Provider Types
// ============================================

export type IntegrationProvider =
  // Version Control
  | 'github'
  | 'gitlab'
  // Backend/Database
  | 'supabase'
  | 'firebase'
  | 'planetscale'
  | 'neon'
  // Deployment
  | 'vercel'
  | 'netlify'
  | 'railway'
  | 'fly'
  // Auth
  | 'clerk'
  | 'auth0'
  // Payments
  | 'stripe'
  // Email
  | 'resend'
  | 'sendgrid'
  // Storage
  | 'aws'
  | 'cloudflare'
  // Collaboration
  | 'linear'
  | 'slack'
  // Work OS
  | 'notion'
  | 'airtable'
  | 'monday'
  | 'asana'
  | 'clickup'
  | 'coda'

export type IntegrationCategory =
  | 'version_control'
  | 'backend'
  | 'deployment'
  | 'auth'
  | 'payments'
  | 'email'
  | 'storage'
  | 'collaboration'
  | 'work_os'

export type IntegrationAuthType = 'oauth' | 'api_key' | 'service_account'

export type IntegrationStatus = 'active' | 'expired' | 'revoked' | 'needs_reauth'

// ============================================
// Integration Definition (Registry)
// ============================================

export interface IntegrationCredentialField {
  name: string
  label: string
  placeholder?: string
  helpText?: string
  helpUrl?: string
  secret: boolean // Whether to mask input
  required: boolean
  validation?: {
    pattern?: string
    minLength?: number
    maxLength?: number
  }
}

export interface IntegrationOAuthConfig {
  authUrl: string
  tokenUrl: string
  scopes: string[]
  pkce: boolean
  clientIdEnvVar?: string // Environment variable name for client ID
}

export interface IntegrationApiKeyConfig {
  fields: IntegrationCredentialField[]
}

export interface IntegrationServiceAccountConfig {
  fields: IntegrationCredentialField[]
  fileUpload?: {
    accept: string // e.g., '.json'
    label: string
  }
}

export interface IntegrationToolDefinition {
  name: string
  displayName: string
  description: string
  cliCommand: string
  cliPackage?: string // npm package if CLI needs to be installed
  inputSchema: Record<string, unknown> // JSON Schema
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  requiresApproval: boolean
}

export interface IntegrationDefinition {
  id: IntegrationProvider
  name: string
  description: string
  category: IntegrationCategory
  icon: string // Lucide icon name or 'custom:{name}' for custom SVGs

  // Website & documentation
  website: string
  docsUrl: string
  setupGuideUrl?: string

  // Auth configuration
  authType: IntegrationAuthType
  oauthConfig?: IntegrationOAuthConfig
  apiKeyConfig?: IntegrationApiKeyConfig
  serviceAccountConfig?: IntegrationServiceAccountConfig

  // Environment variable mapping (credential field -> env var name)
  envVarMapping: Record<string, string>

  // CLI tools this integration provides to agents
  tools: IntegrationToolDefinition[]

  // Feature flags
  isComingSoon?: boolean
  isBeta?: boolean
}

// ============================================
// Connected Integration (Stored Data)
// ============================================

export interface ConnectedIntegration {
  _id: string
  organizationId: string
  provider: IntegrationProvider
  authType: IntegrationAuthType
  encryptedCredentials: string // Encrypted JSON blob
  oauthScopes?: string[]
  tokenExpiresAt?: number
  externalId?: string
  externalAccountName?: string
  metadata?: Record<string, unknown> | VersionControlIntegrationMetadata
  enabledTools?: string[]
  status: IntegrationStatus
  lastVerifiedAt?: number
  connectedBy: string
  connectedAt: number
  updatedAt: number
}

export interface IntegrationOAuthStartOptions {
  metadata?: Record<string, unknown>
}

// ============================================
// Integration Key (Encryption Key Metadata)
// ============================================

export interface IntegrationKeyMetadata {
  _id: string
  organizationId: string
  keyId: string
  keyVersion: number
  algorithm: 'aes-256-gcm'
  createdAt: number
  rotatedAt?: number
}

// ============================================
// Decrypted Credentials (Runtime Only)
// ============================================

// Generic credentials interface (fields vary by provider)
export type IntegrationCredentials = Record<string, string | undefined>

// Provider-specific credential types for type safety
export interface GitHubCredentials {
  accessToken: string
  refreshToken?: string
}

export interface SupabaseCredentials {
  url: string
  anonKey: string
  serviceRoleKey?: string
}

export interface FirebaseCredentials {
  projectId: string
  privateKey: string
  clientEmail: string
}

export interface VercelCredentials {
  accessToken: string
  refreshToken?: string
  teamId?: string
}

export interface StripeCredentials {
  secretKey: string
  publishableKey?: string
  webhookSecret?: string
}

export interface ResendCredentials {
  apiKey: string
}

export interface RailwayCredentials {
  apiToken: string
}

export interface ClerkCredentials {
  secretKey: string
  publishableKey?: string
}

export interface AWSCredentials {
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export interface CloudflareCredentials {
  apiToken: string
  accountId?: string
}

// ============================================
// UI State Types
// ============================================

export interface IntegrationConnectState {
  isConnecting: boolean
  error?: string
  step: 'idle' | 'authenticating' | 'verifying' | 'saving' | 'complete'
}

export interface IntegrationListFilters {
  category?: IntegrationCategory
  status?: IntegrationStatus
  search?: string
}
