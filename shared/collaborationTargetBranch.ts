import { assertGitCommitSha, type CollaborationSessionDescriptor } from "./collaborationSession"

export interface CollaborationTargetResolution { repositoryId: string; branch: string; commitSha: string }
export interface CollaborationTargetCheck { status: "unchanged" | "changed" | "unknown"; commitSha: string }

// The published session base advances independently of the target branch.
// Never substitute it for the immutable starting target SHA.
export function checkCollaborationTarget(
  session: Pick<CollaborationSessionDescriptor, "repositoryId" | "targetBranch" | "targetCommitSha">,
  resolved: CollaborationTargetResolution,
): CollaborationTargetCheck {
  if (resolved.repositoryId !== session.repositoryId || resolved.branch !== session.targetBranch) {
    throw new Error("The resolved target does not match this session’s repository and branch")
  }
  const commitSha = assertGitCommitSha(resolved.commitSha, "Remote target commit SHA")
  return { commitSha, status: session.targetCommitSha === undefined ? "unknown"
    : assertGitCommitSha(session.targetCommitSha) === commitSha ? "unchanged" : "changed" }
}

export interface CollaborationRestartSelection { sourceWorkspaceId: string; branch: string; creationToken: string }
export async function endCollaborationForRestart(
  session: Pick<CollaborationSessionDescriptor, "id" | "projectId" | "repositoryId" | "targetBranch" | "targetCommitSha">,
  dependencies: {
    getBinding(id: string): Promise<{ projectId: string; sourceWorkspaceId: string } | null>
    resolve(input: { projectId: string; branch: string }): Promise<CollaborationTargetResolution>
    leave(input: { sessionId: string; end: true }): Promise<void>
  },
): Promise<CollaborationRestartSelection> {
  const binding = await dependencies.getBinding(session.id)
  if (!binding || binding.projectId !== session.projectId) throw new Error("The original workspace for this session is unavailable")
  // Check access before ending; Start will resolve the target again after review.
  checkCollaborationTarget(session, await dependencies.resolve({ projectId: session.projectId, branch: session.targetBranch }))
  await dependencies.leave({ sessionId: session.id, end: true })
  return { sourceWorkspaceId: binding.sourceWorkspaceId, branch: session.targetBranch, creationToken: crypto.randomUUID() }
}
