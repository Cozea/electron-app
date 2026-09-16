import { describe, expect, it } from "vitest";

import {
  shouldClearEphemeralChanges,
  type CheckpointCleanupObservation,
} from "../../apps/desktop/src/features/source-control/model/checkpointCleanupDecision";

/**
 * Ephemeral change records describe work that is not committed yet. Once a
 * commit has absorbed them they describe a moment that is gone, and the only
 * evidence of that commit is HEAD moving while the tree came back clean.
 */
function observation(
  overrides: Partial<CheckpointCleanupObservation> = {},
): CheckpointCleanupObservation {
  return { headCommit: "a".repeat(40), changedFiles: 0, hasError: false, ...overrides };
}

describe("shouldClearEphemeralChanges", () => {
  const before = observation({ headCommit: "a".repeat(40), changedFiles: 3 });
  const after = observation({ headCommit: "b".repeat(40), changedFiles: 0 });

  it("clears once a commit lands and leaves the tree clean", () => {
    expect(shouldClearEphemeralChanges(before, after, null)).toBe(true);
  });

  it("clears even when the dirty half was never observed", () => {
    // Editing in another editor touches no Git state, so nothing invalidates
    // and the last snapshot can still read clean when the commit arrives. The
    // poll this replaced sampled often enough to catch the dirty half; the
    // event stream does not, so HEAD moving has to be enough on its own.
    const cleanBefore = observation({ headCommit: "a".repeat(40), changedFiles: 0 });
    expect(shouldClearEphemeralChanges(cleanBefore, after, null)).toBe(true);
  });

  it("holds while the tree still has uncommitted work", () => {
    const partial = observation({ headCommit: "b".repeat(40), changedFiles: 2 });
    expect(shouldClearEphemeralChanges(before, partial, null)).toBe(false);
  });

  it("holds when HEAD has not moved", () => {
    const same = observation({ headCommit: "a".repeat(40), changedFiles: 0 });
    expect(shouldClearEphemeralChanges(before, same, null)).toBe(false);
  });

  it("does not clear twice for the same commit", () => {
    expect(shouldClearEphemeralChanges(before, after, "b".repeat(40))).toBe(false);
  });

  it("waits for a first observation before deciding anything moved", () => {
    expect(shouldClearEphemeralChanges(null, after, null)).toBe(false);
  });

  it("ignores a snapshot that failed to compute", () => {
    const failed = observation({ headCommit: "b".repeat(40), hasError: true });
    expect(shouldClearEphemeralChanges(before, failed, null)).toBe(false);
  });

  it("ignores a repository with no commits yet", () => {
    const empty = observation({ headCommit: null });
    expect(shouldClearEphemeralChanges(before, empty, null)).toBe(false);
  });
});
