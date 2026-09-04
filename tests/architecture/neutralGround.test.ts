import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardrail for the modules that exist to break cycles.
 *
 * Ambient state — which project am I in, which workspace, which bench is on
 * screen — is nobody's feature, so it was lifted out of the features that
 * happened to declare it first. The lift only holds while these modules import
 * nothing back: one `@/features/…` here and the cycle it was moved to break is
 * silently restored, with nothing failing until someone re-measures the graph.
 *
 * Every feature import that remains is pinned below with what makes it
 * survivable. The list may only shrink; a new one fails as a regression, and a
 * removed one fails until it is deleted from here.
 *
 * @see featureDependencyGraph.test.ts for the cycles this protects.
 */

const REPO_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Every file under these directories is neutral ground. */
const NEUTRAL_ROOTS = ["apps/desktop/src/contexts"];

/** Individual modules lifted out of a feature, whose siblings are not neutral. */
const NEUTRAL_MODULES = [
  "apps/desktop/src/components/ProjectPixelInvaderIcon.tsx",
  "apps/desktop/src/lib/browseForDirectory.ts",
  "apps/desktop/src/lib/projectIconSets.ts",
  "apps/desktop/src/lib/sidebarActivity.ts",
  "apps/desktop/src/lib/workbenchScopeKey.ts",
  "apps/desktop/src/lib/workbenchStore.ts",
  "apps/desktop/src/lib/workbenchTileContract.ts",
  "apps/desktop/src/lib/workspaceIdentity.ts",
  "apps/desktop/src/lib/workspaceRuntimeStore.ts",
];

interface PinnedFeatureImport {
  /** Repo-relative path of the neutral module doing the importing. */
  readonly file: string;
  /** The `@/features/…` specifier it still reaches for. */
  readonly specifier: string;
  /** Why this one does not re-close a cycle. */
  readonly because: string;
}

const PINNED_FEATURE_IMPORTS: readonly PinnedFeatureImport[] = [
  {
    file: "apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx",
    specifier: "@/features/collaboration/hooks/useCollabSession",
    because:
      "The provider runtime composes the capabilities the sync context exposes rather than being ambient itself; it belongs in app composition, not here.",
  },
  {
    file: "apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx",
    specifier: "@/features/source-control/hooks/useProjectCheckpointCleanup",
    because: "Same runtime, same reason.",
  },
  {
    file: "apps/desktop/src/contexts/project/projectSyncShared.ts",
    specifier: "@/features/collaboration/hooks/useCollabSession",
    because:
      "Type-only. CollabEncryptionBootstrap is a collaboration contract that has no home of its own yet.",
  },
  {
    file: "apps/desktop/src/lib/sidebarActivity.ts",
    specifier: "@/features/dev-server/devServerRunStore",
    because: "Type-only. Terminal and workbench publish into this engine; only the status type comes back.",
  },
  {
    file: "apps/desktop/src/lib/sidebarActivity.ts",
    specifier: "@/features/assistant/model/types",
    because: "Type-only. Same engine, same direction.",
  },
];

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function neutralFiles(): string[] {
  const fromRoots = NEUTRAL_ROOTS.flatMap((root) =>
    listSourceFiles(path.join(REPO_ROOT, root)).map((file) =>
      path.relative(REPO_ROOT, file).split(path.sep).join("/"),
    ),
  );
  return [...fromRoots, ...NEUTRAL_MODULES].sort();
}

/**
 * Both the aliased and the relative form are resolved: a neutral module is one
 * `../../features/` away from importing a feature without the alias, and the
 * guardrail would never notice.
 */
function readFeatureImports(): string[] {
  const found: string[] = [];

  for (const file of neutralFiles()) {
    const absolute = path.join(REPO_ROOT, file);
    const source = fs.readFileSync(absolute, "utf8");

    for (const [, specifier] of source.matchAll(/["'](@\/features\/[^"']+)["']/g)) {
      found.push(`${file} -> ${specifier}`);
    }

    for (const [, specifier] of source.matchAll(/["'](\.{1,2}\/[^"']+)["']/g)) {
      const resolved = path.resolve(path.dirname(absolute), specifier);
      const relative = path.relative(REPO_ROOT, resolved).split(path.sep).join("/");
      if (!relative.startsWith("apps/desktop/src/features/")) continue;
      found.push(`${file} -> ${relative}`);
    }
  }

  return [...new Set(found)].sort();
}

describe("neutral ground", () => {
  it("reaches back into features only where pinned", () => {
    const pinned = PINNED_FEATURE_IMPORTS.map(
      ({ file, specifier }) => `${file} -> ${specifier}`,
    ).sort();

    // Equality reports both directions: an unpinned import is a regression, and
    // a pin with nothing behind it has been fixed and must be deleted, so the
    // count can never drift back up.
    expect(readFeatureImports()).toEqual(pinned);
  });

  it("every pin names a file that is actually neutral ground", () => {
    const neutral = new Set(neutralFiles());

    for (const { file, because } of PINNED_FEATURE_IMPORTS) {
      expect(neutral, `${file} is pinned but is not neutral ground`).toContain(file);
      expect(because.length, `${file} records no reason`).toBeGreaterThan(0);
    }
  });

  it("names only modules that exist", () => {
    for (const file of NEUTRAL_MODULES) {
      expect(fs.existsSync(path.join(REPO_ROOT, file)), `${file} is gone`).toBe(true);
    }
  });
});
