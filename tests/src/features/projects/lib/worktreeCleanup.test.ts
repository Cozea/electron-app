import { describe, expect, it } from "vitest";

import {
  buildOrphanWorktreePromptMessage,
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
} from "@/features/assistant/services/worktreeCleanup";

describe("worktreeCleanup", () => {
  it("returns null when the target thread has no worktree", () => {
    const result = getOrphanedWorktreePathForThread(
      [{ id: "thread-1", worktreePath: null }],
      "thread-1",
    );
    expect(result).toBeNull();
  });

  it("returns the path when no other thread links to that worktree", () => {
    const threads = [{ id: "thread-1", worktreePath: "/tmp/repo/worktrees/feature-a" }];
    expect(getOrphanedWorktreePathForThread(threads, "thread-1")).toBe(
      "/tmp/repo/worktrees/feature-a",
    );
  });

  it("returns null when another thread links to the same worktree", () => {
    const threads = [
      { id: "thread-1", worktreePath: "/tmp/repo/worktrees/feature-a" },
      { id: "thread-2", worktreePath: "/tmp/repo/worktrees/feature-a" },
    ];
    expect(getOrphanedWorktreePathForThread(threads, "thread-1")).toBeNull();
  });

  it("ignores threads linked to different worktrees", () => {
    const threads = [
      { id: "thread-1", worktreePath: "/tmp/repo/worktrees/feature-a" },
      { id: "thread-2", worktreePath: "/tmp/repo/worktrees/feature-b" },
    ];
    expect(getOrphanedWorktreePathForThread(threads, "thread-1")).toBe(
      "/tmp/repo/worktrees/feature-a",
    );
  });

  it("formats display paths using the final segment", () => {
    expect(formatWorktreePathForDisplay("/Users/me/.cozea/worktrees/app/feature-a")).toBe(
      "feature-a",
    );
    expect(formatWorktreePathForDisplay("C:\\Users\\me\\.cozea\\worktrees\\app\\feature-a")).toBe(
      "feature-a",
    );
    expect(formatWorktreePathForDisplay("/tmp/custom-worktrees/my-worktree/")).toBe("my-worktree");
  });

  it("builds a keep-vs-prune prompt message", () => {
    expect(buildOrphanWorktreePromptMessage("/tmp/repo/worktrees/feature-a")).toContain(
      "Delete the worktree too?",
    );
    expect(buildOrphanWorktreePromptMessage("/tmp/repo/worktrees/feature-a")).toContain(
      "feature-a",
    );
  });
});
