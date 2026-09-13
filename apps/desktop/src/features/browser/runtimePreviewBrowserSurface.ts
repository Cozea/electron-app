import type { WorkbenchDevServerTile } from "@/lib/workbenchTileContract"

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

/**
 * Null until the workbench session key resolves, so a Dev Server or project
 * DevApp surface cannot be created against a provisional identity either. These
 * families are still legacy-backed, but the identity boundary is shared and the
 * bug would otherwise be waiting for them at migration time.
 */
export function runtimePreviewBrowserSurfaceTabId(
  identity: RuntimePreviewBrowserSurfaceIdentity,
): string | null {
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
