import { afterEach, describe, expect, it } from "vitest";

import {
  createDelegatingCheckpointOps,
  getChangesCheckpointReads,
  registerDriverCheckpointOps,
  registerLegacyChangesCheckpointBackend,
  resetCheckpointFacadeForTests,
  type ChangesCheckpointBackend,
} from "../../../../electron/substrate/vcs/checkpointsFacade";

function makeBackend(): ChangesCheckpointBackend {
  return {
    readChanges: async (input) => ({
      success: true,
      scope: input.scope,
      files: [{ path: "a.ts", status: "modified" }],
      diff: "diff",
    }),
    getHeadDiffStats: async () => ({
      success: true,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    }),
  };
}

describe("checkpointsFacade (Phase 4b)", () => {
  afterEach(() => {
    resetCheckpointFacadeForTests();
  });

  it("uses legacy backend when flag is off", async () => {
    registerLegacyChangesCheckpointBackend(makeBackend());
    const reads = getChangesCheckpointReads({});
    const result = await reads.readChanges({ cwd: "/tmp", scope: "current" });
    expect(result.files).toHaveLength(1);
  });

  it("routes through driver stubs when flag is on", async () => {
    const legacy = makeBackend();
    registerLegacyChangesCheckpointBackend(legacy);
    const stubs = createDelegatingCheckpointOps(legacy);
    registerDriverCheckpointOps(stubs);

    const reads = getChangesCheckpointReads({ COZEA_SUBSTRATE_VCS: "1" });
    const result = await reads.readChanges({ cwd: "/tmp", scope: "branch" });
    expect(result.success).toBe(true);
    expect(result.scope).toBe("branch");
  });
});
