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
  parts: {
    view: { source: "native", rendererId: "devServer" },
    worker: { capabilities: ["process.spawn", "project.read"] },
    service: { runtimeKind: "node", singleton: true },
  },
  launch: { kind: "devServer", tileType: "devServer", singleton: true },
};

const orgApp: DevAppManifest = {
  ...builtIn,
  id: "org-devapp:pub-1",
  name: "Sammy",
  parts: { view: { source: "package" } },
  launch: {
    kind: "publishedDevApp",
    tileType: "orgDevApp",
    ref: "cozea-devapp:org_1/publication_1@1",
    publicationId: "pub-1",
    organizationId: "org-1",
    organizationName: "Acme",
    releaseId: "release-1",
    releaseVersion: 1,
    name: "Sammy",
    framework: "vite-react",
    contentHash: "d".repeat(64),
    entryPath: "index.html",
    runtimeKind: "static",
  },
};

describe("workbench selection categories", () => {
  it("only exposes Your org once at least one org DevApp exists", () => {
    expect(getWorkbenchSelectionCategories(false)).not.toContain("Your org");
    expect(getWorkbenchSelectionCategories(true)).toEqual([
      "All",
      "Your org",
      "Development",
      "Assistant",
      "Explore DevApps Store",
    ]);
  });

  it("filters Your org by launch kind without including built-in development apps", () => {
    expect(filterWorkbenchSelectionApps([builtIn, orgApp], "Your org")).toEqual([orgApp]);
    expect(filterWorkbenchSelectionApps([orgApp], "Development")).toEqual([orgApp]);
  });

  it("keeps Your org isolated after launcher search", () => {
    const orgSearch = listLauncherApps({ additionalApps: [orgApp], query: "Sammy" });
    const builtInSearch = listLauncherApps({ additionalApps: [orgApp], query: "Browser" });

    expect(filterWorkbenchSelectionApps(orgSearch, "Your org")).toEqual([orgApp]);
    expect(filterWorkbenchSelectionApps(builtInSearch, "Your org")).toEqual([]);
  });

  it("falls back to All immediately when the last org DevApp disappears", () => {
    expect(resolveWorkbenchSelectionCategory("Your org", false)).toBe("All");
    expect(resolveWorkbenchSelectionCategory("Your org", true)).toBe("Your org");
  });
});
