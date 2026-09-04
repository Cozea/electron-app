import { buildWorkbenchScopeKey } from "@/features/workbench/model/workbenchStore";

export interface EnsureDevAppPreviewSurfaceRequest {
  projectId: string;
  laneId: string;
  workspaceId: string | null;
  assistantTileId: string;
  relativePath: string;
  preferredTileId?: string;
  create: boolean;
  focus?: boolean;
}

export interface DevAppPreviewSurfaceHandle {
  scopeKey: string;
  tileId: string;
  created: boolean;
  focused: boolean;
}

export interface DevAppPreviewSurfaceController {
  ensureSurface: (
    request: EnsureDevAppPreviewSurfaceRequest,
  ) => Promise<DevAppPreviewSurfaceHandle>;
  focusSurface: (tileId: string) => boolean;
}

const controllers = new Map<string, DevAppPreviewSurfaceController>();

export function normalizeDevAppPreviewRelativePath(relativePath: string): string {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return normalized || ".";
}

export function registerDevAppPreviewSurfaceController(
  scopeKey: string,
  controller: DevAppPreviewSurfaceController,
): () => void {
  controllers.set(scopeKey, controller);
  return () => {
    if (controllers.get(scopeKey) === controller) controllers.delete(scopeKey);
  };
}

export async function ensureDevAppPreviewSurface(
  request: EnsureDevAppPreviewSurfaceRequest,
): Promise<DevAppPreviewSurfaceHandle> {
  const scopeKey = buildWorkbenchScopeKey(request.projectId, request.laneId, request.workspaceId);
  const controller = controllers.get(scopeKey);
  if (!controller) {
    throw new Error(
      "The requested project workbench is not available for DevApp preview automation.",
    );
  }
  return await controller.ensureSurface(request);
}

export function focusDevAppPreviewSurface(scopeKey: string, tileId: string): boolean {
  return controllers.get(scopeKey)?.focusSurface(tileId) ?? false;
}

export function clearDevAppPreviewSurfaceControllersForTests(): void {
  controllers.clear();
}
