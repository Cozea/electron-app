import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const sharedButton = source("apps/desktop/src/components/ui/button.tsx");
const sharedInput = source("apps/desktop/src/components/ui/input.tsx");
const sharedToggle = source("apps/desktop/src/components/ui/toggle.tsx");
const sharedSwitch = source("apps/desktop/src/components/ui/switch.tsx");
const assistantButton = source("apps/desktop/src/features/assistant/ui/button.tsx");
const assistantInput = source("apps/desktop/src/features/assistant/ui/input.tsx");
const compactWindowHook = source("apps/desktop/src/hooks/use-mobile.ts");
const unifiedHeader = source("apps/desktop/src/components/layouts/UnifiedHeader.tsx");
const dockviewCanvas = source("apps/desktop/src/features/workbench/WorkbenchDockviewCanvas.tsx");
const tileChrome = source("apps/desktop/src/features/workbench/WorkbenchTileChrome.tsx");
const geometryCss = source("apps/desktop/src/features/workbench/adaptiveDesktopGeometry.css");
const planBanner = source(
  "apps/desktop/src/features/assistant/chat/ComposerPlanFollowUpBanner.tsx",
);
const approvalPanel = source(
  "apps/desktop/src/features/assistant/chat/ComposerPendingApprovalPanel.tsx",
);
const pendingInput = source(
  "apps/desktop/src/features/assistant/chat/ComposerPendingUserInputPanel.tsx",
);
const sidebar = source("apps/desktop/src/components/ui/sidebar.tsx");

describe("adaptive desktop geometry", () => {
  it("keeps desktop primitive density stable across BrowserWindow widths", () => {
    for (const primitive of [sharedButton, sharedInput, sharedToggle, sharedSwitch]) {
      expect(primitive).not.toMatch(/\bsm:(?:h-|size-|min-w-|\[--thumb-size)/);
    }
    for (const primitive of [assistantButton, assistantInput]) {
      expect(primitive).not.toMatch(/\bsm:(?:h-|size-|leading-)/);
    }

    // Input modality, not viewport width, owns coarse-pointer hit areas.
    expect(sharedButton).toContain("pointer-coarse:after:min-h-11");
    expect(assistantButton).toContain("pointer-coarse:after:min-h-11");
  });

  it("names narrow-window shell behavior as compact desktop geometry", () => {
    expect(compactWindowHook).toContain("COMPACT_WINDOW_BREAKPOINT_PX");
    expect(compactWindowHook).toContain("useIsCompactWindow");
    expect(compactWindowHook).toContain("export const useIsMobile = useIsCompactWindow");
  });

  it("gives the global title bar a compact-window pressure policy", () => {
    // Center identity/content yields before actionable left/right chrome. This
    // keeps the title bar one row high and avoids collisions with OS controls.
    expect(unifiedHeader).toContain('data-unified-header-center="true"');
    expect(unifiedHeader).toContain("max-md:hidden");
    expect(unifiedHeader).toContain('data-unified-header-actions="true"');
    expect(unifiedHeader).toContain("h-10");
  });

  it("establishes each Dockview group as the pane geometry boundary", () => {
    expect(dockviewCanvas).toContain('import "@/features/workbench/adaptiveDesktopGeometry.css"');
    expect(geometryCss).toContain("container-name: cozea-workbench-pane");
    expect(geometryCss).toContain("container-type: inline-size");
    expect(tileChrome).toContain("data-workbench-tile-type={tileType}");
    expect(tileChrome).toContain('data-workbench-pane-content="true"');
  });

  it("makes standalone assistant presentation query pane width", () => {
    for (const chatSource of [planBanner, approvalPanel, pendingInput]) {
      expect(chatSource).toContain("@md/cozea-workbench-pane:");
      expect(chatSource).not.toMatch(/\bsm:(?:px|py)-/);
    }

    // Large chat surface/timeline files retain behavioral ResizeObservers; their
    // legacy sm: presentation tokens are reinterpreted centrally by pane width.
    expect(geometryCss).toContain('data-workbench-tile-type="assistantChat"');
    expect(geometryCss).toContain('[class~="sm:px-5"]');
  });

  it("keeps Selection and Browser adaptation pane-local", () => {
    expect(geometryCss).toContain('data-workbench-tile-type="selection"');
    expect(geometryCss).toContain("min-width: 45rem");
    expect(geometryCss).toContain("[data-browser-address-group]");
  });

  it("does not introduce workbench topology rewrites", () => {
    expect(geometryCss).not.toContain("grid-template-areas");
    expect(geometryCss).not.toContain("flex-direction: column");
    expect(geometryCss).not.toContain("display: none; /* pane */");
  });

  it("preserves smooth sidebar collapse transitions without snapping across compact window widths", () => {
    // The sidebar must remain a continuously rendered desktop offcanvas component;
    // it must not abruptly swap to an unmounted Sheet or use hidden md:block/md:flex.
    expect(sidebar).not.toMatch(/hidden\s+[^"]*md:block/);
    expect(sidebar).not.toMatch(/hidden\s+[^"]*md:flex/);
    expect(sidebar).not.toContain("<Sheet");
    // The outer sidebar element must use block layout so sidebar-gap does not become an in-flow flex column pushing sidebar-container
    expect(sidebar).toMatch(/group\s+peer\s+relative\s+block\s+h-full/);
    // Responsive auto-collapse must track the compact breakpoint and transition state
    expect(sidebar).toContain("COMPACT_WINDOW_BREAKPOINT_PX");
    expect(sidebar).toContain("wasAutoCollapsedRef");
  });
});
