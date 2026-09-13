import { beforeEach, describe, expect, it } from "vitest";

import {
  browserSurfaceRuntimeTabId,
  canonicalBrowserWorkbenchSessionKey,
  resolveBrowserWorkbenchSessionKey,
} from "../../apps/desktop/src/features/browser/browserSurfaceIdentity";

/**
 * `runtimeTabId` is browser identity (INV-002). A tile that renders before its
 * workbench session has resolved must not be given an identity it cannot
 * reproduce a moment later, because a `runtimeTabId` that changes is a second
 * Chromium browser for the same tile.
 *
 * This is the regression for D1: a route round trip left `workbenchSessionKey`
 * momentarily null, the session key fell back to the workbench coordinates, and
 * the tile minted a second browser under a second identity while the first
 * leaked.
 */

const RUNTIME_ID_REGISTRY_KEY = Symbol.for("cozea.browserSurfaceRuntimeIds");

const identity = (workbenchSessionKey: string | null) => ({
  projectId: "proj_1",
  laneId: "collab",
  workspaceId: "lws_1",
  workbenchSessionKey,
  tileId: "browser-tile-1",
  kind: "browser" as const,
});

beforeEach(() => {
  // The registry is process-global so identity survives module reloads; each
  // test needs its own so ids from a previous one cannot be mistaken for reuse.
  (globalThis as Record<symbol, unknown>)[RUNTIME_ID_REGISTRY_KEY] = {
    byIdentity: new Map(),
    nextFallbackId: 0,
  };
});

describe("browser surface identity boundary", () => {
  it("mints no identity while the session key is unresolved", () => {
    expect(browserSurfaceRuntimeTabId(identity(null))).toBeNull();
    expect(browserSurfaceRuntimeTabId(identity(""))).toBeNull();
    expect(browserSurfaceRuntimeTabId(identity("   "))).toBeNull();
  });

  it("does not mint a second identity when the session key blanks and returns", () => {
    const before = browserSurfaceRuntimeTabId(identity("proj_1::collab::lws_1::v1"));
    const during = browserSurfaceRuntimeTabId(identity(null));
    const after = browserSurfaceRuntimeTabId(identity("proj_1::collab::lws_1::v1"));

    // The null is a readiness state, not a different session. Substituting a
    // key for it is what produced the second browser.
    expect(before).not.toBeNull();
    expect(during).toBeNull();
    expect(after).toBe(before);
  });

  it("keeps revisions of one session distinct", () => {
    const v1 = browserSurfaceRuntimeTabId(identity("proj_1::collab::lws_1::v1"));
    const v2 = browserSurfaceRuntimeTabId(identity("proj_1::collab::lws_1::v2"));

    // A revision bump is deliberately a different session, so it must get its
    // own browser. Normalising the suffix away would silently reuse one.
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v2).not.toBe(v1);
  });

  it("never derives identity from the scoping fallback", () => {
    const fallbackKey = resolveBrowserWorkbenchSessionKey(identity(null));
    // The exact string the old code minted from, and the reason it broke: it is
    // not the canonical key that arrives moments later.
    expect(fallbackKey).toBe("proj_1::collab::lws_1");

    const canonical = browserSurfaceRuntimeTabId(identity("proj_1::collab::lws_1::v1"));
    const fromFallbackShapedKey = browserSurfaceRuntimeTabId(identity(fallbackKey));

    expect(fromFallbackShapedKey).not.toBe(canonical);
    expect(browserSurfaceRuntimeTabId(identity(null))).toBeNull();
  });

  it("separates tiles that share one resolved session", () => {
    const first = browserSurfaceRuntimeTabId(identity("proj_1::collab::lws_1::v1"));
    const second = browserSurfaceRuntimeTabId({
      ...identity("proj_1::collab::lws_1::v1"),
      tileId: "browser-tile-2",
    });

    expect(first).not.toBe(second);
  });

  it("reports readiness without substituting a key", () => {
    expect(canonicalBrowserWorkbenchSessionKey({ workbenchSessionKey: null })).toBeNull();
    expect(canonicalBrowserWorkbenchSessionKey({ workbenchSessionKey: "  " })).toBeNull();
    expect(canonicalBrowserWorkbenchSessionKey({ workbenchSessionKey: " k::v1 " })).toBe("k::v1");
  });
});
