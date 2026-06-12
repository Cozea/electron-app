import fs from "node:fs/promises"
import path from "node:path"
import type { RepoIdentity } from "../../shared/workspaceTypes.ts"

// Re-export so callers inside electron/workspaces/ can use this module
// instead of reaching back to projectPathResolution.ts.
export function extractProjectIdFromRemoteUrl(
  remoteUrl: string | null | undefined,
): string | null {
  if (typeof remoteUrl !== "string" || remoteUrl.trim().length === 0) return null
  const match = remoteUrl.match(/(?:^|[/:])git\/([^/?#]+)\.git(?:$|[?#])/i)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

async function readGitDirPath(projectPath: string): Promise<string | null> {
  const gitEntryPath = path.join(projectPath, ".git")

  let stats: Awaited<ReturnType<typeof fs.stat>>
  try {
    stats = await fs.stat(gitEntryPath)
  } catch {
    return null
  }

  if (stats.isDirectory()) return gitEntryPath
  if (!stats.isFile()) return null

  try {
    const raw = await fs.readFile(gitEntryPath, "utf-8")
    const match = raw.match(/gitdir:\s*(.+)\s*$/im)
    if (!match?.[1]) return null
    return path.resolve(projectPath, match[1].trim())
  } catch {
    return null
  }
}

async function readOriginRemoteUrl(projectPath: string): Promise<string | null> {
  const gitDirPath = await readGitDirPath(projectPath)
  if (!gitDirPath) return null

  const configPath = path.join(gitDirPath, "config")

  let raw: string
  try {
    raw = await fs.readFile(configPath, "utf-8")
  } catch {
    return null
  }

  const lines = raw.split(/\r?\n/)
  let inOriginSection = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inOriginSection = /^\[remote\s+"origin"\]$/i.test(trimmed)
      continue
    }
    if (!inOriginSection) continue

    const match = trimmed.match(/^url\s*=\s*(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

/**
 * Canonical form for URLs we cannot attribute to a known provider: protocol,
 * credentials, the scp-style ":" separator, trailing ".git" and slashes all
 * stripped, lowercased. ssh and https spellings of the same repo compare equal.
 */
function normalizeUnknownGitUrl(rawUrl: string): string {
  let value = rawUrl.trim().toLowerCase()
  value = value.replace(/^(?:git\+)?(?:https?|ssh|git|file):\/\//, "")
  value = value.replace(/^[^/@]+@/, "")
  // scp-style host:path — keep ports (host:22/path) intact.
  value = value.replace(/^([^/:]+):(?!\d)/, "$1/")
  value = value.replace(/\/+$/, "")
  value = value.replace(/\.git$/, "")
  return value
}

// Repo name segment: anything but "/", with an optional trailing ".git" that
// is not part of the name. "[^/]+?" (not "[^/.]+?") so dotted names match
// (next.js, socket.io).
const GITHUB_REMOTE_PATTERN =
  /(?:^|[/@])github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?(?:$|[?#])/i
// GitLab allows nested subgroups: match one-or-more "segment/" before the name.
const GITLAB_REMOTE_PATTERN =
  /(?:^|[/@])gitlab\.com[/:]((?:[^/]+\/)+[^/]+?)(?:\.git)?\/?(?:$|[?#])/i

export function parseRepoIdentity(remoteUrl: string): RepoIdentity {
  const cozeaProjectId = extractProjectIdFromRemoteUrl(remoteUrl)
  if (cozeaProjectId) {
    return { provider: "cozea", projectId: cozeaProjectId, url: remoteUrl }
  }

  const githubMatch = remoteUrl.match(GITHUB_REMOTE_PATTERN)
  if (githubMatch?.[1]) {
    return { provider: "github", fullName: githubMatch[1], url: remoteUrl }
  }

  const gitlabMatch = remoteUrl.match(GITLAB_REMOTE_PATTERN)
  if (gitlabMatch?.[1]) {
    return { provider: "gitlab", fullName: gitlabMatch[1], url: remoteUrl }
  }

  return { provider: "unknown", url: remoteUrl }
}

export function normalizeRepoIdentity(identity: RepoIdentity): string {
  switch (identity.provider) {
    case "github":
    case "gitlab":
      return `${identity.provider}:${identity.fullName.toLowerCase()}`
    case "cozea":
      return `cozea:${identity.projectId}`
    case "unknown":
      return `unknown:${normalizeUnknownGitUrl(identity.url)}`
  }
}

export function repoIdentitiesMatch(a: RepoIdentity, b: RepoIdentity): boolean {
  return normalizeRepoIdentity(a) === normalizeRepoIdentity(b)
}

export async function readGitRepoIdentity(
  projectPath: string,
): Promise<RepoIdentity | null> {
  const remoteUrl = await readOriginRemoteUrl(projectPath)
  if (!remoteUrl) return null
  return parseRepoIdentity(remoteUrl)
}
