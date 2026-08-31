import type { BrowserSurfaceKind } from "@shared/browserSurfaceTypes";

interface BrowserWorkbenchSessionIdentity {
  readonly projectId: string;
  readonly laneId: string;
  readonly workspaceId: string | null;
  readonly workbenchSessionKey: string | null;
}

interface BrowserSurfaceRuntimeIdentity extends BrowserWorkbenchSessionIdentity {
  readonly tileId: string;
  readonly kind: BrowserSurfaceKind;
  readonly runtimeGeneration?: string | number | null;
}

export function resolveBrowserWorkbenchSessionKey(
  identity: BrowserWorkbenchSessionIdentity,
): string {
  const explicit = identity.workbenchSessionKey?.trim();
  if (explicit) return explicit;
  return [
    identity.projectId.trim(),
    identity.laneId.trim() || "collab",
    identity.workspaceId?.trim() || "unbound",
  ].join("::");
}

export function browserSurfaceRuntimeTabId(identity: BrowserSurfaceRuntimeIdentity): string {
  return JSON.stringify([
    resolveBrowserWorkbenchSessionKey(identity),
    identity.kind,
    identity.tileId,
    identity.runtimeGeneration ?? null,
  ]);
}
