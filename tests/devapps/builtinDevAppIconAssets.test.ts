import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const BUILTIN_ICON_PATHS = [
  "browser/icon.png",
  "claude/icon.png",
  "codex/icon.png",
  "cursor/icon.png",
  "dev-server/icon.png",
  "mobile-simulator/icon.png",
  "opencode/icon.png",
  "published/icon.png",
  "terminal/icon.png",
] as const;

function resolveIconPath(relativePath: (typeof BUILTIN_ICON_PATHS)[number]): string {
  return fileURLToPath(
    new URL(
      `../../apps/desktop/src/features/devapps/apps/${relativePath}`,
      import.meta.url,
    ),
  );
}

function readPngDimensions(path: string): { width: number; height: number } {
  const contents = readFileSync(path);
  const pngSignature = contents.subarray(0, 8).toString("hex");

  expect(pngSignature).toBe("89504e470d0a1a0a");

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

describe("built-in DevApp icon assets", () => {
  it.each(BUILTIN_ICON_PATHS)("keeps %s sharp on high-density displays", (relativePath) => {
    expect(readPngDimensions(resolveIconPath(relativePath))).toEqual({ width: 512, height: 512 });
  });

  it("gives published DevApps artwork distinct from every built-in app", () => {
    const publishedIcon = readFileSync(resolveIconPath("published/icon.png"));

    for (const relativePath of BUILTIN_ICON_PATHS) {
      if (relativePath === "published/icon.png") continue;
      expect(publishedIcon.equals(readFileSync(resolveIconPath(relativePath)))).toBe(false);
    }
  });
});
