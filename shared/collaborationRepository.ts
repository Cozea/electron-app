export type CollaborationRepositoryProvider = "github"
export type CollaborationRepositoryAccessPolicy = "organization" | "restricted"
export type CollaborationRepositoryCredentialOperation = "read" | "write"

export interface CollaborationRepositoryBindingDescriptor {
  id: string
  projectId: string
  organizationId: string | null
  provider: CollaborationRepositoryProvider
  repositoryId: string
  repositoryNumericId: string
  installationId: string
  owner: string
  name: string
  fullName: string
  cloneUrl: string
  htmlUrl: string
  defaultBranch: string
  accessPolicy: CollaborationRepositoryAccessPolicy
  enabled: boolean
  createdByUserId: string
  createdAt: number
  updatedAt: number
}

export interface CollaborationRepositoryCredentialRequest {
  projectId: string
  operation: CollaborationRepositoryCredentialOperation
  sessionId?: string
}

export interface CollaborationRepositoryCredentialResponse {
  provider: CollaborationRepositoryProvider
  repositoryId: string
  repositoryNumericId: string
  fullName: string
  cloneUrl: string
  defaultBranch: string
  operation: CollaborationRepositoryCredentialOperation
  username: "x-access-token"
  token: string
  expiresAt: number
}

export interface CollaborationPushVerificationRequest {
  sessionId: string
  commitSha: string
}

export interface CollaborationPushVerificationResponse {
  verified: true
  sessionId: string
  sessionBranch: string
  commitSha: string
  coveredThroughSequence: number
  baseAdvanced: true
}

export function buildCollaborationRepositoryId(
  provider: CollaborationRepositoryProvider,
  repositoryNumericId: string,
): string {
  const numericId = repositoryNumericId.trim()
  parseGitHubNumericId(numericId)
  return `${provider}:${numericId}`
}

export function normalizeGitHubCloneUrl(owner: string, name: string): string {
  const normalizedOwner = owner.trim()
  const normalizedName = name.trim().replace(/\.git$/i, "")
  if (!normalizedOwner || !normalizedName) {
    throw new Error("GitHub repository owner and name are required")
  }
  return `https://github.com/${normalizedOwner}/${normalizedName}.git`
}

export function createGitHubExtraHeader(token: string): string {
  const normalized = token.trim()
  if (!normalized) throw new Error("GitHub access token is required")
  return `AUTHORIZATION: basic ${btoa(`x-access-token:${normalized}`)}`
}

export function parseGitHubNumericId(value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error("Invalid GitHub numeric ID")
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("GitHub numeric ID must be a positive safe integer")
  }
  return numeric
}
