/**
 * Gives an invitee a folder for the live session they just joined.
 *
 * Master Specification: Section 7.1, P15
 *
 * When this Mac already has a folder for the project, the session syncs there once the
 * folder is on the session branch. Otherwise the Git remote the session recorded is
 * cloned on the session branch into the projects folder and bound to the project as a
 * folder Cozea manages, so opening the project attaches it to the session.
 */

import {
  describeSessionRepository,
  hasSpaceOrControlCharacter,
  normalizeSessionRepositoryUrl,
} from "@shared/collaboration/repositoryUrl"
import type {
  CloneWorkspaceForProjectRequest,
  CloneWorkspaceForProjectResult,
  LocalWorkspaceRecord,
} from "@shared/workspaceTypes"

export type InviteeCopyOutcome =
  | { kind: "existing"; rootPath: string }
  | { kind: "cloned"; rootPath: string; repository: string }
  | { kind: "no_repository" }
  | { kind: "failed"; message: string }

/** The part of `window.electronAPI.workspace` this needs. */
export interface InviteeWorkspaceApi {
  getActiveForProject: (projectId: string) => Promise<LocalWorkspaceRecord | null>
  cloneForProject: (req: CloneWorkspaceForProjectRequest) => Promise<CloneWorkspaceForProjectResult>
}

export interface InviteeCopyRequest {
  projectId: string
  projectName: string
  branchName: string
  repositoryUrl: string | null | undefined
}

export async function ensureInviteeCopy(
  request: InviteeCopyRequest,
  workspaceApi: InviteeWorkspaceApi | undefined,
): Promise<InviteeCopyOutcome> {
  if (!workspaceApi) {
    return { kind: "failed", message: "This version of Cozea can't set up project folders." }
  }
  const existing = await workspaceApi.getActiveForProject(request.projectId).catch(() => null)
  if (existing) return { kind: "existing", rootPath: existing.projectRootPath }

  const repositoryUrl = normalizeSessionRepositoryUrl(request.repositoryUrl)
  if (!repositoryUrl) return { kind: "no_repository" }
  const repository = describeSessionRepository(repositoryUrl)
  if (!isCloneableBranchName(request.branchName)) {
    return { kind: "failed", message: `Cozea won't check out a branch named "${request.branchName}".` }
  }

  let result: CloneWorkspaceForProjectResult
  try {
    result = await workspaceApi.cloneForProject({
      projectId: request.projectId,
      slug: projectFolderSlug(request.projectName),
      repoUrl: repositoryUrl,
      branch: request.branchName,
      setActive: true,
    })
  } catch (error) {
    return { kind: "failed", message: describeCloneFailure(errorText(error), repository, request.branchName) }
  }
  if (!result.success || !result.workspace) {
    return { kind: "failed", message: describeCloneFailure(result.error ?? "", repository, request.branchName) }
  }
  return { kind: "cloned", rootPath: result.workspace.projectRootPath, repository }
}

/** What the Inbox says after joining, for each way the folder was, or was not, set up. */
export function describeInviteeCopy(copy: InviteeCopyOutcome, branchName: string): string {
  switch (copy.kind) {
    case "existing":
      return `You're in the live session on ${branchName}. Open the project on that branch to sync with it.`
    case "cloned":
      return `Cozea cloned ${copy.repository} on ${branchName} into ${copy.rootPath}. Open the project to start syncing.`
    case "no_repository":
      return `You're in the live session on ${branchName}. It hasn't recorded its Git remote, so link your own copy with Relink Local Folder.`
    case "failed":
      return `You're in the live session on ${branchName}, but no copy was set up. ${copy.message}`
  }
}

/** A subset of `git check-ref-format --branch`: nothing Git could read as an option or a revision expression. */
export function isCloneableBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{") &&
    !/[~^:?*[\\]/.test(name) &&
    !hasSpaceOrControlCharacter(name)
  )
}

function projectFolderSlug(projectName: string): string {
  const slug = projectName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return slug || "project"
}

function describeCloneFailure(detail: string, repository: string, branchName: string): string {
  if (/authentication failed|could not read username|repository not found|permission denied|access denied|\b403\b/i.test(detail)) {
    return `Git on this Mac can't read ${repository}. Get access to it, then link a copy with Relink Local Folder.`
  }
  if (/remote branch .* not found|couldn't find remote ref/i.test(detail)) {
    return `${repository} has no branch ${branchName}.`
  }
  const firstLine = detail
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  return `Git couldn't clone ${repository}${firstLine ? `: ${firstLine}` : "."}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
