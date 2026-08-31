import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { T3_BROWSER_PORT_PARITY_LEDGER } from "@shared/browserPortParityLedger";

const root = process.cwd();
const sourceRoots = ["apps/desktop/electron", "apps/desktop/src", "shared", "scripts"];
const sourceExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set(["dist", "node_modules", "out"]);

const forbiddenLegacyTokens = [
  "WebContentsView",
  "WorkbenchBrowserService",
  "workbenchBrowser:",
  "electronAPI.workbenchBrowser",
  "BrowserTileModel",
  "useWorkbenchBrowserView",
  "data-workbench-browser-overlay",
  "BrowserUnavailableSurface",
  "placeholderScreenshot",
  "overlayPaused",
  "cozea:dock-layout-change",
  "legacyBrowserFallback",
  "browserHostFallback",
  "nativeSurfaceOcclusion",
  "data-native-surface",
  "cozea:split-control",
] as const;

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : listSourceFiles(entryPath);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("legacy browser removal boundary", () => {
  it("keeps forbidden native-host symbols out of first-party application code", () => {
    const violations = sourceRoots.flatMap((sourceRoot) =>
      listSourceFiles(path.join(root, sourceRoot)).flatMap((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        return forbiddenLegacyTokens
          .filter((token) => source.includes(token))
          .map((token) => `${path.relative(root, filePath)}: ${token}`);
      }),
    );

    expect(violations).toEqual([]);
  });

  it("restores all four browser-backed surface families through the shared T3 host", () => {
    const browserTile = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
    );
    const runtimeTile = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx",
    );
    const orgDevAppTile = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchOrgDevAppTile.tsx",
    );

    expect(browserTile).toContain("<BrowserSurfaceSlot");
    expect(browserTile).toContain("useHostedBrowserSurface(descriptor)");
    expect(browserTile).not.toContain("<BrowserUnavailableSurface");
    expect(runtimeTile).toContain("<BrowserSurfaceSlot");
    expect(runtimeTile).toContain("useHostedBrowserSurface(browserSurfaceDescriptor)");
    expect(runtimeTile).not.toContain("<BrowserUnavailableSurface");
    expect(runtimeTile).toContain("tile.devAppId");
    expect(orgDevAppTile).toContain("<BrowserSurfaceSlot");
    expect(orgDevAppTile).toContain("useHostedBrowserSurface(browserSurfaceDescriptor)");
    expect(orgDevAppTile).not.toContain("<BrowserUnavailableSurface");
  });

  it("keeps the removed host absent while mounting only the T3 webview foundation", () => {
    const main = read("apps/desktop/electron/main.ts");
    const preload = read("apps/desktop/electron/preload.ts");
    const sessionManager = read("apps/desktop/electron/services/WorkbenchSessionManager.ts");

    expect(main).not.toContain("registerWorkbenchBrowserHandlers");
    expect(main).not.toContain("registerBrowserAutomationHandlers");
    expect(main).toContain("webviewTag: true");
    expect(main).toContain("will-attach-webview");
    expect(preload).not.toContain("workbenchBrowser");
    expect(preload).toContain("preview: previewBridge");
    expect(sessionManager).toContain(
      "hasBrowserSurface: this.browserSurfaces.hasSurfaceForWorkbenchSession(sessionKey)",
    );
  });

  it("keeps the complete all-surface T3 automation host enabled with no pending parity", () => {
    const host = read("apps/desktop/src/substrate/t3PreviewAutomationHost.ts");
    for (const operation of [
      "status",
      "open",
      "navigate",
      "snapshot",
      "click",
      "type",
      "press",
      "scroll",
      "evaluate",
      "waitFor",
      "recordingStart",
      "recordingStop",
      "resize",
      "setColorScheme",
      "devServerStatus",
      "devServerEnsure",
      "devServerAttach",
      "devAppPreviewEnsure",
      "devAppPreviewAttach",
    ]) {
      expect(host).toContain(`"${operation}"`);
    }
    expect(host).toContain("lastControlledSurfaceByThread");
    expect(host).toContain("bridge.listSurfaces()");
    expect(host).not.toContain("PreviewAutomationUnavailableError");
    expect(
      T3_BROWSER_PORT_PARITY_LEDGER.filter((requirement) =>
        String(requirement.status).includes("pending"),
      ),
    ).toEqual([]);
    expect(
      fs.existsSync(
        path.join(
          root,
          "apps/desktop/src/features/projects/components/workbench/BrowserUnavailableSurface.tsx",
        ),
      ),
    ).toBe(false);
  });
});
