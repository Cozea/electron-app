import type { WorkbenchDevServerTile } from "@/stores/useProjectWorkbenchStore";

export interface WorkbenchRuntimeTarget {
  projectId: string;
  laneId: string;
  workspaceId: string | null;
  usesProjectDevAppSource: boolean;
}

interface CurrentWorkbenchRuntimeTarget {
  projectId: string;
  laneId: string;
  workspaceId: string | null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * A local DevApp can be mounted in any project's dock, but its process must
 * continue to run from the source project's workspace. Legacy same-project
 * tiles without source metadata retain the current-workspace behavior.
 */
export function resolveProjectDevAppRuntimeTarget(
  tile: WorkbenchDevServerTile,
  current: CurrentWorkbenchRuntimeTarget,
): WorkbenchRuntimeTarget {
  const sourceProjectId = normalizeOptionalString(tile.devAppProjectId);
  if (!tile.devAppId || !sourceProjectId) {
    return { ...current, usesProjectDevAppSource: false };
  }

  const sourceWorkspaceId = normalizeOptionalString(tile.devAppWorkspaceId);
  const sourceLaneId = normalizeOptionalString(tile.devAppLaneId);
  const isCurrentProject = sourceProjectId === current.projectId;

  if (isCurrentProject && (!sourceWorkspaceId || sourceWorkspaceId === current.workspaceId)) {
    return { ...current, usesProjectDevAppSource: false };
  }

  return {
    projectId: sourceProjectId,
    laneId: sourceLaneId ?? (isCurrentProject ? current.laneId : "collab"),
    workspaceId: sourceWorkspaceId,
    usesProjectDevAppSource: true,
  };
}

export function buildWorkbenchRuntimeTargetIdentity(target: WorkbenchRuntimeTarget): string {
  return [
    target.projectId,
    target.laneId,
    target.workspaceId ?? "unbound",
    target.usesProjectDevAppSource ? "project-devapp" : "workbench",
  ].join("::");
}
