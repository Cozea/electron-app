import type { ReactNode } from "react"
import type {
  ActiveWorkspaceContextValue,
  LocalWorkspaceDTO,
  ResolveProjectWorkspaceResult,
  WorkspaceLaneDTO,
  WorkspaceResolutionAction,
} from "../../../../shared/workspaceTypes"
import { ActiveWorkspaceProvider } from "./ActiveWorkspaceContext"
import { useProjectWorkspaceResolution } from "./useProjectWorkspaceResolution"
import { WorkspaceRepairScreen } from "./WorkspaceRepairScreen"

export interface ProjectLike {
  _id: string
  slug?: string | null
  name?: string | null
}

type ReadyResolution = Extract<ResolveProjectWorkspaceResult, { status: "ready" }>

interface ProjectWorkspaceGateProps {
  project: ProjectLike
  /** Rendered when the workspace is ready. Receives the ready resolution. */
  children: (resolution: ReadyResolution) => ReactNode
  /** Called when the user clicks a repair action. Defaults to a no-op placeholder. */
  onRepairAction?: (action: WorkspaceResolutionAction) => void
}

/**
 * Resolves the local workspace for a project and gates its children behind
 * a verified workspace. Shows repair UI for all non-ready states.
 */
export function ProjectWorkspaceGate({
  project,
  children,
  onRepairAction,
}: ProjectWorkspaceGateProps) {
  const { result: resolution } = useProjectWorkspaceResolution(
    project._id,
    project.slug,
    null,
    null,
    { allowCandidateScan: true },
  )

  if (!resolution) {
    return <WorkspaceLoadingPlaceholder />
  }

  if (resolution.status === "ready") {
    const contextValue = buildActiveWorkspaceContextValue(resolution, project)
    return (
      <ActiveWorkspaceProvider value={contextValue}>
        {children(resolution)}
      </ActiveWorkspaceProvider>
    )
  }

  return (
    <WorkspaceRepairScreen
      result={resolution}
      project={project}
      onAction={onRepairAction}
    />
  )
}

function WorkspaceLoadingPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  )
}

function buildActiveWorkspaceContextValue(
  resolution: ReadyResolution,
  project: ProjectLike,
): ActiveWorkspaceContextValue {
  return {
    projectId: resolution.projectId,
    projectSlug: project.slug ?? null,
    projectName: project.name ?? null,
    workspace: resolution.workspace as LocalWorkspaceDTO,
    lane: resolution.lane as WorkspaceLaneDTO,
    runtime: resolution.runtimeIdentity,
    collaborationScopeId: resolution.collaborationScopeId,
  }
}
