import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { T3_BROWSER_PORT_PARITY_LEDGER } from "@shared/browserPortParityLedger";
import {
  BROWSER_SURFACE_FAMILIES,
  BROWSER_SURFACE_MIGRATION_LEDGER,
  expectedBackendForState,
  isFullyMigrated,
} from "@shared/browserSurfaceMigrationLedger";
import type { BrowserSurfaceKind } from "@shared/browserSurfaceTypes";

const root = process.cwd();
const rendererRoots = ["apps/desktop/src", "shared"];
const mainRoot = "apps/desktop/electron";
const sourceRoots = [mainRoot, ...rendererRoots, "scripts"];
const sourceExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set(["dist", "node_modules", "out"]);

/**
 * Symbols from the *removed* browser host, not from the native architecture
 * this migration is introducing. Keeping them forbidden stops the old design
 * being resurrected; the new main-owned classes use `BrowserSurface*` names and
 * are unaffected.
 *
 * `WebContentsView`, screenshot substitution and native-surface occlusion were
 * previously in this list. They are now required by the target architecture and
 * are governed by the scoped ownership test below instead.
 */
const forbiddenRemovedHostTokens = [
  "WorkbenchBrowserService",
  "workbenchBrowser:",
  "electronAPI.workbenchBrowser",
  "BrowserTileModel",
  "useWorkbenchBrowserView",
  "data-workbench-browser-overlay",
  "BrowserUnavailableSurface",
  "cozea:dock-layout-change",
  "cozea:split-control",
] as const;

/**
 * A fallback browser host is forbidden in every phase. The plan permits the
 * legacy and native hosts to coexist only through explicit ledger states, never
 * through a silent runtime fallback.
 */
const forbiddenFallbackTokens = ["legacyBrowserFallback", "browserHostFallback"] as const;

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

