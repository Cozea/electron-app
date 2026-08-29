import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkbenchBrowserViewState } from "@shared/electronApiTypes";
import type { BrowserCreateOptions } from "@shared/browserHostTypes";
import { BrowserTileModel } from "@/features/projects/browser/browserTileModel";
import {
  getDockComponentName,
  getPanelConstraintsForTile,
  getPanelRendererForTile,
  resolveTabGroupPreset,
} from "@/features/projects/lib/workbenchDockview";

const DEVAPP_URL = `cozea-devapp://${"a".repeat(64)}.release/index.html`;

function createBrowserState(tileId: string): WorkbenchBrowserViewState {
  return {
    tileId,
    url: DEVAPP_URL,
    title: "Org DevApp",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    focused: false,
    visible: false,
    isDevToolsOpen: false,
    storageScope: "orgDevApp",
    zoomFactor: 1,
    canZoomIn: true,
    canZoomOut: true,
    find: {
      query: "",
      visible: false,
      matchCase: false,
      activeMatchOrdinal: 0,
      matches: 0,
      finalUpdate: false,
    },
    loadError: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Org DevApp #114 port completeness", () => {
  it("maps Org DevApps to their dedicated always-mounted dock component", () => {
    expect(getDockComponentName("orgDevApp")).toBe("orgDevApp");
    expect(getPanelRendererForTile("orgDevApp")).toBe("always");
    expect(getPanelConstraintsForTile("orgDevApp")).toEqual({
      minimumWidth: 320,
      minimumHeight: 220,
    });
    expect(resolveTabGroupPreset("orgDevApp")).toEqual({
      label: "Preview",
      color: "preview",
    });
  });

  it("keeps an assistant mounted while a background Dev Server tab is active", () => {
    expect(getPanelRendererForTile("assistantChat")).toBe("always");
  });

  it("forwards the isolated partition and navigation policy to Electron", async () => {
    const ensureTile = vi.fn(async () => createBrowserState("org-devapp-tile"));
    const destroyTile = vi.fn(async () => undefined);
    const setBounds = vi.fn(async () => true);
    const onStateChange = vi.fn(() => () => undefined);

    vi.stubGlobal("window", {
      electronAPI: {
        workbenchBrowser: {
          ensureTile,
          destroyTile,
          setBounds,
          onStateChange,
        },
      },
    });

    const model = new BrowserTileModel("org-devapp-tile");
    const options: BrowserCreateOptions = {
      initialUrl: DEVAPP_URL,
      storageScope: "orgDevApp",
      workspaceId: "publication-1",
      partitionKey: "publication-1",
      navigationPolicy: "orgDevApp",
    };

    await model.initialize(options);

    expect(ensureTile).toHaveBeenCalledWith({
      tileId: "org-devapp-tile",
      ...options,
    });

    const hiddenModel = new BrowserTileModel("hidden-org-devapp-tile");
    await hiddenModel.setVisible(false, options);
    expect(ensureTile).toHaveBeenCalledWith({
      tileId: "hidden-org-devapp-tile",
      ...options,
    });
    expect(setBounds).toHaveBeenCalledWith({
      tileId: "hidden-org-devapp-tile",
      visible: false,
    });

    await model.dispose();
    await hiddenModel.dispose();
    expect(destroyTile).toHaveBeenCalledWith({ tileId: "org-devapp-tile" });
  });
});
