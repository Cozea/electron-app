import { describe, expect, it } from "vitest";

import { executeInProcessCheckpointOp } from "../../../../electron/substrate/vcs/inProcessCheckpointOps";

describe("inProcessCheckpointOps (phase 4b)", () => {
  it("rejects unknown methods", async () => {
    await expect(
      executeInProcessCheckpointOp("unknown" as never, {} as never),
    ).rejects.toThrow(/Unknown checkpoint op/);
  });
});
