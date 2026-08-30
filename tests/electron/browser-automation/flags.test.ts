import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("removed browser automation feature flag", () => {
  it("cannot re-enable the deleted adapter through environment configuration", () => {
    const firstPartySource = ["apps/desktop/electron", "apps/desktop/src", "shared"].map(
      (relativePath) => path.join(process.cwd(), relativePath),
    );

    const readTree = (directory: string): string[] =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return readTree(entryPath);
        return /\.(?:ts|tsx)$/.test(entry.name) ? [fs.readFileSync(entryPath, "utf8")] : [];
      });

    expect(firstPartySource.flatMap(readTree).join("\n")).not.toContain(
      "COZEA_BROWSER_AGENT_AUTOMATION",
    );
  });
});
