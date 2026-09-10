import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserSurfaceDescriptor } from "../../shared/browserSurfaceTypes";

/**
 * The defining invariant of the migration: a surface can be laid out, hidden,
 * shown, moved and destroyed while one main-owned browser persists, and no
 * renderer `<webview>` is involved at any point.
 */

const created: FakeView[] = [];

interface FakeView {
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  borderRadius: number;
  webContents: {
    id: number;
    isDestroyed: () => boolean;
    close: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
  };
  setBounds: (bounds: FakeView["bounds"]) => void;
  getBounds: () => FakeView["bounds"];
  setVisible: (visible: boolean) => void;
  getVisible: () => boolean;
  setBorderRadius: (radius: number) => void;
  options: unknown;
}

let nextWebContentsId = 100;

class FakeWebContentsView {
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  visible = true;
  borderRadius = 0;
  webContents: FakeView["webContents"];
  options: unknown;

  constructor(options: unknown) {
    this.options = options;
    const id = nextWebContentsId++;
    // Per-instance, so disposing one surface cannot make every other surface
    // look destroyed and hide a real per-view leak.
    let destroyed = false;
    this.webContents = {
      id,
      isDestroyed: () => destroyed,
      close: vi.fn(() => {
        destroyed = true;
      }),
      focus: vi.fn(),
      loadURL: vi.fn(async () => undefined),
    };
    created.push(this as unknown as FakeView);
  }
  setBounds(bounds: FakeView["bounds"]) {
    this.bounds = bounds;
  }
  getBounds() {
    return this.bounds;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  getVisible() {
    return this.visible;
  }
  setBorderRadius(radius: number) {
    this.borderRadius = radius;
  }
}

vi.mock("electron", () => ({
  WebContentsView: FakeWebContentsView,
  session: { fromPartition: vi.fn(() => ({}) as never) },
}));

const { BrowserSurfaceView } = await import(
  "../../apps/desktop/electron/services/browser/BrowserSurfaceView"
);
const { BrowserSurfaceNativeHost } = await import(
  "../../apps/desktop/electron/services/browser/BrowserSurfaceNativeHost"
);

const makeWindow = () => {
  const children: unknown[] = [];
  // The host watches the window's own renderer, so the fake window has to be
  // able to report that its document went away.
  const rendererListeners = new Map<string, (...args: never[]) => void>();
  return {
    isDestroyed: () => false,
    webContents: {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        rendererListeners.set(event, listener);
      }),
      emit: (event: string, ...args: unknown[]) =>
        rendererListeners.get(event)?.(...(args as never[])),
      listenerCount: (event: string) => (rendererListeners.has(event) ? 1 : 0),
    },
    contentView: {
      children,
      addChildView: vi.fn((view: unknown) => {
        const at = children.indexOf(view);
        if (at !== -1) children.splice(at, 1);
        children.push(view);
      }),
      removeChildView: vi.fn((view: unknown) => {
        const at = children.indexOf(view);
        if (at !== -1) children.splice(at, 1);
      }),
    },
  };
};

const descriptor = (runtimeTabId = "rt_1"): BrowserSurfaceDescriptor => ({
  runtimeTabId,
  tileId: `tile_${runtimeTabId}`,
  workbenchSessionKey: "session_1",
  kind: "browser",
  title: "Browser",
  initialUrl: null,
  storageScope: "ephemeral",
});

const makeView = (window = makeWindow()) =>
  new BrowserSurfaceView({
    runtimeTabId: "rt_1",
    descriptor: descriptor(),
    session: {} as never,
    window: window as never,
  });

beforeEach(() => {
  created.length = 0;
  nextWebContentsId = 100;
});

