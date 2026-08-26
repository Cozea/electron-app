import { CommandId, ThreadId } from "@cozea/assistant-contracts";
import { describe, expect, it, vi } from "vitest";

import { deleteAssistantThread } from "@/features/projects/lib/deleteAssistantThread";

describe("deleteAssistantThread", () => {
  const threadId = ThreadId.makeUnsafe("thread-orphan-1");
  const otherThreadId = ThreadId.makeUnsafe("thread-orphan-2");

  it("prompts and prunes an orphan worktree when confirmed", async () => {
    const confirm = vi.fn(async () => true);
    const dispatchDelete = vi.fn(async () => ({ sequence: 1 }));
    const removeWorktree = vi.fn(async () => undefined);
    const stopSession = vi.fn(async () => undefined);
    const closeTerminals = vi.fn(async () => undefined);

    const result = await deleteAssistantThread({
      threadId,
      threads: [
        { id: threadId, worktreePath: "/tmp/repo/worktrees/feature-a" },
        { id: otherThreadId, worktreePath: "/tmp/repo/worktrees/feature-b" },
      ],
      project: { workspaceRoot: "/tmp/repo" },
      deps: {
        confirm,
        dispatchDelete,
        removeWorktree,
        newCommandId: () => CommandId.makeUnsafe("cmd-1"),
        stopSession,
        closeTerminals,
      },
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain("Delete the worktree too?");
    expect(stopSession).toHaveBeenCalledWith(threadId);
    expect(closeTerminals).toHaveBeenCalledWith(threadId);
    expect(dispatchDelete).toHaveBeenCalledWith({
      threadId,
      commandId: CommandId.makeUnsafe("cmd-1"),
    });
    expect(removeWorktree).toHaveBeenCalledWith({
      cwd: "/tmp/repo",
      path: "/tmp/repo/worktrees/feature-a",
      force: true,
    });
    expect(result).toEqual({ status: "deleted", prunedWorktree: true });
  });

  it("keeps the worktree when the prompt is declined", async () => {
    const confirm = vi.fn(async () => false);
    const dispatchDelete = vi.fn(async () => ({ sequence: 1 }));
    const removeWorktree = vi.fn(async () => undefined);

    const result = await deleteAssistantThread({
      threadId,
      threads: [{ id: threadId, worktreePath: "/tmp/repo/worktrees/feature-a" }],
      project: { workspaceRoot: "/tmp/repo" },
      deps: {
        confirm,
        dispatchDelete,
        removeWorktree,
        newCommandId: () => CommandId.makeUnsafe("cmd-2"),
      },
    });

    expect(dispatchDelete).toHaveBeenCalledTimes(1);
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "deleted", prunedWorktree: false });
  });

  it("skips the orphan prompt when the worktree is shared", async () => {
    const confirm = vi.fn(async () => true);
    const dispatchDelete = vi.fn(async () => ({ sequence: 1 }));
    const removeWorktree = vi.fn(async () => undefined);

    const result = await deleteAssistantThread({
      threadId,
      threads: [
        { id: threadId, worktreePath: "/tmp/repo/worktrees/shared" },
        { id: otherThreadId, worktreePath: "/tmp/repo/worktrees/shared" },
      ],
      project: { workspaceRoot: "/tmp/repo" },
      deps: {
        confirm,
        dispatchDelete,
        removeWorktree,
        newCommandId: () => CommandId.makeUnsafe("cmd-3"),
      },
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "deleted", prunedWorktree: false });
  });

  it("reports worktree prune failure after a successful thread delete", async () => {
    const confirm = vi.fn(async () => true);
    const dispatchDelete = vi.fn(async () => ({ sequence: 1 }));
    const removeWorktree = vi.fn(async () => {
      throw new Error("remove failed");
    });

    const result = await deleteAssistantThread({
      threadId,
      threads: [{ id: threadId, worktreePath: "/tmp/repo/worktrees/feature-a" }],
      project: { workspaceRoot: "/tmp/repo" },
      deps: {
        confirm,
        dispatchDelete,
        removeWorktree,
        newCommandId: () => CommandId.makeUnsafe("cmd-4"),
      },
    });

    expect(dispatchDelete).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("deleted_worktree_failed");
    if (result.status === "deleted_worktree_failed") {
      expect(result.worktreePath).toBe("/tmp/repo/worktrees/feature-a");
    }
  });
});
