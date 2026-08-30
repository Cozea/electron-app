import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

  it("renders the shared blackout surface from every browser-backed tile implementation", () => {
    const browserTile = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
    );
    const runtimeTile = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx",
    );
    const orgDevAppTile = read(
      "apps/desktop/src/features/projects/components/workbench/WorkbenchOrgDevAppTile.tsx",
    );

    expect(browserTile).toContain("<BrowserUnavailableSurface");
    expect(runtimeTile).toContain("<BrowserUnavailableSurface");
    expect(runtimeTile).toContain("tile.devAppId");
    expect(orgDevAppTile).toContain("<BrowserUnavailableSurface");
  });

  it("keeps browser rendering detached from Electron startup and preload", () => {
    const main = read("apps/desktop/electron/main.ts");
    const preload = read("apps/desktop/electron/preload.ts");
    const sessionManager = read("apps/desktop/electron/services/WorkbenchSessionManager.ts");

    expect(main).not.toContain("registerWorkbenchBrowserHandlers");
    expect(main).not.toContain("registerBrowserAutomationHandlers");
    expect(preload).not.toContain("workbenchBrowser");
    expect(sessionManager).toContain("hasBrowserSurface: false");
  });
});