/**
 * Drop block comments and whole-line `//` comments before scanning.
 *
 * These architecture rules are about what code *does*, not which words appear
 * in prose (INV-014). Without this, documenting an invariant in a comment
 * violates the invariant it documents.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function scan(roots: readonly string[], tokens: readonly string[]): string[] {
  return roots.flatMap((sourceRoot) =>
    listSourceFiles(path.join(root, sourceRoot)).flatMap((filePath) => {
      const source = stripComments(fs.readFileSync(filePath, "utf8"));
      return tokens
        .filter((token) => source.includes(token))
        .map((token) => `${path.relative(root, filePath)}: ${token}`);
    }),
  );
}

describe("browser surface migration boundary", () => {
  it("keeps removed-host and fallback symbols out of first-party application code", () => {
    expect(
      scan(sourceRoots, [...forbiddenRemovedHostTokens, ...forbiddenFallbackTokens]),
    ).toEqual([]);
  });

  it("confines native WebContentsView ownership to Electron main", () => {
    // INV-001: only main may create or destroy a native browser view. This is
    // the replacement for the old blanket ban on the token, which also made the
    // target architecture untestable.
    expect(scan(rendererRoots, ["WebContentsView"])).toEqual([]);
  });

  it("covers every browser surface kind in the migration ledger", () => {
    const ledgerFamilies = BROWSER_SURFACE_MIGRATION_LEDGER.map((entry) => entry.family);
    expect([...ledgerFamilies].sort()).toEqual([...BROWSER_SURFACE_FAMILIES].sort());

    // Fails when a new BrowserSurfaceKind is added without deciding how it
    // migrates. The annotation is what makes the omission a type error too.
    const kinds: Record<BrowserSurfaceKind, true> = {
      browser: true,
      devServer: true,
      projectDevApp: true,
      orgDevApp: true,
      devAppPreview: true,
    };
    expect([...BROWSER_SURFACE_FAMILIES].sort()).toEqual(Object.keys(kinds).sort());
  });

  it("keeps each family's active backend consistent with its migration state", () => {
    const mismatches = BROWSER_SURFACE_MIGRATION_LEDGER.filter(
      (entry) => entry.activeBackend !== expectedBackendForState(entry.state),
    ).map((entry) => `${entry.family}: ${entry.state} declares ${entry.activeBackend}`);

    expect(mismatches).toEqual([]);
  });

  it("keeps surface descriptors stable across the migration", () => {
    // Identity is the descriptor, not the DOM node (INV-002). These fields are
    // what main will key native surfaces by, so they must not drift silently.
    const descriptorSource = read("shared/browserSurfaceTypes.ts");
    for (const field of [
      "runtimeTabId",
      "tileId",
      "workbenchSessionKey",
      "kind",
      "storageScope",
    ]) {
      expect(descriptorSource, `BrowserSurfaceDescriptor.${field}`).toContain(field);
    }
  });

  it("routes every native surface through the one main-owned host", () => {
    const service = read("apps/desktop/electron/services/T3BrowserSurfaceService.ts");

    // Native views may only come from the host (INV-001). The development probe
    // stays gated so it cannot be mistaken for the product path.
    expect(service).toContain("COZEA_BROWSER_NATIVE_SHADOW");
    expect(service).toContain("nativeHost.ensureSurface(descriptor)");

    const nativeCreationSites = scan([mainRoot], ["ensureSurface(descriptor)"]);
    expect(nativeCreationSites).toEqual([
      "apps/desktop/electron/services/T3BrowserSurfaceService.ts: ensureSurface(descriptor)",
    ]);
  });

  it("gives a native surface the same listeners the guest path attaches", () => {
    const service = read("apps/desktop/electron/services/T3BrowserSurfaceService.ts");
    const ensureNative = service.slice(
      service.indexOf("async ensureNativeSurface("),
      service.indexOf("async releaseNativeSurfaceForTab("),
    );

    // HTTP diagnostics and requested-URL tracking feed the tile's error state
    // and address bar. Without them a native surface paints while its chrome
    // stays blank, which is the silent half-migration INV-013 forbids.
    expect(ensureNative).toContain("this.attachCozeaListeners(");
    expect(ensureNative).toContain("this.attachDevAppViewBridge(");
  });

  it("keeps the native host out of renderer code", () => {
    // The host owns Chromium; the renderer may only ask for layout and
    // visibility through IPC.
    expect(
      scan(rendererRoots, [
        "BrowserSurfaceNativeHost",
        "BrowserSurfaceView",
        "BrowserSurfaceSessionRegistry",
      ]),
    ).toEqual([]);
  });

  it("subscribes to surface state independently of the legacy host", () => {
    const bridge = read("apps/desktop/src/features/browser/BrowserSurfaceRuntimeBridge.tsx");
    const legacyHost = read("apps/desktop/src/features/browser/ElectronBrowserHost.tsx");
    const entry = read("apps/desktop/src/main.tsx");

    // The legacy host is lazily mounted only while the legacy registry has
    // entries, and a native surface never registers there. Hosting these
    // subscriptions inside it left a native tile with no state at all -- no
    // title, favicon or error -- however well its page had loaded.
    expect(bridge).toContain("onSurfaceStateChange");
    expect(bridge).toContain("onPointerEvent");
    expect(legacyHost).not.toContain("onSurfaceStateChange");
    expect(legacyHost).not.toContain("onPointerEvent");
    expect(entry).toContain("<BrowserSurfaceRuntimeBridge />");
  });

  it("keeps the T3 automation parity ledger complete", () => {
    expect(
      T3_BROWSER_PORT_PARITY_LEDGER.filter((requirement) =>
        String(requirement.status).includes("pending"),
      ),
    ).toEqual([]);
  });

  it("restores all browser-backed surface families through the shared host", () => {
    const browserTile = read("apps/desktop/src/features/workbench/WorkbenchBrowserTile.tsx");
    const runtimeTile = read("apps/desktop/src/features/workbench/WorkbenchDevServerTile.tsx");
    const orgDevAppTile = read("apps/desktop/src/features/workbench/WorkbenchOrgDevAppTile.tsx");
    const backendSlot = read("apps/desktop/src/features/browser/BrowserSurfaceBackendSlot.tsx");

    // The Browser tile no longer picks a host itself. The ledger does, inside
    // the backend slot, which is what keeps the two paths mutually exclusive.
    expect(browserTile).toContain("<BrowserSurfaceBackendSlot");
    expect(browserTile).not.toContain("useHostedBrowserSurface");
    expect(backendSlot).toContain("migrationStateFor(props.descriptor.kind)");
    expect(backendSlot).toContain("useHostedBrowserSurface(descriptor)");
    expect(backendSlot).toContain("<NativeBrowserSurfaceSlot");
    expect(runtimeTile).toContain("<BrowserSurfaceSlot");
    expect(runtimeTile).toContain("useHostedBrowserSurface(browserSurfaceDescriptor)");
    expect(runtimeTile).toContain("tile.devAppId");
    expect(orgDevAppTile).toContain("<BrowserSurfaceSlot");
    expect(orgDevAppTile).toContain("useHostedBrowserSurface(browserSurfaceDescriptor)");
  });

  it("keeps the complete all-surface T3 automation host enabled", () => {
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
      "devAppToolCatalog",
      "devAppToolInvoke",
    ]) {
      expect(host).toContain(`"${operation}"`);
    }
    expect(host).toContain("lastControlledSurfaceByThread");
    expect(host).toContain("bridge.listSurfaces()");
    expect(host).not.toContain("PreviewAutomationUnavailableError");
    expect(
      fs.existsSync(
        path.join(
          root,
          "apps/desktop/src/features/projects/components/workbench/BrowserUnavailableSurface.tsx",
        ),
      ),
    ).toBe(false);
  });

  describe("legacy webview host", () => {
    const legacyBackedFamilies = BROWSER_SURFACE_MIGRATION_LEDGER.filter(
      (entry) => entry.activeBackend === "renderer-webview",
    );

    it.runIf(legacyBackedFamilies.length > 0)(
      "stays mounted while any family is still renderer-backed",
      () => {
        const main = read("apps/desktop/electron/main.ts");
        const preload = read("apps/desktop/electron/preload.ts");
        const sessionManager = read(
          "apps/desktop/electron/services/WorkbenchSessionManager.ts",
        );

        expect(main).not.toContain("registerWorkbenchBrowserHandlers");
        expect(main).not.toContain("registerBrowserAutomationHandlers");
        expect(main).toContain("webviewTag: true");
        expect(main).toContain("will-attach-webview");
        expect(preload).not.toContain("workbenchBrowser");
        expect(preload).toContain("preview: previewBridge");
        expect(sessionManager).toContain(
          "hasBrowserSurface: this.browserSurfaces.hasSurfaceForWorkbenchSession(sessionKey)",
        );
      },
    );

    it.runIf(isFullyMigrated())("is fully removed at final cutover", () => {
      const main = read("apps/desktop/electron/main.ts");
      const preload = read("apps/desktop/electron/preload.ts");

      expect(main).not.toContain("webviewTag: true");
      expect(main).not.toContain("will-attach-webview");
      expect(preload).not.toContain("registerWebview");
      expect(scan(rendererRoots, ["<webview", "registerWebview"])).toEqual([]);

      // The native host must exist and be main-owned before anything is deleted.
      expect(
        fs.existsSync(
          path.join(root, "apps/desktop/electron/services/browser/BrowserSurfaceNativeHost.ts"),
        ),
      ).toBe(true);
    });
  });
});
