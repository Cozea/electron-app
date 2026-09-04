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

interface BrowserSurfaceRuntimeIdRegistry {
  readonly byIdentity: Map<string, string>;
  nextFallbackId: number;
}

const RUNTIME_ID_REGISTRY_KEY = Symbol.for("cozea.browserSurfaceRuntimeIds");
const runtimeHost = globalThis as {
  [RUNTIME_ID_REGISTRY_KEY]?: BrowserSurfaceRuntimeIdRegistry;
};
const runtimeIds: BrowserSurfaceRuntimeIdRegistry = (runtimeHost[RUNTIME_ID_REGISTRY_KEY] ??= {
  byIdentity: new Map(),
  nextFallbackId: 0,
});

function newOpaqueRuntimeTabId(kind: BrowserSurfaceKind): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `cozea-preview:${kind}:${uuid}`;

  runtimeIds.nextFallbackId += 1;
  return `cozea-preview:${kind}:${Date.now().toString(36)}-${runtimeIds.nextFallbackId.toString(36)}`;
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
  const canonicalIdentity = JSON.stringify([
    resolveBrowserWorkbenchSessionKey(identity),
    identity.kind,
    identity.tileId,
    identity.runtimeGeneration ?? null,
  ]);
  const existing = runtimeIds.byIdentity.get(canonicalIdentity);
  if (existing) return existing;

  const runtimeTabId = newOpaqueRuntimeTabId(identity.kind);
  runtimeIds.byIdentity.set(canonicalIdentity, runtimeTabId);
  return runtimeTabId;
}