describe("BrowserSurfaceView lifecycle", () => {
  it("starts on a real rectangle but invisible", () => {
    const view = makeView();
    const native = created[0]!;

    // A view that first lays out at 0x0 can end up without a compositor
    // surface, so the initial rectangle is non-zero and simply not drawn.
    expect(native.bounds).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    expect(view.isVisible).toBe(false);
    expect(view.isLaidOut).toBe(false);
  });

  it("refuses to draw before real bounds arrive", () => {
    const view = makeView();

    view.setVisible(true);

    // Otherwise the surface would flash the placeholder rectangle.
    expect(view.isVisible).toBe(false);
  });

  it("runs create -> hidden -> layout -> visible -> navigate -> hide -> show -> destroy", async () => {
    const view = makeView();
    const native = created[0]!;
    expect(view.isVisible).toBe(false);

    view.layout({ x: 10, y: 20, width: 800, height: 600 }, 8);
    expect(view.isLaidOut).toBe(true);
    expect(view.isVisible).toBe(false);

    view.setVisible(true);
    expect(view.isVisible).toBe(true);
    expect(native.bounds).toEqual({ x: 10, y: 20, width: 800, height: 600 });
    expect(native.borderRadius).toBe(8);

    await view.loadUrl("https://example.com");
    expect(native.webContents.loadURL).toHaveBeenCalledWith("https://example.com");

    view.setVisible(false);
    expect(view.isVisible).toBe(false);

    view.setVisible(true);
    expect(view.isVisible).toBe(true);
    // One browser throughout: hiding is not destroying (INV-004).
    expect(created).toHaveLength(1);

    view.dispose();
    expect(view.isDisposed).toBe(true);
    expect(native.webContents.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the same WebContents across a hide and show cycle", () => {
    const view = makeView();
    view.layout({ x: 0, y: 0, width: 400, height: 300 });
    const before = view.webContentsId;

    view.setVisible(true);
    view.setVisible(false);
    view.setVisible(true);

    expect(view.webContentsId).toBe(before);
    expect(created).toHaveLength(1);
  });

  it("drops a repeated rectangle before it reaches the compositor", () => {
    const view = makeView();
    const native = created[0]!;
    const setBounds = vi.spyOn(native, "setBounds");

    view.layout({ x: 1, y: 2, width: 300, height: 200 });
    view.layout({ x: 1, y: 2, width: 300, height: 200 });
    view.layout({ x: 1, y: 2, width: 300, height: 201 });

    expect(setBounds).toHaveBeenCalledTimes(2);
  });

  it("hides rather than letting an overlay be painted over", () => {
    const view = makeView();
    view.layout({ x: 0, y: 0, width: 400, height: 300 });
    view.setVisible(true);

    view.setOccluded(true);
    // A native view cannot sit under DOM, so it must leave the screen.
    expect(view.isVisible).toBe(false);

    view.setOccluded(false);
    expect(view.isVisible).toBe(true);
  });

  it("stays hidden when an overlay clears while the surface is unwanted", () => {
    const view = makeView();
    view.layout({ x: 0, y: 0, width: 400, height: 300 });
    view.setVisible(false);

    view.setOccluded(true);
    view.setOccluded(false);

    expect(view.isVisible).toBe(false);
  });

  it("ignores operations after disposal instead of throwing", () => {
    const view = makeView();
    view.layout({ x: 0, y: 0, width: 400, height: 300 });
    view.dispose();

    view.setVisible(true);
    view.layout({ x: 5, y: 5, width: 100, height: 100 });
    view.dispose();

    expect(view.isVisible).toBe(false);
    expect(created[0]!.webContents.close).toHaveBeenCalledTimes(1);
  });

  it("reparents to another window without recreating the browser", () => {
    const first = makeWindow();
    const second = makeWindow();
    const view = makeView(first);

    view.moveToWindow(second as never);

    expect(first.contentView.removeChildView).toHaveBeenCalled();
    expect(second.contentView.addChildView).toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });
});

describe("BrowserSurfaceNativeHost", () => {
  const makeHost = (window = makeWindow(), automation?: unknown) =>
    new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => window as never,
      automation: (automation ?? null) as never,
    });

  it("returns the existing surface rather than a second browser", async () => {
    const host = makeHost();

    const first = await host.ensureSurface(descriptor());
    const second = await host.ensureSurface(descriptor());

    // INV-003: one live native browser per runtimeTabId.
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("registers the exact contents it created with automation", async () => {
    const attach = vi.fn(async () => undefined);
    const host = makeHost(makeWindow(), { attach, detach: vi.fn(async () => undefined) });

    const view = await host.ensureSurface(descriptor());

    // INV-006: automation must reach the contents the user sees.
    expect(attach).toHaveBeenCalledWith("rt_1", view.webContentsId);
  });

  it("leaves no half-registered surface when automation refuses it", async () => {
    const host = makeHost(makeWindow(), {
      attach: vi.fn(async () => {
        throw new Error("registration refused");
      }),
      detach: vi.fn(async () => undefined),
    });

    await expect(host.ensureSurface(descriptor())).rejects.toThrow("registration refused");

    expect(host.has("rt_1")).toBe(false);
    expect(created[0]!.webContents.close).toHaveBeenCalled();
  });

  it("withdraws the automation vouch when a surface is released", async () => {
    const detach = vi.fn(async () => undefined);
    const host = makeHost(makeWindow(), { attach: vi.fn(async () => undefined), detach });

    const view = await host.ensureSurface(descriptor());
    const webContentsId = view.webContentsId;
    await host.releaseSurface("rt_1");

    // Chromium recycles ids, so a lingering vouch would trust the next view.
    expect(detach).toHaveBeenCalledWith(webContentsId);
    expect(host.has("rt_1")).toBe(false);
  });

  it("fails loudly rather than creating a surface with no window", async () => {
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => null,
    });

    await expect(host.ensureSurface(descriptor())).rejects.toThrow(/live window/);
  });

  it("orders overlapping surfaces by re-adding them back to front", async () => {
    const window = makeWindow();
    const host = makeHost(window);
    await host.ensureSurface(descriptor("rt_a"));
    await host.ensureSurface(descriptor("rt_b"));

    host.setSurfaceOrder(["rt_b", "rt_a"]);

    // Last added is topmost, so the array tail is the front-most surface.
    const children = window.contentView.children;
    expect(children).toHaveLength(2);
    expect(children.at(-1)).toBe(host.get("rt_a")?.view);
  });

  it("releases every surface on shutdown", async () => {
    const host = makeHost();
    await host.ensureSurface(descriptor("rt_a"));
    await host.ensureSurface(descriptor("rt_b"));

    await host.releaseAll();

    expect(host.list()).toHaveLength(0);
  });
});

