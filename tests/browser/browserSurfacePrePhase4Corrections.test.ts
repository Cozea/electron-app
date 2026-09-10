import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserSurfaceDescriptor } from "../../shared/browserSurfaceTypes";

const created: FakeView[] = [];
let nextWebContentsId = 500;

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
  setBounds: ReturnType<typeof vi.fn>;
  getBounds: () => FakeView["bounds"];
  setVisible: ReturnType<typeof vi.fn>;
  getVisible: () => boolean;
  setBorderRadius: ReturnType<typeof vi.fn>;
}

class FakeWebContentsView {
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  visible = true;
  borderRadius = 0;
  webContents: FakeView["webContents"];
  setBounds = vi.fn((bounds: FakeView["bounds"]) => {
    this.bounds = bounds;
  });
  setVisible = vi.fn((visible: boolean) => {
    this.visible = visible;
  });
  setBorderRadius = vi.fn((radius: number) => {
    this.borderRadius = radius;
  });

  constructor(_options: unknown) {
    let destroyed = false;
    const id = nextWebContentsId++;
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

  getBounds() {
    return this.bounds;
  }

  getVisible() {
    return this.visible;
  }
}

vi.mock("electron", () => ({
  WebContentsView: FakeWebContentsView,
  session: { fromPartition: vi.fn(() => ({})) },
}));

const { BrowserSurfaceView } = await import(
  "../../apps/desktop/electron/services/browser/BrowserSurfaceView"
);
const { BrowserSurfaceNativeHost } = await import(
  "../../apps/desktop/electron/services/browser/BrowserSurfaceNativeHost"
);

const descriptor = (runtimeTabId = "rt_1"): BrowserSurfaceDescriptor => ({
  runtimeTabId,
  tileId: `tile_${runtimeTabId}`,
  workbenchSessionKey: "session_1",
  kind: "browser",
  title: "Browser",
  initialUrl: null,
  storageScope: "ephemeral",
});

const makeWindow = () => {
  const children: unknown[] = [];
  const rendererListeners = new Map<string, (...args: never[]) => void>();
  return {
    isDestroyed: () => false,
    webContents: {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        rendererListeners.set(event, listener);
      }),
      emit: (event: string, ...args: unknown[]) =>
        rendererListeners.get(event)?.(...(args as never[])),
    },
    contentView: {
      children,
      addChildView: vi.fn((view: unknown) => {
        const index = children.indexOf(view);
        if (index !== -1) children.splice(index, 1);
        children.push(view);
      }),
      removeChildView: vi.fn((view: unknown) => {
        const index = children.indexOf(view);
        if (index !== -1) children.splice(index, 1);
      }),
    },
  };
};

beforeEach(() => {
  created.length = 0;
  nextWebContentsId = 500;
});

describe("pre-Phase-4 native browser corrections", () => {
  it("applies a radius-only presentation change without touching bounds again", () => {
    const window = makeWindow();
    const surface = new BrowserSurfaceView({
      runtimeTabId: "rt_1",
      descriptor: descriptor(),
      session: {} as never,
      window: window as never,
    });
    const native = created[0]!;

    surface.layout({ x: 10, y: 20, width: 800, height: 600 }, 0);
    const boundsCalls = native.setBounds.mock.calls.length;
    const radiusCalls = native.setBorderRadius.mock.calls.length;

    surface.layout({ x: 10, y: 20, width: 800, height: 600 }, 12);

    expect(native.setBounds).toHaveBeenCalledTimes(boundsCalls);
    expect(native.setBorderRadius).toHaveBeenCalledTimes(radiusCalls + 1);
    expect(native.borderRadius).toBe(12);
  });

  it("revokes automation trust before the WebContents closes", async () => {
    const window = makeWindow();
    const order: string[] = [];
    const detach = vi.fn(async () => {
      order.push("detach");
    });
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => window as never,
      automation: {
        attach: vi.fn(async () => undefined),
        detach,
      },
    });

    const surface = await host.ensureSurface(descriptor());
    const native = created[0]!;
    native.webContents.close.mockImplementation(() => {
      order.push("close");
    });

    await host.releaseSurface(surface.runtimeTabId);

    expect(order).toEqual(["detach", "close"]);
  });

  it("best-effort revokes trust when automation registration fails", async () => {
    const window = makeWindow();
    const detach = vi.fn(async () => undefined);
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => window as never,
      automation: {
        attach: vi.fn(async () => {
          throw new Error("registration failed");
        }),
        detach,
      },
    });

    await expect(host.ensureSurface(descriptor())).rejects.toThrow("registration failed");

    expect(detach).toHaveBeenCalledWith(500);
    expect(created[0]!.webContents.close).toHaveBeenCalledTimes(1);
  });

  it("suppresses a repeated canonical native order", async () => {
    const window = makeWindow();
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => window as never,
    });
    await host.ensureSurface(descriptor("rt_a"));
    await host.ensureSurface(descriptor("rt_b"));
    const initialAdds = window.contentView.addChildView.mock.calls.length;

    host.setSurfaceOrder(["rt_a", "rt_b"]);
    const afterFirst = window.contentView.addChildView.mock.calls.length;
    host.setSurfaceOrder(["rt_a", "rt_b"]);

    expect(afterFirst).toBe(initialAdds + 2);
    expect(window.contentView.addChildView).toHaveBeenCalledTimes(afterFirst);
    expect(window.contentView.children.at(-1)).toBe(host.get("rt_b")?.view);
  });

  it("delegates a full renderer replacement to the logical lifecycle owner", async () => {
    const window = makeWindow();
    let resolveInvalidation!: () => void;
    const onRendererInvalidated = vi.fn(
      () => new Promise<void>((resolve) => (resolveInvalidation = resolve)),
    );
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => window as never,
      onRendererInvalidated,
    });
    await host.ensureSurface(descriptor());

    window.webContents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
    });
    window.webContents.emit("render-process-gone");

    expect(onRendererInvalidated).toHaveBeenCalledTimes(1);
    // The host must not privately discard the native child while the service is
    // still closing its T3/descriptor state.
    expect(host.has("rt_1")).toBe(true);

    resolveInvalidation();
    await Promise.resolve();
  });
});
