import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitService } from "../../apps/projectd/src/git/GitService";

describe("Canonical GitService", () => {
  let tempDir: string;
  let repoDir: string;
  let service: GitService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-git-test-"));
    repoDir = path.join(tempDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });

    // Initialize real git repo with commits and branches
    execSync("git init -b main", { cwd: repoDir, stdio: "ignore" });
    execSync('git config user.name "Test Author"', { cwd: repoDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: "ignore" });
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Test Repo\n");
    execSync("git add README.md && git commit -m 'Initial commit'", { cwd: repoDir, stdio: "ignore" });

    // Create a feature branch
    execSync("git branch feature-1", { cwd: repoDir, stdio: "ignore" });

    service = new GitService();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists project branches with status and worktrees accurately", async () => {
    const result = await service.listProjectBranches(repoDir);

    expect(result.isRepo).toBe(true);
    expect(result.hasOriginRemote).toBe(false);
    expect(result.branches.length).toBeGreaterThanOrEqual(2);

    const mainBranch = result.branches.find((b) => b.name === "main");
    expect(mainBranch).toBeDefined();
    expect(mainBranch?.current).toBe(true);
    expect(mainBranch?.isRemote).toBe(false);

    const featureBranch = result.branches.find((b) => b.name === "feature-1");
    expect(featureBranch).toBeDefined();
    expect(featureBranch?.current).toBe(false);
    expect(featureBranch?.isRemote).toBe(false);
  });

  it("handles non-repository folders gracefully in listProjectBranches", async () => {
    const nonRepo = path.join(tempDir, "empty");
    fs.mkdirSync(nonRepo, { recursive: true });

    const result = await service.listProjectBranches(nonRepo);
    expect(result.isRepo).toBe(false);
    expect(result.branches).toEqual([]);
    expect(result.hasOriginRemote).toBe(false);
  });

  it("checks out an existing local branch", async () => {
    const checkedOutBranch = await service.checkoutBranch(repoDir, "feature-1");
    expect(checkedOutBranch).toBe("feature-1");

    const status = await service.getStatus(repoDir);
    expect(status.headRef).toBe("feature-1");
  });

  it("creates a git worktree on a new branch", async () => {
    const worktreePath = path.join(tempDir, "wt-branch-2");
    const result = await service.createWorktree(repoDir, "main", {
      newBranch: "wt-feature-2",
      path: worktreePath,
    });

    expect(result.success).toBe(true);
    expect(result.worktree?.path).toBe(worktreePath);
    expect(result.worktree?.branch).toBe("wt-feature-2");
    expect(fs.existsSync(worktreePath)).toBe(true);

    const worktrees = await service.listWorktrees(repoDir);
    expect(worktrees.length).toBe(2);
    expect(worktrees.some((w) => w.branch === "wt-feature-2")).toBe(true);
  });

  it("returns parsed git status from GitStatusParser", async () => {
    fs.writeFileSync(path.join(repoDir, "new-file.txt"), "hello world");
    const status = await service.getStatus(repoDir);

    expect(status.headOid).toBeTruthy();
    expect(status.clean).toBe(false);
    expect(status.files.some((f) => f.path === "new-file.txt" && f.isUntracked)).toBe(true);
  });
});
