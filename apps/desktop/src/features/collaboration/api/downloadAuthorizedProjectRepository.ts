import {
  repositoryGitAuthOptions,
  requestCollaborationRepositoryCredential,
} from "@/features/collaboration/api/collaborationGatewayClient"
import type { CollaborationRepositoryDescriptor } from "@shared/collaborationRepository"
import type { LocalWorkspaceDTO } from "@shared/workspaceTypes"

export interface DownloadAuthorizedProjectRepositoryResult {
  workspace: LocalWorkspaceDTO
  repository: CollaborationRepositoryDescriptor
}

/**
 * Materialize an authorized shared project directly from GitHub into a Cozea-managed
 * workspace. The gateway returns repository identity and the short-lived credential
 * atomically, eliminating the stale-binding window that existed in PR141.
 */
export async function downloadAuthorizedProjectRepository(args: {
  projectId: string
  slug: string
}): Promise<DownloadAuthorizedProjectRepositoryResult> {
  const workspace = window.electronAPI.workspace
  if (!workspace) throw new Error("Local workspace management is unavailable")

  const credential = await requestCollaborationRepositoryCredential({
    projectId: args.projectId,
    operation: "read",
  })
  const repository = credential.repository
  const auth = repositoryGitAuthOptions(credential)

  const created = await workspace.createForProject({
    projectId: args.projectId,
    slug: args.slug,
    initGit: true,
    setActive: true,
  })
  if (!created.success || !created.workspace) {
    throw new Error(created.error || "Could not create the local project workspace")
  }

  const workspaceId = created.workspace.workspaceId
  try {
    const ensured = await window.electronAPI.workspaceSync.gitEnsureRepo({
      workspaceId,
      branch: repository.defaultBranch,
      repoUrl: repository.cloneUrl,
    })
    if (!ensured.success) throw new Error(ensured.error || "Could not initialize the local Git repository")

    const fetched = await window.electronAPI.workspaceSync.gitFetchMain({
      workspaceId,
      remote: "origin",
      branch: repository.defaultBranch,
      provider: auth.provider,
      extraHeader: auth.extraHeader,
    })
    if (!fetched.success) throw new Error(fetched.error || "Could not download the project from GitHub")

    const restored = await window.electronAPI.workspaceSync.gitRestoreMain({
      workspaceId,
      remote: "origin",
      branch: repository.defaultBranch,
      repoUrl: repository.cloneUrl,
      provider: auth.provider,
      extraHeader: auth.extraHeader,
    })
    if (!restored.success) throw new Error(restored.error || "Could not materialize the downloaded project")

    const verified = await workspace.verify(workspaceId)
    if (!verified.workspace) throw new Error("The downloaded project workspace could not be verified")
    return { workspace: verified.workspace, repository }
  } catch (error) {
    await workspace.trashManagedWorkspace(workspaceId).catch(() => undefined)
    throw error
  }
}
