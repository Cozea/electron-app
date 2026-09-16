import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerLegacyChangesCheckpointBackend,
  resetCheckpointFacadeForTests,
} from "../../../../apps/desktop/electron/substrate/vcs/checkpointsFacade";
import {
  resetVcsStatusBroadcasterForTests,
  VcsStatusBroadcaster,
} from "../../../../apps/desktop/electron/substrate/vcs/VcsStatusBroadcaster";

const REPO = "/tmp/cozea-scope-interest-repo";

/**
 * Branch scope costs a `merge-base` and two diffs. Recomputing it because a
 * file changed, when only the Changes list for the working tree is open, is
 * work nobody reads.
 */
describe("invalidation follows scope interest", () => {
  afterEach(() => {
    resetVcsStatusBroadcasterForTests();
    resetCheckpointFacadeForTests();
    vi.useRealTimers();
  });

  function installBackend(): ReturnType<typeof vi.fn> {
    const readChanges = vi.fn(async (input: { scope: "current" | "branch" }) => ({
      success: true as const,
      scope: input.scope,
      files: [],
      diff: "",
    }));
    registerLegacyChangesCheckpointBackend({
      readChanges,
      getHeadDiffStats: async () => ({
        success: true as const,
        additions: 0,
        deletions: 0,
        changedFiles: 0,
      }),
    });
    return readChanges;
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  it("refreshes only the scopes someone is watching", async () => {
    const broadcaster = VcsStatusBroadcaster.getInstance();
    const readChanges = installBackend();
    broadcaster.setScopeInterestProvider(() => ["current"]);

    broadcaster.invalidateProjectPath(REPO);
    await settle();

    const scopes = readChanges.mock.calls.map(([input]) => input.scope);
    expect(scopes).toContain("current");
    expect(scopes).not.toContain("branch");
  });

  it("skips the work entirely when nothing is watching", async () => {
    const broadcaster = VcsStatusBroadcaster.getInstance();
    const readChanges = installBackend();
    broadcaster.setScopeInterestProvider(() => []);

    broadcaster.invalidateProjectPath(REPO);
    await settle();

    expect(readChanges).not.toHaveBeenCalled();
  });

  it("still refreshes every scope when no provider is registered", async () => {
    const broadcaster = VcsStatusBroadcaster.getInstance();
    const readChanges = installBackend();

    broadcaster.invalidateProjectPath(REPO);
    await settle();

    const scopes = readChanges.mock.calls.map(([input]) => input.scope);
    expect(scopes).toContain("current");
    expect(scopes).toContain("branch");
  });
});
