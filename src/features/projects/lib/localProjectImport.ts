export interface LocalGitState {
  isLoading: boolean
  isRepo: boolean
  hasOriginRemote: boolean
  branch: string
  remoteUrl: string | null
  error: string | null
}

export function deriveNameFromPath(projectPath: string): string {
  const normalized = projectPath.replace(/[\\/]+$/, "")
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? ""
}

export function deriveProviderFromRepoUrl(
  repoUrl: string,
): "github" | "gitlab" | "bitbucket" {
  const trimmed = repoUrl.trim()
  if (!trimmed) return "github"
  if (/bitbucket/i.test(trimmed)) return "bitbucket"
  if (/gitlab/i.test(trimmed)) return "gitlab"
  return "github"
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

export async function detectOriginRemoteUrl(projectPath: string): Promise<string | null> {
  const directConfig = await window.electronAPI.fs.readFile(joinFsPath(projectPath, ".git", "config"))
  if (directConfig) {
    return parseGitRemoteUrl(directConfig)
  }

  const gitEntry = await window.electronAPI.fs.readFile(joinFsPath(projectPath, ".git"))
  const gitDirMatch = gitEntry?.match(/gitdir:\s*(.+)\s*$/i)
  if (!gitDirMatch?.[1]) {
    return null
  }

  const resolvedGitDir = resolveRelativeFsPath(projectPath, gitDirMatch[1].trim())
  const linkedConfig = await window.electronAPI.fs.readFile(joinFsPath(resolvedGitDir, "config"))
  return linkedConfig ? parseGitRemoteUrl(linkedConfig) : null
}

export async function detectCurrentBranch(
  projectPath: string,
  fallbackBranch: string,
): Promise<string> {
  try {
    const result = await window.electronAPI.project.listGitBranches({ projectPath })
    const currentBranch = result.branches.find(
      (branch) => branch.current && !branch.isRemote,
    )?.name?.trim()
    if (currentBranch) {
      return currentBranch
    }

    const defaultBranch = result.branches.find(
      (branch) => branch.isDefault && !branch.isRemote,
    )?.name?.trim()
    return defaultBranch || fallbackBranch
  } catch {
    return fallbackBranch
  }
}

export async function inspectLocalGitState(projectPath: string): Promise<LocalGitState> {
  try {
    const branches = await window.electronAPI.project.listGitBranches({ projectPath })
    const branch =
      branches.branches.find((item) => item.current && !item.isRemote)?.name?.trim() ??
      branches.branches.find((item) => item.isDefault && !item.isRemote)?.name?.trim() ??
      "main"
    const remoteUrl = branches.hasOriginRemote
      ? await detectOriginRemoteUrl(projectPath)
      : null

    return {
      isLoading: false,
      isRepo: branches.isRepo,
      hasOriginRemote: branches.hasOriginRemote,
      branch,
      remoteUrl,
      error: branches.error ?? null,
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
