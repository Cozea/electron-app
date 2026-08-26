import { describe, expect, it } from "vitest";

import {
  buildOrphanWorktreePromptMessage,
  createDetectionOnlyWorktreeOrphanHooks,
  getOrphanedWorktreePathForThread,
} from "../../../../electron/substrate/vcs/worktreeOrphanCleanup";

describe("worktree orphan cleanup (Phase 4e / Track B alignment)", () => {
  it("returns orphan path when only the deleted thread owns it", () => {
    const path = getOrphanedWorktreePathForThread(
      [
        { id: "t1", worktreePath: "/repos/app/.worktrees/feat" },
        { id: "t2", worktreePath: null },
      ],
      "t1",
    );
    expect(path).toBe("/repos/app/.worktrees/feat");
  });

  it("returns null when another thread shares the worktree", () => {
    const path = getOrphanedWorktreePathForThread(
      [
        { id: "t1", worktreePath: "/repos/app/.worktrees/feat" },
        { id: "t2", worktreePath: "/repos/app/.worktrees/feat" },
      ],
      "t1",
    );
    expect(path).toBeNull();
  });

  it("builds a keep-vs-prune prompt", () => {
    expect(buildOrphanWorktreePromptMessage("/repos/app/.worktrees/feat")).toContain("feat");
  });

  it("detection-only hooks require prune wiring", async () => {
    const hooks = createDetectionOnlyWorktreeOrphanHooks();
    await expect(
      hooks.pruneWorktree({ cwd: "/repos/app", worktreePath: "/repos/app/.worktrees/feat" }),
    ).rejects.toThrow(/VcsDriver\.removeWorktree/);
  });
});
