import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDevAppManifestV3 } from "@shared/devAppManifestV3Parser";

const fixtureRoot = path.join(process.cwd(), "examples/native-devapps/counter");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(fixtureRoot, relativePath), "utf8");
}

describe("native Counter reference package", () => {
  it("is a valid native React package with no website entry", () => {
    const parsed = parseDevAppManifestV3(read("cozea-devapp.json"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.manifest?.contributes.surfaces[0]?.renderer.kind).toBe("native-react");
    expect(fs.existsSync(path.join(fixtureRoot, "index.html"))).toBe(false);
    expect(fs.existsSync(path.join(fixtureRoot, "src/index.html"))).toBe(false);
  });

  it("uses only the public renderer and extension SDK entry points", () => {
    expect(read("src/index.tsx")).toContain('from "@cozea/devapp-api/native"');
    expect(read("src/extension.ts")).toContain('from "@cozea/devapp-api/extension"');
    expect(read("src/index.tsx")).not.toContain("window.electronAPI");
    expect(read("src/extension.ts")).not.toContain('from "electron"');
  });

  it("keeps package CSS under the app-scoped host selector", () => {
    const styles = read("src/styles.css");
    expect(styles).toContain('[data-cozea-devapp="dev.cozea.examples.counter"]');
    expect(styles).not.toMatch(/(^|\n)\s*(?:html|body|:root|#root)\b/);
  });
});
