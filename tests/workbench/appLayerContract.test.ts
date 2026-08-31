import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { APP_LAYERS } from "@/lib/appLayers";

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
});
