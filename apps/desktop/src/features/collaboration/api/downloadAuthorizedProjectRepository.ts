import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { convex } from "@/lib/convex"
import {
  repositoryGitAuthOptions,
  requestCollaborationRepositoryCredential,
} from "@/features/collaboration/api/collaborationGatewayClient"
import type { CollaborationRepositoryBindingDescriptor } from "@shared/collaborationRepository"
import type { LocalWorkspaceDTO } from "@shared/workspaceTypes"

export interface DownloadAuthorizedProjectRepositoryResult {
  workspace: LocalWorkspaceDTO
  binding: CollaborationRepositoryBindingDescriptor
}

export async function downloadAuthorizedProjectRepository(args: {
  projectId: string
  slug: string
}): Promise<DownloadAuthorizedProjectRepositoryResult> {
  if (!convex) throw new Error("Convex is not configured")

  const workspace = window.electronAPI.workspace
  if (!workspace) {
    throw new Error("Local workspace management is unavailable")
  }

  const binding = await convex.query(api.collaborationRepositories.getBinding, {
    projectId: args.projectId as Id<"projects">,
  }) as CollaborationRepositoryBindingDescriptor | null
  if (!binding?.enabled) {
    throw new Error("This project does not have an enabled organization repository binding")
  }

  const credential = await requestCollaborationRepositoryCredential({
    projectId: args.projectId,
    operation: "read",
  })
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
      branch: binding.defaultBranch,
      repoUrl: binding.cloneUrl,
    })
    if (!ensured.success) {
      throw new Error(ensured.error || "Could not initialize the local Git repository")
    }

    const fetched = await window.electronAPI.workspaceSync.gitFetchMain({
      workspaceId,
      remote: "origin",
      branch: binding.defaultBranch,
      provider: auth.provider,
      extraHeader: auth.extraHeader,
    })
    if (!fetched.success) {
      throw new Error(fetched.error || "Could not download the project from GitHub")
    }

    const restored = await window.electronAPI.workspaceSync.gitRestoreMain({
      workspaceId,
      remote: "origin",
      branch: binding.defaultBranch,
      repoUrl: binding.cloneUrl,
      provider: auth.provider,
      extraHeader: auth.extraHeader,
    })
    if (!restored.success) {
      throw new Error(restored.error || "Could not materialize the downloaded project")
    }

    const verified = await workspace.verify(workspaceId)
    if (!verified.workspace) {
      throw new Error("The downloaded project workspace could not be verified")
    }

    return { workspace: verified.workspace, binding }
  } catch (error) {
    await workspace.trashManagedWorkspace(workspaceId).catch(() => undefined)
    throw error
  }
}
