import type { LocalWorkspaceDTO } from "@shared/workspaceTypes"

/** Renderer forwards intent only. GitHub credentials and Git run in Electron. */
export function downloadAuthorizedProjectRepository(args: { projectId: string; slug: string }): Promise<LocalWorkspaceDTO> {
  return window.electronAPI.collaboration.downloadRepository(args)
}
