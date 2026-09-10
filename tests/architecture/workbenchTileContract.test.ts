import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  WORKBENCH_TILE_DEFAULT_TITLES,
  type WorkbenchTileType,
} from "@/lib/workbenchTileContract";

/**
 * Architecture guardrail: Cozea collaboration is project-centric and filesystem-based.
 *
 * Invariant C10: Do not add a built-in source editor to make collaboration function.
 * Collaboration operates across local workspaces via CRDT convergence on the filesystem,
 * not on a built-in code editor tile.
 */
describe("workbench tile contract architecture boundary", () => {
  const FORBIDDEN_EDITOR_TILE_TYPES = [
    "editor",
    "codeEditor",
    "fileEditor",
    "sourceEditor",
    "textEditor",
    "monaco",
  ];

  it("asserts WorkbenchTileType contract has no collaboration-required source editor", () => {
    const tileTypes = Object.keys(WORKBENCH_TILE_DEFAULT_TITLES) as WorkbenchTileType[];

    // Ensure none of the registered tile types are editor tiles
    for (const forbidden of FORBIDDEN_EDITOR_TILE_TYPES) {
      expect(tileTypes).not.toContain(forbidden);
    }

    // Explicitly pin the allowed set of workbench tile types
    const expectedTileTypes: WorkbenchTileType[] = [
      "browser",
      "terminal",
      "devServer",
      "memory",
      "llama",
      "mobileSimulator",
      "orgDevApp",
      "devAppPreview",
      "selection",
      "tasks",
      "assistantChat",
    ];

    expect(tileTypes.sort()).toEqual(expectedTileTypes.sort());
  });

  it("asserts workbenchTileContract source file contains no editor tile declarations", () => {
    const contractPath = path.resolve(
      __dirname,
      "../../apps/desktop/src/lib/workbenchTileContract.ts",
    );
    const source = fs.readFileSync(contractPath, "utf8");

    // Must not declare an editor tile interface or type
    for (const forbidden of FORBIDDEN_EDITOR_TILE_TYPES) {
      const typeRegex = new RegExp(`["']${forbidden}["']`, "i");
      expect(source).not.toMatch(typeRegex);
    }
  });

  it("asserts collaboration feature does not import or require an editor tile", () => {
    const collabDir = path.resolve(__dirname, "../../apps/desktop/src/features/collaboration");
    if (!fs.existsSync(collabDir)) return;

    const files = fs.readdirSync(collabDir, { recursive: true }) as string[];
    for (const file of files) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const filePath = path.join(collabDir, file);
      const content = fs.readFileSync(filePath, "utf8");

      for (const forbidden of FORBIDDEN_EDITOR_TILE_TYPES) {
        expect(content).not.toMatch(new RegExp(`type:\\s*["']${forbidden}["']`));
      }
    }
  });
});