describe("BrowserSurfaceNativeHost renderer lifecycle", () => {
  const makeHost = (window: ReturnType<typeof makeWindow>) =>
    new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => window as never,
    });

  it("drops surfaces when the renderer document is replaced", async () => {
    const window = makeWindow();
    const host = makeHost(window);
    const view = await host.ensureSurface(descriptor());

    // A reloaded renderer mints new runtimeTabIds, so it can never name these
    // surfaces again: left alone they keep painting over the workbench and no
    // tile can close them.
    window.webContents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
    });
    await Promise.resolve();

    expect(host.has("rt_1")).toBe(false);
    expect(view.isDisposed).toBe(true);
    expect(window.contentView.children).toHaveLength(0);
  });

  it("keeps surfaces across a same-document navigation", async () => {
    const window = makeWindow();
    const host = makeHost(window);
    await host.ensureSurface(descriptor());

    // pushState and fragment navigation keep renderer memory, so the tiles
    // still own their surfaces.
    window.webContents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: true,
    });
    await Promise.resolve();

    expect(host.has("rt_1")).toBe(true);
  });

  it("keeps surfaces when a subframe navigates", async () => {
    const window = makeWindow();
    const host = makeHost(window);
    await host.ensureSurface(descriptor());

    window.webContents.emit("did-start-navigation", {
      isMainFrame: false,
      isSameDocument: false,
    });
    await Promise.resolve();

    expect(host.has("rt_1")).toBe(true);
  });

  it("drops surfaces when the renderer crashes", async () => {
    const window = makeWindow();
    const host = makeHost(window);
    await host.ensureSurface(descriptor());

    // A crashed renderer never gets to announce anything, so waiting to be told
    // would leak every surface it owned.
    window.webContents.emit("render-process-gone");
    await Promise.resolve();

    expect(host.has("rt_1")).toBe(false);
  });

  it("watches the renderer once, not once per surface", async () => {
    const window = makeWindow();
    const host = makeHost(window);
    await host.ensureSurface(descriptor("rt_1"));
    await host.ensureSurface(descriptor("rt_2"));
    await host.ensureSurface(descriptor("rt_3"));

    expect(window.webContents.listenerCount("did-start-navigation")).toBe(1);
  });
});
