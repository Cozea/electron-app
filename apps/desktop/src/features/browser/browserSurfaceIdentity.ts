import type { BrowserSurfaceKind } from "@shared/browserSurfaceTypes";

interface BrowserWorkbenchSessionIdentity {
  readonly projectId: string;
  readonly laneId: string;
  readonly workspaceId: string | null;
  readonly workbenchSessionKey: string | null;
}

interface BrowserSurfaceRuntimeIdentity extends BrowserSurfaceRuntimeIdentityBase {
  readonly workbenchSessionKey: string | null;
}

interface BrowserSurfaceRuntimeIdentityBase {
  readonly projectId: string;
  readonly laneId: string;
  readonly workspaceId: string | null;
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

/**
 * The workbench session key when the session has actually resolved it.
 *
 * Returns null while the session is still resolving. That null is a readiness
 * state, not a different session, which is why it is reported rather than
 * substituted: a substitute would be indistinguishable from a real key and
 * would silently become a second browser identity (INV-002).
 *
 * The key carries a revision suffix (`::v1`, `::v2`). Revisions are distinct
 * sessions and must never be normalised away.
 */
export function canonicalBrowserWorkbenchSessionKey(
  identity: Pick<BrowserWorkbenchSessionIdentity, "workbenchSessionKey">,
): string | null {
  const explicit = identity.workbenchSessionKey?.trim();
  return explicit ? explicit : null;
}

/**
 * A session key for scoping, falling back to the workbench coordinates.
 *
 * For grouping and lookup only -- storage scopes, inventory buckets, anything
 * that may safely describe a session before it has finished resolving. It is
 * deliberately NOT valid input for runtime identity: the fallback it returns
 * while `workbenchSessionKey` is null is a different string from the canonical
 * key that arrives moments later, so minting an identity from it produces a
 * second browser for the same tile. Use
 * `canonicalBrowserWorkbenchSessionKey` for anything that owns Chromium.
 */
export function resolveBrowserWorkbenchSessionKey(
  identity: BrowserWorkbenchSessionIdentity,
): string {
  const explicit = canonicalBrowserWorkbenchSessionKey(identity);
  if (explicit) return explicit;
  return [
    identity.projectId.trim(),
    identity.laneId.trim() || "collab",
    identity.workspaceId?.trim() || "unbound",
  ].join("::");
}

/**
 * The stable browser identity for a tile, or null while it cannot be known.
 *
 * Identity is memoised on the canonical session key, so being handed an
 * unresolved one would mint an id that a later render cannot reproduce -- and
 * a `runtimeTabId` that changes is, by definition, a second browser. Callers
 * withhold surface creation until this returns an id; rendering the tile shell
 * meanwhile is fine, creating Chromium is not.
 */
export function browserSurfaceRuntimeTabId(
  identity: BrowserSurfaceRuntimeIdentity,
): string | null {
  const sessionKey = canonicalBrowserWorkbenchSessionKey(identity);
  if (!sessionKey) return null;

  const canonicalIdentity = JSON.stringify([
    sessionKey,
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
