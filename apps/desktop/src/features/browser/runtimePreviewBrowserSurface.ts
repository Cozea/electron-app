import type { WorkbenchDevServerTile } from "@/features/workbench/model/workbenchStore";

import { browserSurfaceRuntimeTabId } from "./browserSurfaceIdentity";

interface RuntimePreviewBrowserSurfaceIdentity {
  readonly projectId: string;
  readonly laneId: string;
  readonly workspaceId: string | null;
  readonly workbenchSessionKey: string | null;
  readonly tile: WorkbenchDevServerTile;
}

export function runtimePreviewBrowserSurfaceKind(
  tile: WorkbenchDevServerTile,
): "devServer" | "projectDevApp" {
  return tile.devAppId ? "projectDevApp" : "devServer";
}

export function runtimePreviewBrowserSurfaceGeneration(
  tile: WorkbenchDevServerTile,
): string | number | null {
  if (!tile.devAppId) return null;
  return tile.devAppReleaseId ?? tile.devAppReleaseVersion ?? null;
}

export function runtimePreviewBrowserSurfaceTabId(
  identity: RuntimePreviewBrowserSurfaceIdentity,
): string {
  return browserSurfaceRuntimeTabId({
    projectId: identity.projectId,
    laneId: identity.laneId,
    workspaceId: identity.workspaceId,
    workbenchSessionKey: identity.workbenchSessionKey,
    tileId: identity.tile.id,
    kind: runtimePreviewBrowserSurfaceKind(identity.tile),
    runtimeGeneration: runtimePreviewBrowserSurfaceGeneration(identity.tile),
  });
}
