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

export function resolveImportedProjectName(requestedName: string, folderPath: string): string {
  return requestedName.trim() || deriveNameFromPath(folderPath).trim() || "Project"
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

/**
 * Inspect a picker-selected folder in Electron. Keeping the pre-bind read in
 * one workspace-specific IPC avoids granting the renderer durable, general
 * filesystem access to every folder it has opened in the past.
 */
export async function inspectLocalGitState(folderPath: string): Promise<LocalGitState> {
  try {
    const result = await window.electronAPI.workspace!.preflightExistingFolder({ folderPath })
    if (!result.success) {
      throw new Error(result.error || "Failed to inspect local folder.")
    }
    if (!result.isRepo) {
      return {
        isLoading: false,
        isRepo: false,
        hasOriginRemote: false,
        branch: "main",
        remoteUrl: null,
        error: null,
      }
    }

    const remoteUrl = result.repoIdentity?.url ?? null

    return {
      isLoading: false,
      isRepo: true,
      hasOriginRemote: Boolean(remoteUrl),
      branch: result.branch || "main",
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
