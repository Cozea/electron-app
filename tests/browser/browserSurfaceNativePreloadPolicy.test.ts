import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserSurfaceDescriptor } from "../../shared/browserSurfaceTypes";

const optionsSeen: unknown[] = [];
let nextId = 900;

class FakeWebContentsView {
  private visible = false;
  webContents = {
    id: nextId++,
    isDestroyed: () => false,
    close: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn(),
    isFocused: () => false,
  };

  constructor(options: unknown) {
    optionsSeen.push(options);
  }

  setBounds() {}
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  getVisible() {
    return this.visible;
  }
  setBorderRadius() {}
}

vi.mock("electron", () => ({
  WebContentsView: FakeWebContentsView,
  session: { fromPartition: vi.fn(() => ({})) },
}));

const { BrowserSurfaceNativeHost } = await import(
  "../../apps/desktop/electron/services/browser/BrowserSurfaceNativeHost"
);

const descriptor: BrowserSurfaceDescriptor = {
  runtimeTabId: "rt_picker",
  tileId: "tile_picker",
  workbenchSessionKey: "session_1",
  kind: "browser",
  title: "Browser",
  initialUrl: null,
  storageScope: "ephemeral",
};

const makeWindow = () => ({
  isDestroyed: () => false,
  webContents: { on: vi.fn() },
  contentView: {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  },
});

beforeEach(() => {
  optionsSeen.length = 0;
  nextId = 900;
});

describe("native browser preload posture", () => {
  it("keeps a bare native surface isolated", async () => {
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => makeWindow() as never,
    });

    await host.ensureSurface(descriptor);

    const options = optionsSeen[0] as {
      webPreferences: { contextIsolation: boolean; sandbox: boolean; preload?: string };
    };
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.preload).toBeUndefined();
  });

  it("runs the current T3 annotation picker preload in the shared page world while sandboxed", async () => {
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => makeWindow() as never,
      resolvePreload: () => "/tmp/cozea-preview-picker-preload.js",
    });

    await host.ensureSurface({ ...descriptor, runtimeTabId: "rt_picker_preload" });

    const options = optionsSeen[0] as {
      webPreferences: { contextIsolation: boolean; sandbox: boolean; preload?: string };
    };
    expect(options.webPreferences.contextIsolation).toBe(false);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.preload).toBe("/tmp/cozea-preview-picker-preload.js");
  });

  it("allows a future non-picker preload to opt back into isolation explicitly", async () => {
    const host = new BrowserSurfaceNativeHost({
      sessions: { resolve: () => ({}) as never } as never,
      getWindow: () => makeWindow() as never,
      resolvePreload: () => "/tmp/keyboard-only-preload.js",
      resolvePreloadPosture: () => "isolated",
    });

    await host.ensureSurface({ ...descriptor, runtimeTabId: "rt_isolated_preload" });

    const options = optionsSeen[0] as {
      webPreferences: { contextIsolation: boolean; sandbox: boolean; preload?: string };
    };
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.sandbox).toBe(true);
  });
});
