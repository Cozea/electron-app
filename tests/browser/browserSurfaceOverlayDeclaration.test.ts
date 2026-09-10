import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A native browser surface only yields to application UI that it can find
 * (INV-009). Anything that puts itself on one of Cozea's application overlay
 * layers therefore has to declare itself with `data-cozea-overlay`; an
 * undeclared overlay would open underneath a live browser.
 *
 * This is a guard on a registration rule, not on an architecture: it names no
 * backend and forbids none.
 */

const SOURCE_ROOT = path.resolve(__dirname, "../../apps/desktop/src");
const OVERLAY_LAYER = /z-\[var\(--cozea-layer-(?:dialog|menu|tooltip|toast)\)\]/g;
const DECLARATION = /data-cozea-overlay=/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("application overlay declarations", () => {
  it("declares every element placed on an application overlay layer", () => {
    const undeclared = sourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const layered = source.match(OVERLAY_LAYER)?.length ?? 0;
      const declared = source.match(DECLARATION)?.length ?? 0;
      return layered > declared
        ? [`${path.relative(SOURCE_ROOT, file)}: ${layered} layered, ${declared} declared`]
        : [];
    });

    expect(undeclared).toEqual([]);
  });
});
