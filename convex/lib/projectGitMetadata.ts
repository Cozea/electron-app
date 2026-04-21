export type ProjectSyncMode = "git"
export type GitAccessState = "unknown" | "pending" | "granted" | "missing" | "error"

export interface GitRepositoryMetadata {
  provider: string
  owner: string
  name: string
  url: string
  defaultBranch: string
}

export interface GitSyncStateMetadata {
  accessState: GitAccessState
  lastFetchedCommit?: string
  lastPushedCommit?: string
  lastFetchAt?: number
  lastPushAt?: number
  repoBytes?: number
  lastRepoSizeAt?: number
  errorMessage?: string
  migratedFromReplicaAt?: number
}

export interface ProjectTeamSeedMember {
  email: string
  name?: string
  role: "project_manager" | "developer" | "designer" | "viewer"
  isCurrentUser?: boolean
  profileImageUrl?: string | null
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50)
}

function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/+$/, "")
}

function stripDotGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value
}

function parseRepositoryPathFromUrl(repoUrl: string): { owner: string; name: string } | null {
  const normalized = normalizeRepoUrl(repoUrl)

  const sshMatch = normalized.match(/^(?:git@|ssh:\/\/git@)[^:/]+[:/](.+?)(?:\.git)?$/i)
  if (sshMatch) {
    const segments = stripDotGitSuffix(sshMatch[1]).split("/").filter(Boolean)
    if (segments.length < 2) {
      return null
    }
    return {
      owner: segments.slice(0, -1).join("/"),
      name: segments[segments.length - 1],
    }
  }

  try {
    const url = new URL(normalized)
    const segments = url.pathname.split("/").filter(Boolean)
    if (segments.length < 2) return null

    return {
      owner: segments.slice(0, -1).join("/"),
      name: stripDotGitSuffix(segments[segments.length - 1]),
    }
  } catch {
    return null
  }
}

export function buildGitRepositoryMetadata(args: {
  provider?: string
  repoUrl?: string
  defaultBranch?: string
}): GitRepositoryMetadata | undefined {
  const provider = args.provider?.trim()
  const repoUrl = args.repoUrl?.trim()

  if (!provider || !repoUrl || provider === "local") {
    return undefined
  }

  const parsed = parseRepositoryPathFromUrl(repoUrl)
  if (!parsed) {
    return undefined
  }

  return {
    provider,
    owner: parsed.owner,
    name: parsed.name,
    url: normalizeRepoUrl(repoUrl),
    defaultBranch: args.defaultBranch?.trim() || "main",
  }
}
