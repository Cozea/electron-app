import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readChanges } from "../../../../apps/desktop/electron/substrate/vcs/checkpointOps";
import { parsePorcelainV2Status } from "../../../../shared/git/porcelainStatus";
import { useTestGitIdentity } from "../../../helpers/gitIdentity";

/**
 * The Changes list read porcelain v1, where `-z` reverses a rename to
 * `R  <new>\0<old>`, and took the first path as the old one. Every staged
 * rename appeared backwards, naming a file that no longer exists. These run
 * against real Git because the bug was in believing the format, not the code.
 */
describe("the Changes list reads the working tree through the shared parser", () => {
  useTestGitIdentity();

  let repoDir: string;

  function git(args: string[]): string {
    const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  function write(name: string, content = "content\n"): void {
    fs.mkdirSync(path.dirname(path.join(repoDir, name)), { recursive: true });
    fs.writeFileSync(path.join(repoDir, name), content);
  }

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-status-"));
    git(["init", "-b", "main"]);
    for (const name of ["old-name.txt", "doomed.txt", "edited.txt"]) write(name);
    git(["add", "."]);
    git([
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${path.join(repoDir, "no-such-hooks")}`,
      "commit",
      "-m",
      "base",
    ]);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("reports a staged rename with the new path as the path", async () => {
    git(["mv", "old-name.txt", "new-name.txt"]);

    const result = await readChanges({ cwd: repoDir, scope: "current" });

    expect(result.files).toContainEqual({ path: "new-name.txt", oldPath: "old-name.txt", status: "renamed" });
  });

  it("classifies deletions, edits, staged additions and untracked files", async () => {
    fs.rmSync(path.join(repoDir, "doomed.txt"));
    write("edited.txt", "changed\n");
    write("staged.txt");
    git(["add", "staged.txt"]);
    write("untracked.txt");

    const result = await readChanges({ cwd: repoDir, scope: "current" });

    expect(result.files).toEqual([
      { path: "doomed.txt", status: "deleted" },
      { path: "edited.txt", status: "modified" },
      { path: "staged.txt", status: "added" },
      { path: "untracked.txt", status: "added" },
    ]);
    // Untracked files still get a synthetic diff against /dev/null.
    expect(result.diff).toMatch(/\+\+\+ b\/.*untracked\.txt/);
  });

  it("keeps file names that a line-based parser would corrupt", async () => {
    const awkward = ["with space.txt", " leading-space.txt", "arrow -> name.txt", "new\nline.txt"];
    for (const name of awkward) write(name);

    const result = await readChanges({ cwd: repoDir, scope: "current" });

    expect(result.files.map((file) => file.path).sort()).toEqual([...awkward].sort());
  });

  it("leaves truncation to the caller", () => {
    const output = ["? a.txt", "? b.txt", "? c.txt", ""].join("\0");

    expect(parsePorcelainV2Status(output, 2)).toMatchObject({ isTruncated: true });
    expect(parsePorcelainV2Status(output, 2).files).toHaveLength(2);
    expect(parsePorcelainV2Status(output, Number.POSITIVE_INFINITY).files).toHaveLength(3);
  });
});
