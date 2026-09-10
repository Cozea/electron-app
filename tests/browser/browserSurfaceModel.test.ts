import { describe, expect, it, vi } from "vitest";

import {
  BrowserSurfaceModelRegistry,
  type NativeBrowserSurfaceBridge,
} from "../../apps/desktop/src/features/browser/browserSurfaceModel";
import type { BrowserSurfaceBounds } from "../../shared/browserSurfaceLayout";
import type { BrowserSurfaceDescriptor } from "../../shared/browserSurfaceTypes";

/**
 * The model is what makes a browser survive React. A Dockview move unmounts the
 * old subtree before mounting the new one, so a registry that destroyed on
 * unmount would tear down Chromium every time a tile changed groups.
 */

const descriptor = (runtimeTabId = "rt_1"): BrowserSurfaceDescriptor => ({
  runtimeTabId,
  tileId: `tile_${runtimeTabId}`,
  workbenchSessionKey: "session_1",
  kind: "browser",
  title: "Browser",
  initialUrl: null,
  storageScope: "ephemeral",
});

const bounds = (overrides: Partial<BrowserSurfaceBounds> = {}): BrowserSurfaceBounds => ({
  windowId: 0,
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  cornerRadius: 0,
  nativeOrder: 0,
  ...overrides,
});

/** Deferred release runs only when the test says so. */
const makeHarness = () => {
  const calls: Array<() => void> = [];
  const bridge: NativeBrowserSurfaceBridge = {
    prepareSurface: vi.fn(async () => undefined),
    ensureNativeSurface: vi.fn(async () => undefined),
    releaseNativeSurface: vi.fn(async () => undefined),
    layoutNativeSurface: vi.fn(async () => undefined),
    setNativeSurfaceVisible: vi.fn(async () => undefined),
    setNativeSurfaceOccluded: vi.fn(async () => undefined),
    setNativeSurfaceOrder: vi.fn(async () => undefined),
    focusNativeSurface: vi.fn(async () => undefined),
  };
  const registry = new BrowserSurfaceModelRegistry(bridge, {
    defer: (callback) => {
      calls.push(callback);
      return calls.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle) => {
      calls.splice((handle as unknown as number) - 1, 1);
    },
  });
  return { registry, bridge, runDeferred: () => calls.splice(0).forEach((call) => call()) };
};

