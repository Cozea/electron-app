import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isExternallyOpenableBrowserUrl } from "@/features/projects/components/workbench/BrowserUnavailableSurface";
import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

const browserTileSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
  ),
  "utf8",
);

describe("browser blackout surface", () => {
  it("allows external opening only for HTTP(S) URLs", () => {
    expect(isExternallyOpenableBrowserUrl("https://example.com/docs")).toBe(true);
    expect(isExternallyOpenableBrowserUrl("http://127.0.0.1:4173")).toBe(true);
    expect(isExternallyOpenableBrowserUrl("cozea-devapp://release/index.html")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("file:///tmp/private")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("not a url")).toBe(false);
  });

  it("uses the generic shell API only after the URL policy accepts the URL", () => {
    expect(browserTileSource).toContain("window.electronAPI.shell.openExternal(externalUrl)");
    expect(browserTileSource).toContain("isExternallyOpenableBrowserUrl(tile.url)");
    expect(browserTileSource).not.toContain("electronAPI.workbenchBrowser");
  });

  it.each([
    "navigation.initial-blank",
    "navigation.sequential-urls",
    "navigation.history-reload-find-zoom-devtools",
    "navigation.popup-policy",
  ])("preserves %s as a mandatory T3 port requirement", (id) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "navigation",
      status: "pending-t3-port",
    });
  });
});
