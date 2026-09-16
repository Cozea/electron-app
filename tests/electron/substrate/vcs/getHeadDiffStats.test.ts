import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getHeadDiffStats } from "../../../../apps/desktop/electron/substrate/vcs/checkpointOps";
import { useTestGitIdentity } from "../../../helpers/gitIdentity";

/**
 * `getHeadDiffStats` feeds the Changes header's "+n −n". It used to build a
 * throwaway commit to get there — a temp index, `read-tree HEAD`, `add -A` over
 * the whole working tree, `write-tree`, `commit-tree` — and then diff it.
 *
 * It now reads the working tree once and counts the patch. These pin the part
 * that staging everything used to give for free: untracked files still count,
 * and the numbers still describe the distance from HEAD.
 */
describe("getHeadDiffStats", () => {
  useTestGitIdentity();

  let repoDir: string;

  function git(args: string[]): void {
    const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
  }

  function commit(message: string): void {
    // The person's own signing and hooks must not decide whether a test commit
    // succeeds, the way `gitRuntimeUsesPersonsGit` isolates the same concerns.
    git([
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${path.join(repoDir, "no-such-hooks")}`,
      "commit",
      "-m",
      message,
    ]);
  }

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-head-stats-"));
    git(["init", "-b", "main"]);
    fs.writeFileSync(path.join(repoDir, "notes.md"), "a\nb\nc\n");
    git(["add", "notes.md"]);
    commit("base");
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("reports nothing for a clean tree", async () => {
    await expect(getHeadDiffStats(repoDir)).resolves.toEqual({
      success: true,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    });
  });

  it("counts an edit to a tracked file", async () => {
    fs.writeFileSync(path.join(repoDir, "notes.md"), "A\nb\nc\nd\n");

    await expect(getHeadDiffStats(repoDir)).resolves.toEqual({
      success: true,
      additions: 2,
      deletions: 1,
      changedFiles: 1,
    });
  });

  it("counts an untracked file, as staging everything used to", async () => {
    fs.writeFileSync(path.join(repoDir, "extra.md"), "x\ny\n");

    await expect(getHeadDiffStats(repoDir)).resolves.toEqual({
      success: true,
      additions: 2,
      deletions: 0,
      changedFiles: 1,
    });
  });

  it("counts tracked edits and untracked files together", async () => {
    fs.writeFileSync(path.join(repoDir, "notes.md"), "A\nb\nc\nd\n");
    fs.writeFileSync(path.join(repoDir, "extra.md"), "x\ny\n");

    await expect(getHeadDiffStats(repoDir)).resolves.toEqual({
      success: true,
      additions: 4,
      deletions: 1,
      changedFiles: 2,
    });
  });

  it("leaves the real index alone", async () => {
    fs.writeFileSync(path.join(repoDir, "extra.md"), "x\ny\n");
    await getHeadDiffStats(repoDir);

    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    expect(staged.stdout.trim()).toBe("");
  });
});
