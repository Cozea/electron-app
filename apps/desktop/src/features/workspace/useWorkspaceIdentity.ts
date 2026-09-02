import { useOptionalProjectRouteContext } from "@/features/projects/contexts/ProjectRouteContext"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import { useActiveWorkspaceOrNull } from "./ActiveWorkspaceContext"

export interface WorkspaceIdentity {
  workspaceId: string | null
  projectRootPath: string | null
  gitRootPath: string | null
}

/**
 * The one way to answer "which local workspace is this surface working in".
 *
 * ProjectLayout feeds the same resolution into three providers
 * (ActiveWorkspaceProvider, ProjectRouteContext, ProjectSyncProvider), and
 * consumers used to pick their own ad-hoc `??` chains across them — three
 * spellings of the same fact that could disagree the day one provider
 * changes. Canonical precedence: the ready resolution (ActiveWorkspace),
 * then the route context, then the sync context.
 */
export function useWorkspaceIdentity(): WorkspaceIdentity {
  const active = useActiveWorkspaceOrNull()
  const route = useOptionalProjectRouteContext()
  const sync = useOptionalProjectSyncContext()

  return {
    workspaceId:
      active?.workspace.workspaceId ?? route?.workspaceId ?? sync?.workspaceId ?? null,
    projectRootPath:
      active?.lane.projectRootPath ??
      active?.workspace.projectRootPath ??
      route?.projectRootPath ??
      null,
    gitRootPath:
      active?.lane.gitRootPath ??
      active?.workspace.gitRootPath ??
      route?.gitRootPath ??
      sync?.gitCwd ??
      null,
  }
}
