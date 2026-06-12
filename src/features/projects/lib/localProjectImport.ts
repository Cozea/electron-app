export interface LocalGitState {
  isLoading: boolean
  isRepo: boolean
  hasOriginRemote: boolean
  branch: string
  remoteUrl: string | null
  error: string | null
}

export function deriveNameFromPath(workspaceId: string): string {
  const normalized = workspaceId.replace(/[\\/]+$/, "")
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? ""
}

export function deriveProviderFromRepoUrl(
  repoUrl: string,
): "github" | "gitlab" | "bitbucket" | "other" {
  const trimmed = repoUrl.trim()
  // "other" rather than assuming github: self-hosted remotes used to be
  // recorded with a provider they do not have.
  if (!trimmed) return "other"
  if (/github/i.test(trimmed)) return "github"
  if (/bitbucket/i.test(trimmed)) return "bitbucket"
  if (/gitlab/i.test(trimmed)) return "gitlab"
  return "other"
}

export function buildFilesystemSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)

  return slug || "project"
}

function parseGitRemoteUrl(configText: string): string | null {
  let inOriginSection = false

  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^\[remote\s+"origin"\]$/i.test(line)) {
      inOriginSection = true
      continue
    }

    if (/^\[.+\]$/.test(line)) {
      inOriginSection = false
      continue
    }

    if (!inOriginSection) continue

    const match = line.match(/^url\s*=\s*(.+)$/i)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return null
}

function joinFsPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes("\\") ? "\\" : "/"
  return [basePath.replace(/[\\/]+$/, ""), ...segments.map((segment) => segment.replace(/^[/\\]+|[/\\]+$/g, ""))]
    .filter(Boolean)
    .join(separator)
}

function resolveRelativeFsPath(basePath: string, targetPath: string): string {
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(targetPath)) {
    return targetPath
  }

  const hasDrivePrefix = /^[A-Za-z]:/.test(basePath)
  const rootPrefix = hasDrivePrefix ? `${basePath.slice(0, 2)}/` : basePath.startsWith("/") ? "/" : ""
  const baseSegments = basePath
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter(Boolean)
  const targetSegments = targetPath.replace(/\\/g, "/").split("/").filter(Boolean)

  for (const segment of targetSegments) {
    if (segment === ".") continue
    if (segment === "..") {
      baseSegments.pop()
      continue
    }
    baseSegments.push(segment)
  }

  return `${rootPrefix}${baseSegments.join("/")}`
}

function parseGitHeadBranch(headText: string): string | null {
  const match = headText.match(/ref:\s*refs\/heads\/(.+?)\s*$/i)
  return match?.[1]?.trim() || null
}

/** Resolve the real .git directory for a folder, following a `gitdir:` link
 * file (worktrees / submodules). Returns null when the folder isn't a repo. */
async function resolveGitDir(folderPath: string): Promise<string | null> {
  const directHead = await window.electronAPI.fs.readFile(joinFsPath(folderPath, ".git", "HEAD"))
  if (directHead !== null) {
    return joinFsPath(folderPath, ".git")
  }

  const gitEntry = await window.electronAPI.fs.readFile(joinFsPath(folderPath, ".git"))
  const gitDirMatch = gitEntry?.match(/gitdir:\s*(.+)\s*$/i)
  if (!gitDirMatch?.[1]) {
    return null
  }
  return resolveRelativeFsPath(folderPath, gitDirMatch[1].trim())
}

/**
 * Inspect a local folder's git state by reading `.git` directly (HEAD +
 * config). Path-pure on purpose: this runs during import BEFORE the folder is
 * bound into the workspace catalog, so the catalog-backed `project:*` git IPC
 * (which resolves a workspaceId) would always fail here and silently report
 * "not a repo". Takes a filesystem path, not a workspaceId.
 */
export async function inspectLocalGitState(folderPath: string): Promise<LocalGitState> {
  try {
    const gitDir = await resolveGitDir(folderPath)
    if (!gitDir) {
      return {
        isLoading: false,
        isRepo: false,
        hasOriginRemote: false,
        branch: "main",
        remoteUrl: null,
        error: null,
      }
    }

    const headText = await window.electronAPI.fs.readFile(joinFsPath(gitDir, "HEAD"))
    const branch = (headText ? parseGitHeadBranch(headText) : null) || "main"
    const configText = await window.electronAPI.fs.readFile(joinFsPath(gitDir, "config"))
    const remoteUrl = configText ? parseGitRemoteUrl(configText) : null

    return {
      isLoading: false,
      isRepo: true,
      hasOriginRemote: Boolean(remoteUrl),
      branch,
      remoteUrl,
      error: null,
    }
  } catch (error) {
    return {
      isLoading: false,
      isRepo: false,
      hasOriginRemote: false,
      branch: "main",
      remoteUrl: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to inspect local git state.",
    }
  }
}

export async function browseForDirectory(title: string): Promise<string | null> {
  const result = await window.electronAPI.dialog.selectDirectory({ title })
  if (!result.success || !result.path) {
    return null
  }
  return result.path
}

interface WorkspaceBindFailureLike {
  error?: string
  conflicts?: Array<{
    reason: string
    existingProjectId?: string | null
    candidatePath?: string
  }>
}

/**
 * Bind failures carry structured conflicts with no `error` string; surfacing
 * them raw left actions failing with "undefined". One formatter for every
 * bind call site (import, relink, repair).
 */
export function formatWorkspaceBindFailure(
  result: WorkspaceBindFailureLike | null | undefined,
  fallback = "Failed to bind the local folder.",
): string {
  if (result?.error) {
    return result.error
  }

  const conflict = result?.conflicts?.[0]
  if (!conflict) {
    return fallback
  }

  switch (conflict.reason) {
    case "duplicate_path":
      return conflict.existingProjectId
        ? "This folder is already linked to another project. Open that project instead, or choose a different folder."
        : "This folder is already linked to another workspace."
    case "marker_mismatch":
      return "This folder belongs to a different Cozea project (its workspace marker points elsewhere). Choose a different folder, or remove the .cozea marker if this is intentional."
    case "copied_workspace":
      return "This looks like a copy of an already-linked folder (the original still exists). Open the original project, or remove the .cozea marker from this copy to link it as a separate project."
    default:
      return fallback
  }
}
