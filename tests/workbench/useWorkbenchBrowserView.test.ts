import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  browserAddressDisplayValue,
  resolveBrowserAddressSubmission,
} from "@/features/projects/browser/browserAddressState";
import { isExternallyOpenableBrowserUrl } from "@/features/projects/browser/urlInput";
import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

const browserTileSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/desktop/src/features/projects/components/workbench/WorkbenchBrowserTile.tsx",
  ),
  "utf8",
);
const browserControlsSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/desktop/src/features/projects/browser/BrowserNavigationControls.tsx",
  ),
  "utf8",
);
const hostedWebviewSource = fs.readFileSync(
  path.join(process.cwd(), "apps/desktop/src/features/projects/browser/HostedBrowserWebview.tsx"),
  "utf8",
);
const browserPreviewActionsSource = fs.readFileSync(
  path.join(process.cwd(), "apps/desktop/src/features/projects/browser/BrowserPreviewActions.tsx"),
  "utf8",
);
const workbenchCssSource = fs.readFileSync(
  path.join(process.cwd(), "apps/desktop/src/features/projects/components/workbench/workbench.css"),
  "utf8",
);

describe("ported T3 Browser tile", () => {
  it("allows external opening only for HTTP(S) URLs", () => {
    expect(isExternallyOpenableBrowserUrl("https://example.com/docs")).toBe(true);
    expect(isExternallyOpenableBrowserUrl("http://127.0.0.1:4173")).toBe(true);
    expect(isExternallyOpenableBrowserUrl("cozea-devapp://release/index.html")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("file:///tmp/private")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("not a url")).toBe(false);
  });

  it("preserves a focused draft while browser navigation changes the committed URL", () => {
    expect(
      browserAddressDisplayValue({
        committedUrl: "https://redirected.example/",
        draft: "second destination",
        focused: true,
      }),
    ).toBe("second destination");
    expect(
      browserAddressDisplayValue({
        committedUrl: "https://redirected.example/",
        draft: "second destination",
        focused: false,
      }),
    ).toBe("https://redirected.example/");
  });

  it("normalizes every submission without suppressing a repeated URL", () => {
    expect(resolveBrowserAddressSubmission("localhost:4173")).toBe("http://localhost:4173");
    expect(resolveBrowserAddressSubmission("cozea browser port")).toBe(
      "https://www.google.com/search?q=cozea%20browser%20port",
    );
    expect(resolveBrowserAddressSubmission("https://example.com/")).toBe("https://example.com/");
    expect(resolveBrowserAddressSubmission("https://example.com/")).toBe("https://example.com/");
    expect(resolveBrowserAddressSubmission("file:///tmp/private")).toBeNull();
    expect(resolveBrowserAddressSubmission("cozea-devapp://release/index.html")).toBeNull();
  });

  it("mounts one hosted slot and keeps descriptor updates outside the guest lifetime effect", () => {
    expect(browserTileSource).toContain("<BrowserSurfaceSlot");
    expect(browserTileSource).toContain("useHostedBrowserSurface(descriptor)");
    expect(browserTileSource).not.toContain("<BrowserUnavailableSurface");
    expect(hostedWebviewSource).toContain("}, [preview, runtimeTabId]);");
    expect(hostedWebviewSource).not.toContain("[descriptor, preview, runtimeTabId]");
    expect(hostedWebviewSource).not.toContain("{ ...current, state: surfaceState }");
    expect(hostedWebviewSource).toContain('useState(() => descriptor.initialUrl ?? "about:blank")');
    expect(hostedWebviewSource).toContain(
      "src={webviewGeneration === 0 ? initialSrc : recoverySrc}",
    );
  });

  it("uses the generic shell API only after the URL policy accepts the committed URL", () => {
    expect(browserControlsSource).toContain("isExternallyOpenableBrowserUrl(committedUrl)");
    expect(browserControlsSource).toContain("window.electronAPI.shell.openExternal(externalUrl)");
    expect(browserControlsSource).not.toContain("electronAPI.workbenchBrowser");
  });

  it("keeps the address field flexible without stretching every header control", () => {
    expect(browserControlsSource).toContain("data-browser-address-group");
    expect(browserControlsSource).toContain(
      "rounded-md bg-transparent px-2 focus-within:bg-background",
    );
    expect(browserControlsSource).not.toContain("rounded-md bg-muted/45 px-2 focus-within");
    expect(workbenchCssSource).toMatch(
      /\.cozea-workbench-dockview \.cozea-workbench-header-controls \{\s*width: 100%;\s*\}/,
    );
    expect(workbenchCssSource).not.toMatch(
      /\.cozea-workbench-dockview \.cozea-workbench-header-controls > \* \{[^}]*(?:^|[;\s])width\s*:/m,
    );
  });

  it("groups browser and preview utilities into one overflow menu", () => {
    expect(browserControlsSource).not.toContain('aria-label="Browser menu"');
    expect(browserControlsSource).not.toContain('data-browser-find-button');
    expect(browserPreviewActionsSource).toContain('aria-label="Browser and preview menu"');
    expect(browserPreviewActionsSource).toContain("Find in page");
    expect(browserPreviewActionsSource).toContain("Annotate preview");
    expect(browserPreviewActionsSource).toContain("Capture screenshot");
    expect(browserPreviewActionsSource).toContain("Open separate preview window");
    expect(browserPreviewActionsSource.match(/<DropdownMenu>/g)).toHaveLength(1);
    expect(browserPreviewActionsSource).toContain("Capture and recording");
    expect(browserPreviewActionsSource).toContain("Zoom {Math.round");
    expect(browserPreviewActionsSource).toContain("Advanced");
    expect(browserPreviewActionsSource.match(/<DropdownMenuSubTrigger inset/g)).toHaveLength(4);
    expect(browserPreviewActionsSource).toContain("<DropdownMenuItem\n            inset");
  });

  it.each([
    ["navigation.initial-blank", "cozea-adapted"],
    ["navigation.sequential-urls", "ported"],
    ["navigation.history-reload-find-zoom-devtools", "cozea-adapted"],
    ["navigation.popup-policy", "ported"],
  ])("records executable parity for %s", (id, status) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "navigation",
      status,
    });
  });
});
