import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { APP_LAYERS } from "@/lib/appLayers";
import {
  resolveDockviewBrowserSurfaceBorderRadius,
  resolveDockviewBrowserSurfaceLayer,
} from "@/features/projects/browser/useDockviewBrowserSurfaceLayer";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("application layer contract", () => {
  it("orders hosted guests, Dockview, and portaled UI deterministically", () => {
    expect(APP_LAYERS.browserDocked).toBeLessThan(APP_LAYERS.dockviewFloatBase);
    expect(APP_LAYERS.dockviewFloatBase).toBeLessThan(APP_LAYERS.dockviewDropTarget);
    expect(APP_LAYERS.dockviewDropTarget).toBeLessThan(APP_LAYERS.dialog);
    expect(APP_LAYERS.dialog).toBeLessThan(APP_LAYERS.menu);
    expect(APP_LAYERS.menu).toBeLessThan(APP_LAYERS.tooltip);
    expect(APP_LAYERS.tooltip).toBeLessThan(APP_LAYERS.toast);
  });

  it("keeps the CSS variables synchronized with the typed values", () => {
    const css = read("apps/desktop/src/index.css");
    const cssNames: Record<keyof typeof APP_LAYERS, string> = {
      browserDocked: "browser-docked",
      dockviewFloatBase: "dockview-float-base",
      dockviewDropTarget: "dockview-drop-target",
      dialog: "dialog",
      menu: "menu",
      tooltip: "tooltip",
      toast: "toast",
    };

    for (const [key, value] of Object.entries(APP_LAYERS) as Array<
      [keyof typeof APP_LAYERS, number]
    >) {
      expect(css).toContain(`--cozea-layer-${cssNames[key]}: ${value};`);
    }
  });

  it("routes shared overlay primitives through semantic layers", () => {
    const sharedSources = [
      "apps/desktop/src/components/ui/alert-dialog.tsx",
      "apps/desktop/src/components/ui/combobox.tsx",
      "apps/desktop/src/components/ui/dialog.tsx",
      "apps/desktop/src/components/ui/dropdown-menu.tsx",
      "apps/desktop/src/components/ui/select.tsx",
      "apps/desktop/src/components/ui/sheet.tsx",
      "apps/desktop/src/components/ui/tooltip.tsx",
      "apps/desktop/src/features/projects/components/assistant/ui/dialog.tsx",
      "apps/desktop/src/features/projects/components/assistant/ui/menu.tsx",
      "apps/desktop/src/features/projects/components/assistant/ui/popover.tsx",
      "apps/desktop/src/features/projects/components/assistant/ui/toast.tsx",
      "apps/desktop/src/features/projects/components/assistant/ui/tooltip.tsx",
    ].map(read);

    expect(sharedSources.join("\n")).not.toContain("z-50");
    expect(sharedSources.join("\n")).toContain("--cozea-layer-dialog");
    expect(sharedSources.join("\n")).toContain("--cozea-layer-menu");
    expect(sharedSources.join("\n")).toContain("--cozea-layer-tooltip");
    expect(sharedSources.join("\n")).toContain("--cozea-layer-toast");
  });

  it("mirrors Dockview floating order into hosted browser layers", () => {
    expect(resolveDockviewBrowserSurfaceLayer("grid", null)).toBe(APP_LAYERS.browserDocked);
    expect(resolveDockviewBrowserSurfaceLayer("edge", "4")).toBe(APP_LAYERS.browserDocked);
    expect(resolveDockviewBrowserSurfaceLayer("floating", null)).toBe(APP_LAYERS.dockviewFloatBase);
    expect(resolveDockviewBrowserSurfaceLayer("floating", "3")).toBe(
      APP_LAYERS.dockviewFloatBase + 6,
    );
  });

  it("clips hosted guests to the exposed Dockview card corners", () => {
    expect(resolveDockviewBrowserSurfaceBorderRadius("top")).toBe("0 0 12px 12px");
    expect(resolveDockviewBrowserSurfaceBorderRadius("bottom")).toBe("12px 12px 0 0");
    expect(resolveDockviewBrowserSurfaceBorderRadius("left")).toBe("0 12px 12px 0");
    expect(resolveDockviewBrowserSurfaceBorderRadius("right")).toBe("12px 0 0 12px");
  });

  it("removes the workbench stacking trap and publishes a layer from every browser slot", () => {
    const keepAlive = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchKeepAliveHost.tsx",
    );
    const activity = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchActivity.tsx",
    );
    const browserTiles = [
      "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
      "apps/desktop/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx",
      "apps/desktop/src/features/projects/components/workbench/WorkbenchOrgDevAppTile.tsx",
    ].map(read);

    expect(keepAlive).not.toContain("relative isolate");
    expect(activity).not.toContain("{ zIndex: 1 }");
    for (const tile of browserTiles) {
      expect(tile).toContain("useDockviewBrowserSurfacePresentation");
      expect(tile).toContain("borderRadius={surfacePresentation.borderRadius}");
      expect(tile).toContain("stackingLayer={surfacePresentation.stackingLayer}");
    }
  });

  it("keeps browser-owned overlays beside the living guest in the global host", () => {
    const host = read("apps/desktop/src/features/projects/browser/HostedBrowserWebview.tsx");
    const localTiles = [
      "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
      "apps/desktop/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx",
      "apps/desktop/src/features/projects/components/workbench/WorkbenchOrgDevAppTile.tsx",
    ].map(read);

    expect(host).toContain("<BrowserSurfaceOverlays runtimeTabId={runtimeTabId} />");
    expect(host).toContain("<BrowserFindOverlay runtimeTabId={runtimeTabId} />");
    expect(host).toContain("data-browser-surface-frame");
    for (const tile of localTiles) {
      expect(tile).not.toContain("BrowserSurfaceOverlays");
      expect(tile).not.toContain("BrowserFindOverlay");
    }
  });

  it("routes custom application overlays through the shared body portal", () => {
    const portal = read("apps/desktop/src/components/ui/app-overlay-portal.tsx");
    const tileChrome = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchTileChrome.tsx",
    );
    const workbench = read("apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx");
    const orgDevApp = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchOrgDevAppTile.tsx",
    );
    const chat = read(
      "apps/desktop/src/features/projects/components/assistant/chat/CozeaChatSurface.tsx",
    );
    const tasks = read("apps/desktop/src/features/projects/pages/TasksPage.tsx");

    expect(portal).toContain("createPortal(children, document.body)");
    expect(tileChrome).toContain("<AnchoredAppOverlayPortal");
    expect(tileChrome).not.toContain("z-[100]");
    expect(workbench).toContain("<Dialog");
    expect(workbench).not.toContain("absolute inset-0 z-30");
    expect(orgDevApp).toContain("<DialogContent");
    expect(orgDevApp).not.toContain("absolute inset-x-4 bottom-4 z-20");
    expect(chat).toContain("<AppOverlayPortal>");
    expect(chat).not.toContain("fixed inset-0 z-50");
    expect(tasks).toContain("<AppOverlayPortal>");
    expect(tasks).not.toContain("fixed inset-0 z-50");
  });

  it("uses the shared panel activity subscription for every browser-backed tile", () => {
    const browser = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
    );
    expect(browser).toContain("useWorkbenchPanelActivityMode(panelApi)");
    expect(browser).not.toContain("usePanelSurfaceVisibility");
  });
});
