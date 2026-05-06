import fs from "node:fs/promises"
import path from "node:path"
import type {
  LocalWorkspaceRecord,
  RepoIdentity,
  WorkspaceVerificationStatus,
} from "../../shared/workspaceTypes.ts"
import { readWorkspaceMarker } from "./markers.ts"
import { readGitRepoIdentity, repoIdentitiesMatch } from "./repoIdentity.ts"

export interface WorkspaceVerificationResult {
  status: WorkspaceVerificationStatus
  reason?: string
  realPath?: string
  repoIdentity?: RepoIdentity | null
  markerWorkspaceId?: string | null
  markerProjectId?: string | null
  markerPath?: string | null
}

/**
 * Fast path verification: stat → realpath → marker → git identity.
 * Does not scan directories. Returns within milliseconds for the happy path.
 */
export async function verifyWorkspacePath(
  workspace: Pick<
    LocalWorkspaceRecord,
    | "rootPath"
    | "realPath"
    | "projectRootRelativePath"
    | "projectRootPath"
    | "projectId"
    | "workspaceId"
    | "gitOriginUrl"
    | "gitRepoIdentityJson"
  >,
  expectedRepo?: RepoIdentity | null,
): Promise<WorkspaceVerificationResult> {
  // 1. stat
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(workspace.rootPath)
  } catch {
    return { status: "missing" }
  }

  if (!stat.isDirectory()) {
    return { status: "not-directory" }
  }

  // 2. realpath
  let realPath: string
  try {
    realPath = await fs.realpath(workspace.rootPath)
  } catch {
    return { status: "unreadable" }
  }

  // 3. Marker
  const markerResult = await readWorkspaceMarker(workspace.projectRootPath)
  const markerWorkspaceId = markerResult?.marker.workspaceId ?? null
  const markerProjectId = markerResult?.marker.projectId ?? null
  const markerPath = markerResult?.markerPath ?? null

  if (markerResult) {
    if (markerResult.marker.projectId !== workspace.projectId) {
      return {
        status: "marker-mismatched-project",
        reason: `marker.projectId=${markerResult.marker.projectId} expected=${workspace.projectId}`,
        realPath,
        markerWorkspaceId,
        markerProjectId,
        markerPath,
      }
    }
    if (markerResult.marker.workspaceId !== workspace.workspaceId) {
      return {
        status: "marker-mismatched-workspace",
        reason: `marker.workspaceId=${markerResult.marker.workspaceId} expected=${workspace.workspaceId}`,
        realPath,
        markerWorkspaceId,
        markerProjectId,
        markerPath,
      }
    }
  }

  // 4. Repo identity (optional — only checked if expectedRepo is provided)
  let repoIdentity: RepoIdentity | null = null
  try {
    repoIdentity = await readGitRepoIdentity(workspace.projectRootPath)
  } catch {
    // non-fatal
  }

  if (expectedRepo && repoIdentity) {
    const gitDir = path.join(workspace.projectRootPath, ".git")
    let hasGit = false
    try {
      await fs.access(gitDir)
      hasGit = true
    } catch {
      // no .git
    }

    if (hasGit && !repoIdentitiesMatch(repoIdentity, expectedRepo)) {
      return {
        status: "repo-mismatched",
        reason: `found=${repoIdentity.provider} expected=${expectedRepo.provider}`,
        realPath,
        repoIdentity,
        markerWorkspaceId,
        markerProjectId,
        markerPath,
      }
    }
  }

  return {
    status: "verified",
    realPath,
    repoIdentity,
    markerWorkspaceId,
    markerProjectId,
    markerPath,
  }
}
