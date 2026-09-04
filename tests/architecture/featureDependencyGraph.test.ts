import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardrail for the feature dependency graph.
 *
 * Features compose downward: the workbench builds tiles out of assistant,
 * browser, devapps and terminal; projects composes the workbench. Those edges
 * are correct and heavily travelled. The problem is the thin edge back up — a
 * capability importing its own caller to read ambient state (which project am
 * I in, which lane is selected) that the caller already knew and could have
 * passed down.
 *
 * Every mutual pair below is pinned with the thin edge and the modules it
 * reaches for, so the fix is legible from the failure. The list may only
 * shrink: a new pair fails as a regression, and a resolved one fails until it
 * is deleted from here, which keeps the count honest instead of letting one
 * cycle be traded for another.
 */

const REPO_ROOT = process.cwd();
const FEATURES_ROOT = path.join(REPO_ROOT, "apps/desktop/src/features");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

interface PinnedCycle {
  /** Feature names, alphabetical. */
  readonly pair: readonly [string, string];
  /** The direction to delete, written as "importer -> imported". */
  readonly thinEdge: string;
  /** Modules the thin edge reaches for, relative to the imported feature. */
  readonly reaches: readonly string[];
}

const PINNED_CYCLES: readonly PinnedCycle[] = [
  {
    pair: ["assistant", "workbench"],
    thinEdge: "assistant -> workbench",
    reaches: ["WorkbenchEditorIcons", "assistant/assistantRuntimeMetadataStore"],
  },
  {
    pair: ["browser", "workbench"],
    thinEdge: "browser -> workbench",
    reaches: ["WorkbenchDockRuntimeContext"],
  },
  {
    pair: ["devapps", "projects"],
    thinEdge: "devapps -> projects",
    reaches: ["hooks/useProjectHeader", "model/createProjectDialogStore"],
  },
  {
    pair: ["projects", "settings"],
    thinEdge: "projects -> settings",
    reaches: ["pages/ProjectSettingsPage", "ui/SettingsChrome", "ui/SettingsSidebar"],
  },
  {
    pair: ["projects", "workbench"],
    thinEdge: "workbench -> projects",
    reaches: ["ui/ProjectPixelInvaderIcon"],
  },
];

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

/**
 * Cross-feature imports all go through the `@/` alias today, but a relative
 * specifier can reach a sibling feature just as well, so both are resolved —
 * otherwise the guardrail is one `../../` away from being bypassed.
 */
function readFeatureEdges(): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();

  for (const filePath of listSourceFiles(FEATURES_ROOT)) {
    const importer = path.relative(FEATURES_ROOT, filePath).split(path.sep)[0];
    const source = fs.readFileSync(filePath, "utf8");
    const imported = new Set<string>();

    for (const [, feature] of source.matchAll(/["']@\/features\/([a-z0-9-]+)\//g)) {
      imported.add(feature);
    }

    for (const [, specifier] of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const resolved = path.resolve(path.dirname(filePath), specifier);
      if (!resolved.startsWith(FEATURES_ROOT + path.sep)) continue;
      imported.add(path.relative(FEATURES_ROOT, resolved).split(path.sep)[0]);
    }

    imported.delete(importer);
    for (const target of imported) {
      const existing = edges.get(importer) ?? new Set<string>();
      existing.add(target);
      edges.set(importer, existing);
    }
  }

  return edges;
}

/**
 * Modules each cross-feature edge reaches for, keyed "importer -> imported".
 * Only the aliased form is collected, which is every cross-feature import
 * today; the relative form is still resolved above for cycle detection.
 */
function readEdgeModules(): Map<string, Set<string>> {
  const modules = new Map<string, Set<string>>();

  for (const filePath of listSourceFiles(FEATURES_ROOT)) {
    const importer = path.relative(FEATURES_ROOT, filePath).split(path.sep)[0];
    const source = fs.readFileSync(filePath, "utf8");

    for (const [, imported, module] of source.matchAll(
      /["']@\/features\/([a-z0-9-]+)\/([^"']+)["']/g,
    )) {
      if (imported === importer) continue;
      const key = `${importer} -> ${imported}`;
      const existing = modules.get(key) ?? new Set<string>();
      existing.add(module);
      modules.set(key, existing);
    }
  }

  return modules;
}

function findMutualPairs(edges: Map<string, Set<string>>): string[] {
  const pairs = new Set<string>();

  for (const [importer, targets] of edges) {
    for (const target of targets) {
      if (edges.get(target)?.has(importer)) {
        pairs.add([importer, target].sort().join(" <-> "));
      }
    }
  }

  return [...pairs].sort();
}

describe("feature dependency graph", () => {
  it("carries no mutual dependency beyond the pinned set", () => {
    const actual = findMutualPairs(readFeatureEdges());
    const pinned = PINNED_CYCLES.map(({ pair }) => pair.join(" <-> ")).sort();

    // A plain equality check reports both directions at once: a pair that
    // appears is a regression, and a pair that disappears has been fixed and
    // must be deleted from PINNED_CYCLES so the count can never drift back up.
    expect(actual).toEqual(pinned);
  });

  it("pins each cycle with the edge to delete and what it reaches for", () => {
    const modules = readEdgeModules();

    for (const { pair, thinEdge, reaches } of PINNED_CYCLES) {
      const [importer, imported] = thinEdge.split(" -> ");

      expect(pair, `${thinEdge} names a feature outside its own pair`).toContain(importer);
      expect(pair, `${thinEdge} names a feature outside its own pair`).toContain(imported);
      expect(reaches.length, `${thinEdge} records no modules to delete`).toBeGreaterThan(0);

      // Without this the recorded modules rot silently: a call site can swap
      // one import for another and leave the plan pointing at the wrong fix.
      expect([...(modules.get(thinEdge) ?? [])].sort(), `${thinEdge} reaches for different modules than recorded`)
        .toEqual([...reaches].sort());
    }
  });

  it("keeps the pinned list sorted and free of duplicates", () => {
    const keys = PINNED_CYCLES.map(({ pair }) => pair.join(" <-> "));

    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    for (const { pair } of PINNED_CYCLES) {
      expect([...pair], `${pair.join(" <-> ")} is not alphabetical`).toEqual([...pair].sort());
    }
  });
});
