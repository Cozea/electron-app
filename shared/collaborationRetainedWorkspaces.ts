import type { SessionWorkspaceBinding } from "./collaborationDesktop"

/** Resolve only catalog entries already associated with this project. The
 * canonical session record must agree with the workspace policy before UI use. */
export async function listRetainedCollaborationWorkspaces(projectId: string, api: {
  listForProject(projectId: string): Promise<Array<{ workspaceId: string; projectId: string }>>
  bindingForWorkspace(workspaceId: string): Promise<SessionWorkspaceBinding | null>
  getBinding(sessionId: string): Promise<SessionWorkspaceBinding | null>
}): Promise<SessionWorkspaceBinding[]> {
  const workspaces = await api.listForProject(projectId)
  if (workspaces.length > 1000) throw new Error("This project has too many local workspaces to inspect at once")
  const retained: SessionWorkspaceBinding[] = []
  const seen = new Set<string>()
  for (let offset = 0; offset < workspaces.length; offset += 16) {
    const batch = await Promise.all(workspaces.slice(offset, offset + 16).map(async workspace => {
      if (workspace.projectId !== projectId) return null
      const policy = await api.bindingForWorkspace(workspace.workspaceId)
      if (!policy) return null
      if (policy.generation !== 3 || policy.projectId !== projectId || policy.workspaceId !== workspace.workspaceId) throw new Error("Local collaboration workspace association is invalid")
      const binding = await api.getBinding(policy.sessionId)
      if (!binding || binding.generation !== 3 || binding.projectId !== projectId || binding.workspaceId !== workspace.workspaceId ||
        binding.sessionId !== policy.sessionId || binding.repositoryId !== policy.repositoryId || binding.sourceWorkspaceId !== policy.sourceWorkspaceId || binding.state !== policy.state) throw new Error("Local collaboration session association changed; refresh the retained workspaces")
      return binding
    }))
    for (const binding of batch) if (binding && !seen.has(binding.sessionId)) { seen.add(binding.sessionId); retained.push(binding) }
  }
  return retained.sort((a, b) => b.joinedAt - a.joinedAt || a.sessionId.localeCompare(b.sessionId))
}
