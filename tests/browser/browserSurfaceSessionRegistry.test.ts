import { describe, expect, it, vi } from "vitest";

import { partitionForDescriptor } from "../../shared/browserSurfaceSessions";
import type {
  BrowserSurfaceDescriptor,
  BrowserSurfaceKind,
} from "../../shared/browserSurfaceTypes";

/**
 * The session registry decides how a session is configured; the partition rules
 * decide which surfaces share one. These assert the boundary the registry
 * inherited from `T3BrowserSurfaceService` is identical after the extraction,
 * because a partition is a storage boundary: two surfaces on one share cookies,
 * localStorage, IndexedDB and service workers.
 */

const sessionsByPartition = new Map<string, FakeSession>();

interface FakeSession {
  readonly partition: string;
  getUserAgent: () => string;
  setUserAgent: (value: string) => void;
  setPermissionRequestHandler: (handler: PermissionRequestHandler) => void;
  setPermissionCheckHandler: (handler: PermissionCheckHandler) => void;
  on: (event: string, listener: (event: { preventDefault: () => void }) => void) => void;
  clearStorageData: () => Promise<void>;
  clearCache: () => Promise<void>;
  permissionRequestHandler?: PermissionRequestHandler;
  permissionCheckHandler?: PermissionCheckHandler;
  userAgent: string;
  downloadListener?: (event: { preventDefault: () => void }) => void;
}

type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
) => void;
type PermissionCheckHandler = (webContents: unknown, permission: string) => boolean;

const makeFakeSession = (partition: string): FakeSession => {
  const fake: FakeSession = {
    partition,
    userAgent: "Mozilla/5.0 Electron/40.0.1 Cozea/2.0.0 Safari/537.36",
    getUserAgent: () => fake.userAgent,
    setUserAgent: (value) => {
      fake.userAgent = value;
    },
    setPermissionRequestHandler: (handler) => {
      fake.permissionRequestHandler = handler;
    },
    setPermissionCheckHandler: (handler) => {
      fake.permissionCheckHandler = handler;
    },
    on: (event, listener) => {
      if (event === "will-download") fake.downloadListener = listener;
    },
    clearStorageData: async () => undefined,
    clearCache: async () => undefined,
  };
  return fake;
};

vi.mock("electron", () => ({
  session: {
    fromPartition: vi.fn((partition: string) => {
      const existing = sessionsByPartition.get(partition);
      if (existing) return existing;
      const created = makeFakeSession(partition);
      sessionsByPartition.set(partition, created);
      return created;
    }),
  },
}));

const { BrowserSurfaceSessionRegistry } = await import(
  "../../apps/desktop/electron/services/browser/BrowserSurfaceSessionRegistry"
);

const descriptor = (
  overrides: Partial<BrowserSurfaceDescriptor> & { kind: BrowserSurfaceKind },
): BrowserSurfaceDescriptor => ({
  runtimeTabId: "rt_default",
  tileId: "tile_default",
  workbenchSessionKey: "session_default",
  title: "Surface",
  initialUrl: null,
  storageScope: "ephemeral",
  ...overrides,
});

const makeRegistry = () => {
  const registerOrgDevAppProtocol = vi.fn();
  const registerDevAppPreviewProtocol = vi.fn();
  const registry = new BrowserSurfaceSessionRegistry({
    allowedPermissions: new Set(["clipboard-read"]),
    protocols: { registerOrgDevAppProtocol, registerDevAppPreviewProtocol },
  });
  return { registry, registerOrgDevAppProtocol, registerDevAppPreviewProtocol };
};

