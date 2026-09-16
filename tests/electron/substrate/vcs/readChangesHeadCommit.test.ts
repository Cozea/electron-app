import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readChanges } from "../../../../apps/desktop/electron/substrate/vcs/checkpointOps";
import { useTestGitIdentity } from "../../../helpers/gitIdentity";

/**
 * A commit is invisible in the working tree — that is the whole difficulty. The
 * `current` scope reports `headRef` as the literal string `'working tree'`, so
 * the commit HEAD points at is what tells the renderer that a commit happened
 * and that the records describing uncommitted work can go.
 */
describe("readChanges reports the commit HEAD points at", () => {
  useTestGitIdentity();

  let repoDir: string;

  function git(args: string[]): string {
    const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  }

  function commit(message: string): void {
    // The person's own signing and hooks must not decide whether a test commit
    // succeeds, matching the isolation in getHeadDiffStats.test.ts.
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
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-head-commit-"));
    git(["init", "-b", "main"]);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("has no commit to report before the first one", async () => {
    const result = await readChanges({ cwd: repoDir, scope: "current" });

    expect(result.success).toBe(true);
    expect(result.headCommit).toBeUndefined();
  });

  it("reports the current commit", async () => {
    fs.writeFileSync(path.join(repoDir, "notes.md"), "a\n");
    git(["add", "notes.md"]);
    commit("base");

    const result = await readChanges({ cwd: repoDir, scope: "current" });

    expect(result.headCommit).toBe(git(["rev-parse", "HEAD"]));
  });

  it("moves when a commit lands, while the tree goes back to clean", async () => {
    fs.writeFileSync(path.join(repoDir, "notes.md"), "a\n");
    git(["add", "notes.md"]);
    commit("base");
    const before = await readChanges({ cwd: repoDir, scope: "current" });

    fs.writeFileSync(path.join(repoDir, "notes.md"), "a\nb\n");
    const dirty = await readChanges({ cwd: repoDir, scope: "current" });
    expect(dirty.headCommit).toBe(before.headCommit);
    expect(dirty.files).toHaveLength(1);

    git(["add", "notes.md"]);
    commit("second");
    const after = await readChanges({ cwd: repoDir, scope: "current" });

    expect(after.headCommit).not.toBe(before.headCommit);
    expect(after.files).toHaveLength(0);
  });
});
