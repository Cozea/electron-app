export type CollaborationRepositoryProvider = "github"
export type CollaborationRepositoryCredentialOperation = "read" | "write"

export interface CollaborationRepositoryCredentialRequest {
  projectId: string
  operation: CollaborationRepositoryCredentialOperation
  sessionId?: string
}

export interface CollaborationRepositoryDescriptor {
  provider: CollaborationRepositoryProvider
  repositoryId: string
  repositoryNumericId: string
  installationId: string
  owner: string
  name: string
  fullName: string
  cloneUrl: string
  defaultBranch: string
}

export interface CollaborationRepositoryCredentialResponse {
  repository: CollaborationRepositoryDescriptor
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

export function parseGitHubNumericId(value: string): number {
  const normalized = value.trim()
  if (!/^[0-9]+$/.test(normalized)) throw new Error("Invalid GitHub numeric ID")
  const numeric = Number(normalized)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("GitHub numeric ID must be a positive safe integer")
  }
  return numeric
}

export function buildCollaborationRepositoryId(repositoryNumericId: string): string {
  const numeric = parseGitHubNumericId(repositoryNumericId)
  return `github:${numeric}`
}

export function parseGitHubRepositoryUrl(value: string): {
  owner: string
  name: string
  fullName: string
  cloneUrl: string
} {
  const url = new URL(value.trim())
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Collaboration repository must be a GitHub HTTPS URL")
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("GitHub repository URL must identify owner/repository")
  }
  const owner = parts[0]
  const name = parts[1].replace(/\.git$/i, "")
  if (!name) throw new Error("GitHub repository name is required")
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
  }
}
