import { describe, expect, it } from "vitest";

import { ThreadId } from "@cozea/assistant-contracts";

import {
  CHECKPOINT_REFS_PREFIX,
  LEGACY_T3_CHECKPOINT_REFS_PREFIX,
  checkpointRefForGroupId,
  checkpointRefForThreadTurn,
  normalizeCheckpointRef,
} from "../../../../apps/desktop/electron/substrate/vcs/checkpointRefs";

describe("checkpointRefs (unified namespace)", () => {
  it("uses refs/cozea/checkpoints for group and turn refs", () => {
    expect(checkpointRefForGroupId("group-1")).toBe(`${CHECKPOINT_REFS_PREFIX}/group-1`);
    const turnRef = checkpointRefForThreadTurn(ThreadId.makeUnsafe("thread-1"), 2);
    expect(String(turnRef)).toMatch(new RegExp(`^${CHECKPOINT_REFS_PREFIX}/.+/turn/2$`));
  });

  it("normalizes legacy refs/t3/checkpoints refs", () => {
    const legacy = `${LEGACY_T3_CHECKPOINT_REFS_PREFIX}/abc/turn/1`;
    expect(normalizeCheckpointRef(legacy)).toBe(`${CHECKPOINT_REFS_PREFIX}/abc/turn/1`);
    expect(normalizeCheckpointRef(`${CHECKPOINT_REFS_PREFIX}/abc/turn/1`)).toBe(
      `${CHECKPOINT_REFS_PREFIX}/abc/turn/1`,
    );
  });
});