describe("BrowserSurfaceModelRegistry", () => {
  it("prepares the descriptor before creating the native view", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    await model.ensure();

    // Preparation carries descriptor validation and session resolution; a view
    // created without it would have no prepared surface to attach to.
    expect(bridge.prepareSurface).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeTabId: "rt_1" }),
    );
    const prepareOrder = vi.mocked(bridge.prepareSurface).mock.invocationCallOrder[0]!;
    const ensureOrder = vi.mocked(bridge.ensureNativeSurface).mock.invocationCallOrder[0]!;
    expect(prepareOrder).toBeLessThan(ensureOrder);
  });

  it("does not create a native view when preparation is refused", async () => {
    const { registry, bridge } = makeHarness();
    vi.mocked(bridge.prepareSurface).mockRejectedValueOnce(new Error("invalid descriptor"));
    const model = registry.acquire(descriptor(), Symbol("a"));

    await expect(model.ensure()).rejects.toThrow("invalid descriptor");

    expect(bridge.ensureNativeSurface).not.toHaveBeenCalled();
  });

  it("creates the native surface exactly once for one runtime tab", async () => {
    const { registry, bridge } = makeHarness();
    const owner = Symbol("a");

    const model = registry.acquire(descriptor(), owner);
    await model.ensure();
    await model.ensure();

    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1);
  });

  it("does not race two creations when mount calls overlap", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    await Promise.all([model.ensure(), model.ensure(), model.ensure()]);

    // The promise is cached, not the result, so concurrent callers await one
    // creation rather than each starting their own.
    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1);
  });

  it("lets a failed creation be retried", async () => {
    const { registry, bridge } = makeHarness();
    vi.mocked(bridge.ensureNativeSurface).mockRejectedValueOnce(new Error("no window"));
    const model = registry.acquire(descriptor(), Symbol("a"));

    await expect(model.ensure()).rejects.toThrow("no window");
    await model.ensure();

    // A rejected promise must not be cached forever.
    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(2);
  });

  it("shares one model between owners of the same surface", () => {
    const { registry } = makeHarness();

    const first = registry.acquire(descriptor(), Symbol("a"));
    const second = registry.acquire(descriptor(), Symbol("b"));

    expect(second).toBe(first);
    expect(first.ownerCount).toBe(2);
  });

  it("keeps the browser alive while another owner still holds it", () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const first = Symbol("a");
    const second = Symbol("b");
    registry.acquire(descriptor(), first);
    registry.acquire(descriptor(), second);

    registry.release("rt_1", first);
    runDeferred();

    expect(bridge.releaseNativeSurface).not.toHaveBeenCalled();
    expect(registry.size()).toBe(1);
  });

  it("survives an unmount and remount in the same tick", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const before = registry.acquire(descriptor(), Symbol("a"));
    await before.ensure();

    // Exactly what a Dockview move looks like: release then acquire before the
    // deferred destroy can run.
    registry.release("rt_1", Symbol("a"));
    const after = registry.acquire(descriptor(), Symbol("b"));
    runDeferred();

    expect(after).toBe(before);
    expect(bridge.releaseNativeSurface).not.toHaveBeenCalled();
    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1);
  });

  it("destroys the surface once the last owner is really gone", () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const owner = Symbol("a");
    registry.acquire(descriptor(), owner);

    registry.release("rt_1", owner);
    expect(bridge.releaseNativeSurface).not.toHaveBeenCalled();

    runDeferred();

    expect(bridge.releaseNativeSurface).toHaveBeenCalledWith("rt_1");
    expect(registry.size()).toBe(0);
  });

  it("does not make existence mean visibility", () => {
    const { registry, bridge } = makeHarness();

    registry.acquire(descriptor(), Symbol("a"));

    // A model can exist for a tile sitting on a hidden Dockview tab.
    expect(bridge.setNativeSurfaceVisible).not.toHaveBeenCalled();
  });

  it("sends a visibility change only when it actually changes", () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    model.setVisible(true);
    model.setVisible(true);
    model.setVisible(false);

    expect(bridge.setNativeSurfaceVisible).toHaveBeenCalledTimes(2);
  });

  it("sends an occlusion change only when it actually changes", () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    model.setOccluded(true);
    model.setOccluded(true);

    expect(bridge.setNativeSurfaceOccluded).toHaveBeenCalledTimes(1);
  });

  it("stops talking to main once released", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const owner = Symbol("a");
    const model = registry.acquire(descriptor(), owner);
    registry.release("rt_1", owner);
    runDeferred();

    model.layout(bounds());
    model.setVisible(true);
    model.focus();
    await model.ensure();

    // A late callback from a torn-down tile must not resurrect or move a
    // surface that no longer exists.
    expect(bridge.layoutNativeSurface).not.toHaveBeenCalled();
    expect(bridge.setNativeSurfaceVisible).not.toHaveBeenCalled();
    expect(bridge.focusNativeSurface).not.toHaveBeenCalled();
    expect(bridge.ensureNativeSurface).not.toHaveBeenCalled();
  });

  it("updates the descriptor in place rather than replacing the browser", () => {
    const { registry, bridge } = makeHarness();
    const owner = Symbol("a");
    const first = registry.acquire(descriptor(), owner);

    const renamed = { ...descriptor(), title: "Renamed" };
    const second = registry.acquire(renamed, owner);

    // A title change is not a reason to destroy a page.
    expect(second).toBe(first);
    expect(second.currentDescriptor.title).toBe("Renamed");
    expect(bridge.releaseNativeSurface).not.toHaveBeenCalled();
  });

  it("keeps separate surfaces independent", () => {
    const { registry, bridge, runDeferred } = makeHarness();
    registry.acquire(descriptor("rt_a"), Symbol("a"));
    registry.acquire(descriptor("rt_b"), Symbol("b"));

    registry.release("rt_a", Symbol("a"));
    runDeferred();

    expect(registry.get("rt_b")).toBeDefined();
    expect(bridge.releaseNativeSurface).not.toHaveBeenCalledWith("rt_b");
  });

  it("publishes native order for overlapping surfaces", () => {
    const { registry, bridge } = makeHarness();

    registry.setOrder(["rt_b", "rt_a"]);

    expect(bridge.setNativeSurfaceOrder).toHaveBeenCalledWith(["rt_b", "rt_a"]);
  });

  it("tears everything down on shutdown", async () => {
    const { registry, bridge } = makeHarness();
    registry.acquire(descriptor("rt_a"), Symbol("a"));
    registry.acquire(descriptor("rt_b"), Symbol("b"));

    await registry.destroyAll();

    expect(bridge.releaseNativeSurface).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(0);
  });
});