describe("BrowserSurfaceSessionRegistry", () => {
  it("keeps every surface kind on the partition the extracted rules produce", () => {
    const { registry } = makeRegistry();
    const cases: ReadonlyArray<BrowserSurfaceDescriptor> = [
      descriptor({ kind: "browser", storageScope: "global" }),
      descriptor({ kind: "browser", storageScope: "workspace", workspaceId: "ws_1" }),
      descriptor({ kind: "browser", storageScope: "ephemeral", tileId: "tile_a" }),
      descriptor({ kind: "devServer", storageScope: "ephemeral", tileId: "tile_b" }),
      descriptor({ kind: "projectDevApp", storageScope: "ephemeral", tileId: "tile_c" }),
      descriptor({
        kind: "orgDevApp",
        storageScope: "orgDevApp",
        publicationId: "pub_1",
        contentHash: "a".repeat(64),
      }),
      descriptor({
        kind: "devAppPreview",
        storageScope: "devAppPreview",
        devSourceId: "b".repeat(32),
      }),
    ];

    // The registry must not have quietly become a second source of truth.
    for (const entry of cases) {
      expect(registry.partitionFor(entry)).toBe(partitionForDescriptor(entry));
    }
  });

  it("shares one session between workspace surfaces in the same workspace", () => {
    const { registry } = makeRegistry();
    const first = registry.resolve(
      descriptor({ kind: "browser", storageScope: "workspace", workspaceId: "ws_1", tileId: "t1" }),
    );
    const second = registry.resolve(
      descriptor({ kind: "browser", storageScope: "workspace", workspaceId: "ws_1", tileId: "t2" }),
    );

    expect(first).toBe(second);
  });

  it("separates workspace surfaces belonging to different workspaces", () => {
    const { registry } = makeRegistry();
    const first = registry.resolve(
      descriptor({ kind: "browser", storageScope: "workspace", workspaceId: "ws_1" }),
    );
    const second = registry.resolve(
      descriptor({ kind: "browser", storageScope: "workspace", workspaceId: "ws_2" }),
    );

    expect(first).not.toBe(second);
  });

  it("isolates ephemeral surfaces from each other", () => {
    const { registry } = makeRegistry();
    const first = registry.resolve(
      descriptor({ kind: "browser", storageScope: "ephemeral", tileId: "tile_a" }),
    );
    const second = registry.resolve(
      descriptor({ kind: "browser", storageScope: "ephemeral", tileId: "tile_b" }),
    );

    expect(first).not.toBe(second);
    expect(registry.isPersistent(descriptor({ kind: "browser", storageScope: "ephemeral" }))).toBe(
      false,
    );
  });

  it("shares one session between instances of the same published Org DevApp", () => {
    const { registry } = makeRegistry();
    const published = (tileId: string) =>
      descriptor({
        kind: "orgDevApp",
        storageScope: "orgDevApp",
        publicationId: "pub_1",
        contentHash: "a".repeat(64),
        tileId,
      });

    expect(registry.resolve(published("t1"))).toBe(registry.resolve(published("t2")));
  });

  it("separates distinct publications", () => {
    const { registry } = makeRegistry();
    const first = registry.resolve(
      descriptor({ kind: "orgDevApp", storageScope: "orgDevApp", publicationId: "pub_1" }),
    );
    const second = registry.resolve(
      descriptor({ kind: "orgDevApp", storageScope: "orgDevApp", publicationId: "pub_2" }),
    );

    expect(first).not.toBe(second);
  });

  it("never hands a development preview a published app's session", () => {
    const { registry } = makeRegistry();
    const sourceId = "c".repeat(32);
    const preview = registry.resolve(
      descriptor({ kind: "devAppPreview", storageScope: "devAppPreview", devSourceId: sourceId }),
    );
    // A publication named to collide with the preview partition still cannot
    // reach it: the published branch normalizes the dot away.
    const published = registry.resolve(
      descriptor({
        kind: "orgDevApp",
        storageScope: "orgDevApp",
        publicationId: `preview.${sourceId}`,
      }),
    );

    expect(preview).not.toBe(published);
  });

  it("separates different development sources", () => {
    const { registry } = makeRegistry();
    const first = registry.resolve(
      descriptor({
        kind: "devAppPreview",
        storageScope: "devAppPreview",
        devSourceId: "d".repeat(32),
      }),
    );
    const second = registry.resolve(
      descriptor({
        kind: "devAppPreview",
        storageScope: "devAppPreview",
        devSourceId: "e".repeat(32),
      }),
    );

    expect(first).not.toBe(second);
  });

  it("registers a protocol handler only for the surface kind that owns one", () => {
    const { registry, registerOrgDevAppProtocol, registerDevAppPreviewProtocol } = makeRegistry();

    registry.resolve(descriptor({ kind: "browser", storageScope: "global" }));
    expect(registerOrgDevAppProtocol).not.toHaveBeenCalled();
    expect(registerDevAppPreviewProtocol).not.toHaveBeenCalled();

    registry.resolve(
      descriptor({ kind: "orgDevApp", storageScope: "orgDevApp", publicationId: "pub_9" }),
    );
    expect(registerOrgDevAppProtocol).toHaveBeenCalledTimes(1);

    registry.resolve(
      descriptor({
        kind: "devAppPreview",
        storageScope: "devAppPreview",
        devSourceId: "f".repeat(32),
      }),
    );
    expect(registerDevAppPreviewProtocol).toHaveBeenCalledTimes(1);
  });

  it("configures a session once, however many surfaces resolve to it", () => {
    const { registry, registerOrgDevAppProtocol } = makeRegistry();
    const published = (tileId: string) =>
      descriptor({
        kind: "orgDevApp",
        storageScope: "orgDevApp",
        publicationId: "pub_once",
        tileId,
      });

    registry.resolve(published("t1"));
    registry.resolve(published("t2"));

    // Re-registering a protocol per surface would be a real bug, not just waste.
    expect(registerOrgDevAppProtocol).toHaveBeenCalledTimes(1);
  });

  it("strips Electron and Cozea from the user agent a site observes", () => {
    const { registry } = makeRegistry();
    const resolved = registry.resolve(
      descriptor({ kind: "browser", storageScope: "global" }),
    ) as unknown as FakeSession;

    expect(resolved.userAgent).not.toContain("Electron/");
    expect(resolved.userAgent).not.toContain("Cozea/");
  });

  it("denies permissions outside the allowlist and blocks downloads", () => {
    const { registry } = makeRegistry();
    const resolved = registry.resolve(
      descriptor({ kind: "browser", storageScope: "global" }),
    ) as unknown as FakeSession;

    const allowed = vi.fn();
    resolved.permissionRequestHandler?.(null, "clipboard-read", allowed);
    expect(allowed).toHaveBeenCalledWith(true);

    const denied = vi.fn();
    resolved.permissionRequestHandler?.(null, "geolocation", denied);
    expect(denied).toHaveBeenCalledWith(false);
    expect(resolved.permissionCheckHandler?.(null, "geolocation")).toBe(false);

    const download = { preventDefault: vi.fn() };
    resolved.downloadListener?.(download);
    expect(download.preventDefault).toHaveBeenCalled();
  });

  it("marks persistent scopes persistent and ephemeral scopes not", () => {
    const { registry } = makeRegistry();

    expect(registry.isPersistent(descriptor({ kind: "browser", storageScope: "global" }))).toBe(
      true,
    );
    expect(
      registry.isPersistent(
        descriptor({ kind: "browser", storageScope: "workspace", workspaceId: "ws_1" }),
      ),
    ).toBe(true);
    expect(registry.isPersistent(descriptor({ kind: "browser", storageScope: "ephemeral" }))).toBe(
      false,
    );
  });

  it("reconfigures a forgotten partition on the next resolve", () => {
    const { registry, registerOrgDevAppProtocol } = makeRegistry();
    const entry = descriptor({
      kind: "orgDevApp",
      storageScope: "orgDevApp",
      publicationId: "pub_forget",
    });

    registry.resolve(entry);
    expect(registry.hasPartition(registry.partitionFor(entry))).toBe(true);

    registry.forget(registry.partitionFor(entry));
    expect(registry.hasPartition(registry.partitionFor(entry))).toBe(false);

    registry.resolve(entry);
    expect(registerOrgDevAppProtocol).toHaveBeenCalledTimes(2);
  });
});
