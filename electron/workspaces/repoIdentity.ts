import fs from "node:fs"
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

function readGitDirPath(projectPath: string): string | null {
  const gitEntryPath = path.join(projectPath, ".git")
  if (!fs.existsSync(gitEntryPath)) return null

  const stats = fs.statSync(gitEntryPath)
  if (stats.isDirectory()) return gitEntryPath
  if (!stats.isFile()) return null

  try {
    const raw = fs.readFileSync(gitEntryPath, "utf-8")
    const match = raw.match(/gitdir:\s*(.+)\s*$/im)
    if (!match?.[1]) return null
    return path.resolve(projectPath, match[1].trim())
  } catch {
    return null
  }
}

function readOriginRemoteUrl(projectPath: string): string | null {
  const gitDirPath = readGitDirPath(projectPath)
  if (!gitDirPath) return null

  const configPath = path.join(gitDirPath, "config")
  if (!fs.existsSync(configPath)) return null

  try {
    const raw = fs.readFileSync(configPath, "utf-8")
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
  } catch {
    return null
  }
  return null
}

export function parseRepoIdentity(remoteUrl: string): RepoIdentity {
  const cozeaProjectId = extractProjectIdFromRemoteUrl(remoteUrl)
  if (cozeaProjectId) {
    return { provider: "cozea", projectId: cozeaProjectId, url: remoteUrl }
  }

  const githubMatch = remoteUrl.match(
    /(?:^|[/@])github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?(?:$|[/?#])/i,
  )
  if (githubMatch?.[1]) {
    return { provider: "github", fullName: githubMatch[1], url: remoteUrl }
  }

  const gitlabMatch = remoteUrl.match(
    /(?:^|[/@])gitlab\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?(?:$|[/?#])/i,
  )
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
      return `unknown:${identity.url}`
  }
}

export function repoIdentitiesMatch(a: RepoIdentity, b: RepoIdentity): boolean {
  return normalizeRepoIdentity(a) === normalizeRepoIdentity(b)
}

export async function readGitRepoIdentity(
  projectPath: string,
): Promise<RepoIdentity | null> {
  const remoteUrl = readOriginRemoteUrl(projectPath)
  if (!remoteUrl) return null
  return parseRepoIdentity(remoteUrl)
}
