/**
 * Provisions the invitee's dedicated local Session Workbench after membership
 * is accepted. The user's ordinary project workspace is only a clone source;
 * it is never checked out, reset, stashed, or reused as the session folder.
 */

import {
  describeSessionRepository,
  hasSpaceOrControlCharacter,
  normalizeSessionRepositoryUrl,
} from "@shared/collaboration/repositoryUrl"
import type {
  EnsureDesktopSessionWorkbenchRequest,
  EnsureDesktopSessionWorkbenchResponse,
} from "@shared/electronApiTypes"
import type { LocalWorkspaceRecord } from "@shared/workspaceTypes"

export type InviteeCopyOutcome =
  | { kind: "ready"; rootPath: string; workspaceId: string; repository: string | null }
  | { kind: "no_repository" }
  | { kind: "failed"; message: string }

export interface InviteeWorkspaceApi {
  getActiveForProject: (projectId: string) => Promise<LocalWorkspaceRecord | null>
}

export interface InviteeSessionWorkbenchApi {
  ensureSession: (request: EnsureDesktopSessionWorkbenchRequest) => Promise<EnsureDesktopSessionWorkbenchResponse>
}

export interface InviteeCopyRequest {
  projectId: string
  projectName: string
  publicSessionId: string
  branchName: string
  repositoryUrl: string | null | undefined
}

export async function ensureInviteeCopy(
  request: InviteeCopyRequest,
  workspaceApi: InviteeWorkspaceApi | undefined,
  workbenchApi: InviteeSessionWorkbenchApi | undefined,
): Promise<InviteeCopyOutcome> {
  if (!workspaceApi || !workbenchApi) {
    return { kind: "failed", message: "This version of Cozea can't prepare Session Workbenches." }
  }
  if (!isCloneableBranchName(request.branchName)) {
    return { kind: "failed", message: `Cozea won't check out a branch named "${request.branchName}".` }
  }

  const existing = await workspaceApi.getActiveForProject(request.projectId).catch(() => null)
  const repositoryUrl = normalizeSessionRepositoryUrl(request.repositoryUrl)
  if (!existing && !repositoryUrl) return { kind: "no_repository" }

  const repository = repositoryUrl ? describeSessionRepository(repositoryUrl) : null
  let result: EnsureDesktopSessionWorkbenchResponse
  try {
    result = await workbenchApi.ensureSession({
      projectId: request.projectId,
      publicSessionId: request.publicSessionId,
      branchName: request.branchName,
      baseBranch: request.branchName,
      createBranch: false,
      title: `${request.projectName} · ${request.branchName}`,
      sourceRepoUrl: repositoryUrl,
      sourceWorkspaceId: existing?.workspaceId ?? null,
      includeDirtyChanges: false,
      setActive: true,
    })
  } catch (error) {
    return {
      kind: "failed",
      message: describeSetupFailure(errorText(error), repository, request.branchName),
    }
  }
  if (!result.success) {
    return {
      kind: "failed",
      message: describeSetupFailure(result.error, repository, request.branchName),
    }
  }
  return {
    kind: "ready",
    rootPath: result.rootPath,
    workspaceId: result.workspace.workspaceId,
    repository,
  }
}

export function describeInviteeCopy(copy: InviteeCopyOutcome, branchName: string): string {
  switch (copy.kind) {
    case "ready":
      return copy.repository
        ? `Your Session Workbench for ${branchName} is ready from ${copy.repository}.`
        : `Your Session Workbench for ${branchName} is ready from your local project copy.`
    case "no_repository":
      return `You're in the live session on ${branchName}, but this Mac has no project copy and the session has no Git remote to clone.`
    case "failed":
      return `You're in the live session on ${branchName}, but its Session Workbench was not prepared. ${copy.message}`
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

function describeSetupFailure(detail: string, repository: string | null, branchName: string): string {
  if (/authentication failed|could not read username|repository not found|permission denied|access denied|\b403\b/i.test(detail)) {
    return repository
      ? `Git on this Mac can't read ${repository}. Update this Mac's Git credentials and retry.`
      : "Git on this Mac could not read the local project copy."
  }
  if (/remote branch .* not found|couldn't find remote ref/i.test(detail)) {
    return `${repository ?? "The repository"} has no branch ${branchName}.`
  }
  const firstLine = detail
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine || "Git couldn't prepare the session repository."
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
