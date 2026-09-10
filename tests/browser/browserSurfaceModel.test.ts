import { describe, expect, it, vi } from "vitest";

import {
  BrowserSurfaceModelRegistry,
  type NativeBrowserSurfaceBridge,
} from "../../apps/desktop/src/features/browser/browserSurfaceModel";
import type { BrowserSurfaceBounds } from "../../shared/browserSurfaceLayout";
import type { BrowserSurfaceDescriptor } from "../../shared/browserSurfaceTypes";

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

const makeHarness = () => {
  const calls: Array<() => void> = [];
  const bridge: NativeBrowserSurfaceBridge = {
    prepareSurface: vi.fn(async () => undefined),
    ensureNativeSurface: vi.fn(async () => undefined),
    closeSurface: vi.fn(async () => undefined),
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
      const index = (handle as unknown as number) - 1;
      if (index >= 0 && index < calls.length) calls.splice(index, 1);
    },
  });
  return { registry, bridge, runDeferred: () => calls.splice(0).forEach((call) => call()) };
};

describe("BrowserSurfaceModelRegistry", () => {
  it("prepares the descriptor before creating the native view", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    await model.ensure();

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

  it("creates the native surface exactly once for one initial renderer attach", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    await model.ensure();
    await model.ensure();

    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1);
  });

  it("does not race overlapping initial ensure calls", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    await Promise.all([model.ensure(), model.ensure(), model.ensure()]);

    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1);
  });

  it("lets a failed creation be retried", async () => {
    const { registry, bridge } = makeHarness();
    vi.mocked(bridge.ensureNativeSurface).mockRejectedValueOnce(new Error("no window"));
    const model = registry.acquire(descriptor(), Symbol("a"));

    await expect(model.ensure()).rejects.toThrow("no window");
    await model.ensure();

    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(2);
  });

  it("shares one model between simultaneous presentation owners", () => {
    const { registry } = makeHarness();
    const firstOwner = Symbol("a");
    const secondOwner = Symbol("b");

    const first = registry.acquire(descriptor(), firstOwner);
    const second = registry.acquire(descriptor(), secondOwner);

    expect(second).toBe(first);
    expect(first.ownerCount).toBe(2);
  });

  it("survives a real same-tick unmount/remount without hiding or closing runtime", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const firstOwner = Symbol("a");
    const secondOwner = Symbol("b");
    const before = registry.acquire(descriptor(), firstOwner);
    before.setVisible(true);
    await before.ensure();
    vi.mocked(bridge.setNativeSurfaceVisible).mockClear();

    registry.release("rt_1", firstOwner);
    const after = registry.acquire(descriptor(), secondOwner);
    runDeferred();

    expect(after).toBe(before);
    expect(bridge.setNativeSurfaceVisible).not.toHaveBeenCalledWith("rt_1", false);
    expect(bridge.closeSurface).not.toHaveBeenCalled();
  });

  it("hides and evicts only the renderer proxy after the last owner grace expires", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const owner = Symbol("a");
    const model = registry.acquire(descriptor(), owner);
    model.setVisible(true);
    await model.ensure();

    registry.release("rt_1", owner);
    expect(registry.size()).toBe(1);
    runDeferred();

    expect(bridge.setNativeSurfaceVisible).toHaveBeenLastCalledWith("rt_1", false);
    expect(bridge.closeSurface).not.toHaveBeenCalled();
    expect(registry.size()).toBe(0);
  });

  it("creates a fresh renderer proxy after route-length absence without closing main runtime", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const firstOwner = Symbol("a");
    const first = registry.acquire(descriptor(), firstOwner);
    await first.ensure();

    registry.release("rt_1", firstOwner);
    runDeferred();
    expect(registry.get("rt_1")).toBeUndefined();

    const second = registry.acquire(descriptor(), Symbol("b"));
    await second.ensure();

    expect(second).not.toBe(first);
    expect(bridge.closeSurface).not.toHaveBeenCalled();
    expect(bridge.prepareSurface).toHaveBeenCalledTimes(2);
    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(2);
  });

  it("reconciles main ownership when a hidden model becomes visible again", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));
    await model.ensure();
    vi.mocked(bridge.prepareSurface).mockClear();
    vi.mocked(bridge.ensureNativeSurface).mockClear();

    model.setVisible(true);
    await vi.waitFor(() => expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1));
    model.setVisible(true);
    await Promise.resolve();

    // Identical visible intent does not start another reconciliation. The one
    // reconciliation is what recreates a WCV if backgroundFrozen policy evicted
    // it; an already-warm WCV is returned idempotently by main.
    expect(bridge.prepareSurface).toHaveBeenCalledTimes(1);
    expect(bridge.ensureNativeSurface).toHaveBeenCalledTimes(1);
  });

  it("does not make existence mean visibility", () => {
    const { registry, bridge } = makeHarness();

    registry.acquire(descriptor(), Symbol("a"));

    expect(bridge.setNativeSurfaceVisible).not.toHaveBeenCalled();
  });

  it("sends false immediately when a ready visible surface is hidden", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));
    model.setVisible(true);
    await model.ensure();
    vi.mocked(bridge.setNativeSurfaceVisible).mockClear();

    model.setVisible(false);
    model.setVisible(false);

    expect(bridge.setNativeSurfaceVisible).toHaveBeenCalledTimes(1);
    expect(bridge.setNativeSurfaceVisible).toHaveBeenCalledWith("rt_1", false);
  });

  it("sends an occlusion change only when it actually changes", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));
    await model.ensure();

    model.setOccluded(true);
    model.setOccluded(true);

    expect(bridge.setNativeSurfaceOccluded).toHaveBeenCalledTimes(1);
  });

  it("applies only settled geometry stated while creation is in flight", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));
    const settled = bounds({ width: 900, height: 700 });

    const creating = model.ensure();
    model.layout(bounds({ width: 100, height: 100 }));
    model.layout(settled);
    model.setVisible(true);
    expect(bridge.layoutNativeSurface).not.toHaveBeenCalled();
    await creating;

    expect(bridge.layoutNativeSurface).toHaveBeenCalledTimes(1);
    expect(bridge.layoutNativeSurface).toHaveBeenCalledWith("rt_1", settled);
    expect(bridge.setNativeSurfaceVisible).toHaveBeenCalledWith("rt_1", true);
  });

  it("does not announce a surface as visible when it was never asked to be", async () => {
    const { registry, bridge } = makeHarness();
    const model = registry.acquire(descriptor(), Symbol("a"));

    await model.ensure();

    expect(bridge.setNativeSurfaceVisible).not.toHaveBeenCalled();
  });

  it("updates the descriptor in place rather than replacing the presentation model", () => {
    const { registry, bridge } = makeHarness();
    const owner = Symbol("a");
    const first = registry.acquire(descriptor(), owner);

    const renamed = { ...descriptor(), title: "Renamed" };
    const second = registry.acquire(renamed, owner);

    expect(second).toBe(first);
    expect(second.currentDescriptor.title).toBe("Renamed");
    expect(bridge.closeSurface).not.toHaveBeenCalled();
  });

  it("keeps separate surfaces independent with real owner identities", () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const ownerA = Symbol("a");
    const ownerB = Symbol("b");
    registry.acquire(descriptor("rt_a"), ownerA);
    registry.acquire(descriptor("rt_b"), ownerB);

    registry.release("rt_a", ownerA);
    runDeferred();

    expect(registry.get("rt_b")).toBeDefined();
    expect(bridge.closeSurface).not.toHaveBeenCalled();
  });

  it("explicit close ends runtime lifetime even after the presentation proxy was evicted", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    const owner = Symbol("a");
    registry.acquire(descriptor(), owner);
    registry.release("rt_1", owner);
    runDeferred();

    await registry.close("rt_1");

    expect(bridge.closeSurface).toHaveBeenCalledWith("rt_1");
  });

  it("does not let a close racing preparation resurrect a native surface", async () => {
    const { registry, bridge } = makeHarness();
    let resolvePrepare!: () => void;
    vi.mocked(bridge.prepareSurface).mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolvePrepare = resolve)),
    );
    const model = registry.acquire(descriptor(), Symbol("a"));

    const creating = model.ensure();
    await model.close();
    resolvePrepare();
    await creating;

    expect(bridge.ensureNativeSurface).not.toHaveBeenCalled();
    expect(bridge.closeSurface).toHaveBeenCalled();
    expect(model.isClosed).toBe(true);
  });

  it("keeps an in-flight model reachable so registry close can cancel late resurrection", async () => {
    const { registry, bridge, runDeferred } = makeHarness();
    let resolvePrepare!: () => void;
    vi.mocked(bridge.prepareSurface).mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolvePrepare = resolve)),
    );
    const owner = Symbol("a");
    const model = registry.acquire(descriptor(), owner);
    const creating = model.ensure();

    registry.release("rt_1", owner);
    runDeferred();
    expect(registry.get("rt_1")).toBe(model);

    const closing = registry.close("rt_1");
    resolvePrepare();
    await Promise.all([creating, closing]);

    expect(bridge.ensureNativeSurface).not.toHaveBeenCalled();
    expect(bridge.closeSurface).toHaveBeenCalled();
    expect(model.isClosed).toBe(true);
  });

  it("closes again after a native ensure that wins a race with explicit close", async () => {
    const { registry, bridge } = makeHarness();
    let resolveEnsure!: () => void;
    vi.mocked(bridge.ensureNativeSurface).mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveEnsure = resolve)),
    );
    const model = registry.acquire(descriptor(), Symbol("a"));

    const creating = model.ensure();
    await Promise.resolve();
    const closing = model.close();
    resolveEnsure();
    await Promise.all([creating, closing]);

    expect(bridge.closeSurface).toHaveBeenCalled();
    expect(model.isClosed).toBe(true);
  });

  it("publishes native order in canonical back-to-front order", () => {
    const { registry, bridge } = makeHarness();

    registry.setOrder(["rt_b", "rt_a"]);

    expect(bridge.setNativeSurfaceOrder).toHaveBeenCalledWith(["rt_b", "rt_a"]);
  });

  it("explicit destroyAll closes all runtimes", async () => {
    const { registry, bridge } = makeHarness();
    registry.acquire(descriptor("rt_a"), Symbol("a"));
    registry.acquire(descriptor("rt_b"), Symbol("b"));

    await registry.destroyAll();

    expect(bridge.closeSurface).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(0);
  });
});
