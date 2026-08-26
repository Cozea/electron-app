import { describe, expect, it } from "vitest";

import type { DevAppManifest } from "@/features/devapps/registry/types";
import { listLauncherApps } from "@/features/devapps/registry";
import {
  filterWorkbenchSelectionApps,
  getWorkbenchSelectionCategories,
  resolveWorkbenchSelectionCategory,
} from "@/features/projects/lib/workbenchSelectionCategories";

const builtIn: DevAppManifest = {
  id: "dev-server",
  name: "Dev Server",
  description: "Built in",
  categories: ["preview-tools"],
  icon: { src: "builtin.png", alt: "Dev Server" },
  launcher: { enabled: true, order: 1, group: "Development", searchTerms: [] },
  store: { categoryLabel: "Development", accentClassName: "", badgeLabel: "Built in" },
  launch: { kind: "devServer", tileType: "devServer", singleton: true },
};

const local: DevAppManifest = {
  ...builtIn,
  id: "project-devapp:local-1",
  name: "Sammy",
  launch: {
    kind: "projectDevApp",
    tileType: "devServer",
    singleton: true,
    publicationId: "local-1",
    releaseId: "release-1",
    releaseVersion: 1,
    projectId: "project-source",
    name: "Sammy",
    framework: "vite-react",
    devCommand: "bun run dev",
  },
};

describe("workbench selection categories", () => {
  it("only exposes Local once at least one local DevApp exists", () => {
    expect(getWorkbenchSelectionCategories(false)).not.toContain("Local");
    expect(getWorkbenchSelectionCategories(true)).toEqual([
      "All",
      "Local",
      "Development",
      "Assistant",
      "Explore DevApps Store",
    ]);
  });

  it("filters Local by launch kind without including built-in development apps", () => {
    expect(filterWorkbenchSelectionApps([builtIn, local], "Local")).toEqual([local]);
    expect(filterWorkbenchSelectionApps([local], "Development")).toEqual([local]);
  });

  it("keeps Local isolated after launcher search", () => {
    const localSearch = listLauncherApps({ additionalApps: [local], query: "Sammy" });
    const builtInSearch = listLauncherApps({ additionalApps: [local], query: "Browser" });

    expect(filterWorkbenchSelectionApps(localSearch, "Local")).toEqual([local]);
    expect(filterWorkbenchSelectionApps(builtInSearch, "Local")).toEqual([]);
  });

  it("falls back to All immediately when the last local DevApp disappears", () => {
    expect(resolveWorkbenchSelectionCategory("Local", false)).toBe("All");
    expect(resolveWorkbenchSelectionCategory("Local", true)).toBe("Local");
  });
});
