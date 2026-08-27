import { afterEach, describe, expect, it, vi } from "vitest";

import { resetCheckpointFacadeForTests } from "../../../../apps/desktop/electron/substrate/vcs/checkpointsFacade";
import {
  resetVcsStatusBroadcasterForTests,
  VcsStatusBroadcaster,
} from "../../../../apps/desktop/electron/substrate/vcs/VcsStatusBroadcaster";

describe("VcsStatusBroadcaster (phase 4c)", () => {
  afterEach(() => {
    resetVcsStatusBroadcasterForTests();
    resetCheckpointFacadeForTests();
  });

  it("notifies listeners on invalidate without polling", async () => {
    const broadcaster = VcsStatusBroadcaster.getInstance();
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    broadcaster.registerWorkspaceId("/tmp/cozea-vcs-test-repo", "ws-1");

    const readChanges = vi.fn(async () => ({
      success: true as const,
      scope: "current" as const,
      files: [],
      diff: "",
    }));
    const getHeadDiffStats = vi.fn(async () => ({
      success: true as const,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }));

    const { registerLegacyChangesCheckpointBackend } = await import(
      "../../../../apps/desktop/electron/substrate/vcs/checkpointsFacade"
    );
    registerLegacyChangesCheckpointBackend({
      readChanges,
      getHeadDiffStats,
    });

    await broadcaster.refresh("/tmp/cozea-vcs-test-repo", "current");
    expect(readChanges).toHaveBeenCalled();

    listener.mockClear();
    broadcaster.invalidateProjectPath("/tmp/cozea-vcs-test-repo");

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(listener.mock.calls.length).toBeGreaterThan(0);
  });
});
